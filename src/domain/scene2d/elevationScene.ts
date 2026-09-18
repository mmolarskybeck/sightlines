import type {
  Artwork,
  ArtworkFloorObject,
  FloorSupport,
  ArtworkWallObject,
  CaseFloorObject,
  CaseWallObject,
  FloorObject,
  OpeningWallObject,
  WallObject,
  WallTextWallObject
} from "../project";
import { getPlacementFootprintMm } from "../framing";
import type { FloorPartition } from "../geometry/freestandingWalls";
import { isMonitorArtwork } from "../geometry/monitorGlyphs";
import { shelfElevationGlyph } from "../geometry/shelfGlyphs";
import {
  assemblyPlanRect,
  resolveFloorSupport,
  supportPlanRect
} from "../geometry/supportGlyphs";
import {
  getFloorObjectPlanRect,
  segmentPlanRect,
  type PlanRect
} from "../geometry/planObjects";
import type { Point } from "../geometry/polygon";

// Pure derivation: one wall's object inventory -> the static elevation
// drawing, as plain-data primitives (planScene.ts's twin). ElevationView maps
// these to SVG elements, and the upcoming PNG/PDF exports will draw the SAME
// scene. Static-only, same rule as the plan scene: move drags, ghosts, snap
// guides, marquee, group outlines and dimension lines stay in the view.
//
// The input is the wall-object array rather than a whole Project because the
// interactive view layers live arrange-session previews over the committed
// objects BEFORE any derivation runs — exports simply pass
// project.wallObjects and get the committed state.

// Wall-local coordinates are y-up from the floor (docs/plan.md §2); SVG is
// y-down from the top. Every elevation drawing goes through this one flip.
// (Moved here from app/components/elevation/elevationArtworkGeometry.ts so the export
// builders can share it without importing app code; that module re-exports
// it for the existing component imports.)
export function wallLocalYToSvgY(wallHeightMm: number, yMm: number): number {
  return wallHeightMm - yMm;
}

export type ArtworkCenterMm = {
  xMm: number;
  yMm: number;
};

export type ArtworkSizeMm = {
  widthMm: number;
  heightMm: number;
};

export type SvgRectMm = {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
};

// Center-anchored wall-local coordinates (docs/plan.md §2) to a top-left SVG
// rect: x is a plain offset since SVG x and wall-local x both run left-to-
// right from the wall start, but y needs the one shared flip
// (wallLocalYToSvgY) since SVG is y-down and wall-local is y-up from the
// floor — the rect's *top* edge (higher wall-local y) is what becomes the
// smaller SVG y.
export function getArtworkRectSvg(
  wallHeightMm: number,
  center: ArtworkCenterMm,
  size: ArtworkSizeMm
): SvgRectMm {
  return {
    xMm: center.xMm - size.widthMm / 2,
    yMm: wallLocalYToSvgY(wallHeightMm, center.yMm + size.heightMm / 2),
    widthMm: size.widthMm,
    heightMm: size.heightMm
  };
}

// A local visibility flag only — "make constraints visible" (docs/plan.md
// §1.5), not a constraint enforced here. The store's own validator remains
// the authoritative source of placement warnings; this just lets a renderer
// highlight a placement that visibly extends past the wall's own bounds
// without importing that validator.
export function isArtworkOutOfWallBounds(
  wallLengthMm: number,
  wallHeightMm: number,
  center: ArtworkCenterMm,
  size: ArtworkSizeMm
): boolean {
  const leftMm = center.xMm - size.widthMm / 2;
  const rightMm = center.xMm + size.widthMm / 2;
  const bottomMm = center.yMm - size.heightMm / 2;
  const topMm = center.yMm + size.heightMm / 2;

  return leftMm < 0 || rightMm > wallLengthMm || bottomMm < 0 || topMm > wallHeightMm;
}

export type ElevationSceneArtwork = {
  object: ArtworkWallObject;
  // The joined artwork record (undefined for a dangling artworkId) —
  // frame/mat/status/assetId all read from here, matching the neutral
  // fallback the view uses when the record is missing.
  artwork?: Artwork;
  centerMm: ArtworkCenterMm;
  sizeMm: ArtworkSizeMm;
  outOfBounds: boolean;
};

export type ElevationSceneOpening = {
  object: OpeningWallObject;
  centerMm: ArtworkCenterMm;
  sizeMm: ArtworkSizeMm;
  outOfBounds: boolean;
};

export type ElevationSceneWallText = {
  object: WallTextWallObject;
  centerMm: ArtworkCenterMm;
  sizeMm: ArtworkSizeMm;
  outOfBounds: boolean;
};

// A wall display case in elevation: a plain box from its wall-local center +
// width/height, same shape as the opening/wall-text entries. depthMm (its
// protrusion) is not an elevation concern — the wall-face view is width×height.
export type ElevationSceneCase = {
  object: CaseWallObject;
  centerMm: ArtworkCenterMm;
  sizeMm: ArtworkSizeMm;
  outOfBounds: boolean;
};

// A wall shelf in elevation: the slab band. Deliberately NOT shaped like the
// case/opening entries above — a shelf is drawn as a horizontal band spanning
// two wall-local x's at one height, not as a centre + size box, and giving the
// entry the span directly is what lets a painter draw it (and a dimension
// chain read it) without re-deriving the centre arithmetic. `yMm` is the
// slab's CENTRE height and `heightMm` its thickness, exactly as stored (see
// ShelfWallObject); `depthMm` is its protrusion, carried so an elevation
// surface can label the shelf without a second lookup.
export type ElevationSceneShelf = {
  objectId: string;
  xMinMm: number;
  xMaxMm: number;
  yMm: number;
  heightMm: number;
  depthMm: number;
};

// The elevation "shadow" of a FLOOR case standing in front of this wall: its
// rotated plan footprint projected onto the wall's along-axis gives an
// along-wall x-range, and the ghost rises from the floor (y=0) to the case's
// overall height. Purpose: viewing a wall in elevation, you can see freestanding
// cases in front of it and align them with wall-hung work. A DISTINCT entry
// type (not ElevationSceneCase) so the UI phase renders it dashed/low-opacity
// against the solid wall-case profile. Only emitted when the projection
// overlaps the wall's [0, wallLengthMm] extent; the range is clamped to it.
export type ElevationSceneFloorCaseGhost = {
  object: CaseFloorObject;
  xMinMm: number;
  xMaxMm: number;
  heightMm: number;
};

// The elevation "shadow" of a SUSPENDED floor artwork — a board hung from
// ceiling wires (the projection-surface case: a thin panel angled to the wall,
// hovering above the floor). Same along-wall projection as the floor case, but
// the ghost FLOATS: it spans baseHeightMm..baseHeightMm+heightMm instead of
// rising from the floor, because baseHeightMm is the bottom edge's height above
// the floor (see FloorObjectBase.baseHeightMm — NOT wallYMm). A distinct entry
// type from the case ghost so the UI can draw the floating board plus its
// suspension wires rather than the case's glass-box/slab/legs glyph.
//
// DECISION — only SUSPENDED artworks ghost (baseHeightMm > 0); a floor-resting
// artwork emits nothing, because it is the suspension itself — occupying air
// in front of the wall, at the same heights as hung work — that no other view
// already shows; a floor-resting object's footprint is fully covered by the
// plan. If floor-resting artwork should ghost later, this is one predicate —
// deliberately not a silent default.
export type ElevationSceneSuspendedArtworkGhost = {
  object: ArtworkFloorObject;
  xMinMm: number;
  xMaxMm: number;
  // Wall-local y of the ghost's BOTTOM edge (> 0 by construction).
  baseHeightMm: number;
  // The board's own height; its top edge is baseHeightMm + heightMm.
  heightMm: number;
};

// The elevation "shadow" of a floor-standing BOX MONITOR: the cabinet, its
// screen, and the pedestal under it, projected along the wall exactly like the
// floor-case ghost beside it.
//
// This is the one narrow exception to the DECISION recorded above — that
// floor-RESTING artwork emits no elevation ghost. A monitor is waist-to-eye-
// height equipment standing against a wall, and the thing a curator needs the
// elevation for is precisely whether the screen's centre lines up with the
// hung work beside it; nothing else in the app answers that. The exception
// stays narrow by construction: it is keyed on displayAs === "monitor", so no
// existing project grows a single new dashed outline.
export type ElevationSceneMonitorGhost = {
  object: ArtworkFloorObject;
  xMinMm: number;
  xMaxMm: number;
  // The cabinet's own height (the placement's heightMm — the pedestal is NOT
  // in it; see CrtMonitorMesh for why the two are stored apart).
  monitorHeightMm: number;
  // The plinth beneath, or 0 when the monitor stands on the bare floor.
  // Resolved here through resolveFloorSupport (absent monitorSupport ⇒ pedestal,
  // but an EXPLICIT pedestal/plinth on the cabinet wins) so the canvas and the
  // PDF can't disagree about what, if anything, is under the box.
  pedestalHeightMm: number;
  // The PLINTH's own along-wall span, which the plinth and the bonnet are drawn
  // across — xMin/xMax above stay the CABINET's, because a monitor on a wide
  // plinth is still a monitor of its own width.
  //
  // For the monitor default (a pedestal sized and centred on its cabinet) these
  // equal xMinMm/xMaxMm exactly, so every legacy monitor draws what it always
  // drew; they diverge only once a curator authors an explicit support with its
  // own footprint or offset — which plan already draws and elevation used to
  // silently shrink back to the cabinet.
  supportXMinMm: number;
  supportXMaxMm: number;
  // The plexi bonnet's height above the plinth's top face, absent when there is
  // none. Like the supported-artwork ghost's: a LOCKED bonnet may be SHORTER
  // than the cabinet, and the cabinet is then drawn straight through it.
  bonnetHeightMm?: number;
};

// The elevation "shadow" of a floor work STANDING ON A SUPPORT: the pedestal or
// plinth block, the work above it, and the plexi bonnet over both when there is
// one. The second narrow exception to the "floor-resting artwork emits no
// ghost" DECISION above, and for the same reason the monitor is the first: a
// sculpture on a pedestal is waist-to-eye-height matter standing against this
// wall, and whether its centre lines up with the work hung beside it is exactly
// what the elevation is for.
//
// MONITORS ARE NOT IN THIS FAMILY — they keep ElevationSceneMonitorGhost, which
// draws the cabinet and its screen; a monitor on a plinth is still a monitor.
//
// Two spans, not one: the assembly's (the union of work and support footprints,
// which is WIDER than either whenever the work overhangs or the support is
// bigger) bounds the support box and the bonnet, while the work's own span
// bounds the work outline drawn above it. Collapsing them would draw a
// sculpture as wide as its plinth.
export type ElevationSceneSupportedArtworkGhost = {
  kind: "supported-artwork";
  objectId: string;
  // The ASSEMBLY's along-wall span, clamped to the wall extent.
  xMinMm: number;
  xMaxMm: number;
  // Floor to the support's top face; the work's bottom edge sits on it.
  supportHeightMm: number;
  // The work's own height, rising from supportHeightMm.
  workHeightMm: number;
  // The bonnet's height above the support's top face, absent when there is no
  // bonnet. A LOCKED bonnet may be SHORTER than the work — the consumer draws
  // the work outline straight through and past it rather than clipping.
  bonnetHeightMm?: number;
  // The WORK's own along-wall span, clamped to the wall extent.
  workXMinMm: number;
  workXMaxMm: number;
  // The SUPPORT's own along-wall span: what the support block and the bonnet
  // (bonnet footprint = support footprint) are drawn across. Narrower than the
  // assembly span whenever the work overhangs — drawing the block across the
  // assembly would widen a pedestal to its sculpture.
  supportXMinMm: number;
  supportXMaxMm: number;
};

// A plan rect's shadow on one wall: the along-wall extent plus how the
// footprint sits relative to the wall's VIEWER side.
export type PlanRectWallProjection = {
  // Wall-local x range (mm from the wall's start), clamped to [0, wallLengthMm].
  xMinMm: number;
  xMaxMm: number;
  // Perpendicular distance from the wall line to the NEAREST corner, measured
  // along the wall's viewer-side normal — 0 when the footprint touches or
  // crosses the line. Never negative (see onViewerSide for "fully behind").
  gapMm: number;
  // false when EVERY corner sits on the non-viewer side of the wall line: the
  // rect is behind this face and invisible from its elevation. Callers that
  // ghost things standing in the room (floor cases, boards) have historically
  // ignored this — the room filter upstream already did that job for them.
  onViewerSide: boolean;
};

// Projects a (possibly rotated) plan rect onto the wall's along-axis by
// projecting its four corners. Returns null when the footprint does not overlap
// the wall's [0, wallLengthMm] extent at all (entirely off either end).
//
// Kind-agnostic on purpose (floor cases, suspended artwork boards AND partition
// slabs run through this one function): the along-wall extent of a rotated
// rectangle is the same problem either way, and a second copy would be free to
// drift. Rotation is genuinely handled — the corner formula here is character-
// for-character the one in planRectIntersectsRect, so a 45° board correctly
// reports the WIDER |w·cos| + |d·sin| span rather than its own width.
//
// The viewer-side normal is the LEFT of start→end ((-dy, dx)/L, see
// unitLeftNormalOrZero) — the ONE handedness convention in this codebase, the
// same one partition faces are offset along in freestandingWalls.ts, so a face
// and the perimeter walls it faces agree on which side a viewer stands.
export function projectPlanRectOntoWall(
  rect: PlanRect,
  wallStartFloorMm: Point,
  wallEndFloorMm: Point
): PlanRectWallProjection | null {
  const dirX = wallEndFloorMm.xMm - wallStartFloorMm.xMm;
  const dirY = wallEndFloorMm.yMm - wallStartFloorMm.yMm;
  const wallLengthMm = Math.hypot(dirX, dirY);
  if (wallLengthMm === 0) return null;

  const angleRad = (rect.angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const halfW = rect.widthMm / 2;
  const halfD = rect.depthMm / 2;

  // Wall-local x (mm from start) of a floor point = its scalar projection onto
  // the unit start→end direction. Unclamped, so a footprint straddling an end
  // still reports its true reach past the wall. The offset is the companion
  // projection onto the unit left normal.
  const cornerOf = (localX: number, localY: number): { alongMm: number; offsetMm: number } => {
    const px = rect.centerXMm + localX * cos - localY * sin;
    const py = rect.centerYMm + localX * sin + localY * cos;
    const relX = px - wallStartFloorMm.xMm;
    const relY = py - wallStartFloorMm.yMm;
    return {
      alongMm: (relX * dirX + relY * dirY) / wallLengthMm,
      offsetMm: (relX * -dirY + relY * dirX) / wallLengthMm
    };
  };

  const corners = [
    cornerOf(-halfW, -halfD),
    cornerOf(halfW, -halfD),
    cornerOf(halfW, halfD),
    cornerOf(-halfW, halfD)
  ];
  const alongs = corners.map((corner) => corner.alongMm);
  const offsets = corners.map((corner) => corner.offsetMm);
  const rawMin = Math.min(...alongs);
  const rawMax = Math.max(...alongs);

  // No overlap with the wall's [0, wallLengthMm] extent → no shadow.
  if (rawMax <= 0 || rawMin >= wallLengthMm) return null;

  return {
    xMinMm: Math.max(0, rawMin),
    xMaxMm: Math.min(wallLengthMm, rawMax),
    gapMm: Math.max(0, Math.min(...offsets)),
    onViewerSide: Math.max(...offsets) > 0
  };
}

// Projects a floor object's rotated plan footprint onto the wall's along-axis.
// Returns the [xMin, xMax] wall-local range, or null when it doesn't overlap
// the wall at all — a thin view over projectPlanRectOntoWall that keeps the
// side-relationship fields out of the floor-ghost call sites, which filter by
// room membership instead.
export function projectFloorObjectOntoWall(
  floorObject: FloorObject,
  wallStartFloorMm: Point,
  wallEndFloorMm: Point
): { xMinMm: number; xMaxMm: number } | null {
  const projection = projectPlanRectOntoWall(
    getFloorObjectPlanRect(floorObject),
    wallStartFloorMm,
    wallEndFloorMm
  );
  if (!projection) return null;
  return { xMinMm: projection.xMinMm, xMaxMm: projection.xMaxMm };
}

// The supported-assembly twin of projectFloorObjectOntoWall: the union of the
// work's footprint and its support's projected onto the wall, PLUS the work's
// own span inside it. Returns null when the assembly doesn't overlap the wall
// at all.
//
// Both spans come from the one corner formula in projectPlanRectOntoWall, so a
// rotated pedestal reports the same wider |w·cos| + |d·sin| span its work does.
export function projectSupportedFootprintOntoWall(
  object: FloorObject,
  support: FloorSupport,
  wallStartFloorMm: Point,
  wallEndFloorMm: Point
): {
  xMinMm: number;
  xMaxMm: number;
  workXMinMm: number;
  workXMaxMm: number;
  supportXMinMm: number;
  supportXMaxMm: number;
} | null {
  const assembly = projectPlanRectOntoWall(
    assemblyPlanRect(object, support),
    wallStartFloorMm,
    wallEndFloorMm
  );
  if (!assembly) return null;

  // The assembly contains both boxes, so an overlapping assembly with a
  // non-overlapping part means that part hangs entirely past one end of this
  // wall. Pin it to that end as a zero-width span rather than letting it
  // inherit the assembly's — a support whose work is off the page should show
  // the support, not a work outline as wide as it, and the same holds for a
  // plinth that has slid off the end under a work still on it.
  const dirX = wallEndFloorMm.xMm - wallStartFloorMm.xMm;
  const dirY = wallEndFloorMm.yMm - wallStartFloorMm.yMm;
  const wallLengthMm = Math.hypot(dirX, dirY);
  const spanOf = (rect: PlanRect): { minMm: number; maxMm: number } => {
    const projection = projectPlanRectOntoWall(rect, wallStartFloorMm, wallEndFloorMm);
    if (projection) return { minMm: projection.xMinMm, maxMm: projection.xMaxMm };
    const alongMm =
      wallLengthMm === 0
        ? 0
        : ((rect.centerXMm - wallStartFloorMm.xMm) * dirX +
            (rect.centerYMm - wallStartFloorMm.yMm) * dirY) /
          wallLengthMm;
    const pinnedMm = alongMm <= 0 ? assembly.xMinMm : assembly.xMaxMm;
    return { minMm: pinnedMm, maxMm: pinnedMm };
  };

  const work = spanOf(getFloorObjectPlanRect(object));
  const supportSpan = spanOf(supportPlanRect(object, support));
  return {
    xMinMm: assembly.xMinMm,
    xMaxMm: assembly.xMaxMm,
    workXMinMm: work.minMm,
    workXMaxMm: work.maxMm,
    supportXMinMm: supportSpan.minMm,
    supportXMaxMm: supportSpan.maxMm
  };
}

// A partition standing in front of this wall gets a projected profile rather
// than nothing at all: from the wall's own elevation it is architecture that
// divides the surface into hanging zones, and until now it left no trace.
// TWO TIERS, keyed on gapMm:
//  - abutting (gap ≤ PARTITION_ABUT_THRESHOLD_MM): a SOLID band painted OVER
//    the wall objects — the partition physically meets this wall, so it really
//    does cut the surface in two;
//  - freestanding (gap beyond that): a dashed ghost OUTLINE in the existing
//    elevation ghost language, painted BEFORE the wall objects so it can never
//    occlude hung work.
// Both are inert — this is a drawing, not a placement rule.
export const PARTITION_ABUT_THRESHOLD_MM = 150;

// SPACING rule, a wider tier than the drawing tiers above: a partition whose
// near edge sits within this perpendicular gap of the wall participates as a
// spacing NEIGHBOR on that wall's elevation — it bounds and blocks gap
// dimensions, centering and snapping exactly like a real wall object. Beyond
// it, the partition is scenery standing well out in the room: still drawn as a
// ghost, but too far away for a dimension between it and hung work to mean
// anything. (A drawn profile is not automatically a neighbor; consumers filter
// on ElevationScenePartitionProfile.gapMm.)
export const PARTITION_NEIGHBOR_MAX_GAP_MM = 1200;

export type ElevationScenePartitionProfile = {
  partition: FloorPartition;
  xMinMm: number;
  xMaxMm: number;
  // The partition's true height; the profile rises from the floor line to it.
  heightMm: number;
  abutting: boolean;
  // Perpendicular distance from the wall face to the partition's NEAREST
  // corner (0 when it touches or crosses the wall line). `abutting` is one
  // threshold on this value; the spacing-neighbor rule
  // (PARTITION_NEIGHBOR_MAX_GAP_MM) is a second, wider one, so the raw
  // distance is carried rather than collapsed into a single boolean.
  gapMm: number;
};

// The partition half of buildElevationScene, split out so consumers that want
// only the projected profiles (partitionNeighbors.ts's shim path) can get them
// without assembling a whole scene — and so there is exactly ONE place the
// viewer-side gate and the abut threshold are applied.
export function buildPartitionProfiles(
  partitions: readonly FloorPartition[],
  wallStartFloorMm: Point,
  wallEndFloorMm: Point
): ElevationScenePartitionProfile[] {
  const profiles: ElevationScenePartitionProfile[] = [];
  for (const partition of partitions) {
    const projection = projectPlanRectOntoWall(
      segmentPlanRect(partition.startMm, partition.endMm, partition.thicknessMm),
      wallStartFloorMm,
      wallEndFloorMm
    );
    if (!projection || !projection.onViewerSide) continue;
    profiles.push({
      partition,
      xMinMm: projection.xMinMm,
      xMaxMm: projection.xMaxMm,
      heightMm: partition.heightMm,
      abutting: projection.gapMm <= PARTITION_ABUT_THRESHOLD_MM,
      gapMm: projection.gapMm
    });
  }
  return profiles;
}

export type ElevationScene = {
  wallLengthMm: number;
  wallHeightMm: number;
  // The floor line sits at the bottom wall edge; the centerline (curator
  // eyeline) is the stored wall-local height flipped into SVG space. Both are
  // horizontal rules spanning 0..wallLengthMm. Whether the centerline is
  // VISIBLE is the caller's toggle, not scene data — the position is the
  // derivation.
  floorLineSvgY: number;
  centerlineSvgY: number;
  artworks: ElevationSceneArtwork[];
  openings: ElevationSceneOpening[];
  wallTexts: ElevationSceneWallText[];
  cases: ElevationSceneCase[];
  // Wall shelves on this wall, as slab bands (see ElevationSceneShelf).
  shelves: ElevationSceneShelf[];
  // Floor cases standing in front of this wall, projected onto its along-axis.
  // Empty unless the caller supplies floorCases + the wall's floor-space
  // endpoints in the options.
  floorCaseGhosts: ElevationSceneFloorCaseGhost[];
  // Suspended floor artworks (boards hung above the floor) hovering in front of
  // this wall, same projection, floating y-span. Empty unless the caller
  // supplies floorArtworks + the wall's floor-space endpoints.
  suspendedArtworkGhosts: ElevationSceneSuspendedArtworkGhost[];
  // Non-monitor floor artworks STANDING ON a pedestal or plinth in front of
  // this wall, same projection, rising from the floor line. Empty unless the
  // caller supplies floorArtworks + the wall's floor-space endpoints; the
  // artworksById join only decides monitor-vs-not, so an explicit support
  // ghosts with or without it.
  supportedArtworkGhosts: ElevationSceneSupportedArtworkGhost[];
  // Floor-standing box monitors in front of this wall, same projection, rising
  // from the floor line (pedestal + cabinet). Empty unless the caller supplies
  // floorArtworks, artworksById — the display type lives on the WORK, so
  // without the join no placement can be recognised as a monitor — and the
  // wall's floor-space endpoints.
  monitorGhosts: ElevationSceneMonitorGhost[];
  // Free-standing partitions in front of this wall, projected onto its
  // along-axis. Empty unless the caller supplies partitions + the wall's
  // floor-space endpoints.
  partitionProfiles: ElevationScenePartitionProfile[];
};

export type ElevationSceneOptions = {
  // undefined matches nothing (an unwired view renders a bare wall) — same
  // as the view's own filter semantics.
  wallId: string | undefined;
  wallLengthMm: number;
  wallHeightMm: number;
  centerlineMm: number;
  artworksById?: ReadonlyMap<string, Artwork>;
  // Freestanding floor cases in the room containing this wall (caller filters
  // by room). Projected onto the wall to emit floorCaseGhosts. Requires the
  // wall's floor-space endpoints below; without them no ghosts are emitted.
  floorCases?: CaseFloorObject[];
  // Floor-placed artworks in the same room (caller filters by room, exactly as
  // for floorCases). Pass them ALL — the suspension rule (baseHeightMm > 0)
  // lives in the builder so every consumer, canvas and PDF alike, agrees on
  // which floor artworks are visible in elevation.
  floorArtworks?: ArtworkFloorObject[];
  // Free-standing partitions in the room containing this wall, in floor space
  // (getFloorPartitions). The caller owns BOTH gates, mirroring floorCases:
  // the room filter, and — when the viewed wall is itself a partition face —
  // dropping the partition that face belongs to, which would otherwise project
  // its own thickness onto itself.
  partitions?: FloorPartition[];
  wallStartFloorMm?: Point;
  wallEndFloorMm?: Point;
};

export function buildElevationScene(
  wallObjects: WallObject[],
  options: ElevationSceneOptions
): ElevationScene {
  const {
    wallId,
    wallLengthMm,
    wallHeightMm,
    centerlineMm,
    artworksById,
    floorCases,
    floorArtworks,
    partitions,
    wallStartFloorMm,
    wallEndFloorMm
  } = options;

  const artworks: ElevationSceneArtwork[] = [];
  const openings: ElevationSceneOpening[] = [];
  const wallTexts: ElevationSceneWallText[] = [];
  const cases: ElevationSceneCase[] = [];
  const shelves: ElevationSceneShelf[] = [];

  // One pass, split by kind — preserving each kind's stored order (the view
  // paints artworks then openings then wall texts, so relative paint order
  // within a kind is exactly the array order).
  for (const object of wallObjects) {
    if (object.wallId !== wallId) continue;
    const centerMm = { xMm: object.xMm, yMm: object.yMm };
    const sizeMm = { widthMm: object.widthMm, heightMm: object.heightMm };

    if (object.kind === "artwork") {
      const artwork = artworksById?.get(object.artworkId);
      const footprintMm = getPlacementFootprintMm(object, artwork);
      const outOfBounds = isArtworkOutOfWallBounds(
        wallLengthMm,
        wallHeightMm,
        centerMm,
        footprintMm
      );
      artworks.push({
        object,
        ...(artwork ? { artwork } : {}),
        centerMm,
        sizeMm,
        outOfBounds
      });
    } else if (object.kind === "wall-text") {
      const outOfBounds = isArtworkOutOfWallBounds(
        wallLengthMm,
        wallHeightMm,
        centerMm,
        sizeMm
      );
      wallTexts.push({ object, centerMm, sizeMm, outOfBounds });
    } else if (object.kind === "case") {
      const outOfBounds = isArtworkOutOfWallBounds(
        wallLengthMm,
        wallHeightMm,
        centerMm,
        sizeMm
      );
      cases.push({ object, centerMm, sizeMm, outOfBounds });
    } else if (object.kind === "shelf") {
      // The band's span comes from the shared glyph module, so the elevation
      // canvas, the PDF page and the 3D slab can never disagree about where a
      // shelf's ends and its top face are.
      const glyph = shelfElevationGlyph(object);
      shelves.push({
        objectId: object.id,
        xMinMm: glyph.xMinMm,
        xMaxMm: glyph.xMaxMm,
        yMm: object.yMm,
        heightMm: object.heightMm,
        depthMm: object.depthMm
      });
    } else {
      const outOfBounds = isArtworkOutOfWallBounds(
        wallLengthMm,
        wallHeightMm,
        centerMm,
        sizeMm
      );
      openings.push({ object, centerMm, sizeMm, outOfBounds });
    }
  }

  // Floor-case ghosts: project each supplied floor case onto this wall's
  // along-axis, keeping only those whose footprint overlaps the wall extent.
  const floorCaseGhosts: ElevationSceneFloorCaseGhost[] = [];
  if (floorCases && wallStartFloorMm && wallEndFloorMm) {
    for (const floorCase of floorCases) {
      const range = projectFloorObjectOntoWall(floorCase, wallStartFloorMm, wallEndFloorMm);
      if (!range) continue;
      floorCaseGhosts.push({
        object: floorCase,
        xMinMm: range.xMinMm,
        xMaxMm: range.xMaxMm,
        heightMm: floorCase.heightMm
      });
    }
  }

  // Suspended-artwork ghosts: same projection, same wall-extent filter, but
  // gated on baseHeightMm > 0 (see ElevationSceneSuspendedArtworkGhost for why
  // floor-RESTING artwork deliberately emits nothing) and floating instead of
  // standing on the floor line.
  const suspendedArtworkGhosts: ElevationSceneSuspendedArtworkGhost[] = [];
  if (floorArtworks && wallStartFloorMm && wallEndFloorMm) {
    for (const floorArtwork of floorArtworks) {
      // A monitor never suspends — it stands on a pedestal or on the floor, and
      // the inspector withholds the "Height off floor" field for it (the same
      // rule CaseMesh/FloorCaseMesh apply to cases). A stale baseHeightMm on a
      // work that was later switched to a monitor must therefore not float it
      // here: it ghosts below, as a monitor.
      if (isMonitorArtwork(artworksById?.get(floorArtwork.artworkId))) continue;
      // Nor does a work standing on a pedestal: its bottom edge IS the support's
      // top face and baseHeightMm is ignored (see ArtworkFloorObject.support),
      // so a stale suspension height left on a work that was later stood on a
      // plinth must ghost as supported below, never float here.
      if (resolveFloorSupport(floorArtwork, artworksById?.get(floorArtwork.artworkId))) {
        continue;
      }
      const baseHeightMm = floorArtwork.baseHeightMm ?? 0;
      if (baseHeightMm <= 0) continue;
      const range = projectFloorObjectOntoWall(floorArtwork, wallStartFloorMm, wallEndFloorMm);
      if (!range) continue;
      suspendedArtworkGhosts.push({
        object: floorArtwork,
        xMinMm: range.xMinMm,
        xMaxMm: range.xMaxMm,
        baseHeightMm,
        heightMm: floorArtwork.heightMm
      });
    }
  }

  // Box-monitor ghosts: same projection and same wall-extent filter as the two
  // above, gated on the JOINED work's display type (a placement carries no
  // display type of its own), and standing on the floor line like the case
  // ghost rather than floating like the suspended board.
  const monitorGhosts: ElevationSceneMonitorGhost[] = [];
  if (floorArtworks && wallStartFloorMm && wallEndFloorMm) {
    for (const floorArtwork of floorArtworks) {
      const artwork = artworksById?.get(floorArtwork.artworkId);
      if (!isMonitorArtwork(artwork)) continue;
      // One resolver for what is under the cabinet: the absent-means-pedestal
      // default and an explicitly authored pedestal/plinth both arrive here as
      // a support, and null means the cabinet really is on the bare floor.
      const support = resolveFloorSupport(floorArtwork, artwork);
      if (!support) {
        const range = projectFloorObjectOntoWall(
          floorArtwork,
          wallStartFloorMm,
          wallEndFloorMm
        );
        if (!range) continue;
        monitorGhosts.push({
          object: floorArtwork,
          xMinMm: range.xMinMm,
          xMaxMm: range.xMaxMm,
          monitorHeightMm: floorArtwork.heightMm,
          pedestalHeightMm: 0,
          // No plinth to span; the cabinet's own span is the inert answer, and
          // consumers gate the plinth on pedestalHeightMm > 0 anyway.
          supportXMinMm: range.xMinMm,
          supportXMaxMm: range.xMaxMm
        });
        continue;
      }
      // With a support the ASSEMBLY decides whether this monitor shows on this
      // wall at all — a cabinet just past the end on a plinth still standing in
      // front of the wall is one installation, and plan already draws it whole.
      // For the monitor default the assembly IS the cabinet, so nothing legacy
      // changes here.
      const range = projectSupportedFootprintOntoWall(
        floorArtwork,
        support,
        wallStartFloorMm,
        wallEndFloorMm
      );
      if (!range) continue;
      monitorGhosts.push({
        object: floorArtwork,
        xMinMm: range.workXMinMm,
        xMaxMm: range.workXMaxMm,
        monitorHeightMm: floorArtwork.heightMm,
        pedestalHeightMm: support.heightMm,
        supportXMinMm: range.supportXMinMm,
        supportXMaxMm: range.supportXMaxMm,
        ...(support.bonnetHeightMm !== undefined
          ? { bonnetHeightMm: support.bonnetHeightMm }
          : {})
      });
    }
  }

  // Supported-artwork ghosts: every NON-monitor floor work standing on a
  // pedestal or plinth, projected as the union of work + support so the drawn
  // block is the real footprint against this wall.
  const supportedArtworkGhosts: ElevationSceneSupportedArtworkGhost[] = [];
  if (floorArtworks && wallStartFloorMm && wallEndFloorMm) {
    for (const floorArtwork of floorArtworks) {
      const artwork = artworksById?.get(floorArtwork.artworkId);
      if (isMonitorArtwork(artwork)) continue;
      const support = resolveFloorSupport(floorArtwork, artwork);
      if (!support) continue;
      const range = projectSupportedFootprintOntoWall(
        floorArtwork,
        support,
        wallStartFloorMm,
        wallEndFloorMm
      );
      if (!range) continue;
      supportedArtworkGhosts.push({
        kind: "supported-artwork",
        objectId: floorArtwork.id,
        xMinMm: range.xMinMm,
        xMaxMm: range.xMaxMm,
        supportHeightMm: support.heightMm,
        workHeightMm: floorArtwork.heightMm,
        ...(support.bonnetHeightMm !== undefined
          ? { bonnetHeightMm: support.bonnetHeightMm }
          : {}),
        workXMinMm: range.workXMinMm,
        workXMaxMm: range.workXMaxMm,
        supportXMinMm: range.supportXMinMm,
        supportXMaxMm: range.supportXMaxMm
      });
    }
  }

  // Partition profiles: the partition's plan slab (centerline + thickness)
  // projected onto this wall. Unlike the floor ghosts these DO test the viewer
  // side — a partition behind the wall face being viewed is masonry the viewer
  // cannot see, and the room filter alone can't tell the two sides of a
  // partition face apart.
  const partitionProfiles: ElevationScenePartitionProfile[] =
    partitions && wallStartFloorMm && wallEndFloorMm
      ? buildPartitionProfiles(partitions, wallStartFloorMm, wallEndFloorMm)
      : [];

  return {
    wallLengthMm,
    wallHeightMm,
    floorLineSvgY: wallHeightMm,
    centerlineSvgY: wallLocalYToSvgY(wallHeightMm, centerlineMm),
    artworks,
    openings,
    wallTexts,
    cases,
    shelves,
    floorCaseGhosts,
    suspendedArtworkGhosts,
    supportedArtworkGhosts,
    monitorGhosts,
    partitionProfiles
  };
}
