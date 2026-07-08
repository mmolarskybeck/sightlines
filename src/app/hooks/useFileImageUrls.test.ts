import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFileImageUrls } from "./useFileImageUrls";

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

function fakeFile(name: string) {
  return new File(["fake"], name, { type: "image/jpeg" });
}

describe("useFileImageUrls", () => {
  it("resolves an object URL for each file, keyed by name", async () => {
    const files = [fakeFile("a.jpg"), fakeFile("b.jpg")];

    const { result } = renderHook(() => useFileImageUrls(files));

    await waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get("a.jpg")).toBe("blob:mock-0");
    expect(result.current.get("b.jpg")).toBe("blob:mock-1");
    expect(createObjectURL).toHaveBeenCalledWith(files[0]);
    expect(createObjectURL).toHaveBeenCalledWith(files[1]);
  });

  it("keeps the last file for a duplicate name", async () => {
    const files = [fakeFile("a.jpg"), fakeFile("a.jpg")];

    const { result } = renderHook(() => useFileImageUrls(files));

    await waitFor(() => expect(result.current.size).toBe(1));
    expect(result.current.get("a.jpg")).toBe("blob:mock-1");
  });

  it("stays stable and does not recreate URLs when the same array reference is passed again", async () => {
    const files = [fakeFile("a.jpg")];

    const { result, rerender } = renderHook(
      ({ files }: { files: File[] }) => useFileImageUrls(files),
      { initialProps: { files } }
    );

    await waitFor(() => expect(result.current.get("a.jpg")).toBeDefined());
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    rerender({ files });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("revokes every prior URL when the file list is replaced", async () => {
    const { result, rerender } = renderHook(
      ({ files }: { files: File[] }) => useFileImageUrls(files),
      { initialProps: { files: [fakeFile("a.jpg")] } }
    );

    await waitFor(() => expect(result.current.get("a.jpg")).toBeDefined());
    const firstUrl = result.current.get("a.jpg");

    rerender({ files: [fakeFile("b.jpg")] });

    await waitFor(() => expect(result.current.get("b.jpg")).toBeDefined());
    expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl);
    expect(result.current.has("a.jpg")).toBe(false);
  });

  it("revokes every URL when the file list resets to empty", async () => {
    const { result, rerender } = renderHook(
      ({ files }: { files: File[] }) => useFileImageUrls(files),
      { initialProps: { files: [fakeFile("a.jpg")] } }
    );

    await waitFor(() => expect(result.current.get("a.jpg")).toBeDefined());
    const firstUrl = result.current.get("a.jpg");

    rerender({ files: [] });

    await waitFor(() => expect(result.current.size).toBe(0));
    expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl);
  });

  it("revokes every cached URL on unmount", async () => {
    const files = [fakeFile("a.jpg"), fakeFile("b.jpg")];

    const { result, unmount } = renderHook(() => useFileImageUrls(files));

    await waitFor(() => expect(result.current.size).toBe(2));
    const urls = Array.from(result.current.values());

    unmount();

    for (const url of urls) {
      expect(revokeObjectURL).toHaveBeenCalledWith(url);
    }
  });
});
