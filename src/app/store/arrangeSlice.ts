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
import { objectIdsOf } from "./selectionSlice";

// A transient, NON-undoable arrange interaction (precedent: selectedObjectIds
// is view state, not on the undo stack). While a session is live, panel edits,
// group drags and arrow nudges write to previewById only — the committed
// project is untouched until the session settles. Accepting flushes previewById
// into ONE "Arrange on wall" undo entry; cancelling just drops the slice.
// originalById is the committed layout at begin, used for cancel/no-op
// detection. Exported so the elevation view / inspector (later work packages)
// can read previewById to render the live preview.
export type ArrangeSession = {
  wallId: string;
  memberIds: string[];
  originalById: Record<string, { xMm: number; yMm: number }>;
  previewById: Record<string, { xMm: number; yMm: number }>;
  mode: "equal" | "inset" | "gap";
  // Which side the "From edges" (inset) mode measures from. "both"
  // keeps the group centred (the original symmetric solve, now zone-aware —
  // see insetBoundary); "left"/"right" slide the group as a rigid unit so the
  // named outer edge sits a given distance from its detected boundary,
  // preserving interior spacing. Only meaningful while mode === "inset", but
  // carried on the session so switching mode and back remembers it. See
  // lastInsetAnchor for the idle default.
  insetAnchor: "left" | "both" | "right";
  // What each side of the "From edges" mode measures against — the wall edge,
  // or the nearest unselected neighbour beside the group (see detectBoundary)
  // — computed ONCE at session begin from the members' ORIGINAL positions, so
  // the target stays fixed while previews move the members around (the same
  // freeze openZoneBoundsMm applies to "Space evenly"). Only meaningful while
  // mode === "inset".
  insetBoundary: { left: BoundaryDetection; right: BoundaryDetection };
  // Which span the "Space evenly" mode distributes across: the whole wall, or
  // just the "open space" beside the group (bounded by the nearest unselected
  // neighbours — see openZoneBoundsMm). Only meaningful while mode === "equal",
  // but carried on the session so switching mode and back remembers it. See
  // lastEvenZone for the idle default.
  evenZone: "wall" | "open";
  // The open-space span, computed ONCE at session begin from the members'
  // ORIGINAL positions and the unselected wall objects on this wall, so the
  // zone stays fixed while previews move the members around inside it. Ignored
  // when evenZone === "wall".
  openZoneBoundsMm: { startMm: number; endMm: number };
};

export type ArrangeSliceState = {
  // Transient arrange interaction, null unless a session is in flight. Settles
  // (accept/cancel) on any selection/view change, undo/redo, or foreign edit —
  // see the settle table around settleArrangeSession.
  arrangeSession: ArrangeSession | null;
  // The spacing mode the arrange panel should default to when there's no live
  // session and the layout doesn't already read as evenly spaced — plain view
  // state (not undoable, not persisted), remembered across selections so the
  // panel opens in the mode the curator last worked in. Updated whenever a
  // session begins or changes mode.
  lastArrangeMode: ArrangeSession["mode"];
  // The wall edge the "From wall edges" mode should measure from when there's
  // no live session — plain view state (not undoable, not persisted), mirroring
  // lastArrangeMode. Updated whenever a session's anchor is set or changed.
  lastInsetAnchor: ArrangeSession["insetAnchor"];
  // The "Space within" zone the "Space evenly" mode should default to. null
  // until the curator first picks one — the smart default (open when the group
  // is boxed in by neighbours, else whole wall) applies while it's null. Plain
  // view state (not undoable, not persisted), mirroring lastInsetAnchor.
  lastEvenZone: ArrangeSession["evenZone"] | null;
};

export type ArrangeSliceActions = {
  // Ephemeral arrange session (live preview → single commit). See ArrangeSession.
  beginArrangeSession: (mode: ArrangeSession["mode"]) => void;
  // Sets which wall edge the inset mode measures from, WITHOUT moving anything
  // (mirrors how switching mode never jumps the works). Updates the live
  // session's anchor when one is open, and always the remembered default.
  setArrangeAnchor: (anchor: ArrangeSession["insetAnchor"]) => void;
  // Sets which span the "Space evenly" mode distributes across (whole wall vs.
  // the open space beside the group). Unlike the anchor row, choosing a zone is
  // an ACTION: it re-applies the equal solve live when a session is open in
  // equal mode, and begins one (in equal mode) when none is open — clicking a
  // zone spaces evenly the same way clicking "Space evenly" does. Always
  // remembers the choice in lastEvenZone.
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

// Order-insensitive equality of two id lists — used to detect that a
// beginArrangeSession call names the same members as the live session (a
// mode switch), so the running preview isn't discarded.
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

  // Internal, SYNCHRONOUS settle for a pending arrange session — the single
  // place accept/cancel semantics live (see the table in
  // docs/plan wild-floating-babbage.md).
  //
  // LOAD-BEARING ordering: the accept path completes all of its state changes
  // synchronously (pushEditEntry's `set()` runs before any await; persist is
  // fired as `void persist(...)`, not awaited). Callers such as selectObject
  // rely on this: they call the auto-accept as their first line and then
  // proceed to change selection in the same synchronous tick, trusting the
  // arrangement is already committed by the time they run.
  //
  // Returns "committed" (one undo entry pushed), "cleared" (session dropped
  // with no edit — cancel or a no-op accept), or "blocked" (collision gate
  // rejected the commit; session left intact with the error surfaced).
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

    // No-op guard: if every preview position is within 0.01mm of where it
    // started, there's nothing to commit — drop the session without an
    // undo entry.
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
      // Fire-and-forget so the state change above is fully synchronous.
      void persist(result.project);
      return "committed";
    }
    if (result.status === "blocked") {
      // Session left intact (commit didn't clear it); error already surfaced.
      return "blocked";
    }
    // Commit found nothing to move (preview matched committed positions) —
    // clear the session without an undo entry.
    set({ arrangeSession: null });
    return "cleared";
  }

  // Auto-accept used by selection/view changes: a pending arrangement can't
  // outlive the selection it belongs to, so a collision-blocked commit here
  // is cancelled (keeping the surfaced error) rather than left open the way an
  // explicit commitArrangeSession would.
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

      // Guards identical to arrangeSelectedOnWall (2+ wall members, no floor
      // members, all on one wall) — but a silent no-op on failure, since the
      // panel only offers a begin when the selection already qualifies.
      const selectedIds = objectIdsOf(get().selection);
      const hasFloorMember = selectedIds.some((id) =>
        project.floorObjects.some((floorObject) => floorObject.id === id)
      );
      if (hasFloorMember) return;

      // Members are ARTWORKS only — a selected opening is architecture, never
      // arranged (see arrangeSelectedOnWall). It doesn't move on arrange and
      // doesn't count toward the 2-member minimum, but it also doesn't block
      // eligibility.
      const members = project.wallObjects.filter(
        (wallObject) => wallObject.kind === "artwork" && selectedIds.includes(wallObject.id)
      );
      if (members.length < 2) return;

      const wallIds = new Set(members.map((member) => member.wallId));
      if (wallIds.size > 1) return;

      const memberIds = members.map((member) => member.id);

      // Idempotent: re-begin on the same member set just switches mode, so
      // previewById built up so far survives (a mode switch never re-seeds
      // from committed positions mid-session).
      const existing = get().arrangeSession;
      if (existing && sameIdSet(existing.memberIds, memberIds)) {
        // Preserves the existing session's zone fields (evenZone/
        // openZoneBoundsMm) via the spread — a mode switch never re-computes
        // the zone mid-session.
        set({ arrangeSession: { ...existing, mode }, lastArrangeMode: mode });
        return;
      }

      const wall = getProjectWalls(project).find(
        (candidate) => candidate.id === members[0].wallId
      );
      if (!wall) return;

      // The open-space span, fixed for the life of the session: bounded by the
      // nearest UNSELECTED wall objects beside the group, from the members'
      // committed positions (the same "others" filter the dimension lines use
      // — every same-wall object that isn't part of this selection).
      const others = project.wallObjects.filter(
        (wallObject) =>
          wallObject.wallId === wall.id && !selectedIds.includes(wallObject.id)
      );
      const openZoneBoundsMm = getOpenSpaceBounds(members, others, wall.lengthMm);
      // Smart default: honour a remembered choice, else open the zone when the
      // group is boxed in by neighbours (span narrower than the whole wall),
      // otherwise the whole wall.
      const isBounded =
        openZoneBoundsMm.startMm > 0 || openZoneBoundsMm.endMm < wall.lengthMm;
      const evenZone = get().lastEvenZone ?? (isBounded ? "open" : "wall");

      // What "From edges" measures against on each side — same detector, same
      // "others", frozen the same way as openZoneBoundsMm.
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
          // A fresh session opens on the remembered anchor; switching mode
          // and back keeps whatever the session already carried.
          insetAnchor: get().lastInsetAnchor,
          insetBoundary,
          evenZone,
          openZoneBoundsMm
        },
        lastArrangeMode: mode
      });
    },

    setArrangeAnchor(anchor) {
      // Pure preference change — never moves a work. The inset field only
      // re-slides the group once its VALUE is edited (updateArrangeSession),
      // exactly as a mode switch waits for a value before moving anything.
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
      // The picked zone is always remembered, even when the selection can't
      // be arranged (mirrors setArrangeAnchor remembering lastInsetAnchor).
      set({ lastEvenZone: zone });

      const session = get().arrangeSession;
      if (session) {
        set({ arrangeSession: { ...session, evenZone: zone } });
        // In equal mode, switching the zone re-spaces the works live (x only,
        // y untouched) — updateArrangeSession reads the freshly-set zone.
        if (session.mode === "equal") {
          get().updateArrangeSession({ equal: true });
        }
        return;
      }

      // No session: clicking a zone acts like clicking "Space evenly" — begin
      // an equal session (smart default now reads the zone just remembered, so
      // the session opens on it) and apply the solve. If the selection is
      // ineligible, beginArrangeSession is a no-op and only lastEvenZone
      // stuck; nothing else happens.
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

      // Run the arrange math against PREVIEW positions (committed objects
      // overridden with previewById), so successive edits compose. No
      // collision gate during preview — overlaps surface only at commit.
      const previewMembers = project.wallObjects
        .filter((wallObject) => session.memberIds.includes(wallObject.id))
        .map((wallObject) => {
          const preview = session.previewById[wallObject.id];
          return preview ? { ...wallObject, xMm: preview.xMm, yMm: preview.yMm } : wallObject;
        });

      // An inset edit resolves against the anchor the field was measured
      // from — "both" re-solves the symmetric centred arrangement (within the
      // zone bounded by insetBoundary, wall edges when both sides detected
      // "wall"), while "left"/"right" slide the group rigidly so the named
      // outer edge lands at the typed distance from its detected boundary,
      // interior spacing untouched. The anchor rides in with the value (the
      // field knows which edge it's showing) and falls back to whatever the
      // session already carried.
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
        // "Between works" keeps the group's current center fixed and only
        // changes the interior spacing — it must NOT re-center the subset on
        // the wall (that would teleport an off-center pair toward the middle).
        moves = spaceGroupAboutCenter(previewMembers, params.gapMm);
      } else {
        // "Space evenly" distributes within the chosen zone: the whole wall,
        // or the fixed open-space span beside the group. A whole-wall zone of
        // [0, wallLengthMm] is exactly the original centred solve.
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
      // A collision block keeps the session open (error surfaced) so the
      // curator can adjust — settleArrangeSession returns "blocked" and does
      // not clear the slice.
      settleArrangeSession("accept", allowOverlap);
    },

    cancelArrangeSession() {
      settleArrangeSession("cancel");
    }
  };

  return { actions, settleArrangeSession, autoAcceptArrangeSession };
}
