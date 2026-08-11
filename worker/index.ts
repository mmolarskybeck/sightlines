import {
  analyticsDimensions,
  sanitizeTelemetryEvent
} from "../src/telemetry/eventContract";
import {
  asDropboxDownloadUrl,
  DROPBOX_SHARE_PROXY_PATH,
  isDropboxFileShareUrl
} from "../src/app/cloud/dropboxShare";

const ANALYTICS_PATH = "/api/analytics";
const PRODUCTION_ORIGIN = "https://app.sightlines.art";
const MAX_BODY_BYTES = 4_096;
const MAX_SHARE_REQUEST_BYTES = 8_192;
const MAX_SHARED_PACKAGE_BYTES = 256 * 1024 * 1024;

function response(status: number, headers?: HeadersInit): Response {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const [mediaType, ...parameters] = value.split(";").map((part) => part.trim());
  if (mediaType.toLowerCase() !== "application/json") return false;
  return parameters.every((parameter) => /^charset=utf-8$/i.test(parameter));
}

async function readBoundedBody(
  request: Request,
  maxBytes = MAX_BODY_BYTES
): Promise<string | null> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      return null;
    }
  }

  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let bytesRead = 0;
  let body = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } catch {
    await reader.cancel().catch(() => {});
    return null;
  } finally {
    reader.releaseLock();
  }
}

function boundedShareStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let bytesRead = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          reader.releaseLock();
          return;
        }
        bytesRead += value.byteLength;
        if (bytesRead > MAX_SHARED_PACKAGE_BYTES) {
          await reader.cancel();
          controller.error(new Error("Shared package exceeded the relay limit."));
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
}

export async function handleDropboxShareRequest(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname !== DROPBOX_SHARE_PROXY_PATH) return response(404);
  if (request.method !== "POST") return response(405, { Allow: "POST" });
  if (request.headers.get("origin") !== requestUrl.origin) return response(403);
  if (!isJsonContentType(request.headers.get("content-type"))) return response(415);

  const raw = await readBoundedBody(request, MAX_SHARE_REQUEST_BYTES);
  if (raw === null) return response(413);

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return response(400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return response(400);
  const record = payload as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.url !== "string") {
    return response(400);
  }
  if (!isDropboxFileShareUrl(record.url)) return response(400);

  let upstream: Response;
  try {
    upstream = await fetch(asDropboxDownloadUrl(record.url), {
      redirect: "follow",
      headers: {
        Accept: "application/octet-stream",
        // Ask Dropbox for at most one byte beyond the limit. Content-Range
        // lets us reject an oversized file before streaming it; the bounded
        // wrapper remains the fallback if an upstream ignores Range.
        Range: `bytes=0-${MAX_SHARED_PACKAGE_BYTES}`
      }
    });
  } catch {
    return response(502);
  }
  if (!upstream.ok) {
    return response(upstream.status === 404 || upstream.status === 409 ? 404 : 502);
  }
  const length = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_SHARED_PACKAGE_BYTES) {
    return response(413);
  }
  const contentRange = upstream.headers.get("content-range");
  const totalMatch = contentRange?.match(/\/(\d+)$/);
  if (totalMatch && Number(totalMatch[1]) > MAX_SHARED_PACKAGE_BYTES) {
    await upstream.body?.cancel().catch(() => {});
    return response(413);
  }
  if (!upstream.body) return response(502);

  return new Response(boundedShareStream(upstream.body), {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function handleAnalyticsRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== PRODUCTION_ORIGIN || url.pathname !== ANALYTICS_PATH) {
    return response(404);
  }
  if (request.method !== "POST") {
    return response(405, { Allow: "POST" });
  }
  if (request.headers.get("origin") !== PRODUCTION_ORIGIN) {
    return response(403);
  }
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return response(415);
  }

  const body = await readBoundedBody(request);
  if (body === null) return response(413);

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return response(400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return response(400);
  const record = payload as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    !("name" in record) ||
    !("properties" in record)
  ) return response(400);

  const event = sanitizeTelemetryEvent(record.name, record.properties, {
    rejectUnknownProperties: true
  });
  if (!event) return response(400);

  const dimensions = analyticsDimensions(event);
  env.PRODUCT_ANALYTICS.writeDataPoint({
    indexes: [event.name],
    blobs: dimensions
  });
  return response(204);
}

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname === DROPBOX_SHARE_PROXY_PATH) {
      return handleDropboxShareRequest(request);
    }
    return handleAnalyticsRequest(request, env);
  }
} satisfies ExportedHandler<Env>;
