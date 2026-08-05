import { evaluateOpeningPair } from "../../domain/geometry/openingConnections";
import {
  areSharedBoundaryWalls,
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
import {
  FIT_EPSILON_MM,
  getOpeningLegalSpan,
  type OpeningFitConstraint
} from "../../domain/placement/fitOpeningOnWall";
import { isStructurallyValidPair } from "../../domain/placement/openingPairs";
import {
  SHARED_OPENING_GEOMETRY_TOLERANCE_MM,
  SHARED_OPENING_MIRROR_TOLERANCE_MM
} from "../../domain/placement/sharedOpeningAnalysis";
import { isOpeningSlotFree } from "../../domain/placement/openingSlots";
import { isBlockingKind } from "../../domain/placement/overlapPolicy";
import type {
  ConnectableOpeningWallObject,
  OpeningWallObject,
  Project,
  WallObject
} from "../../domain/project";
import { getProjectWalls } from "../projectWalls";

// The slot-freedom predicates now live in the domain (the shared-opening
// analyzer needs them and must not import from `src/app`). Re-exported here so
// every existing store/UI call site keeps its import path.
export { isOpeningSlotFree };

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
  if (kind === "case") return "display case";
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

// What a direct edit to one half of a paired opening may do to the other half.
//
// A single `null` used to conflate four unrelated situations — no partner at
// all, a legacy pair whose walls were never a shared boundary, a broken
// document, and a real collision on the far side — and every caller treated all
// four as "just move this half". Splitting them is what lets a live shared pair
// REFUSE an edit while the other three still proceed.
export type PartnerSyncResult =
  // The partner was mirrored; commit `nextWallObjects` as one edit.
  | { status: "synced"; nextWallObjects: WallObject[]; partnerId: string }
  // Unpaired, dangling pointer, or a kind mismatch -> caller proceeds.
  | { status: "no-partner" }
  // Paired, but the two walls are not two faces of one physical boundary
  // (a legacy "Connect" across unrelated walls). Best effort, never refused:
  // `nextWallObjects` carries the mirrored draft when the far half could
  // follow, and is absent when it could not. Preserving today's behaviour
  // matters — these pairs are exactly the data decision 4 exists to leave
  // alone, and silently changing how they move is still disturbing them.
  | {
      status: "legacy-unpaired-walls";
      partnerId: string;
      nextWallObjects?: WallObject[];
    }
  // A missing or degenerate wall: a broken document, not a user error.
  // Deliberately NOT a flavour of `blocked` — refusing here would wedge the
  // opening with no way out -> caller moves the target alone.
  | { status: "degraded"; partnerId: string; reason: "unmappable-wall" }
  // A live shared pair whose final state would not be one aligned opening on
  // the same boundary -> caller REFUSES the whole edit.
  | {
      status: "blocked";
      partnerId: string;
      reason: "slot-occupied" | "off-boundary";
    };

// A mirrored half may overhang its own wall by this much before the pair counts
// as having left the boundary. Sub-millimetre float slop only; the point is to
// refuse a door slid past the run its two rooms actually share, not to argue
// about the last bit of a projection.
const PARTNER_BOUNDS_EPS_MM = 0.5;

// The live, same-kind opening on the other side of a pair, or null when the
// pointer is dangling / this object is not a paired opening at all.
// The partner of a STRUCTURALLY sound pair, or null. `no-partner` is documented
// as covering kind mismatches and dangling pointers, so this has to enforce
// that rather than trust the pointer: a broken one-way door->window reference
// would otherwise move or resize an unrelated object. isStructurallyValidPair
// is the same predicate normalizeOpeningPairs and the schema use, so a document
// this rejects is one the schema would reject too.
function resolveLivePartner(
  project: Project,
  target: ConnectableOpeningWallObject
): ConnectableOpeningWallObject | null {
  const partnerId = target.connectsToObjectId;
  if (partnerId === undefined) return null;
  const partner = project.wallObjects.find((object) => object.id === partnerId);
  if (!partner || (partner.kind !== "door" && partner.kind !== "window")) return null;
  if (!isStructurallyValidPair(target, partner)) return null;
  return partner;
}

// Whether an opening of `widthMm` centred at `xMm` still sits on a wall of
// `wallLengthMm`. The mirrored half leaving its own wall is exactly the
// "dragged past the run the two rooms share" case: the far face has no wall
// there, so this is no longer one physical opening.
function fitsOnWall(xMm: number, widthMm: number, wallLengthMm: number): boolean {
  const halfMm = widthMm / 2;
  return (
    xMm - halfMm >= -PARTNER_BOUNDS_EPS_MM &&
    xMm + halfMm <= wallLengthMm + PARTNER_BOUNDS_EPS_MM
  );
}

// Mirror a paired opening move across rooms.
//
// `project` is the PRE-EDIT project and `target` its PRE-EDIT record: the
// shared-boundary classification must be computed before any mutation (and
// before normalizeOpeningPairs), or a move that drags a healthy pair off its
// boundary would first look "non-shared" and then be waved through as legacy
// data. `targetWallId` is where the target is going — it differs from
// `target.wallId` only on a plan re-anchor.
// The mirrored draft a caller should commit, if any. `synced` always carries
// one; a legacy pair carries one only when the far half could follow. Every
// other status means "commit the target-only draft" — and `blocked` never
// reaches here, because the caller refuses before asking.
// Occupancy is read from the completed draft, never the pre-edit project.
// Topology (is this a shared boundary?) is deliberately pre-edit — that is the
// whole point of classifying before mutating — but "is the far slot taken?" is
// a question about the state being committed. A batch that moves a blocker OUT
// of the twin's destination in the same transaction would otherwise be refused
// for a collision its own completed state does not contain.
function draftOf(project: Project, wallObjects: WallObject[]): Project {
  return { ...project, wallObjects };
}

export function appliedPartnerSync(
  result: PartnerSyncResult
): { nextWallObjects: WallObject[]; partnerId: string } | null {
  if (result.status === "synced") {
    return { nextWallObjects: result.nextWallObjects, partnerId: result.partnerId };
  }
  if (result.status === "legacy-unpaired-walls" && result.nextWallObjects) {
    return { nextWallObjects: result.nextWallObjects, partnerId: result.partnerId };
  }
  return null;
}

export function syncPartnerMove(
  project: Project,
  movedWallObjects: WallObject[],
  target: ConnectableOpeningWallObject,
  targetXMm: number,
  targetYMm: number,
  targetWallId: string = target.wallId
): PartnerSyncResult {
  const partner = resolveLivePartner(project, target);
  if (!partner) return { status: "no-partner" };
  const partnerId = partner.id;

  const twinWall = getProjectWalls(project).find((candidate) => candidate.id === partner.wallId);
  const partnerXMm = mirrorOpeningXMm(project, targetWallId, partner.wallId, targetXMm);
  // A wall that is missing or degenerate is a broken document. Report it as
  // such rather than refusing, so the opening never becomes uneditable.
  if (!twinWall || partnerXMm === null) {
    return { status: "degraded", partnerId, reason: "unmappable-wall" };
  }

  // The carve-out: a pair the user connected across walls that never faced
  // each other is not one physical opening, and never was. It may drift, the
  // same as it always has — otherwise a legacy north/south pair could not be
  // nudged at all without splitting it first.
  const occupancy = draftOf(project, movedWallObjects);
  const mirroredMove = (): WallObject[] | null => {
    if (!fitsOnWall(partnerXMm, partner.widthMm, twinWall.lengthMm)) return null;
    if (
      !isOpeningSlotFree(
        occupancy,
        twinWall,
        { widthMm: partner.widthMm, heightMm: partner.heightMm },
        targetYMm,
        partnerXMm,
        partner.id
      )
    ) {
      return null;
    }
    return movedWallObjects.map((object) =>
      object.id === partner.id ? { ...object, xMm: partnerXMm, yMm: targetYMm } : object
    );
  };

  if (!areSharedBoundaryWalls(project, target.wallId, partner.wallId)) {
    // Best effort, and only while the half stays on its own wall. Dragging a
    // legacy half onto a DIFFERENT wall is a re-anchor, not a nudge: mirroring
    // across walls that never faced each other is meaningless, and mirroring
    // onto the partner's own wall would collide the two halves and block a move
    // that has always been allowed. normalizeOpeningPairs owns that case.
    const mirrored = targetWallId === target.wallId ? mirroredMove() : null;
    return mirrored
      ? { status: "legacy-unpaired-walls", partnerId, nextWallObjects: mirrored }
      : { status: "legacy-unpaired-walls", partnerId };
  }

  // From here the pair IS one physical opening: it stays synchronized on the
  // same boundary, or the edit fails.
  if (
    targetWallId !== target.wallId &&
    !areSharedBoundaryWalls(project, targetWallId, partner.wallId)
  ) {
    return { status: "blocked", partnerId, reason: "off-boundary" };
  }
  if (!fitsOnWall(partnerXMm, partner.widthMm, twinWall.lengthMm)) {
    return { status: "blocked", partnerId, reason: "off-boundary" };
  }
  const mirrored = mirroredMove();
  if (!mirrored) return { status: "blocked", partnerId, reason: "slot-occupied" };

  return { status: "synced", nextWallObjects: mirrored, partnerId };
}

// Batch counterpart of syncPartnerMove for the group-move paths.
//
// "Skip the pair when both halves moved" is not enough: the batch can leave the
// two halves on unrelated walls, or offset past any common opening, and the
// pair would silently stop being one physical opening. So:
//
//   - exactly one half in the batch -> mirror it onto the other;
//   - both halves in the batch -> VALIDATE the completed draft still reads as
//     one aligned opening on the same boundary;
//   - neither -> nothing.
//
// Classification is always against the pre-edit `project`, and a legacy pair is
// left entirely alone (its halves have always been free to drift apart).
// Blocking is all-or-nothing, matching "one collision blocks the entire batch".
export type MovedPairSyncResult =
  | { status: "ok"; nextWallObjects: WallObject[]; validateIds: string[] }
  | {
      status: "blocked";
      openingId: string;
      partnerId: string;
      reason: "slot-occupied" | "off-boundary" | "not-aligned";
    };

// Are these two halves ACTUALLY one opening — mirrored x, and identical width,
// height and hang height, within the tolerances Stage 2 already defines?
//
// Deliberately not evaluateOpeningPair. That predicate exists to INFER whether
// two independent openings should be read as a passage, so it accepts ~50%
// overlap and merely requires some vertical overlap: two 915 mm doors can sit
// ~400 mm out of step, at different heights, and still pass. Good enough to
// carve a hole in 3D; nowhere near good enough to certify that a batch left a
// shared opening synchronized.
function isMirroredPair(
  project: Project,
  a: WallObject,
  b: WallObject
): boolean {
  const mirroredXMm = mirrorOpeningXMm(project, a.wallId, b.wallId, a.xMm);
  if (mirroredXMm === null) return false;
  if (Math.abs(b.xMm - mirroredXMm) > SHARED_OPENING_MIRROR_TOLERANCE_MM) return false;
  return (
    Math.abs(a.widthMm - b.widthMm) <= SHARED_OPENING_GEOMETRY_TOLERANCE_MM &&
    Math.abs(a.heightMm - b.heightMm) <= SHARED_OPENING_GEOMETRY_TOLERANCE_MM &&
    Math.abs(a.yMm - b.yMm) <= SHARED_OPENING_GEOMETRY_TOLERANCE_MM
  );
}

export function syncMovedPairHalves(
  project: Project,
  draftWallObjects: WallObject[],
  movedIds: Iterable<string>
): MovedPairSyncResult {
  const movedIdSet = new Set(movedIds);
  if (movedIdSet.size === 0) {
    return { status: "ok", nextWallObjects: draftWallObjects, validateIds: [] };
  }

  let working = draftWallObjects;
  const validateIds: string[] = [];
  const seenPairs = new Set<string>();

  for (const candidate of project.wallObjects) {
    if (candidate.kind !== "door" && candidate.kind !== "window") continue;
    const partner = resolveLivePartner(project, candidate);
    // Only structurally symmetric pairs; a one-way pointer is normalizeOpeningPairs' problem.
    if (!partner || partner.connectsToObjectId !== candidate.id) continue;

    // "\u0000" as a source escape, not a literal NUL byte: an embedded NUL
    // makes grep/rg classify the whole file as binary and skip it.
    const pairKey = [candidate.id, partner.id].sort().join("\u0000");
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    const candidateMoved = movedIdSet.has(candidate.id);
    const partnerMoved = movedIdSet.has(partner.id);
    if (!candidateMoved && !partnerMoved) continue;
    // Legacy pairs keep today's behaviour: the batch moves whatever it moves.
    if (!areSharedBoundaryWalls(project, candidate.wallId, partner.wallId)) continue;

    if (candidateMoved && partnerMoved) {
      const draftProject: Project = { ...project, wallObjects: working };
      const draftA = working.find((object) => object.id === candidate.id);
      const draftB = working.find((object) => object.id === partner.id);
      if (!draftA || !draftB) continue;
      if (!areSharedBoundaryWalls(draftProject, draftA.wallId, draftB.wallId)) {
        return {
          status: "blocked",
          openingId: candidate.id,
          partnerId: partner.id,
          reason: "off-boundary"
        };
      }
      if (!isMirroredPair(draftProject, draftA, draftB)) {
        return {
          status: "blocked",
          openingId: candidate.id,
          partnerId: partner.id,
          reason: "not-aligned"
        };
      }
      continue;
    }

    // Exactly one half moved: the moved half is authoritative and the other
    // follows it, read from the finished draft so the batch's own result (not a
    // half-applied intermediate) is what gets mirrored.
    const moved = candidateMoved ? candidate : partner;
    const still = candidateMoved ? partner : candidate;
    const draftMoved = working.find((object) => object.id === moved.id);
    if (!draftMoved) continue;

    const result = syncPartnerMove(
      project,
      working,
      moved,
      draftMoved.xMm,
      draftMoved.yMm,
      draftMoved.wallId
    );
    if (result.status === "blocked") {
      return {
        status: "blocked",
        openingId: moved.id,
        partnerId: still.id,
        reason: result.reason
      };
    }
    if (result.status === "synced") {
      working = result.nextWallObjects;
      validateIds.push(still.id);
    }
  }

  return { status: "ok", nextWallObjects: working, validateIds };
}

// The run a PAIRED opening may occupy, expressed in the target's wall-local
// coordinates, with both faces' constraints folded into one interval.
//
// A pair is one physical opening, so it has to be solved once in a common
// coordinate space. Fitting each face on its own and reconciling afterwards
// lets the two halves settle at locally valid but physically different centres.
//
// The mapping between twin walls is ORDER-REVERSING: coincident twins are
// anti-parallel, so mirrorOpeningXMm sends the partner's local x to roughly
// `length - x`. Intersecting [a1,b1] with the partner's [a2,b2] using the
// mapped endpoints in their original order would therefore compare a start
// against an end and silently yield an empty span. Map both endpoints, then
// re-derive min/max from the results rather than assuming orientation.
export function resolvePairedOpeningSpan(
  project: Project,
  target: ConnectableOpeningWallObject,
  partner: OpeningWallObject
): { spanStartMm: number; spanEndMm: number; constraintSource: OpeningFitConstraint } | null {
  const walls = getProjectWalls(project);
  const targetWall = walls.find((wall) => wall.id === target.wallId);
  const partnerWall = walls.find((wall) => wall.id === partner.wallId);
  if (!targetWall || !partnerWall) return null;

  const sameWall = (wallId: string) =>
    project.wallObjects.filter((object) => object.wallId === wallId);

  const own = getOpeningLegalSpan(target, sameWall(target.wallId), targetWall.lengthMm);
  const twin = getOpeningLegalSpan(partner, sameWall(partner.wallId), partnerWall.lengthMm);

  const mappedA = mirrorOpeningXMm(project, partner.wallId, target.wallId, twin.spanStartMm);
  const mappedB = mirrorOpeningXMm(project, partner.wallId, target.wallId, twin.spanEndMm);
  // Unmappable walls (missing or degenerate) degrade to the target's own span
  // rather than blocking the edit.
  if (mappedA === null || mappedB === null) {
    return {
      spanStartMm: own.spanStartMm,
      spanEndMm: own.spanEndMm,
      constraintSource: own.boundedByNeighbor ? "neighbor" : "wall"
    };
  }

  const twinLoMm = Math.min(mappedA, mappedB);
  const twinHiMm = Math.max(mappedA, mappedB);

  const spanStartMm = Math.max(own.spanStartMm, twinLoMm);
  const spanEndMm = Math.min(own.spanEndMm, twinHiMm);

  // Which face actually bound the result decides how the UI words it.
  const twinBinds =
    twinLoMm > own.spanStartMm + FIT_EPSILON_MM || twinHiMm < own.spanEndMm - FIT_EPSILON_MM;
  const constraintSource: OpeningFitConstraint = twinBinds
    ? twin.boundedByNeighbor
      ? "paired-neighbor"
      : "paired-wall"
    : own.boundedByNeighbor
      ? "neighbor"
      : "wall";

  return { spanStartMm, spanEndMm, constraintSource };
}

// Apply one solved geometry to a paired twin: the SAME width (a scalar, copied
// verbatim — never mapped, which also sidesteps the fact that the pairing angle
// tolerance makes the point mapping only near-isometric) and the mirrored
// centre. The caller solves the fit once against the common span
// (resolvePairedOpeningSpan), so both faces are guaranteed to agree.
export function syncPartnerResize(
  project: Project,
  resizedWallObjects: WallObject[],
  target: ConnectableOpeningWallObject,
  widthMm: number,
  heightMm: number,
  targetXMm: number,
  targetYMm: number
): PartnerSyncResult {
  const partner = resolveLivePartner(project, target);
  if (!partner) return { status: "no-partner" };
  const partnerId = partner.id;

  const twinWall = getProjectWalls(project).find((candidate) => candidate.id === partner.wallId);
  const partnerXMm = mirrorOpeningXMm(project, target.wallId, partner.wallId, targetXMm);
  if (!twinWall || partnerXMm === null) {
    return { status: "degraded", partnerId, reason: "unmappable-wall" };
  }

  // The SOLVED y, not the partner's stale one. A door's y is recomputed as
  // heightMm / 2 so its bottom stays on the floor, so mirroring width, height
  // and x alone left the two halves at different heights — manufacturing the
  // paired-geometry-mismatch this stage exists to prevent. The slot has to be
  // validated at the height the partner will actually occupy, too.
  const occupancy = draftOf(project, resizedWallObjects);
  const mirroredResize = (): WallObject[] | null => {
    if (!fitsOnWall(partnerXMm, widthMm, twinWall.lengthMm)) return null;
    if (
      !isOpeningSlotFree(
        occupancy,
        twinWall,
        { widthMm, heightMm },
        targetYMm,
        partnerXMm,
        partner.id
      )
    ) {
      return null;
    }
    return resizedWallObjects.map((object) =>
      object.id === partner.id
        ? { ...object, widthMm, heightMm, xMm: partnerXMm, yMm: targetYMm }
        : object
    );
  };

  if (!areSharedBoundaryWalls(project, target.wallId, partner.wallId)) {
    const mirrored = mirroredResize();
    return mirrored
      ? { status: "legacy-unpaired-walls", partnerId, nextWallObjects: mirrored }
      : { status: "legacy-unpaired-walls", partnerId };
  }

  // The width is the SOLVED one (resolvePairedOpeningSpan already folded both
  // faces' runs into one interval), so a mirrored half that no longer fits its
  // own wall means the request reached past the boundary itself.
  if (!fitsOnWall(partnerXMm, widthMm, twinWall.lengthMm)) {
    return { status: "blocked", partnerId, reason: "off-boundary" };
  }
  const mirrored = mirroredResize();
  if (!mirrored) return { status: "blocked", partnerId, reason: "slot-occupied" };

  return { status: "synced", nextWallObjects: mirrored, partnerId };
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
  // Blockers come from the overlap policy, not a second hardcoded copy of it:
  // wall text and display cases are furniture and never block placement, so a
  // new door must not slide away from a label it is allowed to overlap.
  const sameWallOpenings = project.wallObjects.filter(
    (object) => object.wallId === wall.id && isBlockingKind(object.kind)
  );
  return findFreeOpeningCenterXMm({
    preferredXMm,
    sizeMm: { widthMm, heightMm },
    centerYMm: resolvedCenterYMm,
    wallLengthMm: wall.lengthMm,
    sameWallOpenings
  });
}
