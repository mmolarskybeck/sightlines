// Pure derivation: selection-driven dimension lines for PLAN view, the top-down
// twin of the elevation canvas's GroupDimensionLines / VerticalGapDimensionLines.
// Two independent producers, both emitting the SAME PlanGapLine primitive so one
// renderer (PlanGapDimensionLines) draws them all:
//
//   • derivePlanFloorGaps — floor objects (cases, plinths, blocked zones) laid
//     out on the floor. Feeds the generic two-axis orthogonal-neighbor engine
//     (orthogonalNeighbors.ts) exactly like elevationDimensions.ts does, then
//     keeps only the gaps touching a SELECTED object. Room boundaries enter the
//     graph as thin "blocked-zone" strip participants — one per axis-aligned
//     room-wall segment — so a floor object also dimensions to the wall it sits
//     near, and polygon (L-shaped) rooms work with no bounding-box assumption.
//
//   • derivePlanWallGaps — a wall-hung object (artwork / opening / case / wall
//     text) selected on a room wall or partition face. Shows its ALONG-wall
//     clearance to the nearest neighbor on the same wall per side, falling back
//     to the wall ends, reusing arrangeOnWall's getNeighborAwareSegments (the
//     same spacing logic the elevation "From edges" readout uses) rather than
//     reinventing it.
//
// Coordinate space: floor millimeters, the plan SVG's own y-DOWN space (a floor
// point maps straight to an SVG point). Everything here stays in floor mm; the
// renderer converts nothing.
//
// Rotation policy (mirrors floorSnapTargets.ts): a floor object counts as
// axis-aligned only within RIGHT_ANGLE_EPSILON_DEG of a right-angle multiple,
// swapping width/depth at 90/270. An off-axis object has no well-defined
// axis-aligned footprint for the min-corner engine, so it gets NO gap dimensions
// and does not participate as a blocker either — an AABB stand-in would print a
// gap to a corner that isn't the true clearance, which is worse than silence.

import { getNeighborAwareSegments } from "../placement/arrangeOnWall";
import type { Point } from "../geometry/polygon";
import type { FloorWall, PlanRect } from "../geometry/planObjects";
import type { WallObjectBase } from "../project";
import {
  deriveElevationDimensions,
  NEIGHBOR_TOLERANCE_MM,
  type DimensionParticipant,
  type GapDimension
} from "./orthogonalNeighbors";

// Same 0.5° window floorSnapTargets uses to decide an object is axis-aligned.
const RIGHT_ANGLE_EPSILON_DEG = 0.5;

// Thickness of a synthetic room-wall strip participant (mm). Small and outward-
// facing so its inner face sits ON the wall line: an object's gap then measures
// object-edge → wall line, and a flush object overlaps only within tolerance
// (reads a clean 0). The exact value is invisible; only the inner face matters.
const WALL_STRIP_THICKNESS_MM = 10;

// How far, in handle units, the renderer offsets a line off the geometry it
// measures. Floor gaps sit IN the clear corridor (0, like the elevation vertical
// gap lines). Wall gaps would land on the wall drawing, so they step into the
// room — the same drafting stand-off PartitionDimensionLines uses (2.5).
const FLOOR_GAP_OFFSET_UNITS = 0;
const WALL_GAP_OFFSET_UNITS = 2.5;

// One dimension line, fully placed in floor space. The renderer draws the line
// from aMm to bMm (after offsetting by offsetHandleUnits * handleSizeMm along
// normalMm), a facing-edge tick at each end perpendicular to a→b, and the label
// at the midpoint. gapMm is the printed clearance.
export type PlanGapLine = {
  id: string;
  gapMm: number;
  aMm: Point;
  bMm: Point;
  // Unit normal perpendicular to a→b; the offset/label-placement direction.
  normalMm: Point;
  offsetHandleUnits: number;
  // Distance along normalMm from the line past which a label is clear of BOTH
  // measured footprints (their union's near edge on the normal side). Floor
  // gaps set this so a label too wide for its gap can step fully past the
  // objects it measures; absent (wall gaps) the renderer's fixed far offset is
  // already clear — the room side is open by construction.
  labelClearMm?: number;
};

// A floor object reduced to what the dimension pass needs: its id, plan rect,
// and containing room (null → not in any room, excluded from the floor pass).
export type PlanFloorObjectInput = {
  id: string;
  rect: PlanRect;
  roomId: string | null;
};

// World-axis min-corner rect for a plan rect, but ONLY at a right-angle
// rotation: at 0/180 width runs along x and depth along y; at 90/270 they swap.
// Returns null off a right angle (see the rotation policy above).
function axisAlignedParticipantRect(rect: PlanRect): DimensionParticipant["rect"] | null {
  const norm = ((rect.angleDeg % 180) + 180) % 180; // [0, 180)
  const nearZero = Math.min(norm, 180 - norm) <= RIGHT_ANGLE_EPSILON_DEG;
  const nearNinety = Math.abs(norm - 90) <= RIGHT_ANGLE_EPSILON_DEG;
  if (!nearZero && !nearNinety) return null;
  const widthMm = nearZero ? rect.widthMm : rect.depthMm;
  const heightMm = nearZero ? rect.depthMm : rect.widthMm;
  return {
    xMm: rect.centerXMm - widthMm / 2,
    yMm: rect.centerYMm - heightMm / 2,
    widthMm,
    heightMm
  };
}

// True only for a wall whose direction is (within epsilon) world x or y — the
// only walls whose "outward" side is a pure ±x/±y axis, so the strip stays an
// axis-aligned rect the min-corner engine can consume. Angled walls are skipped
// (same policy as floorSnapTargets' axisAlignedOrientation).
function wallOrientation(wall: FloorWall): "horizontal" | "vertical" | null {
  const dx = Math.abs(wall.endFloorMm.xMm - wall.startFloorMm.xMm);
  const dy = Math.abs(wall.endFloorMm.yMm - wall.startFloorMm.yMm);
  if (dy <= 1e-6 && dx > 1e-6) return "horizontal";
  if (dx <= 1e-6 && dy > 1e-6) return "vertical";
  return null;
}

// Each axis-aligned room wall as a thin strip participant, its inner face on the
// wall line and its body pushed to the room's EXTERIOR (away from the centroid
// of the room's wall endpoints), so an object never overlaps it except when
// genuinely flush. Non-axis-aligned walls are dropped.
function roomWallStrips(walls: FloorWall[]): DimensionParticipant[] {
  const axisWalls = walls
    .map((wall) => ({ wall, orientation: wallOrientation(wall) }))
    .filter((entry): entry is { wall: FloorWall; orientation: "horizontal" | "vertical" } =>
      entry.orientation !== null
    );
  if (axisWalls.length === 0) return [];

  // Pseudo-centroid from every endpoint — inside a convex-ish room, enough to
  // pick which side of each wall is the interior.
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const { wall } of axisWalls) {
    for (const end of [wall.startFloorMm, wall.endFloorMm]) {
      sumX += end.xMm;
      sumY += end.yMm;
      count += 1;
    }
  }
  const centroid = { xMm: sumX / count, yMm: sumY / count };
  const t = WALL_STRIP_THICKNESS_MM;

  return axisWalls.map(({ wall, orientation }) => {
    if (orientation === "horizontal") {
      const wy = wall.startFloorMm.yMm;
      const x0 = Math.min(wall.startFloorMm.xMm, wall.endFloorMm.xMm);
      const x1 = Math.max(wall.startFloorMm.xMm, wall.endFloorMm.xMm);
      // Interior on +y → body on -y (yMm = wy - t, inner face at wy); vice versa.
      const interiorAbove = centroid.yMm > wy;
      return {
        id: `wall-strip:${wall.id}`,
        kind: "blocked-zone" as const,
        rect: { xMm: x0, yMm: interiorAbove ? wy - t : wy, widthMm: x1 - x0, heightMm: t }
      };
    }
    const wx = wall.startFloorMm.xMm;
    const y0 = Math.min(wall.startFloorMm.yMm, wall.endFloorMm.yMm);
    const y1 = Math.max(wall.startFloorMm.yMm, wall.endFloorMm.yMm);
    const interiorRight = centroid.xMm > wx;
    return {
      id: `wall-strip:${wall.id}`,
      kind: "blocked-zone" as const,
      rect: { xMm: interiorRight ? wx - t : wx, yMm: y0, widthMm: t, heightMm: y1 - y0 }
    };
  });
}

// A GapDimension (engine output, in projected 1-D + corridor form) placed into
// floor space as a PlanGapLine. Horizontal gaps run along x at the corridor's
// mid-y; vertical gaps run along y at the corridor's mid-x. The line sits IN the
// corridor (no offset); the normal only steers the label a hair to the side.
function gapToPlanLine(
  gap: GapDimension,
  rectsById: ReadonlyMap<string, DimensionParticipant["rect"]>
): PlanGapLine {
  const corridorMid = (gap.corridorLoMm + gap.corridorHiMm) / 2;
  // Union of both measured footprints along the gap's PERPENDICULAR axis, so a
  // label too wide for its gap knows how far it must step to clear them. The
  // normal points toward whichever union edge is nearer (the shorter hop).
  const aRect = rectsById.get(gap.aId);
  const bRect = rectsById.get(gap.bId);
  const perpendicularClearance = (lo: number, hi: number) => {
    const clearDown = hi - corridorMid;
    const clearUp = corridorMid - lo;
    return clearDown <= clearUp
      ? { sign: 1, clearMm: Math.max(0, clearDown) }
      : { sign: -1, clearMm: Math.max(0, clearUp) };
  };
  if (gap.axis === "horizontal") {
    const side =
      aRect && bRect
        ? perpendicularClearance(
            Math.min(aRect.yMm, bRect.yMm),
            Math.max(aRect.yMm + aRect.heightMm, bRect.yMm + bRect.heightMm)
          )
        : { sign: 1, clearMm: undefined };
    return {
      id: `floor-gap:${gap.aId}:${gap.bId}:h`,
      gapMm: gap.gapMm,
      aMm: { xMm: gap.fromMm, yMm: corridorMid },
      bMm: { xMm: gap.toMm, yMm: corridorMid },
      normalMm: { xMm: 0, yMm: side.sign },
      offsetHandleUnits: FLOOR_GAP_OFFSET_UNITS,
      labelClearMm: side.clearMm
    };
  }
  const side =
    aRect && bRect
      ? perpendicularClearance(
          Math.min(aRect.xMm, bRect.xMm),
          Math.max(aRect.xMm + aRect.widthMm, bRect.xMm + bRect.widthMm)
        )
      : { sign: 1, clearMm: undefined };
  return {
    id: `floor-gap:${gap.aId}:${gap.bId}:v`,
    gapMm: gap.gapMm,
    aMm: { xMm: corridorMid, yMm: gap.fromMm },
    bMm: { xMm: corridorMid, yMm: gap.toMm },
    normalMm: { xMm: side.sign, yMm: 0 },
    offsetHandleUnits: FLOOR_GAP_OFFSET_UNITS,
    labelClearMm: side.clearMm
  };
}

// Floor-object gap dimensions for the current selection. All same-room floor
// objects (right-angle footprints) plus the room's wall strips form one
// neighbor graph per room (via the shared engine, nearest-neighbor pruned);
// only gaps touching a selected object are returned — selection-driven, exactly
// like the elevation canvas filters its derived gaps to the selected members.
export function derivePlanFloorGaps(args: {
  selectedIds: ReadonlySet<string>;
  floorObjects: PlanFloorObjectInput[];
  walls: FloorWall[]; // all floor walls; grouped by wall.roomId internally
  toleranceMm?: number;
}): PlanGapLine[] {
  const tol = args.toleranceMm ?? NEIGHBOR_TOLERANCE_MM;

  // Only rooms that actually contain a selected floor object are worth deriving.
  const selectedRoomIds = new Set<string>();
  for (const object of args.floorObjects) {
    if (object.roomId !== null && args.selectedIds.has(object.id)) {
      selectedRoomIds.add(object.roomId);
    }
  }
  if (selectedRoomIds.size === 0) return [];

  const wallsByRoom = new Map<string, FloorWall[]>();
  for (const wall of args.walls) {
    if (!selectedRoomIds.has(wall.roomId)) continue;
    const bucket = wallsByRoom.get(wall.roomId);
    if (bucket) bucket.push(wall);
    else wallsByRoom.set(wall.roomId, [wall]);
  }

  const lines: PlanGapLine[] = [];
  for (const roomId of selectedRoomIds) {
    const objectParticipants: DimensionParticipant[] = [];
    for (const object of args.floorObjects) {
      if (object.roomId !== roomId) continue;
      const rect = axisAlignedParticipantRect(object.rect);
      if (!rect) continue; // off-axis object: no dims, no blocking (see policy)
      objectParticipants.push({ id: object.id, kind: "artwork", rect });
    }
    const strips = roomWallStrips(wallsByRoom.get(roomId) ?? []);
    const participants = [...objectParticipants, ...strips];
    if (participants.length < 2) continue;

    // wallLengthMm/wallHeightMm only feed boundary/center-height dimensions,
    // which this caller ignores (walls are modeled as strip participants, not
    // the engine's wall sentinels); the derived neighborGaps are all we read.
    const bounds = participantsBounds(participants);
    const { neighborGaps } = deriveElevationDimensions({
      wallLengthMm: bounds.widthMm,
      wallHeightMm: bounds.heightMm,
      participants,
      toleranceMm: tol
    });

    const rectsById = new Map(participants.map((p) => [p.id, p.rect]));
    for (const gap of neighborGaps) {
      // A strip↔strip gap can never touch a selection; keep only gaps where at
      // least one endpoint is a selected floor object.
      if (!args.selectedIds.has(gap.aId) && !args.selectedIds.has(gap.bId)) continue;
      lines.push(gapToPlanLine(gap, rectsById));
    }
  }
  return lines;
}

function participantsBounds(participants: DimensionParticipant[]): {
  widthMm: number;
  heightMm: number;
} {
  let maxX = 0;
  let maxY = 0;
  for (const p of participants) {
    maxX = Math.max(maxX, p.rect.xMm + p.rect.widthMm);
    maxY = Math.max(maxY, p.rect.yMm + p.rect.heightMm);
  }
  return { widthMm: maxX, heightMm: maxY };
}

// Along-wall clearance dimensions for a wall-hung object selected on a wall.
// getNeighborAwareSegments returns, for a lone member, [leftSegment, ...,
// rightSegment] in wall-local mm: the gap to the nearest neighbor on each side,
// or to the wall end when none. We keep the two OUTER segments (the member's own
// clearances) and lift each into floor space along the wall direction, offset
// into the room.
//
// Plan is a top-down projection where height is invisible: two works at
// different hang heights still read as along-wall neighbors. getNeighborAware-
// Segments gates neighbors by vertical band overlap, so every participant is
// given one shared full-height band here (yMm 0, a large heightMm) to disable
// that gate — the result is pure 1-D along-wall spacing.
export function derivePlanWallGaps(args: {
  selectedObject: { id: string; xMm: number; widthMm: number };
  others: ReadonlyArray<{ id: string; xMm: number; widthMm: number }>;
  wall: FloorWall;
  toleranceMm?: number;
}): PlanGapLine[] {
  const tol = args.toleranceMm ?? NEIGHBOR_TOLERANCE_MM;
  if (args.wall.lengthMm <= 0) return [];

  const BAND: Pick<WallObjectBase, "yMm" | "heightMm"> = { yMm: 0, heightMm: 1e6 };
  const member: WallObjectBase = { ...BAND, id: args.selectedObject.id, wallId: args.wall.id, xMm: args.selectedObject.xMm, widthMm: args.selectedObject.widthMm };
  const others: WallObjectBase[] = args.others.map((object) => ({
    ...BAND,
    id: object.id,
    wallId: args.wall.id,
    xMm: object.xMm,
    widthMm: object.widthMm
  }));

  const segments = getNeighborAwareSegments([member], others, args.wall.lengthMm);
  if (segments.length < 2) return [];
  // Only the member's own two clearances (first = left, last = right); a lone
  // member yields exactly these, but slicing guards against any interior noise.
  const outer = [segments[0], segments[segments.length - 1]];

  // Wall direction start→end and its left normal (the viewer/room side, same
  // convention as offsetPlanRectToViewerSide: for dir (cos,sin) it's (-sin,cos)).
  const dir = {
    xMm: (args.wall.endFloorMm.xMm - args.wall.startFloorMm.xMm) / args.wall.lengthMm,
    yMm: (args.wall.endFloorMm.yMm - args.wall.startFloorMm.yMm) / args.wall.lengthMm
  };
  const normalMm = { xMm: -dir.yMm, yMm: dir.xMm };
  const pointAt = (alongMm: number): Point => ({
    xMm: args.wall.startFloorMm.xMm + dir.xMm * alongMm,
    yMm: args.wall.startFloorMm.yMm + dir.yMm * alongMm
  });

  const lines: PlanGapLine[] = [];
  outer.forEach((segment, index) => {
    const gapMm = segment.toMm - segment.fromMm;
    if (gapMm <= tol) return; // flush against a neighbor/end: nothing to print
    lines.push({
      id: `wall-gap:${args.selectedObject.id}:${index === 0 ? "lo" : "hi"}`,
      gapMm,
      aMm: pointAt(segment.fromMm),
      bMm: pointAt(segment.toMm),
      normalMm,
      offsetHandleUnits: WALL_GAP_OFFSET_UNITS
    });
  });
  return lines;
}
