import { useCallback, useEffect, useState } from "react";
import type { OpeningKind } from "../../domain/placement/createOpening";
import type { ViewMode } from "../store";

// The 2D canvas's armed-tool state, collapsed into one discriminated union
// instead of four mutually-exclusive useStates (activeTool/drawRoomActive/
// reshapeRoomId/partitionToolActive). Structurally there is now only ever
// one mode at a time, so arming any one of them naturally excludes the
// others — no more "disarm the other three" bookkeeping at every call site.
//
// Room and partition drawing remain plan-only, while opening placement is
// shared by the plan and elevation canvases. This union stays the single place
// that enforces mutual exclusion across those tool modes.
export type PlanMode =
  | { kind: "idle" }
  | { kind: "placeOpening"; tool: OpeningKind }
  | { kind: "drawRect" }
  | { kind: "drawRoom" }
  | { kind: "reshapeRoom"; roomId: string }
  | { kind: "drawPartition" }
  | { kind: "measure" };

export interface UsePlanModeResult {
  mode: PlanMode;
  // Sets (or clears, on null) the placeOpening tool — not itself a toggle;
  // callers (InsertPicker) compute null-vs-tool by comparing against the
  // current armed tool before calling this, exactly as App did before.
  armOpeningTool: (tool: OpeningKind | null) => void;
  // Real toggle, same family as toggleDrawRoom: arms the rectangle-room tool
  // (drag corner-to-corner), disarming whatever else was armed.
  toggleDrawRect: () => void;
  // Real toggle: calling it while drawRoom is armed disarms it, otherwise
  // arms it (and implicitly disarms whatever else was armed).
  toggleDrawRoom: () => void;
  // Real toggle keyed on room id: arming the room already armed disarms it;
  // arming a different room (or null) sets/clears accordingly.
  toggleReshapeRoom: (roomId: string | null) => void;
  // Real toggle, same family as toggleDrawRoom.
  togglePartitionTool: () => void;
  // Shared by Plan and Elevation. Like opening placement, Measure remains
  // armed when moving between the two 2D coordinate surfaces.
  toggleMeasure: () => void;
  // Unconditionally returns to "idle".
  disarm: () => void;
}

const IDLE: PlanMode = { kind: "idle" };

/**
 * Owns the 2D canvas's single armed-tool mode plus the two effects that
 * used to sit beside App's four separate useStates:
 *  - disarm whenever the workspace steers away from plan view
 *  - drop reshape mode when the selection moves away from the room it's
 *    reshaping
 */
export function usePlanMode(viewMode: ViewMode, selectedRoomId: string | null): UsePlanModeResult {
  const [mode, setMode] = useState<PlanMode>(IDLE);

  const armOpeningTool = useCallback((tool: OpeningKind | null) => {
    setMode(tool ? { kind: "placeOpening", tool } : IDLE);
  }, []);

  const toggleDrawRect = useCallback(() => {
    setMode((current) => (current.kind === "drawRect" ? IDLE : { kind: "drawRect" }));
  }, []);

  const toggleDrawRoom = useCallback(() => {
    setMode((current) => (current.kind === "drawRoom" ? IDLE : { kind: "drawRoom" }));
  }, []);

  const toggleReshapeRoom = useCallback((roomId: string | null) => {
    setMode((current) => {
      const currentRoomId = current.kind === "reshapeRoom" ? current.roomId : null;
      const next = currentRoomId === roomId ? null : roomId;
      return next ? { kind: "reshapeRoom", roomId: next } : IDLE;
    });
  }, []);

  const togglePartitionTool = useCallback(() => {
    setMode((current) => (current.kind === "drawPartition" ? IDLE : { kind: "drawPartition" }));
  }, []);

  const toggleMeasure = useCallback(() => {
    setMode((current) => (current.kind === "measure" ? IDLE : { kind: "measure" }));
  }, []);

  const disarm = useCallback(() => setMode(IDLE), []);

  // Opening placement works in both 2D views. Disarm only when the workspace
  // steers to 3D/data, so switching between Plan and Elevation preserves the
  // selected insert tool instead of silently losing the user's intent.
  useEffect(() => {
    setMode((current) => {
      if (viewMode === "plan") return current;
      if (
        viewMode === "elevation" &&
        (current.kind === "placeOpening" || current.kind === "measure")
      ) {
        return current;
      }
      return IDLE;
    });
  }, [viewMode]);

  // Reshape mode tracks a specific room id — if selection moves away from
  // that room (another room, an object, or nothing), the handles would be
  // showing for a room that's no longer the focus, so drop it. Reads the
  // latest mode via the functional updater rather than closing over it, so
  // this effect only needs to re-run when selectedRoomId itself changes.
  useEffect(() => {
    setMode((current) =>
      current.kind === "reshapeRoom" && current.roomId !== selectedRoomId ? IDLE : current
    );
  }, [selectedRoomId]);

  return {
    mode,
    armOpeningTool,
    toggleDrawRect,
    toggleDrawRoom,
    toggleReshapeRoom,
    togglePartitionTool,
    toggleMeasure,
    disarm
  };
}
