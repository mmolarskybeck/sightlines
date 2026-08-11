import { describe, expect, it, vi } from "vitest";
import { handleAnalyticsRequest, handleDropboxShareRequest } from "./index";

const endpoint = "https://app.sightlines.art/api/analytics";

function setup() {
  const writeDataPoint = vi.fn();
  const env = {
    PRODUCT_ANALYTICS: { writeDataPoint }
  } as Env;
  return { env, writeDataPoint };
}

function request(
  body: string,
  init: { method?: string; origin?: string; contentType?: string; url?: string } = {}
) {
  return new Request(init.url ?? endpoint, {
    method: init.method ?? "POST",
    headers: {
      Origin: init.origin ?? "https://app.sightlines.art",
      "Content-Type": init.contentType ?? "application/json"
    },
    body: init.method === "GET" ? undefined : body
  });
}

describe("product analytics Worker", () => {
  it("writes only the allowlisted event dimensions and returns 204", async () => {
    const { env, writeDataPoint } = setup();
    const result = await handleAnalyticsRequest(
      request(JSON.stringify({ name: "view_opened", properties: { view: "3d" } })),
      env
    );

    expect(result.status).toBe(204);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: ["view_opened"],
      blobs: ["view_opened", "3d", ""]
    });
  });

  it.each([
    ["unknown event", { name: "project_named", properties: {} }],
    ["unknown enum", { name: "view_opened", properties: { view: "gallery" } }],
    ["extra payload field", { name: "project_created", properties: {}, title: "Secret" }],
    ["extra property", { name: "view_opened", properties: { view: "plan", title: "Secret" } }],
    ["missing properties", { name: "project_created" }]
  ])("rejects %s", async (_label, payload) => {
    const { env, writeDataPoint } = setup();
    const result = await handleAnalyticsRequest(request(JSON.stringify(payload)), env);
    expect(result.status).toBe(400);
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it("rejects non-production request and Origin hosts, including local and preview hosts", async () => {
    for (const [url, origin] of [
      ["http://localhost:5173/api/analytics", "http://localhost:5173"],
      ["https://feature.sightlines.workers.dev/api/analytics", "https://feature.sightlines.workers.dev"],
      [endpoint, "https://sightlines.art"]
    ]) {
      const { env, writeDataPoint } = setup();
      const result = await handleAnalyticsRequest(
        request('{"name":"project_created","properties":{}}', { url, origin }),
        env
      );
      expect([403, 404]).toContain(result.status);
      expect(writeDataPoint).not.toHaveBeenCalled();
    }
  });

  it("accepts only POST and JSON", async () => {
    const method = await handleAnalyticsRequest(request("", { method: "GET" }), setup().env);
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("POST");

    const mediaType = await handleAnalyticsRequest(
      request("{}", { contentType: "text/plain" }),
      setup().env
    );
    expect(mediaType.status).toBe(415);
  });

  it("accepts JSON with an explicit UTF-8 charset", async () => {
    const result = await handleAnalyticsRequest(
      request('{"name":"project_created","properties":{}}', {
        contentType: "application/json; charset=UTF-8"
      }),
      setup().env
    );
    expect(result.status).toBe(204);
  });

  it("rejects malformed and oversized streaming bodies without writing them", async () => {
    const malformed = setup();
    expect((await handleAnalyticsRequest(request("{"), malformed.env)).status).toBe(400);
    expect(malformed.writeDataPoint).not.toHaveBeenCalled();

    const oversized = setup();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(3_000));
        controller.enqueue(new Uint8Array(2_000));
        controller.close();
      }
    });
    const oversizedRequest = new Request(endpoint, {
      method: "POST",
      headers: {
        Origin: "https://app.sightlines.art",
        "Content-Type": "application/json"
      },
      body: stream,
      duplex: "half"
    } as RequestInit);
    expect((await handleAnalyticsRequest(oversizedRequest, oversized.env)).status).toBe(413);
    expect(oversized.writeDataPoint).not.toHaveBeenCalled();
  });
});

describe("Dropbox share relay", () => {
  const shareEndpoint = "https://app.sightlines.art/api/dropbox-share";
  const dropboxUrl =
    "https://www.dropbox.com/scl/fi/token/project.sightlines?rlkey=secret&dl=0";

  function shareRequest(
    url = dropboxUrl,
    origin = "https://app.sightlines.art"
  ): Request {
    return new Request(shareEndpoint, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
  }

  it("streams a supported Dropbox file without caching it", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([80, 75, 3, 4]), {
        status: 200,
        headers: { "Content-Length": "4", "Content-Type": "application/zip" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleDropboxShareRequest(shareRequest());

    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(result.headers.get("content-type")).toBe("application/octet-stream");
    expect(Array.from(new Uint8Array(await result.arrayBuffer()))).toEqual([80, 75, 3, 4]);
    const requested = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requested.searchParams.get("dl")).toBe("1");
    expect(requested.searchParams.get("rlkey")).toBe("secret");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Range: `bytes=0-${256 * 1024 * 1024}`
    });
  });

  it("rejects cross-origin callers and arbitrary download hosts", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(
      (await handleDropboxShareRequest(shareRequest(dropboxUrl, "https://evil.example"))).status
    ).toBe(403);
    expect(
      (await handleDropboxShareRequest(shareRequest("https://evil.example/project.sightlines")))
        .status
    ).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps missing Dropbox files to 404 and rejects declared oversized packages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    expect((await handleDropboxShareRequest(shareRequest())).status).toBe(404);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1]), {
            headers: { "Content-Length": String(256 * 1024 * 1024 + 1) }
          })
      )
    );
    expect((await handleDropboxShareRequest(shareRequest())).status).toBe(413);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1]), {
            status: 206,
            headers: { "Content-Range": `bytes 0-0/${256 * 1024 * 1024 + 1}` }
          })
      )
    );
    expect((await handleDropboxShareRequest(shareRequest())).status).toBe(413);
  });
});
