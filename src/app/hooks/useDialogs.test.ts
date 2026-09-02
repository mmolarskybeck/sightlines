import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useDialogs, type DialogsHandle } from "./useDialogs";

afterEach(cleanup);

describe("useDialogs", () => {
  it("starts with every dialog closed", () => {
    const { result } = renderHook(() => useDialogs());

    expect(result.current.isOpen("help")).toBe(false);
    expect(result.current.isOpen("deleteRoom")).toBe(false);
    expect(result.current.anyOpen).toBe(false);
  });

  it("opens and closes a plain dialog", () => {
    const { result } = renderHook(() => useDialogs());

    act(() => result.current.open("help"));
    expect(result.current.isOpen("help")).toBe(true);
    expect(result.current.anyOpen).toBe(true);

    act(() => result.current.close("help"));
    expect(result.current.isOpen("help")).toBe(false);
    expect(result.current.anyOpen).toBe(false);
  });

  // Settings hands off to Help in one gesture, and the import wizard and the
  // library picker are independent — so this is a record, not one activeDialog.
  it("holds several dialogs open at once", () => {
    const { result } = renderHook(() => useDialogs());

    act(() => {
      result.current.open("importWizard");
      result.current.open("libraryPicker");
    });

    expect(result.current.isOpen("importWizard")).toBe(true);
    expect(result.current.isOpen("libraryPicker")).toBe(true);

    act(() => result.current.close("importWizard"));
    expect(result.current.isOpen("importWizard")).toBe(false);
    expect(result.current.isOpen("libraryPicker")).toBe(true);
  });

  it("carries a confirm's subject and clears it on close", () => {
    const { result } = renderHook(() => useDialogs());

    act(() => result.current.open("deleteRoom", { roomId: "room-a" }));
    expect(result.current.payload("deleteRoom")).toEqual({ roomId: "room-a" });

    act(() => result.current.open("openWall", { wallId: "wall-north" }));
    expect(result.current.payload("openWall")).toEqual({ wallId: "wall-north" });
    expect(result.current.payload("deleteRoom")).toEqual({ roomId: "room-a" });

    // A stale id must never outlive the question it belonged to.
    act(() => result.current.close("deleteRoom"));
    expect(result.current.payload("deleteRoom")).toBeNull();
    expect(result.current.isOpen("deleteRoom")).toBe(false);
    expect(result.current.anyOpen).toBe(true);
  });

  it("re-opening a confirm replaces its subject", () => {
    const { result } = renderHook(() => useDialogs());

    act(() => result.current.open("openWall", { wallId: "wall-a" }));
    act(() => result.current.open("openWall", { wallId: "wall-b" }));

    expect(result.current.payload("openWall")).toEqual({ wallId: "wall-b" });
  });

  it("types the payload per dialog", () => {
    // Compile-time only: tsc checks every @ts-expect-error line, and the
    // function is never called, so the invalid calls never touch a store.
    function typeChecks(dialogs: DialogsHandle) {
      // @ts-expect-error a confirm cannot open without its subject
      dialogs.open("deleteRoom");
      // @ts-expect-error a plain dialog carries nothing
      dialogs.open("help", { roomId: "room-a" });
      // @ts-expect-error the payload shape is per dialog
      dialogs.open("deleteRoom", { wallId: "wall-a" });
      // @ts-expect-error setOpen only drives dialogs that need no subject
      dialogs.setOpen("deleteRoom");
    }
    expect(typeof typeChecks).toBe("function");
  });

  it("drives Radix onOpenChange through a stable per-name handle", () => {
    const { result, rerender } = renderHook(() => useDialogs());

    const first = result.current.setOpen("settings");
    act(() => first(true));
    expect(result.current.isOpen("settings")).toBe(true);

    // Same identity after a state change AND after an unrelated re-render, so
    // effect deps that hold the handle never churn.
    expect(result.current.setOpen("settings")).toBe(first);
    rerender();
    expect(result.current.setOpen("settings")).toBe(first);
    expect(result.current.setOpen("help")).not.toBe(first);

    act(() => first(false));
    expect(result.current.isOpen("settings")).toBe(false);
  });

  it("keeps open/close/setOpen referentially stable", () => {
    const { result, rerender } = renderHook(() => useDialogs());
    const before = {
      open: result.current.open,
      close: result.current.close,
      setOpen: result.current.setOpen
    };

    act(() => result.current.open("exportPdf"));
    rerender();

    expect(result.current.open).toBe(before.open);
    expect(result.current.close).toBe(before.close);
    expect(result.current.setOpen).toBe(before.setOpen);
  });

  it("anyOpen tracks the last dialog standing", () => {
    const { result } = renderHook(() => useDialogs());

    act(() => result.current.open("exportChecklist"));
    act(() => result.current.open("deleteRoom", { roomId: "room-a" }));
    expect(result.current.anyOpen).toBe(true);

    act(() => result.current.close("exportChecklist"));
    expect(result.current.anyOpen).toBe(true);

    act(() => result.current.close("deleteRoom"));
    expect(result.current.anyOpen).toBe(false);
  });
});
