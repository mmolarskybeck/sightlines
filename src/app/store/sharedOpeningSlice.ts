import { parseFaceWallId } from "../../domain/geometry/freestandingWalls";
import { areSharedBoundaryWalls, mirrorOpeningXMm } from "../../domain/geometry/sharedWalls";
import { newId } from "../../domain/id";
import { isStructurallyValidPair } from "../../domain/placement/openingPairs";
import { isOpeningSlotFree } from "../../domain/placement/openingSlots";
import { isBlockingKind } from "../../domain/placement/overlapPolicy";
import {
  analyzeSharedOpenings,
  applySharedOpeningActions,
  sharedOpeningCandidates,
  type SharedOpeningAction,
  type SharedOpeningTarget
} from "../../domain/placement/sharedOpeningAnalysis";
import type { ConnectableOpeningWallObject, Project, WallObject } from "../../domain/project";
import { getProjectWalls } from "../projectWalls";
import type { AppState, EditExtras } from "../store";
import { moveObjectNoun, openingNoun } from "./openingEdits";
import type { CommitWallObjectEdit } from "./placementSlice";

// Realign mirrors the SELECTED half onto its partner, so the only thing that
// can stop it is something already standing where the partner has to land. Say
// what is in the way rather than "the slot is occupied": the user's next move is
// to shift that object, and they need to know which one.
export const SHARED_OPENING_REALIGN_BLOCKED_MESSAGE =
  "The other side of this opening has nowhere to go — something on the facing wall is already there.";

export function sharedOpeningRealignBlockedMessage(blocker: WallObject | null): string {
  // Degrades to a still-true sentence when nothing resolves: a wall we cannot
  // map, or an obstruction that is off the wall rather than on it.
  if (!blocker) return SHARED_OPENING_REALIGN_BLOCKED_MESSAGE;
  return `The other side of this opening has nowhere to go — a ${moveObjectNoun(blocker.kind)} on the facing wall is already there.`;
}

// Two faces of one physical opening are not two openings that happen to be
// linked. While the rooms still share that wall there is nothing to separate,
// so Split says what would have to change in the plan first.
export const SHARED_OPENING_SPLIT_REFUSED_MESSAGE =
  "These are two faces of one opening. Move the rooms apart, or delete it.";

// The resolver re-derives the choices against the CURRENT project, so a pick
// made from a stale list is refused rather than applied to a plan it no longer
// fits.
export const SHARED_OPENING_TARGET_UNAVAILABLE_MESSAGE =
  "That side is no longer an option for this opening. The rooms have moved since these choices were offered.";

export const SHARED_OPENING_ALREADY_PAIRED_MESSAGE =
  "This is already one half of a shared opening.";

function isConnectableOpening(
  object: WallObject | undefined
): object is ConnectableOpeningWallObject {
  return object?.kind === "door" || object?.kind === "window";
}

// Structural equality on the discriminated union. The resolver compares a
// caller-supplied target against a freshly derived candidate list, and those
// are never the same object reference.
function sameSharedOpeningTarget(a: SharedOpeningTarget, b: SharedOpeningTarget): boolean {
  if (a.kind === "opening") return b.kind === "opening" && a.openingId === b.openingId;
  return b.kind === "wall" && a.wallId === b.wallId;
}

function withoutPartnerPointer(opening: ConnectableOpeningWallObject): WallObject {
  const { connectsToObjectId: _cleared, ...rest } = opening;
  return rest;
}

// What is standing in a slot on `wallId`, using the same blocking-kind rule
// isOpeningSlotFree applies. A looser filter here could name a wall label as the
// blocker of a slot the label is not blocking.
function findWallSlotBlocker(
  project: Project,
  wallId: string,
  footprint: { widthMm: number; heightMm: number; yMm: number; xMm: number },
  ignoreIds: ReadonlySet<string>
): WallObject | null {
  const halfWidthMm = footprint.widthMm / 2;
  const halfHeightMm = footprint.heightMm / 2;
  const overlapping = project.wallObjects
    .filter(
      (object) =>
        object.wallId === wallId &&
        isBlockingKind(object.kind) &&
        !ignoreIds.has(object.id) &&
        Math.abs(object.yMm - footprint.yMm) < halfHeightMm + object.heightMm / 2 &&
        Math.abs(object.xMm - footprint.xMm) < halfWidthMm + object.widthMm / 2
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  // A door or window explains itself better than a blocked zone does.
  return overlapping.find(isConnectableOpening) ?? overlapping[0] ?? null;
}

export type SharedOpeningSliceActions = {
  // The five shared-opening resolutions (plan "Stage 6 — Resolver"). Every one
  // of them is SCOPED IN THE STORE, never in the UI: each re-derives what the
  // current project permits and refuses anything else, so a picker rendered
  // from a stale analysis cannot talk the store into an invalid pairing.
  //
  // Give a one-sided opening its other face, at a target the user picked out of
  // `sharedOpeningCandidates`. An existing opening is adopted; a bare wall gets
  // a twin created on it — which is the only way an ambiguous boundary between
  // two EMPTY walls is resolvable at all. One undo step.
  resolveSharedOpening: (openingId: string, target: SharedOpeningTarget) => Promise<void>;
  // Apply the `create-twin` the load pass deliberately declined (the
  // `missing-twin` issue). No such repair pending = no-op, no undo entry.
  completeSharedOpening: (openingId: string) => Promise<void>;
  // Mirror THIS half onto its partner — position, size and hang height. The
  // selected half is authoritative, which is what resolves a geometry mismatch
  // the analyzer deliberately refuses to pick a winner for. Refused, with the
  // obstruction named, when the partner's new slot is occupied.
  realignSharedOpening: (openingId: string) => Promise<void>;
  // Clear both pointers, leaving two independent openings. Only for a pair
  // whose walls are NOT a shared boundary; two faces of one physical opening
  // have nothing to separate.
  splitSharedOpening: (openingId: string) => Promise<void>;
  // Delete the partner and keep this half, for a pair whose rooms have moved
  // apart. Deliberately not `removePlacement`, which deletes both halves.
  keepThisOpeningOnly: (openingId: string) => Promise<void>;
};

export type SharedOpeningSliceInternals = {
  applyEdit: (
    label: string,
    buildNextProject: (project: Project) => Project,
    extras?: EditExtras
  ) => Promise<void>;
  // Every resolution that CREATES or MOVES geometry commits through the
  // placement gate, so a twin it mints is bounds- and collision-checked like
  // any other placement.
  commitWallObjectEdit: CommitWallObjectEdit;
};

export function createSharedOpeningSlice(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  internals: SharedOpeningSliceInternals
): { actions: SharedOpeningSliceActions } {
  const { applyEdit, commitWallObjectEdit } = internals;

  const actions: SharedOpeningSliceActions = {
    async resolveSharedOpening(openingId, target) {
      const project = get().project;
      if (!project) return;

      const opening = project.wallObjects.find((object) => object.id === openingId);
      const counterpart =
        target.kind === "opening"
          ? project.wallObjects.find((object) => object.id === target.openingId)
          : undefined;
      const targetWallId = target.kind === "opening" ? counterpart?.wallId : target.wallId;

      // These three refusals are worded exactly as the old connectOpenings
      // worded them. They are the only ones a curator can reach by mistake
      // rather than through a stale picker, and their strings are asserted.
      if (
        !isConnectableOpening(opening) ||
        (target.kind === "opening" && !isConnectableOpening(counterpart))
      ) {
        set({ error: "Only doors and windows can be connected." });
        return;
      }
      if (counterpart && opening.kind !== counterpart.kind) {
        set({ error: "Connected openings must be the same kind." });
        return;
      }
      if (
        targetWallId === undefined ||
        targetWallId === opening.wallId ||
        parseFaceWallId(opening.wallId) !== null ||
        parseFaceWallId(targetWallId) !== null
      ) {
        set({ error: "Connected openings must be on different perimeter walls." });
        return;
      }
      if (
        opening.connectsToObjectId !== undefined ||
        (counterpart &&
          isConnectableOpening(counterpart) &&
          counterpart.connectsToObjectId !== undefined)
      ) {
        set({ error: SHARED_OPENING_ALREADY_PAIRED_MESSAGE });
        return;
      }

      // THE SCOPING GATE, and it lives here rather than in the inspector.
      // Recomputed against the CURRENT project, so a target the picker offered
      // before the rooms moved is refused instead of being applied to geometry
      // it no longer describes.
      const candidates = sharedOpeningCandidates(project, openingId);
      if (!candidates.some((candidate) => sameSharedOpeningTarget(candidate, target))) {
        set({ error: SHARED_OPENING_TARGET_UNAVAILABLE_MESSAGE });
        return;
      }

      // Hand-built rather than picked out of `analyzeSharedOpenings`, because
      // an opening the user still has to choose FOR emits a conflict, not an
      // action. That is safe here and only here: the candidate guard above has
      // already established this exact target is one the analyzer sanctions,
      // and the commit gate below bounds- and collision-checks whatever the
      // action creates. `applySharedOpeningActions`' own guards are integrity
      // checks against malformed input — its doc comment is explicit that it
      // re-derives nothing geometric — so they would not have caught a bad
      // target on their own.
      let action: SharedOpeningAction;
      if (target.kind === "opening") {
        action = { kind: "adopt", openingId, counterpartOpeningId: target.openingId };
      } else {
        const xMm = mirrorOpeningXMm(project, opening.wallId, target.wallId, opening.xMm);
        if (xMm === null) {
          set({ error: SHARED_OPENING_TARGET_UNAVAILABLE_MESSAGE });
          return;
        }
        action = { kind: "create-twin", openingId, wallId: target.wallId, xMm };
      }

      const applied = applySharedOpeningActions(project, [action], newId);
      if (applied.project === project) {
        set({ error: SHARED_OPENING_TARGET_UNAVAILABLE_MESSAGE });
        return;
      }

      await commitWallObjectEdit(
        `Resolve shared ${openingNoun(opening.kind)}`,
        project,
        applied.project.wallObjects,
        [...applied.createdOpeningIds, ...applied.formedPairIds.flat()],
        false
      );
    },

    async completeSharedOpening(openingId) {
      const project = get().project;
      if (!project) return;

      const opening = project.wallObjects.find((object) => object.id === openingId);
      if (!isConnectableOpening(opening) || opening.connectsToObjectId !== undefined) return;

      // UNSCOPED on purpose: a missing twin is by definition a repair no edit's
      // scope covered, which is why the load pass left it standing as an issue.
      const { actions } = analyzeSharedOpenings(project);
      const action = actions.find(
        (candidate): candidate is Extract<SharedOpeningAction, { kind: "create-twin" }> =>
          candidate.kind === "create-twin" && candidate.openingId === openingId
      );
      // Nothing pending — the issue was already resolved, or never applied to
      // this opening. Silently do nothing rather than push an empty undo step.
      if (!action) return;

      const applied = applySharedOpeningActions(project, [action], newId);
      if (applied.project === project) return;

      await commitWallObjectEdit(
        `Complete shared ${openingNoun(opening.kind)}`,
        project,
        applied.project.wallObjects,
        [...applied.createdOpeningIds, ...applied.formedPairIds.flat()],
        false
      );
    },

    async realignSharedOpening(openingId) {
      const project = get().project;
      if (!project) return;

      const opening = project.wallObjects.find((object) => object.id === openingId);
      if (!isConnectableOpening(opening) || opening.connectsToObjectId === undefined) return;
      const partner = project.wallObjects.find(
        (object) => object.id === opening.connectsToObjectId
      );
      if (!isConnectableOpening(partner) || !isStructurallyValidPair(opening, partner)) return;
      // Only a live shared boundary has an answer to "where should the other
      // half be". A legacy pair on unrelated walls has no mirror to compute.
      if (!areSharedBoundaryWalls(project, opening.wallId, partner.wallId)) return;

      const partnerXMm = mirrorOpeningXMm(project, opening.wallId, partner.wallId, opening.xMm);
      if (partnerXMm === null) return;
      const partnerWall = getProjectWalls(project).find((wall) => wall.id === partner.wallId);
      if (!partnerWall) return;

      // THE SELECTED HALF IS AUTHORITATIVE. Size and hang height come across
      // as well as position: `paired-geometry-mismatch` has no geometric
      // answer to which half is right, and the analyzer deliberately declines
      // to guess — the user's selection is what supplies the answer.
      const next = {
        ...partner,
        xMm: partnerXMm,
        yMm: opening.yMm,
        widthMm: opening.widthMm,
        heightMm: opening.heightMm
      };

      if (
        !isOpeningSlotFree(
          project,
          partnerWall,
          { widthMm: next.widthMm, heightMm: next.heightMm },
          next.yMm,
          next.xMm,
          partner.id
        )
      ) {
        // Refuse and name what is in the way. Nothing is committed, so there
        // is no undo entry for a move that never happened.
        const blocker = findWallSlotBlocker(
          project,
          partner.wallId,
          next,
          new Set([partner.id, opening.id])
        );
        set({ error: sharedOpeningRealignBlockedMessage(blocker) });
        return;
      }

      await commitWallObjectEdit(
        `Realign shared ${openingNoun(opening.kind)}`,
        project,
        project.wallObjects.map((object) => (object.id === partner.id ? next : object)),
        [partner.id],
        false
      );
    },

    async splitSharedOpening(openingId) {
      const project = get().project;
      if (!project) return;

      const opening = project.wallObjects.find((object) => object.id === openingId);
      if (!isConnectableOpening(opening) || opening.connectsToObjectId === undefined) return;
      const partnerId = opening.connectsToObjectId;
      const partner = project.wallObjects.find((object) => object.id === partnerId);

      // While the two rooms still share that wall these are not two openings
      // that happen to be linked — they are one hole seen from both sides.
      if (
        isConnectableOpening(partner) &&
        areSharedBoundaryWalls(project, opening.wallId, partner.wallId)
      ) {
        set({ error: SHARED_OPENING_SPLIT_REFUSED_MESSAGE });
        return;
      }

      const nextWallObjects = project.wallObjects.map((object) =>
        (object.id === opening.id || object.id === partnerId) && isConnectableOpening(object)
          ? withoutPartnerPointer(object)
          : object
      );

      // applyEdit, NOT commitWallObjectEdit with reconcileWallIds: nothing
      // moved, and reconciliation would be free to re-adopt in the same
      // transaction exactly the two halves the user just asked to separate.
      await applyEdit(`Separate ${openingNoun(opening.kind)}s`, (current) => ({
        ...current,
        wallObjects: nextWallObjects
      }));
    },

    async keepThisOpeningOnly(openingId) {
      const project = get().project;
      if (!project) return;

      const opening = project.wallObjects.find((object) => object.id === openingId);
      if (!isConnectableOpening(opening) || opening.connectsToObjectId === undefined) return;
      const partner = project.wallObjects.find(
        (object) => object.id === opening.connectsToObjectId
      );
      if (!isConnectableOpening(partner)) return;
      // Offered only on `boundary-lost`. While the walls still face each other
      // deleting one face would leave a hole open into the room next door.
      if (areSharedBoundaryWalls(project, opening.wallId, partner.wallId)) return;

      // Deliberately NOT removePlacement: includePairedOpenings would take the
      // twin down with it, which is the opposite of what this action means.
      const nextWallObjects = project.wallObjects
        .filter((object) => object.id !== partner.id)
        .map((object) =>
          object.id === opening.id && isConnectableOpening(object)
            ? withoutPartnerPointer(object)
            : object
        );

      await applyEdit(`Keep this ${openingNoun(opening.kind)} only`, (current) => ({
        ...current,
        wallObjects: nextWallObjects
      }));
    },
  };

  return { actions };
}
