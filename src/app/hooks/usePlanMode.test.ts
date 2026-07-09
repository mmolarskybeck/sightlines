import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePlanMode } from "./usePlanMode";

function renderPlanModeWithSelection(initialSelectedRoomId: string | null) {
  return renderHook<ReturnType<typeof usePlanMode>, { selectedRoomId: string | null }>(
    ({ selectedRoomId }) => usePlanMode("plan", selectedRoomId),
    { initialProps: { selectedRoomId: initialSelectedRoomId } }
  );
}

describe("usePlanMode", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => usePlanMode("plan", null));

    expect(result.current.mode).toEqual({ kind: "idle" });
  });

  it("arms an opening tool, and arming it disarms any other mode", () => {
    const { result } = renderHook(() => usePlanMode("plan", null));

    act(() => {
      result.current.toggleDrawRoom();
    });
    expect(result.current.mode).toEqual({ kind: "drawRoom" });

    act(() => {
      result.current.armOpeningTool("door");
    });
    expect(result.current.mode).toEqual({ kind: "placeOpening", tool: "door" });
  });

  it("armOpeningTool(null) clears the mode back to idle", () => {
    const { result } = renderHook(() => usePlanMode("plan", null));

    act(() => {
      result.current.armOpeningTool("window");
    });
    expect(result.current.mode).toEqual({ kind: "placeOpening", tool: "window" });

    act(() => {
      result.current.armOpeningTool(null);
    });
    expect(result.current.mode).toEqual({ kind: "idle" });
  });

  it("toggleDrawRoom arms drawRoom, and calling it again disarms it", () => {
    const { result } = renderHook(() => usePlanMode("plan", null));

    act(() => {
      result.current.toggleDrawRoom();
    });
    expect(result.current.mode).toEqual({ kind: "drawRoom" });

    act(() => {
      result.current.toggleDrawRoom();
    });
    expect(result.current.mode).toEqual({ kind: "idle" });
  });

  it("toggleDrawRoom disarms an armed opening tool", () => {
    const { result } = renderHook(() => usePlanMode("plan", null));

    act(() => {
      result.current.armOpeningTool("blocked-zone");
    });
    act(() => {
      result.current.toggleDrawRoom();
    });

    expect(result.current.mode).toEqual({ kind: "drawRoom" });
  });

  it("togglePartitionTool arms/disarms drawPartition and disarms other modes", () => {
    const { result } = renderHook(() => usePlanMode("plan", null));

    act(() => {
      result.current.toggleDrawRoom();
    });
    act(() => {
      result.current.togglePartitionTool();
    });
    expect(result.current.mode).toEqual({ kind: "drawPartition" });

    act(() => {
      result.current.togglePartitionTool();
    });
    expect(result.current.mode).toEqual({ kind: "idle" });
  });

  it("toggleReshapeRoom arms the given room, re-arming the same room disarms it, and it disarms other modes", () => {
    const { result } = renderHook(() => usePlanMode("plan", "room-1"));

    act(() => {
      result.current.togglePartitionTool();
    });
    act(() => {
      result.current.toggleReshapeRoom("room-1");
    });
    expect(result.current.mode).toEqual({ kind: "reshapeRoom", roomId: "room-1" });

    act(() => {
      result.current.toggleReshapeRoom("room-1");
    });
    expect(result.current.mode).toEqual({ kind: "idle" });
  });

  it("toggleReshapeRoom switches to a different room id without needing a disarm first", () => {
    const { result } = renderHook(() => usePlanMode("plan", "room-1"));

    act(() => {
      result.current.toggleReshapeRoom("room-1");
    });
    act(() => {
      result.current.toggleReshapeRoom("room-2");
    });

    expect(result.current.mode).toEqual({ kind: "reshapeRoom", roomId: "room-2" });
  });

  it("toggleReshapeRoom(null) disarms reshape mode", () => {
    const { result } = renderHook(() => usePlanMode("plan", "room-1"));

    act(() => {
      result.current.toggleReshapeRoom("room-1");
    });
    act(() => {
      result.current.toggleReshapeRoom(null);
    });

    expect(result.current.mode).toEqual({ kind: "idle" });
  });

  it("disarm() unconditionally returns to idle from any mode", () => {
    const { result } = renderHook(() => usePlanMode("plan", null));

    act(() => {
      result.current.armOpeningTool("door");
    });
    act(() => {
      result.current.disarm();
    });

    expect(result.current.mode).toEqual({ kind: "idle" });
  });

  it("disarms whenever viewMode changes away from plan", () => {
    const { result, rerender } = renderHook<
      ReturnType<typeof usePlanMode>,
      { viewMode: "plan" | "elevation" }
    >(({ viewMode }) => usePlanMode(viewMode, null), {
      initialProps: { viewMode: "plan" }
    });

    act(() => {
      result.current.toggleDrawRoom();
    });
    expect(result.current.mode).toEqual({ kind: "drawRoom" });

    rerender({ viewMode: "elevation" });

    expect(result.current.mode).toEqual({ kind: "idle" });
  });

  it("does not disturb the idle mode when viewMode changes away from plan", () => {
    const { result, rerender } = renderHook<
      ReturnType<typeof usePlanMode>,
      { viewMode: "plan" | "elevation" }
    >(({ viewMode }) => usePlanMode(viewMode, null), {
      initialProps: { viewMode: "plan" }
    });

    rerender({ viewMode: "elevation" });

    expect(result.current.mode).toEqual({ kind: "idle" });
  });

  it("reshape mode follows the selected room id and drops when selection moves away", () => {
    const { result, rerender } = renderPlanModeWithSelection("room-1");

    act(() => {
      result.current.toggleReshapeRoom("room-1");
    });
    expect(result.current.mode).toEqual({ kind: "reshapeRoom", roomId: "room-1" });

    // Selecting a different room drops reshape mode.
    rerender({ selectedRoomId: "room-2" });
    expect(result.current.mode).toEqual({ kind: "idle" });
  });

  it("reshape mode drops when the selection is cleared entirely", () => {
    const { result, rerender } = renderPlanModeWithSelection("room-1");

    act(() => {
      result.current.toggleReshapeRoom("room-1");
    });
    rerender({ selectedRoomId: null });

    expect(result.current.mode).toEqual({ kind: "idle" });
  });

  it("leaves reshape mode alone while the selection still matches its room", () => {
    const { result, rerender } = renderPlanModeWithSelection("room-1");

    act(() => {
      result.current.toggleReshapeRoom("room-1");
    });
    rerender({ selectedRoomId: "room-1" });

    expect(result.current.mode).toEqual({ kind: "reshapeRoom", roomId: "room-1" });
  });
});
