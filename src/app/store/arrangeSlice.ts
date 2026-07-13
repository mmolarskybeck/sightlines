import {
  arrangeOnWallInZone,
  arrangeOnWallInZoneWithInset,
  detectBoundary,
  getOpenSpaceBounds,
  slideGroupToBoundaryInset,
  spaceGroupAboutCenter,
  type BoundaryDetection
} from "../../domain/placement/arrangeOnWall";
import type { Project } from "../../domain/project";
import { getProjectWalls } from "../projectWalls";
import type { AppState, EditExtras } from "../store";
import { getArrangeEligibility } from "./arrangeEligibility";
import { objectIdsOf } from "./selectionSlice";

// Transient previews are not persisted or undoable. Accepting creates one undo
// entry; cancelling drops the session without touching the project.
export type ArrangeSession = {
  wallId: string;
  memberIds: string[];
  originalById: Record<string, { xMm: number; yMm: number }>;
  previewById: Record<string, { xMm: number; yMm: number }>;
  mode: "equal" | "inset" | "gap";
  // "both" centers; one-sided anchors translate rigidly and preserve spacing.
  insetAnchor: "left" | "both" | "right";
  // Frozen at session start so preview movement cannot shift its own targets.
  insetBoundary: { left: BoundaryDetection; right: BoundaryDetection };
  // Equal spacing targets either the whole wall or the captured open zone.
  evenZone: "wall" | "open";
  // Captured from original positions and fixed for the session.
  openZoneBoundsMm: { startMm: number; endMm: number };
};

export type ArrangeSliceState = {
  // Settles on selection/view changes, undo/redo, or foreign edits.
  arrangeSession: ArrangeSession | null;
  // Remembered view-state defaults are neither persisted nor undoable.
  lastArrangeMode: ArrangeSession["mode"];
  // Remembered inset anchor when no session is live.
  lastInsetAnchor: ArrangeSession["insetAnchor"];
  // null enables the neighbor-aware smart default until the first explicit choice.
  lastEvenZone: ArrangeSession["evenZone"] | null;
};

export type ArrangeSliceActions = {
  // Ephemeral live preview that settles into one commit.
  beginArrangeSession: (mode: ArrangeSession["mode"]) => void;
  // Changes the inset reference without moving the preview.
  setArrangeAnchor: (anchor: ArrangeSession["insetAnchor"]) => void;
  // Choosing a zone applies equal spacing immediately and remembers the choice.
  setArrangeEvenZone: (zone: ArrangeSession["evenZone"]) => void;
  updateArrangeSession: (
    params:
      | { insetMm: number; anchor?: ArrangeSession["insetAnchor"] }
      | { gapMm: number }
      | { equal: true }
  ) => void;
  setArrangeSessionPreview: (moves: { id: string; xMm: number; yMm: number }[]) => void;
  commitArrangeSession: (allowOverlap?: boolean) => void;
  cancelArrangeSession: () => void;
};

export type ArrangeSliceInternals = {
  commitWallObjectMoves: (
    moves: { id: string; xMm: number; yMm: number }[],
    label: string | ((movedCount: number) => string),
    allowOverlap: boolean,
    extras?: EditExtras
  ) => { status: "committed"; project: Project } | { status: "no-op" } | { status: "blocked" };
  persist: (project: Project) => Promise<void>;
};

export const ARRANGE_SLICE_INITIAL: ArrangeSliceState = {
  arrangeSession: null,
  lastArrangeMode: "inset",
  lastInsetAnchor: "both",
  lastEvenZone: null
};

// Mode switches preserve previews when the member set is unchanged.
function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export function createArrangeSlice(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  internals: ArrangeSliceInternals
): {
  actions: ArrangeSliceActions;
  settleArrangeSession: (outcome: "accept" | "cancel", allowOverlap?: boolean) => "committed" | "cleared" | "blocked";
  autoAcceptArrangeSession: () => void;
} {
  const { commitWallObjectMoves, persist } = internals;

  // LOAD-BEARING: settle state synchronously before callers change selection.
  // Persistence is fire-and-forget; "blocked" leaves the session intact.
  function settleArrangeSession(
    outcome: "accept" | "cancel",
    allowOverlap = false
  ): "committed" | "cleared" | "blocked" {
    const session = get().arrangeSession;
    if (!session) return "cleared";

    if (outcome === "cancel") {
      set({ arrangeSession: null });
      return "cleared";
    }

    // Drop sub-0.01mm no-ops without creating an undo entry.
    const isNoOp = session.memberIds.every((id) => {
      const original = session.originalById[id];
      const preview = session.previewById[id];
      if (!original || !preview) return true;
      return (
        Math.abs(original.xMm - preview.xMm) < 0.01 &&
        Math.abs(original.yMm - preview.yMm) < 0.01
      );
    });
    if (isNoOp) {
      set({ arrangeSession: null });
      return "cleared";
    }

    const moves = session.memberIds
      .filter((id) => session.previewById[id])
      .map((id) => ({
        id,
        xMm: session.previewById[id].xMm,
        yMm: session.previewById[id].yMm
      }));

    const result = commitWallObjectMoves(moves, "Arrange on wall", allowOverlap, {
      arrangeSession: null
    });

    if (result.status === "committed") {
      // Keep the state transition synchronous.
      void persist(result.project);
      return "committed";
    }
    if (result.status === "blocked") {
      // Commit failure leaves the session open for correction.
      return "blocked";
    }
    // Clear unchanged previews without an undo entry.
    set({ arrangeSession: null });
    return "cleared";
  }

  // Auto-settle cancels a collision-blocked session that cannot outlive its selection.
  function autoAcceptArrangeSession() {
    if (!get().arrangeSession) return;
    if (settleArrangeSession("accept") === "blocked") {
      set({ arrangeSession: null });
    }
  }

  const actions: ArrangeSliceActions = {
    beginArrangeSession(mode) {
      const project = get().project;
      if (!project) return;

      // Silently reject selections that do not satisfy arrangement eligibility.
      const selectedIds = objectIdsOf(get().selection);
      const eligibility = getArrangeEligibility(project, selectedIds);
      if (!eligibility.eligible) return;

      // Architecture is ignored; only selected artworks become members.
      const members = eligibility.members;

      const memberIds = members.map((member) => member.id);

      // Same-member re-entry switches mode without resetting the preview.
      const existing = get().arrangeSession;
      if (existing && sameIdSet(existing.memberIds, memberIds)) {
        // Preserve captured zone fields across mode switches.
        set({ arrangeSession: { ...existing, mode }, lastArrangeMode: mode });
        return;
      }

      const wall = getProjectWalls(project).find(
        (candidate) => candidate.id === members[0].wallId
      );
      if (!wall) return;

      // Freeze the open-space span from unselected same-wall objects.
      const others = project.wallObjects.filter(
        (wallObject) =>
          wallObject.wallId === wall.id && !selectedIds.includes(wallObject.id)
      );
      const openZoneBoundsMm = getOpenSpaceBounds(members, others, wall.lengthMm);
      // Default to the open zone only when neighbors bound the group.
      const isBounded =
        openZoneBoundsMm.startMm > 0 || openZoneBoundsMm.endMm < wall.lengthMm;
      const evenZone = get().lastEvenZone ?? (isBounded ? "open" : "wall");

      // Freeze inset boundaries from the same neighbor set.
      const insetBoundary = {
        left: detectBoundary("left", members, others, wall.lengthMm),
        right: detectBoundary("right", members, others, wall.lengthMm)
      };

      const originalById: Record<string, { xMm: number; yMm: number }> = {};
      const previewById: Record<string, { xMm: number; yMm: number }> = {};
      for (const member of members) {
        originalById[member.id] = { xMm: member.xMm, yMm: member.yMm };
        previewById[member.id] = { xMm: member.xMm, yMm: member.yMm };
      }

      set({
        arrangeSession: {
          wallId: members[0].wallId,
          memberIds,
          originalById,
          previewById,
          mode,
          // Fresh sessions use the remembered anchor.
          insetAnchor: get().lastInsetAnchor,
          insetBoundary,
          evenZone,
          openZoneBoundsMm
        },
        lastArrangeMode: mode
      });
    },

    setArrangeAnchor(anchor) {
      // Changing the reference alone never moves the preview.
      const session = get().arrangeSession;
      if (session) {
        set({
          arrangeSession: { ...session, insetAnchor: anchor },
          lastInsetAnchor: anchor
        });
      } else {
        set({ lastInsetAnchor: anchor });
      }
    },

    setArrangeEvenZone(zone) {
      // Remember the zone even when the current selection is ineligible.
      set({ lastEvenZone: zone });

      const session = get().arrangeSession;
      if (session) {
        set({ arrangeSession: { ...session, evenZone: zone } });
        // Equal mode applies the new zone to the live preview.
        if (session.mode === "equal") {
          get().updateArrangeSession({ equal: true });
        }
        return;
      }

      // Without a session, choosing a zone begins and applies equal spacing.
      get().beginArrangeSession("equal");
      if (!get().arrangeSession) return;
      get().updateArrangeSession({ equal: true });
    },

    updateArrangeSession(params) {
      const session = get().arrangeSession;
      const project = get().project;
      if (!session || !project) return;

      const wall = getProjectWalls(project).find(
        (candidate) => candidate.id === session.wallId
      );
      if (!wall) return;

      // Successive edits compose from preview positions; collisions gate only at commit.
      const previewMembers = project.wallObjects
        .filter((wallObject) => session.memberIds.includes(wallObject.id))
        .map((wallObject) => {
          const preview = session.previewById[wallObject.id];
          return preview ? { ...wallObject, xMm: preview.xMm, yMm: preview.yMm } : wallObject;
        });

      // "both" re-solves symmetrically; one-sided anchors translate rigidly.
      const insetAnchor: ArrangeSession["insetAnchor"] =
        "insetMm" in params ? (params.anchor ?? session.insetAnchor) : session.insetAnchor;

      let moves: { id: string; xMm: number }[];
      if ("insetMm" in params) {
        moves =
          insetAnchor === "both"
            ? arrangeOnWallInZoneWithInset(
                previewMembers,
                session.insetBoundary.left.edgeMm,
                session.insetBoundary.right.edgeMm,
                params.insetMm
              )
            : slideGroupToBoundaryInset(
                previewMembers,
                insetAnchor,
                session.insetBoundary[insetAnchor].edgeMm,
                params.insetMm
              );
      } else if ("gapMm" in params) {
        // Gap edits preserve the group's current center.
        moves = spaceGroupAboutCenter(previewMembers, params.gapMm);
      } else {
        // Equal spacing uses the whole wall or the captured open zone.
        const bounds =
          session.evenZone === "open"
            ? session.openZoneBoundsMm
            : { startMm: 0, endMm: wall.lengthMm };
        moves = arrangeOnWallInZone(previewMembers, bounds.startMm, bounds.endMm);
      }
      if (moves.length === 0) return;

      // x only — arranging is a horizontal move; y stays as previewed.
      const previewById = { ...session.previewById };
      for (const move of moves) {
        const current = previewById[move.id];
        previewById[move.id] = { xMm: move.xMm, yMm: current ? current.yMm : 0 };
      }

      const mode: ArrangeSession["mode"] =
        "insetMm" in params ? "inset" : "gapMm" in params ? "gap" : "equal";

      set({
        arrangeSession: { ...session, previewById, mode, insetAnchor },
        lastArrangeMode: mode,
        lastInsetAnchor: insetAnchor
      });
    },

    setArrangeSessionPreview(moves) {
      const session = get().arrangeSession;
      if (!session) return;

      const memberSet = new Set(session.memberIds);
      const previewById = { ...session.previewById };
      for (const move of moves) {
        if (!memberSet.has(move.id)) continue;
        previewById[move.id] = { xMm: move.xMm, yMm: move.yMm };
      }

      set({ arrangeSession: { ...session, previewById } });
    },

    commitArrangeSession(allowOverlap = false) {
      // Explicit collision failures keep the session open for correction.
      settleArrangeSession("accept", allowOverlap);
    },

    cancelArrangeSession() {
      settleArrangeSession("cancel");
    }
  };

  return { actions, settleArrangeSession, autoAcceptArrangeSession };
}
