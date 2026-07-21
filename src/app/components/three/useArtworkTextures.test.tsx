import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useAssetImageUrls, threeState } = vi.hoisted(() => {
  const invalidate = vi.fn();
  const gl = { capabilities: { getMaxAnisotropy: () => 8 } };
  return {
    useAssetImageUrls: vi.fn(() => new Map<string, string>()),
    threeState: { gl, invalidate }
  };
});

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: typeof threeState) => unknown) => selector(threeState)
}));

vi.mock("../../hooks/useAssetImageUrls", () => ({ useAssetImageUrls }));

import { useArtworkTextures } from "./useArtworkTextures";

afterEach(() => {
  vi.clearAllMocks();
});

describe("useArtworkTextures", () => {
  beforeEach(() => {
    useAssetImageUrls.mockReturnValue(new Map<string, string>());
  });

  it("requests display-tier assets by default", () => {
    const getBlob = vi.fn(async (_key: string) => new Blob());

    renderHook(() => useArtworkTextures(["asset-1"], getBlob));

    expect(useAssetImageUrls).toHaveBeenCalledWith(["asset-1"], getBlob, "display");
  });

  it("routes an explicit thumbnail tier to the asset URL hook", () => {
    const getBlob = vi.fn(async (_key: string) => new Blob());

    renderHook(() => useArtworkTextures(["asset-1"], getBlob, "thumbnail"));

    expect(useAssetImageUrls).toHaveBeenCalledWith(["asset-1"], getBlob, "thumbnail");
  });
});
