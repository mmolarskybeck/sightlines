import { parseFaceWallId } from "../geometry/freestandingWalls";
import type { ConnectableOpeningWallObject, Project, WallObject } from "../project";

// A shared-wall door/window is stored as two linked wall objects. Expand a set
// of requested deletions to include those paired twins so every direct-delete
// entrypoint preserves the full-sync contract.
export function includePairedOpenings(
  wallObjects: WallObject[],
  requestedIds: Iterable<string>
): Set<string> {
  const deletedIds = new Set(requestedIds);
  for (const wallObject of wallObjects) {
    if (
      deletedIds.has(wallObject.id) &&
      (wallObject.kind === "door" || wallObject.kind === "window") &&
      wallObject.connectsToObjectId !== undefined
    ) {
      deletedIds.add(wallObject.connectsToObjectId);
    }
  }
  return deletedIds;
}

// After openings are deleted via a room/wall cascade, clear any surviving
// door/window's partner pointer so no dangling reference persists.
export function clearOpeningPartners(
  wallObjects: WallObject[],
  deletedIds: Set<string>
): WallObject[] {
  if (deletedIds.size === 0) return wallObjects;
  return wallObjects.map((wallObject) => {
    if (
      (wallObject.kind === "door" || wallObject.kind === "window") &&
      wallObject.connectsToObjectId !== undefined &&
      deletedIds.has(wallObject.connectsToObjectId)
    ) {
      const { connectsToObjectId: _cleared, ...rest } = wallObject;
      return rest;
    }
    return wallObject;
  });
}

function isConnectable(
  wallObject: WallObject | undefined
): wallObject is ConnectableOpeningWallObject {
  return wallObject?.kind === "door" || wallObject?.kind === "window";
}

// Whether two openings form a STRUCTURALLY valid pair — a mirror of the
// pairing refinements in projectSchema.ts, and deliberately nothing more.
//
// The scope is exactly "what makes the document unsaveable", because this
// predicate drives SILENT repair. It is tempting to also require that the two
// walls be the coincident twin faces of one physical wall (findSharedWallCounterpart),
// so that a paired opening dragged onto an unrelated wall self-heals. That
// would be wrong: connectOpenings deliberately accepts pairs whose walls are
// not twins — the inspector's Select offers them, alignmentLabel names the
// reason ("walls are not parallel", "walls are too far apart"), and
// InspectorNotice shows a caution with a manual Disconnect. A door on
// wall-north paired with one on wall-south of the same room is a legitimate,
// user-created, tested state. Auto-severing it on load would delete the user's
// own explicit connect and destroy data no schema rule objects to.
//
// So geometry is advisory here and always has been: an opening that drags onto
// an unrelated wall simply becomes a visibly misaligned pair the user can
// resolve. The harmful case — both halves on ONE wall — is prevented at drag
// time (excludeWallId in planSnapTargets) and repaired here.
//
// Pointer-level only, so this is also trivially safe on the not-yet-parsed
// input migrateProject hands it: no floor geometry is read.
export function isStructurallyValidPair(
  a: WallObject | undefined,
  b: WallObject | undefined
): boolean {
  if (!isConnectable(a) || !isConnectable(b)) return false;
  // Self-connection.
  if (a.id === b.id) return false;
  // Symmetric double-pointer — enforced, not derived.
  if (a.connectsToObjectId !== b.id || b.connectsToObjectId !== a.id) return false;
  // A door never pairs with a window.
  if (a.kind !== b.kind) return false;
  // Never partition faces, and never the same wall.
  if (parseFaceWallId(a.wallId) !== null || parseFaceWallId(b.wallId) !== null) return false;
  return a.wallId !== b.wallId;
}

// Disconnect both halves of every pair that is no longer structurally valid,
// plus any dangling or non-reciprocal pointer.
//
// Idempotent, and safe on the partially-validated raw input the migration path
// hands it: it reads only fields whose presence it checks. Run this ONCE over a
// completed draft — never per-object while a batch is still being rewritten,
// which would be order-dependent (the first twin moves, the repair reads the
// second twin's stale wall and severs the pair, then the second twin moves into
// what would have been a valid position).
export function normalizeOpeningPairs(project: Project): {
  project: Project;
  repairedCount: number;
} {
  // Raw pre-parse input may not have a usable wallObjects array at all; leave
  // it untouched and let parseProject report the real problem.
  if (!Array.isArray(project?.wallObjects)) return { project, repairedCount: 0 };

  const byId = new Map(project.wallObjects.map((wallObject) => [wallObject.id, wallObject]));

  const severedIds = new Set<string>();
  for (const wallObject of project.wallObjects) {
    if (!isConnectable(wallObject) || wallObject.connectsToObjectId === undefined) continue;
    if (severedIds.has(wallObject.id)) continue;

    const partner = byId.get(wallObject.connectsToObjectId);
    if (isStructurallyValidPair(wallObject, partner)) continue;

    severedIds.add(wallObject.id);
    // Only clear the partner's pointer when it actually points back; an
    // unrelated opening that happens to be referenced keeps its own pairing.
    if (isConnectable(partner) && partner.connectsToObjectId === wallObject.id) {
      severedIds.add(partner.id);
    }
  }

  if (severedIds.size === 0) return { project, repairedCount: 0 };

  const wallObjects = project.wallObjects.map((wallObject) => {
    if (!severedIds.has(wallObject.id)) return wallObject;
    const { connectsToObjectId: _cleared, ...rest } = wallObject as ConnectableOpeningWallObject;
    return rest as WallObject;
  });

  // Count pairs, not halves — the user-facing number is "one invalid shared
  // opening was disconnected", not two.
  return {
    project: { ...project, wallObjects },
    repairedCount: Math.ceil(severedIds.size / 2)
  };
}
