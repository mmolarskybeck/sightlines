import { areSharedBoundaryWalls, sameDoorLeaf } from "../geometry/sharedWalls";
import type { Project, WallObject } from "../project";
import { isStructurallyValidPair } from "./openingPairs";
import {
  analyzeSharedOpenings,
  applySharedOpeningActions,
  resolveSharedDoorLeaves,
  withDoorLeaf
} from "./sharedOpeningAnalysis";

// The LINK-ONLY repair a document gets when it becomes the open document
// (plan "Stage 5 — Load repair and persistent conflicts").
//
// Whole-document, deliberately unscoped: unlike an edit, opening a project is
// not a transaction over a few walls, so there is nothing to scope to. Runs
// POST-parse — normalizeOpeningPairs (openingPairs.ts) is the pre-parse pass
// over untrusted input and only ever severs pointers; this one reads floor
// geometry, so it can only run once the document has parsed.
//
// `adopt` and `realign` are applied; `create-twin` never is. Creating geometry
// in a document the user just opened is a bolder claim than doing it during an
// edit they initiated — a room gaining a door it never had, on open, with no
// undo entry to reverse it (setDocument resets the stack). Every declined twin
// instead becomes a visible `missing-twin` issue via
// selectSharedOpeningConflicts, which is what keeps a declined repair from
// being silently lost.
//
// Legacy non-boundary pairs (settled decision 4: a door on wall-north paired
// with one on wall-south) are preserved unchanged. They are cautions, not
// errors — the analyzer reports them as `boundary-lost` conflicts and nothing
// here severs them.
export type SharedOpeningLoadRepair = {
  // The same reference as the input when nothing was applied — callers memoize
  // on project identity (the openingPairs.ts:123 convention).
  project: Project;
  // Shared openings made whole again: adoptions plus realignments. One number,
  // because both mean the same thing to the user — two faces that are one
  // opening again.
  linkedCount: number;
  // `create-twin` actions this pass deliberately did NOT apply. Not an error
  // and not reported as one; the issues rail surfaces each as `missing-twin`.
  declinedTwinCount: number;
  // Ids of openings whose GEOMETRY moved — the partner half of every applied
  // `realign`, verbatim from applySharedOpeningActions. Deliberately excludes
  // `adopt`: adopting only rewrites connectsToObjectId pointers on the two
  // openings involved and moves neither, so it cannot create a placement
  // collision. Only a moved opening needs re-validating against artwork
  // (isBlockingKind excludes artwork on purpose — overlap there is
  // overridable, not forbidden — so realignment can silently land a door on a
  // hung work). Do not fold formedPairIds in here to "be thorough"; a pointer
  // rewrite has nothing to validate.
  realignedIds: string[];
};

// Reconcile the handing of ALREADY-PAIRED doors whose two stored leaves
// disagree — an imported or hand-edited document, or one written before the
// mirror rule existed.
//
// This is deliberately NOT in normalizeOpeningPairs: that pass is pre-parse and
// pointer-only, reads no floor geometry, and must stay that way. Deciding
// whether two walls are one physical boundary — the gate below, without which a
// legacy north/south pair would have its handing rewritten for no reason — is
// exactly the geometry it refuses to read. So it happens here, in the
// post-parse, geometry-aware pass that already exists for this class of problem.
//
// Silent and lossless by construction: it applies the same table `adopt` does
// (resolveSharedDoorLeaves), with the lexicographically smaller half as the
// authoritative one — already this pass's convention for `realign`. Nothing is
// reported to the user and no conflict reason is minted, matching the settled
// decision that handing never becomes something to resolve in the
// shared-opening UI.
function reconcilePairedDoorLeaves(project: Project): Project {
  const objectsById = new Map(project.wallObjects.map((object) => [object.id, object]));
  let next: WallObject[] | null = null;

  for (const opening of project.wallObjects) {
    if (opening.kind !== "door") continue;
    if (opening.connectsToObjectId === undefined) continue;
    const partner = objectsById.get(opening.connectsToObjectId);
    if (!partner || partner.kind !== "door") continue;
    // Symmetric pointers only, and only the half that sorts first, so each pair
    // is visited once and the authoritative half is the same whichever way the
    // array happens to be ordered.
    if (partner.connectsToObjectId !== opening.id) continue;
    if (opening.id.localeCompare(partner.id) > 0) continue;
    if (!isStructurallyValidPair(opening, partner)) continue;
    // Legacy pairs across walls that never faced each other keep INDEPENDENT
    // leaves, the same carve-out the move/resize mirror makes (openingEdits.ts).
    // Their halves are not two faces of one physical door, so there is no shared
    // handing to agree on.
    if (!areSharedBoundaryWalls(project, opening.wallId, partner.wallId)) continue;

    const { authoritativeLeaf, counterpartLeaf } = resolveSharedDoorLeaves(opening, partner);
    if (
      sameDoorLeaf(opening.leaf, authoritativeLeaf) &&
      sameDoorLeaf(partner.leaf, counterpartLeaf)
    ) {
      continue;
    }

    next ??= [...project.wallObjects];
    const openingIndex = next.findIndex((object) => object.id === opening.id);
    const partnerIndex = next.findIndex((object) => object.id === partner.id);
    if (openingIndex >= 0) next[openingIndex] = withDoorLeaf(opening, authoritativeLeaf);
    if (partnerIndex >= 0) next[partnerIndex] = withDoorLeaf(partner, counterpartLeaf);
  }

  // Same-reference convention as everything else on this path: callers memoize
  // on project identity, so an untouched document must come back untouched.
  return next ? { ...project, wallObjects: next } : project;
}

export function repairSharedOpeningsOnLoad(
  rawProject: Project,
  newObjectId: () => string
): SharedOpeningLoadRepair {
  // Handing first, so `analyzeSharedOpenings` and `applySharedOpeningActions`
  // still see ONE project value (their stated contract). Reconciliation only
  // ever touches doors that are already symmetrically paired, and leaves are
  // invisible to the analyzer, so it cannot change which actions get proposed —
  // and running it after would let this pass's "smaller half wins" default
  // second-guess an `adopt` that already picked a primary.
  const project = reconcilePairedDoorLeaves(rawProject);
  const { actions } = analyzeSharedOpenings(project);

  const linkActions = actions.filter((action) => action.kind !== "create-twin");
  const declinedTwinCount = actions.length - linkActions.length;

  // applySharedOpeningActions returns the input reference for an empty (or
  // wholly stale) action list, so the no-op case needs no special handling.
  const applied = applySharedOpeningActions(project, linkActions, newObjectId);

  return {
    project: applied.project,
    // What was APPLIED, not what was proposed: applySharedOpeningActions drops
    // actions that fail its integrity guards, and a count the user sees must
    // describe the document they got.
    linkedCount: applied.formedPairIds.length + applied.realignedIds.length,
    declinedTwinCount,
    realignedIds: applied.realignedIds
  };
}
