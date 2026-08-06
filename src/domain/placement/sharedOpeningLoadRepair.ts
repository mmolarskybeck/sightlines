import type { Project } from "../project";
import { analyzeSharedOpenings, applySharedOpeningActions } from "./sharedOpeningAnalysis";

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

export function repairSharedOpeningsOnLoad(
  project: Project,
  newObjectId: () => string
): SharedOpeningLoadRepair {
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
