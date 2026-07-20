import { describe, expect, it, vi } from "vitest";
import { handleAnalyticsRequest } from "./index";

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
