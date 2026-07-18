import { evaluateOpeningPair } from "../../domain/geometry/openingConnections";
import {
  findSharedWallCounterpart,
  mirrorOpeningXMm
} from "../../domain/geometry/sharedWalls";
import type { WallWithGeometry } from "../../domain/geometry/walls";
import {
  createOpeningPlacement,
  findFreeOpeningCenterXMm,
  getDefaultOpeningCenterYMm,
  getDefaultOpeningSizeMm,
  getOpeningKindLabel,
  type OpeningKind
} from "../../domain/placement/createOpening";
import type {
  ConnectableOpeningWallObject,
  OpeningWallObject,
  Project,
  WallObject
} from "../../domain/project";
import { getProjectWalls } from "../projectWalls";

// Lowercase noun for undo-stack labels ("Add door", "Move blocked zone"),
// matching the "Add artwork"/"Move artwork" label casing already in use —
// getOpeningKindLabel's Title Case is for UI headings/subjects instead.
export function openingNoun(kind: OpeningKind): string {
  return getOpeningKindLabel(kind).toLowerCase();
}

// Lowercase noun for any placeable object (wall or floor), so a plan move's
// label reads "Move artwork" / "Move door" / "Move blocked zone" the same way
// whether the object is wall-anchored or floor-placed.
export function moveObjectNoun(kind: WallObject["kind"]): string {
  if (kind === "artwork") return "artwork";
  if (kind === "wall-text") return "wall text";
  return openingNoun(kind);
}

// Shared by addOpening (centers on the wall) and placeOpeningFromPlan (places
// at the plan-chosen xMm): builds the opening record with the wall's
// centerline default for y. The only thing that differs between the two
// callers is xMm, so the record construction lives in one place.
export function buildOpeningOnWall(
  project: Project,
  wall: WallWithGeometry,
  kind: OpeningKind,
  xMm: number,
  centerYMm?: number
): OpeningWallObject {
  const centerlineYMm = wall.defaultCenterlineHeightMm ?? project.defaultCenterlineHeightMm;
  const opening = createOpeningPlacement(kind, wall.id, xMm, centerlineYMm);
  return centerYMm === undefined ? opening : { ...opening, yMm: centerYMm };
}

// Builds the wallObjects for adding an opening on `wall`, mirroring it onto a
// coincident twin wall (shared-wall pairing, spec §5.5) when `wall` has one.
// The primary opening always exists; when a twin is present the result also
// either connects to an alignable existing opening there or carries a fresh
// paired twin — all in one array so the caller commits it as a single edit
// (one undo step). Selection stays on the primary (its id is returned).
export function buildOpeningWithMirror(
  project: Project,
  wall: WallWithGeometry,
  kind: OpeningKind,
  xMm: number,
  centerYMm?: number
): { nextWallObjects: WallObject[]; primaryId: string; validateIds: string[] } {
  const primary = buildOpeningOnWall(project, wall, kind, xMm, centerYMm);
  const unpaired = {
    nextWallObjects: [...project.wallObjects, primary],
    primaryId: primary.id,
    validateIds: [primary.id]
  };

  // Blocked zones never pair (spec §5.5); only doors and windows mirror. This
  // also narrows `primary` to a connectable opening for the pointer writes.
  if (primary.kind !== "door" && primary.kind !== "window") return unpaired;

  const counterpart = findSharedWallCounterpart(project, wall.id, xMm, primary.widthMm);
  if (!counterpart) return unpaired;

  // Prefer connecting to an existing, unpaired, same-kind opening already on
  // the twin wall when the pair would read as aligned — one shared opening
  // rather than a duplicate stacked over it.
  const withPrimary: Project = { ...project, wallObjects: [...project.wallObjects, primary] };
  const connectable = project.wallObjects
    .filter(
      (object): object is ConnectableOpeningWallObject =>
        (object.kind === "door" || object.kind === "window") &&
        object.kind === primary.kind &&
        object.wallId === counterpart.wallId &&
        object.connectsToObjectId === undefined
    )
    .sort((a, b) => a.id.localeCompare(b.id))
    .find(
      (object) => evaluateOpeningPair(withPrimary, primary.id, object.id).status === "aligned"
    );

  if (connectable) {
    const nextWallObjects = withPrimary.wallObjects.map((object) => {
      if (object.id === primary.id) return { ...primary, connectsToObjectId: connectable.id };
      if (object.id === connectable.id) return { ...connectable, connectsToObjectId: primary.id };
      return object;
    });
    return { nextWallObjects, primaryId: primary.id, validateIds: [primary.id] };
  }

  // Otherwise mirror a fresh twin at the mirrored x — but only when that slot is
  // clear of a forbidden opening×opening overlap. An occupied slot (or a twin
  // wall that vanished) falls through to placing the primary alone, exactly as
  // without a shared wall.
  const twinWall = getProjectWalls(project).find((candidate) => candidate.id === counterpart.wallId);
  if (twinWall && isTwinSlotFree(project, twinWall, kind, counterpart.xMm, centerYMm)) {
    const twin = buildOpeningOnWall(project, twinWall, kind, counterpart.xMm, centerYMm);
    // buildOpeningOnWall with a door/window kind returns a connectable opening;
    // the guard narrows the union so the symmetric pointer writes typecheck.
    if (twin.kind === "door" || twin.kind === "window") {
      return {
        nextWallObjects: [
          ...project.wallObjects,
          { ...primary, connectsToObjectId: twin.id },
          { ...twin, connectsToObjectId: primary.id }
        ],
        primaryId: primary.id,
        validateIds: [primary.id, twin.id]
      };
    }
  }

  return unpaired;
}

// Whether an opening of the given `size` centered at (`xMm`, `centerYMm`) on
// `wall` would sit clear of a forbidden opening×opening overlap
// (overlapPolicy.ts). Reuses the creation-time free-slot search: the preferred x
// is returned unchanged only when it's already free, so an exact-match result
// means "no overlap here." `ignoreOpeningId` excludes an opening being
// moved/resized (its own current slot) from the blockers.
export function isOpeningSlotFree(
  project: Project,
  wall: WallWithGeometry,
  size: { widthMm: number; heightMm: number },
  centerYMm: number,
  xMm: number,
  ignoreOpeningId: string | null
): boolean {
  const sameWallOpenings = project.wallObjects.filter(
    (object) =>
      object.wallId === wall.id &&
      object.kind !== "artwork" &&
      object.id !== ignoreOpeningId
  );
  const freeXMm = findFreeOpeningCenterXMm({
    preferredXMm: xMm,
    sizeMm: size,
    centerYMm,
    wallLengthMm: wall.lengthMm,
    sameWallOpenings
  });
  return freeXMm !== null && Math.abs(freeXMm - xMm) < 1;
}

// Test a fresh mirrored twin using its resolved default size and centerline.
export function isTwinSlotFree(
  project: Project,
  wall: WallWithGeometry,
  kind: OpeningKind,
  xMm: number,
  centerYMm?: number
): boolean {
  const { widthMm, heightMm } = getDefaultOpeningSizeMm(kind);
  const defaultCenterlineYMm = wall.defaultCenterlineHeightMm ?? project.defaultCenterlineHeightMm;
  const resolvedCenterYMm =
    centerYMm ?? getDefaultOpeningCenterYMm(kind, heightMm, defaultCenterlineYMm);
  return isOpeningSlotFree(project, wall, { widthMm, heightMm }, resolvedCenterYMm, xMm, null);
}

// Mirror a paired opening move across rooms. Return null when no live partner
// or legal mirrored slot exists; the alignment advisory then reports the drift.
export function syncPartnerMove(
  project: Project,
  movedWallObjects: WallObject[],
  target: ConnectableOpeningWallObject,
  targetXMm: number,
  targetYMm: number
): { nextWallObjects: WallObject[]; partnerId: string } | null {
  const partnerId = target.connectsToObjectId;
  if (partnerId === undefined) return null;
  const partner = project.wallObjects.find((object) => object.id === partnerId);
  if (!partner || (partner.kind !== "door" && partner.kind !== "window")) return null;

  const partnerXMm = mirrorOpeningXMm(project, target.wallId, partner.wallId, targetXMm);
  if (partnerXMm === null) return null;

  const twinWall = getProjectWalls(project).find((candidate) => candidate.id === partner.wallId);
  if (!twinWall) return null;
  if (
    !isOpeningSlotFree(
      project,
      twinWall,
      { widthMm: partner.widthMm, heightMm: partner.heightMm },
      targetYMm,
      partnerXMm,
      partner.id
    )
  ) {
    return null;
  }

  return {
    nextWallObjects: movedWallObjects.map((object) =>
      object.id === partner.id ? { ...object, xMm: partnerXMm, yMm: targetYMm } : object
    ),
    partnerId
  };
}

// Mirror size onto a paired twin only when its current slot remains legal.
export function syncPartnerResize(
  project: Project,
  resizedWallObjects: WallObject[],
  target: ConnectableOpeningWallObject,
  widthMm: number,
  heightMm: number
): { nextWallObjects: WallObject[]; partnerId: string } | null {
  const partnerId = target.connectsToObjectId;
  if (partnerId === undefined) return null;
  const partner = project.wallObjects.find((object) => object.id === partnerId);
  if (!partner || (partner.kind !== "door" && partner.kind !== "window")) return null;

  const twinWall = getProjectWalls(project).find((candidate) => candidate.id === partner.wallId);
  if (!twinWall) return null;
  if (!isOpeningSlotFree(project, twinWall, { widthMm, heightMm }, partner.yMm, partner.xMm, partner.id)) {
    return null;
  }

  return {
    nextWallObjects: resizedWallObjects.map((object) =>
      object.id === partner.id ? { ...object, widthMm, heightMm } : object
    ),
    partnerId
  };
}

// Resolve the nearest legal x using the opening's exact default geometry.
// Same-wall openings block; artwork overlaps remain separately overridable.
export function resolveFreeOpeningXMm(
  project: Project,
  wall: WallWithGeometry,
  kind: OpeningKind,
  preferredXMm: number,
  centerYMm?: number
): number | null {
  const { widthMm, heightMm } = getDefaultOpeningSizeMm(kind);
  const centerlineYMm = wall.defaultCenterlineHeightMm ?? project.defaultCenterlineHeightMm;
  const resolvedCenterYMm =
    centerYMm ?? getDefaultOpeningCenterYMm(kind, heightMm, centerlineYMm);
  const sameWallOpenings = project.wallObjects.filter(
    (object) => object.wallId === wall.id && object.kind !== "artwork"
  );
  return findFreeOpeningCenterXMm({
    preferredXMm,
    sizeMm: { widthMm, heightMm },
    centerYMm: resolvedCenterYMm,
    wallLengthMm: wall.lengthMm,
    sameWallOpenings
  });
}
