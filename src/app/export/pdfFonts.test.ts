import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPdfFontBytes, resetPdfFontCacheForTests } from "./pdfFonts";

const TTF_MAGIC = [0x00, 0x01, 0x00, 0x00];

function ttfResponse(): Response {
  return new Response(new Uint8Array([...TTF_MAGIC, 0x42, 0x42]).buffer, {
    status: 200
  });
}

afterEach(() => {
  resetPdfFontCacheForTests();
});

describe("loadPdfFontBytes", () => {
  it("fetches regular and strong faces and caches the result", async () => {
    const fetchFn = vi.fn(async () => ttfResponse());
    const first = await loadPdfFontBytes(fetchFn as unknown as typeof fetch);
    expect(first).toBeDefined();
    expect(first?.regular.slice(0, 4)).toEqual(new Uint8Array(TTF_MAGIC));
    expect(first?.strong.slice(0, 4)).toEqual(new Uint8Array(TTF_MAGIC));
    expect(fetchFn).toHaveBeenCalledTimes(2);

    const second = await loadPdfFontBytes(fetchFn as unknown as typeof fetch);
    expect(second).toBe(first);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("fails open (undefined) on a non-OK response", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      loadPdfFontBytes(fetchFn as unknown as typeof fetch)
    ).resolves.toBeUndefined();
  });

  it("fails open when the SPA fallback answers a font URL with HTML", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(new TextEncoder().encode("<!doctype html>").buffer, {
          status: 200
        })
    );
    await expect(
      loadPdfFontBytes(fetchFn as unknown as typeof fetch)
    ).resolves.toBeUndefined();
  });

  it("does not cache a failure", async () => {
    const failing = vi.fn(async () => new Response(null, { status: 500 }));
    await loadPdfFontBytes(failing as unknown as typeof fetch);
    const working = vi.fn(async () => ttfResponse());
    const result = await loadPdfFontBytes(working as unknown as typeof fetch);
    expect(result).toBeDefined();
  });
});
