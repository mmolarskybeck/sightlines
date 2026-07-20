import {
  analyticsDimensions,
  sanitizeTelemetryEvent
} from "../src/telemetry/eventContract";

const ANALYTICS_PATH = "/api/analytics";
const PRODUCTION_ORIGIN = "https://app.sightlines.art";
const MAX_BODY_BYTES = 4_096;

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

async function readBoundedBody(request: Request): Promise<string | null> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0 || parsedLength > MAX_BODY_BYTES) {
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
      if (bytesRead > MAX_BODY_BYTES) {
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
    return handleAnalyticsRequest(request, env);
  }
} satisfies ExportedHandler<Env>;
