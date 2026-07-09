import { useCallback, useEffect, useState } from "react";
import type { OpeningKind } from "../../domain/placement/createOpening";
import type { ViewMode } from "../store";

// The plan canvas's armed-tool state, collapsed into one discriminated union
// instead of four mutually-exclusive useStates (activeTool/drawRoomActive/
// reshapeRoomId/partitionToolActive). Structurally there is now only ever
// one mode at a time, so arming any one of them naturally excludes the
// others — no more "disarm the other three" bookkeeping at every call site.
//
// When the doorway feature lands, it adds its own arm/disarm family here as
// `| { kind: "pairOpenings"; ... }` — this union stays the single place that
// enforces mutual exclusion across all plan-canvas tool modes.
export type PlanMode =
  | { kind: "idle" }
  | { kind: "placeOpening"; tool: OpeningKind }
  | { kind: "drawRoom" }
  | { kind: "reshapeRoom"; roomId: string }
  | { kind: "drawPartition" };

export interface UsePlanModeResult {
  mode: PlanMode;
  // Sets (or clears, on null) the placeOpening tool — not itself a toggle;
  // callers (InsertToolPicker) compute null-vs-tool by comparing against the
  // current armed tool before calling this, exactly as App did before.
  armOpeningTool: (tool: OpeningKind | null) => void;
  // Real toggle: calling it while drawRoom is armed disarms it, otherwise
  // arms it (and implicitly disarms whatever else was armed).
  toggleDrawRoom: () => void;
  // Real toggle keyed on room id: arming the room already armed disarms it;
  // arming a different room (or null) sets/clears accordingly.
  toggleReshapeRoom: (roomId: string | null) => void;
  // Real toggle, same family as toggleDrawRoom.
  togglePartitionTool: () => void;
  // Unconditionally returns to "idle".
  disarm: () => void;
}

const IDLE: PlanMode = { kind: "idle" };

/**
 * Owns the plan canvas's single armed-tool mode plus the two effects that
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

  const disarm = useCallback(() => setMode(IDLE), []);

  // The insert-tools group only makes sense over the plan canvas — disarm
  // whenever the workspace tab (or the data-view rail button) steers away
  // from "plan", so a tool never stays armed-but-invisible on a surface that
  // can't place anything.
  useEffect(() => {
    if (viewMode !== "plan") {
      setMode(IDLE);
    }
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

  return { mode, armOpeningTool, toggleDrawRoom, toggleReshapeRoom, togglePartitionTool, disarm };
}
