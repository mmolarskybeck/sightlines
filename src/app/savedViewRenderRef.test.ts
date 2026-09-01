import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedViewRenderHandle } from "./components/three/SavedViewRenderHost";
import { createSavedViewRenderRef } from "./savedViewRenderRef";

function fakeHandle(): SavedViewRenderHandle {
  return {
    renderSavedView: vi.fn(),
    beginRenderBatch: vi.fn(() => () => {})
  };
}

describe("createSavedViewRenderRef", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mirrors every write into onChange and reads back synchronously", () => {
    const onChange = vi.fn();
    const ref = createSavedViewRenderRef(onChange);
    const handle = fakeHandle();
    ref.current = handle;
    expect(ref.current).toBe(handle);
    ref.current = null;
    expect(ref.current).toBeNull();
    expect(onChange.mock.calls).toEqual([[handle], [null]]);
  });

  it("whenReady resolves immediately when the handle is already attached", async () => {
    const ref = createSavedViewRenderRef(() => {});
    const handle = fakeHandle();
    ref.current = handle;
    await expect(ref.whenReady()).resolves.toBe(handle);
  });

  it("whenReady resolves all waiters when the handle attaches later", async () => {
    const ref = createSavedViewRenderRef(() => {});
    const first = ref.whenReady();
    const second = ref.whenReady();
    const handle = fakeHandle();
    ref.current = handle;
    await expect(first).resolves.toBe(handle);
    await expect(second).resolves.toBe(handle);
  });

  it("whenReady ignores a null write (host unmount) and waits for a real handle", async () => {
    const ref = createSavedViewRenderRef(() => {});
    const waiting = ref.whenReady();
    ref.current = null;
    const handle = fakeHandle();
    ref.current = handle;
    await expect(waiting).resolves.toBe(handle);
  });

  it("whenReady rejects with AbortError when the signal is already aborted", async () => {
    const ref = createSavedViewRenderRef(() => {});
    const controller = new AbortController();
    controller.abort();
    await expect(ref.whenReady(controller.signal)).rejects.toMatchObject({
      name: "AbortError"
    });
  });

  it("whenReady rejects with AbortError on abort mid-wait and drops the waiter", async () => {
    const ref = createSavedViewRenderRef(() => {});
    const controller = new AbortController();
    const waiting = ref.whenReady(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    // The abandoned waiter must not resurface when a handle attaches later.
    ref.current = fakeHandle();
  });

  it("whenReady rejects after the timeout so an export degrades instead of hanging", async () => {
    const ref = createSavedViewRenderRef(() => {}, 15_000);
    const waiting = ref.whenReady();
    // Attach the rejection expectation before advancing so the rejection is
    // never unhandled.
    const assertion = expect(waiting).rejects.toThrow(
      "The 3D renderer was not ready in time to render Saved views."
    );
    vi.advanceTimersByTime(15_000);
    await assertion;
  });

  it("an attach just before the timeout wins", async () => {
    const ref = createSavedViewRenderRef(() => {}, 15_000);
    const waiting = ref.whenReady();
    vi.advanceTimersByTime(14_999);
    const handle = fakeHandle();
    ref.current = handle;
    vi.advanceTimersByTime(10_000);
    await expect(waiting).resolves.toBe(handle);
  });
});
