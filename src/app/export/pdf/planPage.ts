import type { PDFPage } from "pdf-lib";
import { getRoomPlaceableWalls } from "../../../domain/geometry/placeableWalls";
import type { PlanRect } from "../../../domain/geometry/planObjects";
import {
  casePlanGlyph,
  wallTextPlanGlyph
} from "../../../domain/geometry/caseGlyphs";
import { isPointInPolygon } from "../../../domain/geometry/polygon";
import { getWallGeometry, outwardWallNormal } from "../../../domain/geometry/walls";
import type { DisplayUnit, Project } from "../../../domain/project";
import {
  planScenePaintOrder,
  type PlanScene,
  type PlanSceneRoom,
  type PlanSceneWall
} from "../../../domain/scene2d/planScene";
import { formatLength } from "../../../domain/units/length";
import {
  getMajorGridIntervalMm,
  getMinorGridIntervalMm
} from "../../../domain/units/precision";
import {
  fitBoundsToRect,
  planRectCorners,
  type DocumentBoundsMm,
  type PageRectPt
} from "../../../domain/export/pageComposition";
import {
  COLORS,
  DIMENSION_SIZE_PT,
  GRID_TARGET_PT,
  drawCenteredLabel,
  drawLine,
  gridStart,
  type PdfFonts
} from "./primitives";
import {
  createPlanTransform,
  planRectWorldPoint,
  polygonPath,
  type PlanTransform
} from "./transforms";

// Print analog of PlanView's MIN_WALL_OBJECT_DEPTH_PX: doors/windows/artworks
// are thin along their off-wall axis and would collapse to hairlines at
// document scale. The floor is applied in page units after the fit is known.
const MIN_PLAN_OBJECT_DEPTH_PT = 3;

export function drawPlanGrid(
  page: PDFPage,
  bounds: DocumentBoundsMm,
  transform: PlanTransform,
  unit: DisplayUnit
) {
  const minor = getMinorGridIntervalMm(unit, transform.scalePtPerMm, {
    targetMinorPx: GRID_TARGET_PT
  });
  const major = getMajorGridIntervalMm(unit, minor);
  const maxLines = 3_000;
  let count = 0;

  for (
    let x = gridStart(bounds.minXMm, minor);
    x <= bounds.maxXMm && count < maxLines;
    x += minor, count += 1
  ) {
    const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
    drawLine(
      page,
      transform.point({ xMm: x, yMm: bounds.minYMm }),
      transform.point({ xMm: x, yMm: bounds.maxYMm }),
      isMajor ? 0.45 : 0.25,
      isMajor ? COLORS.gridMajor : COLORS.gridMinor
    );
  }
  for (
    let y = gridStart(bounds.minYMm, minor);
    y <= bounds.maxYMm && count < maxLines;
    y += minor, count += 1
  ) {
    const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-6;
    drawLine(
      page,
      transform.point({ xMm: bounds.minXMm, yMm: y }),
      transform.point({ xMm: bounds.maxXMm, yMm: y }),
      isMajor ? 0.45 : 0.25,
      isMajor ? COLORS.gridMajor : COLORS.gridMinor
    );
  }
}

export function roomScene(
  scene: PlanScene,
  project: Project,
  roomId: string
): PlanScene {
  const room = scene.rooms.find((candidate) => candidate.roomId === roomId);
  const placement = project.floor.rooms.find(
    (candidate) => candidate.roomId === roomId
  );
  if (!room || !placement) {
    return {
      rooms: [],
      partitions: [],
      openingConnections: [],
      wallObjects: [],
      floorObjects: []
    };
  }
  const wallIds = new Set(
    getRoomPlaceableWalls(placement.room).map((wall) => wall.id)
  );
  return {
    rooms: [room],
    partitions: scene.partitions.filter(
      (partition) => partition.partition.roomId === roomId
    ),
    // Intentionally omitted: opening-connection status dots are a live editing
    // aid (they flag mis-aligned door/window pairs while you work), not part of
    // the static exported document. Left [] by decision, not oversight.
    openingConnections: [],
    wallObjects: scene.wallObjects.filter((entry) =>
      wallIds.has(entry.object.wallId)
    ),
    floorObjects: scene.floorObjects.filter((entry) =>
      isPointInPolygon(
        { xMm: entry.rect.centerXMm, yMm: entry.rect.centerYMm },
        room.polygonMm
      )
    )
  };
}

function drawPlanObject(
  page: PDFPage,
  transform: PlanTransform,
  rect: PlanRect,
  kind: "artwork" | "door" | "window" | "blocked-zone" | "wall-text" | "case",
  isFloorPlaced: boolean
) {
  const corners = planRectCorners(rect).map(transform.point);
  page.drawSvgPath(polygonPath(corners), {
    color: kind === "blocked-zone" ? COLORS.surfaceStrong : COLORS.white,
    borderColor: COLORS.muted,
    borderWidth: 0.8,
    ...(isFloorPlaced ? { borderDashArray: [3, 2] } : {})
  });

  const halfW = rect.widthMm / 2;
  const halfD = rect.depthMm / 2;
  const world = (xMm: number, yMm: number) =>
    transform.point(planRectWorldPoint(rect, { xMm, yMm }));

  if (kind === "artwork") {
    const inset = Math.min(rect.widthMm, rect.depthMm) * 0.22;
    const insetRect: PlanRect = {
      ...rect,
      widthMm: Math.max(0, rect.widthMm - inset * 2),
      depthMm: Math.max(0, rect.depthMm - inset * 2)
    };
    page.drawSvgPath(
      polygonPath(planRectCorners(insetRect).map(transform.point)),
      { borderColor: COLORS.subtle, borderWidth: 0.5 }
    );
  } else if (kind === "door") {
    drawLine(page, world(-halfW, halfD), world(-halfW, -halfD), 0.5, COLORS.subtle);
    drawLine(page, world(-halfW, -halfD), world(halfW, halfD), 0.5, COLORS.subtle);
  } else if (kind === "window") {
    drawLine(page, world(-halfW, 0), world(halfW, 0), 0.5, COLORS.subtle);
    drawLine(page, world(0, -halfD), world(0, halfD), 0.5, COLORS.subtle);
  } else if (kind === "wall-text") {
    // A couple of short "text lines" — the plan echo of the elevation panel,
    // via the shared glyph so the export matches the on-screen construction
    // (midline ± inset·0.4, second line shortened) rather than a drifted copy.
    const glyph = wallTextPlanGlyph({ widthMm: rect.widthMm, depthMm: rect.depthMm });
    for (const line of glyph.lines) {
      drawLine(page, world(line.x1Mm, line.yMm), world(line.x2Mm, line.yMm), 0.5, COLORS.subtle);
    }
  } else if (kind === "case") {
    // A vitrine glyph from the shared construction (caseGlyphs.ts) so the
    // export shows the REAL geometry — a glass inset with a 45° glazing hatch,
    // plus square legs for a freestanding floor case — instead of the old
    // generic 0.22 inset + leg dots. No live zoom here, so the raw mm case
    // constants drive the inset/leg size directly.
    const glyph = casePlanGlyph({
      widthMm: rect.widthMm,
      depthMm: rect.depthMm,
      includeLegs: isFloorPlaced
    });
    if (glyph.glass) {
      const glassCorners = [
        world(glyph.glass.x0Mm, glyph.glass.y0Mm),
        world(glyph.glass.x1Mm, glyph.glass.y0Mm),
        world(glyph.glass.x1Mm, glyph.glass.y1Mm),
        world(glyph.glass.x0Mm, glyph.glass.y1Mm)
      ];
      page.drawSvgPath(polygonPath(glassCorners), {
        borderColor: COLORS.subtle,
        borderWidth: 0.5
      });
    }
    for (const line of glyph.hatch) {
      drawLine(page, world(line.x1Mm, line.y1Mm), world(line.x2Mm, line.y2Mm), 0.45, COLORS.subtle);
    }
    for (const leg of glyph.legs) {
      const half = leg.sizeMm / 2;
      const legCorners = [
        world(leg.cxMm - half, leg.cyMm - half),
        world(leg.cxMm + half, leg.cyMm - half),
        world(leg.cxMm + half, leg.cyMm + half),
        world(leg.cxMm - half, leg.cyMm + half)
      ];
      page.drawSvgPath(polygonPath(legCorners), { color: COLORS.subtle });
    }
  } else {
    for (const x of [-halfW, 0, halfW]) {
      drawLine(
        page,
        world(Math.max(-halfW, x - halfD), halfD),
        world(Math.min(halfW, x + halfD), -halfD),
        0.45,
        COLORS.subtle
      );
    }
  }
}

export function drawPlanScene(
  page: PDFPage,
  scene: PlanScene,
  bounds: DocumentBoundsMm,
  drawingRect: PageRectPt,
  unit: DisplayUnit,
  grid: boolean,
  gridBoundsMm?: DocumentBoundsMm
): PlanTransform {
  const fit = fitBoundsToRect(bounds, drawingRect);
  const transform = createPlanTransform(bounds, fit);
  // Fit/transform always use the object-inflated `bounds` so protruding wall
  // objects are never clipped; the grid draws over the narrower structure
  // bounds (when given) so lines stop at the walls instead of poking past them.
  if (grid) drawPlanGrid(page, gridBoundsMm ?? bounds, transform, unit);

  for (const room of scene.rooms) {
    page.drawSvgPath(
      polygonPath(room.polygonMm.map(transform.point)),
      { color: COLORS.white }
    );
  }
  for (const room of scene.rooms) {
    for (const wall of room.walls) {
      drawLine(
        page,
        transform.point(wall.startMm),
        transform.point(wall.endMm),
        1.8,
        COLORS.ink
      );
    }
  }
  for (const partition of scene.partitions) {
    page.drawSvgPath(
      polygonPath(planRectCorners(partition.rect).map(transform.point)),
      { color: COLORS.ink, opacity: 0.72 }
    );
  }
  // Same semantics as getRenderedWallObjectPlanRect's min-depth clamp: the
  // viewer-side offset upstream was computed from the pre-clamp depth, so
  // growing depth around the center here never moves an object's center.
  const minDepthMm = MIN_PLAN_OBJECT_DEPTH_PT / transform.scalePtPerMm;
  // Shared paint order (cases first across wall + floor groups) so an artwork
  // overlapping a case covers it here exactly as it does on the SVG canvas.
  for (const painted of planScenePaintOrder(scene.wallObjects, scene.floorObjects)) {
    if (painted.group === "wall") {
      const entry = painted.entry;
      drawPlanObject(
        page,
        transform,
        {
          ...entry.renderedRect,
          depthMm: Math.max(entry.renderedRect.depthMm, minDepthMm)
        },
        entry.object.kind,
        false
      );
    } else {
      const entry = painted.entry;
      drawPlanObject(page, transform, entry.rect, entry.object.kind, true);
    }
  }
  return transform;
}

// The canonical "which perpendicular points OUT of the room" for a wall
// dimension line, via the same in-polygon probe outwardWallNormal uses
// elsewhere (WallLengthLabels, WallSlideHandles) — a centroid-vs-midpoint
// comparison flips on concave rooms (an L's inner walls can sit on the far
// side of the centroid from the room's actual interior), so this PDF path
// must use the same probe-based helper rather than its own heuristic.
// Returns a unit vector in mm-space (room-local direction, translation- and
// scale-invariant), or null if the wall can't be matched back to the room's
// domain geometry. Exported for direct testing of the side choice.
export function resolveWallDimensionOutwardMm(
  room: PlanSceneRoom,
  wall: PlanSceneWall
): { xMm: number; yMm: number } | null {
  const domainWall = room.placement.room.walls.find((candidate) => candidate.id === wall.wallId);
  if (!domainWall) return null;
  const wallGeometry = getWallGeometry(room.placement.room, domainWall);
  return outwardWallNormal(room.placement.room, wallGeometry);
}

export function drawRoomWallDimensions(
  page: PDFPage,
  fonts: PdfFonts,
  room: PlanSceneRoom,
  transform: PlanTransform,
  unit: DisplayUnit
) {
  for (const wall of room.walls) {
    const start = transform.point(wall.startMm);
    const end = transform.point(wall.endMm);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length <= 0) continue;
    const outwardMm = resolveWallDimensionOutwardMm(room, wall);
    // The plan transform flips y (mm-up vs. page-down) but scales x/y
    // uniformly with no rotation, so a direction vector only needs its y
    // component negated to move from mm-space to page-point-space.
    const normal = outwardMm
      ? { x: outwardMm.xMm, y: -outwardMm.yMm }
      : { x: -dy / length, y: dx / length };
    const offset = 12;
    const a = { x: start.x + normal.x * offset, y: start.y + normal.y * offset };
    const b = { x: end.x + normal.x * offset, y: end.y + normal.y * offset };
    drawLine(page, a, b, 0.55, COLORS.muted);
    drawLine(
      page,
      { x: a.x - normal.x * 3, y: a.y - normal.y * 3 },
      { x: a.x + normal.x * 3, y: a.y + normal.y * 3 },
      0.55,
      COLORS.muted
    );
    drawLine(
      page,
      { x: b.x - normal.x * 3, y: b.y - normal.y * 3 },
      { x: b.x + normal.x * 3, y: b.y + normal.y * 3 },
      0.55,
      COLORS.muted
    );
    const lengthMm = Math.hypot(
      wall.endMm.xMm - wall.startMm.xMm,
      wall.endMm.yMm - wall.startMm.yMm
    );
    drawCenteredLabel(
      page,
      fonts,
      formatLength(lengthMm, { unit }),
      (a.x + b.x) / 2,
      (a.y + b.y) / 2 - DIMENSION_SIZE_PT / 2
    );
  }
}
