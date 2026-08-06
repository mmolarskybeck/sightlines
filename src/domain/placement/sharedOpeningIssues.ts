import type { Project } from "../project";
import { analyzeSharedOpenings, type SharedOpeningConflict } from "./sharedOpeningAnalysis";

// Persistent, whole-document view of shared-opening health, for the issues
// rail (plan "Stage 5 — Load repair and persistent conflicts"). Two sources,
// concatenated:
//
//   1. `analyzeSharedOpenings(project).conflicts` (no scope — the whole
//      document) — everything the analyzer already declines to repair:
//      ambiguous boundaries, drift it cannot realign, overhangs, and so on.
//   2. Every `create-twin` ACTION the analyzer would otherwise apply, remapped
//      to a `missing-twin` CONFLICT. The load pass deliberately never creates
//      twins on open — creating geometry in a document the user just opened is
//      a bolder claim than doing it during an edit they initiated — so any
//      `create-twin` the analyzer proposes is a repair nobody will apply
//      automatically. `missing-twin` sits in the reason union for exactly this
//      reason: it turns a declined repair into something VISIBLE, so a legacy
//      one-sided door facing an empty shared wall shows up in the issues rail
//      instead of being neither repaired nor reported.
//
// Deliberately NOT converted into `PlacementWarning`s, and this module knows
// nothing about that type. `PlacementWarning` requires a single
// `wallObjectId` + `wallId` (validatePlacement.ts:7-16); an ambiguous boundary
// spans several walls and is a document issue, not a placement collision.
// Merging the two lists is presentation-layer work (AppRail.tsx,
// PlacementWarnings.tsx), not this selector's.
//
// Pure, but not free — it re-runs the whole-document analysis pass. The
// caller (App.tsx) is expected to memoize this on `project` identity; without
// that memo it runs on every render, including hover, which is the load-
// bearing perf trap the plan calls out explicitly.
export function selectSharedOpeningConflicts(project: Project): SharedOpeningConflict[] {
  const { actions, conflicts } = analyzeSharedOpenings(project);

  // Guards against ever emitting two conflicts for the same opening+reason —
  // id is documented as exactly that key — should the analyzer one day start
  // reporting `missing-twin` itself.
  const seenIds = new Set(conflicts.map((conflict) => conflict.id));
  const wallIdByOpeningId = new Map(
    project.wallObjects.map((object) => [object.id, object.wallId])
  );

  const missingTwinConflicts: SharedOpeningConflict[] = [];
  for (const action of actions) {
    if (action.kind !== "create-twin") continue;
    const id = `${action.openingId}:missing-twin`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    // `action.openingId` always resolves — it came from analyzing this same
    // `project` — but a defensive skip beats constructing a conflict with a
    // bogus wallIds[0] if that contract is ever violated.
    const ownWallId = wallIdByOpeningId.get(action.openingId);
    if (ownWallId === undefined) continue;

    missingTwinConflicts.push({
      id,
      reason: "missing-twin",
      openingId: action.openingId,
      // [own wall, ...counterpart walls], per the type's contract — here just
      // the one wall the twin would land on. No `candidates`: completing this
      // conflict is a single fixed repair (Stage 6's `completeSharedOpening`
      // re-analyzes and replays the same `create-twin`), not a user pick
      // between several targets, so `candidates` would be inventing a field
      // the reason has no use for.
      wallIds: [ownWallId, action.wallId]
    });
  }

  // Concatenating two already-deterministic lists is still an implicit
  // dependency on their internal traversal order. Sort explicitly so the
  // result cannot depend on it, matching how the analyzer itself keys an
  // ambiguous cluster on its lexicographically smallest member rather than
  // visitation order.
  return [...conflicts, ...missingTwinConflicts].sort((a, b) => a.id.localeCompare(b.id));
}
