import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assetBlobKey } from "../../domain/repositories/assetRepository";
import { useAssetImageUrls } from "./useAssetImageUrls";

// jsdom doesn't implement the Blob URL registry at all, so every test stubs
// both halves of it and asserts against the stub rather than a real URL.
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let nextUrlId: number;

beforeEach(() => {
  nextUrlId = 0;
  createObjectURL = vi.fn(() => `blob:mock-${nextUrlId++}`);
  revokeObjectURL = vi.fn();

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
    writable: true
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
    writable: true
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeGetBlob() {
  const getBlob = vi.fn(async (_key: string) => new Blob(["fake"], { type: "image/webp" }));
  return getBlob;
}

describe("useAssetImageUrls", () => {
  it("resolves a thumbnail object URL for each asset id", async () => {
    const getBlob = fakeGetBlob();

    const { result } = renderHook(() => useAssetImageUrls(["asset-1"], getBlob));

    await waitFor(() => expect(result.current.get("asset-1")).toBeDefined());

    expect(getBlob).toHaveBeenCalledWith(assetBlobKey("asset-1", "thumbnail"));
    expect(result.current.get("asset-1")).toBe("blob:mock-0");
  });

  it("ignores undefined ids in the list", async () => {
    const getBlob = fakeGetBlob();

    const { result } = renderHook(() => useAssetImageUrls([undefined, "asset-1"], getBlob));

    await waitFor(() => expect(result.current.get("asset-1")).toBeDefined());
    expect(getBlob).toHaveBeenCalledTimes(1);
  });

  it("fetches an id only once and stays stable across re-renders", async () => {
    const getBlob = fakeGetBlob();

    const { result, rerender } = renderHook(
      ({ ids }: { ids: (string | undefined)[] }) => useAssetImageUrls(ids, getBlob),
      { initialProps: { ids: ["asset-1"] } }
    );

    await waitFor(() => expect(result.current.get("asset-1")).toBeDefined());
    const firstUrl = result.current.get("asset-1");

    rerender({ ids: ["asset-1"] });

    expect(result.current.get("asset-1")).toBe(firstUrl);
    expect(getBlob).toHaveBeenCalledTimes(1);
  });

  it("revokes the object URL for an id that leaves the list", async () => {
    const getBlob = fakeGetBlob();

    const { result, rerender } = renderHook(
      ({ ids }: { ids: (string | undefined)[] }) => useAssetImageUrls(ids, getBlob),
      { initialProps: { ids: ["asset-1", "asset-2"] } }
    );

    await waitFor(() => expect(result.current.get("asset-2")).toBeDefined());
    const urlForAsset2 = result.current.get("asset-2")!;

    rerender({ ids: ["asset-1"] });

    await waitFor(() => expect(result.current.has("asset-2")).toBe(false));
    expect(revokeObjectURL).toHaveBeenCalledWith(urlForAsset2);
    // asset-1 is untouched by asset-2 leaving.
    expect(result.current.get("asset-1")).toBeDefined();
  });

  it("revokes every cached object URL on unmount", async () => {
    const getBlob = fakeGetBlob();

    const { result, unmount } = renderHook(() =>
      useAssetImageUrls(["asset-1", "asset-2"], getBlob)
    );

    await waitFor(() => expect(result.current.size).toBe(2));
    const urls = Array.from(result.current.values());

    unmount();

    for (const url of urls) {
      expect(revokeObjectURL).toHaveBeenCalledWith(url);
    }
  });

  it("leaves a failed id unresolved instead of throwing", async () => {
    let rejectBlob: (error: Error) => void = () => {};
    const getBlob = vi.fn(
      () =>
        new Promise<Blob>((_resolve, reject) => {
          rejectBlob = reject;
        })
    );

    const { result } = renderHook(() => useAssetImageUrls(["asset-1"], getBlob));

    await waitFor(() => expect(getBlob).toHaveBeenCalled());

    await act(async () => {
      rejectBlob(new Error("not found"));
      // Flush the rejected promise's .catch handler.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.has("asset-1")).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("does not create or apply an object URL for a fetch that resolves after unmount", async () => {
    let resolveBlob: (blob: Blob) => void = () => {};
    const getBlob = vi.fn(
      () =>
        new Promise<Blob>((resolve) => {
          resolveBlob = resolve;
        })
    );

    const { unmount } = renderHook(() => useAssetImageUrls(["asset-1"], getBlob));

    unmount();

    await act(async () => {
      resolveBlob(new Blob(["fake"], { type: "image/webp" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stale completion is dropped entirely — nothing left to revoke, and
    // no leaked object URL was ever handed out for it.
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
