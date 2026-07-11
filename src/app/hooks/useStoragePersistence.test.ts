import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useStoragePersistence } from "./useStoragePersistence";

const ORIGINAL_STORAGE = navigator.storage;

function setNavigatorStorage(value: unknown) {
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value,
    writable: true
  });
}

describe("useStoragePersistence", () => {
  afterEach(() => {
    setNavigatorStorage(ORIGINAL_STORAGE);
  });

  it("resolves to unsupported when navigator.storage is absent", async () => {
    setNavigatorStorage(undefined);

    // The synchronous "no API" branch can resolve before this first read —
    // "pending" is only guaranteed to be the *initial* state, not something
    // every render is guaranteed to observe.
    const { result } = renderHook(() => useStoragePersistence());

    await waitFor(() => expect(result.current.state).toBe("unsupported"));
  });

  it("resolves to unsupported when persist/persisted methods are missing", async () => {
    setNavigatorStorage({});

    const { result } = renderHook(() => useStoragePersistence());

    await waitFor(() => expect(result.current.state).toBe("unsupported"));
  });

  it("starts pending while a supported API's check is still resolving", async () => {
    setNavigatorStorage({
      persist: async () => true,
      persisted: async () => true
    });

    const { result } = renderHook(() => useStoragePersistence());

    expect(result.current.state).toBe("pending");
    await waitFor(() => expect(result.current.state).toBe("granted"));
  });

  it("resolves to granted without requesting when already persisted", async () => {
    let persistCalled = false;
    setNavigatorStorage({
      persist: async () => {
        persistCalled = true;
        return true;
      },
      persisted: async () => true
    });

    const { result } = renderHook(() => useStoragePersistence());

    await waitFor(() => expect(result.current.state).toBe("granted"));
    expect(persistCalled).toBe(false);
  });

  it("resolves to granted when a fresh request succeeds", async () => {
    setNavigatorStorage({
      persist: async () => true,
      persisted: async () => false
    });

    const { result } = renderHook(() => useStoragePersistence());

    await waitFor(() => expect(result.current.state).toBe("granted"));
  });

  it("resolves to denied when a fresh request is refused", async () => {
    setNavigatorStorage({
      persist: async () => false,
      persisted: async () => false
    });

    const { result } = renderHook(() => useStoragePersistence());

    await waitFor(() => expect(result.current.state).toBe("denied"));
  });

  it("resolves to unsupported instead of throwing when the API rejects", async () => {
    setNavigatorStorage({
      persist: async () => {
        throw new Error("permission policy blocked");
      },
      persisted: async () => false
    });

    const { result } = renderHook(() => useStoragePersistence());

    await waitFor(() => expect(result.current.state).toBe("unsupported"));
  });

  it("resolves to unsupported instead of throwing when persisted() itself rejects", async () => {
    setNavigatorStorage({
      persist: async () => true,
      persisted: async () => {
        throw new Error("not allowed");
      }
    });

    const { result } = renderHook(() => useStoragePersistence());

    await waitFor(() => expect(result.current.state).toBe("unsupported"));
  });

  it("retry() re-runs the request, flipping denied to granted once the browser allows it", async () => {
    let persistResult = false;
    setNavigatorStorage({
      persist: async () => persistResult,
      persisted: async () => false
    });

    const { result } = renderHook(() => useStoragePersistence());

    await waitFor(() => expect(result.current.state).toBe("denied"));

    // Simulate the browser being willing to grant on a later ask (e.g. after
    // a user interaction) — retry() should re-run the same request routine.
    persistResult = true;

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.state).toBe("granted"));
  });
});
