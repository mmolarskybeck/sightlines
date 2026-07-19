import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  degrees,
  rgb
} from "pdf-lib";
import {
  FRAME_EDGE_HAIRLINE_HEX,
  FRAME_FINISH_HEX,
  MAT_BEVEL_HAIRLINE_HEX,
  MAT_FILL_HEX,
  effectiveFraming
} from "../../domain/framing";
import { getRoomPlaceableWalls } from "../../domain/geometry/placeableWalls";
import type { PlanRect } from "../../domain/geometry/planObjects";
import {
  caseElevationGlyph,
  caseFloorGhostGlyph,
  casePlanGlyph,
  wallTextPlanGlyph
} from "../../domain/geometry/caseGlyphs";
import { isPointInPolygon } from "../../domain/geometry/polygon";
import { getWallGeometry, outwardWallNormal } from "../../domain/geometry/walls";
import type {
  Artwork,
  Asset,
  CaseFloorObject,
  DisplayUnit,
  Project,
  SavedView
} from "../../domain/project";
import {
  deriveElevationSceneDimensions,
  elevationSceneToDimensionParticipants
} from "../../domain/dimensions/elevationDimensions";
import type {
  BoundaryDimension,
  GapDimension
} from "../../domain/dimensions/orthogonalNeighbors";
import {
  buildElevationScene,
  getArtworkRectSvg,
  type ElevationScene
} from "../../domain/scene2d/elevationScene";
import { computeWallTextSkeleton } from "../../domain/scene2d/wallTextSkeleton";
import {
  buildPlanScene,
  type PlanScene,
  type PlanSceneRoom,
  type PlanSceneWall
} from "../../domain/scene2d/planScene";
import { formatLength } from "../../domain/units/length";
import {
  getMajorGridIntervalMm,
  getMinorGridIntervalMm
} from "../../domain/units/precision";
import type { EffectiveDocumentSettings } from "../../domain/export/documentSettings";
import {
  chooseScaleBarLengthMm,
  deriveDocumentPageManifest,
  fitBoundsToRect,
  getPageDrawingRectPt,
  getPageSizePt,
  planRectCorners,
  type DocumentBoundsMm,
  type DocumentPageManifest,
  type FitToPageResult,
  type PageRectPt
} from "../../domain/export/pageComposition";
import {
  choosePdfLabelCandidate,
  findPdfLeaderRoute,
  type PdfLabelBox
} from "./pdfDimensionLayout";
import { prepareImageForPdf, type PdfImageOptions } from "./pdfImage";

export type RenderSavedView = (
  view: SavedView,
  size: { widthPx: number; heightPx: number }
) => Promise<Blob>;

export type CreateDocumentPdfInput = {
  project: Project;
  settings: EffectiveDocumentSettings;
  artworks: readonly Artwork[];
  getAsset?: (assetId: string) => Promise<Asset>;
  getBlob?: (key: string) => Promise<Blob>;
  renderSavedView?: RenderSavedView;
  exportedAt?: Date;
  locale?: string;
  fontBytes?:
    | Uint8Array
    | { regular: Uint8Array; strong?: Uint8Array };
};

export type CreateDocumentPdfResult = {
  bytes: Uint8Array;
  pageCount: number;
  warnings: string[];
  manifest: DocumentPageManifest[];
};

type PdfFonts = {
  regular: PDFFont;
  strong: PDFFont;
  supportedCodePoints: ReadonlySet<number>;
  substitutedUnsupportedText: boolean;
};

type PlanTransform = {
  scalePtPerMm: number;
  point: (point: { xMm: number; yMm: number }) => { x: number; y: number };
};

type ElevationTransform = {
  scalePtPerMm: number;
  point: (point: { xMm: number; yMm: number }) => { x: number; y: number };
};

type EmbeddedArtworkImage =
  | { status: "ready"; image: PDFImage }
  | { status: "absent" }
  | { status: "missing" };

const COLORS = {
  ink: rgb(0.1, 0.11, 0.12),
  muted: rgb(0.38, 0.4, 0.42),
  dimension: rgb(0.48, 0.5, 0.52),
  subtle: rgb(0.58, 0.6, 0.62),
  surface: rgb(0.96, 0.965, 0.97),
  surfaceStrong: rgb(0.91, 0.92, 0.93),
  gridMinor: rgb(0.88, 0.89, 0.9),
  gridMajor: rgb(0.73, 0.75, 0.77),
  // Light grey skeleton bars on the white wall-text panel (~#d4d4d4).
  skeletonBar: rgb(0.83, 0.835, 0.84),
  white: rgb(1, 1, 1)
};

const HEADER_PROJECT_SIZE_PT = 9;
const HEADER_TITLE_SIZE_PT = 14;
const HEADER_DATE_SIZE_PT = 8;
const BODY_SIZE_PT = 8;
const SMALL_SIZE_PT = 7;
const DIMENSION_SIZE_PT = 7;
const DRAWING_INSET_PT = 22;
const DIMENSION_DRAWING_INSET_PT = 38;
const ELEVATION_DIMENSION_INSETS_PT = {
  left: 30,
  right: 72,
  bottom: 34,
  top: 22
};
const GRID_TARGET_PT = 8;
// Print analog of PlanView's MIN_WALL_OBJECT_DEPTH_PX: doors/windows/artworks
// are thin along their off-wall axis and would collapse to hairlines at
// document scale. The floor is applied in page units after the fit is known.
const MIN_PLAN_OBJECT_DEPTH_PT = 3;
const THREE_D_RENDER_DPI = 144;

function colorFromHex(hex: string) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  return rgb(
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255
  );
}

function fontText(fonts: PdfFonts, text: string): string {
  return [...text]
    .map((character) => {
      if (fonts.supportedCodePoints.has(character.codePointAt(0)!)) {
        return character;
      }
      fonts.substitutedUnsupportedText = true;
      return "?";
    })
    .join("");
}

function textWidth(fonts: PdfFonts, text: string, size: number, strong = false): number {
  const font = strong ? fonts.strong : fonts.regular;
  return font.widthOfTextAtSize(fontText(fonts, text), size);
}

function drawText(
  page: PDFPage,
  fonts: PdfFonts,
  text: string,
  options: {
    x: number;
    y: number;
    size: number;
    strong?: boolean;
    color?: ReturnType<typeof rgb>;
    rotate?: number;
  }
) {
  page.drawText(fontText(fonts, text), {
    x: options.x,
    y: options.y,
    size: options.size,
    font: options.strong ? fonts.strong : fonts.regular,
    color: options.color ?? COLORS.ink,
    ...(options.rotate !== undefined ? { rotate: degrees(options.rotate) } : {})
  });
}

function drawCenteredLabel(
  page: PDFPage,
  fonts: PdfFonts,
  text: string,
  x: number,
  y: number,
  size = DIMENSION_SIZE_PT,
  rotate?: number
) {
  const width = textWidth(fonts, text, size, true);
  if (rotate === 90) {
    page.drawRectangle({
      x: x - size * 0.25,
      y: y - width / 2 - 2,
      width: size + 3,
      height: width + 4,
      color: COLORS.white
    });
    drawText(page, fonts, text, {
      x: x + size * 0.65,
      y: y - width / 2,
      size,
      strong: true,
      color: COLORS.muted,
      rotate: 90
    });
    return;
  }
  page.drawRectangle({
    x: x - width / 2 - 2,
    y: y - 1,
    width: width + 4,
    height: size + 3,
    color: COLORS.white
  });
  drawText(page, fonts, text, {
    x: x - width / 2,
    y: y + 1,
    size,
    strong: true,
    color: COLORS.muted
  });
}

function insetRect(rect: PageRectPt, amountPt: number): PageRectPt {
  return {
    xPt: rect.xPt + amountPt,
    yPt: rect.yPt + amountPt,
    widthPt: Math.max(1, rect.widthPt - amountPt * 2),
    heightPt: Math.max(1, rect.heightPt - amountPt * 2)
  };
}

function insetRectByEdges(
  rect: PageRectPt,
  insets: { left: number; right: number; bottom: number; top: number }
): PageRectPt {
  return {
    xPt: rect.xPt + insets.left,
    yPt: rect.yPt + insets.bottom,
    widthPt: Math.max(1, rect.widthPt - insets.left - insets.right),
    heightPt: Math.max(1, rect.heightPt - insets.bottom - insets.top)
  };
}

export function formatDocumentDimension(
  mm: number,
  unit: DisplayUnit
): string {
  return formatLength(mm, {
    unit,
    ...(unit === "ft" || unit === "in"
      ? { fractionDenominator: 8 as const }
      : {})
  });
}

function createPlanTransform(
  bounds: DocumentBoundsMm,
  fit: FitToPageResult
): PlanTransform {
  return {
    scalePtPerMm: fit.scalePtPerMm,
    point: ({ xMm, yMm }) => ({
      x: fit.xPt + (xMm - bounds.minXMm) * fit.scalePtPerMm,
      y: fit.yPt + (bounds.maxYMm - yMm) * fit.scalePtPerMm
    })
  };
}

function createElevationTransform(
  bounds: DocumentBoundsMm,
  fit: FitToPageResult
): ElevationTransform {
  return {
    scalePtPerMm: fit.scalePtPerMm,
    point: ({ xMm, yMm }) => ({
      x: fit.xPt + (xMm - bounds.minXMm) * fit.scalePtPerMm,
      y: fit.yPt + (yMm - bounds.minYMm) * fit.scalePtPerMm
    })
  };
}

// pdf-lib's drawSvgPath interprets the path in SVG y-DOWN space relative to
// the (x, y) origin option (default 0,0), so page-space y must be negated or
// the shape lands below the page and never prints. Inputs here are page
// coordinates (y-up); the negation makes drawSvgPath render them in place.
function polygonPath(points: readonly { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  return [
    `M ${points[0]!.x} ${-points[0]!.y}`,
    ...points.slice(1).map((point) => `L ${point.x} ${-point.y}`),
    "Z"
  ].join(" ");
}

function planRectWorldPoint(
  rect: PlanRect,
  local: { xMm: number; yMm: number }
): { xMm: number; yMm: number } {
  const angle = (rect.angleDeg * Math.PI) / 180;
  return {
    xMm:
      rect.centerXMm +
      local.xMm * Math.cos(angle) -
      local.yMm * Math.sin(angle),
    yMm:
      rect.centerYMm +
      local.xMm * Math.sin(angle) +
      local.yMm * Math.cos(angle)
  };
}

function drawLine(
  page: PDFPage,
  from: { x: number; y: number },
  to: { x: number; y: number },
  thickness: number,
  color = COLORS.ink,
  dashArray?: number[]
) {
  page.drawLine({
    start: from,
    end: to,
    thickness,
    color,
    ...(dashArray ? { dashArray } : {})
  });
}

function drawHeader(
  page: PDFPage,
  fonts: PdfFonts,
  projectTitle: string,
  pageTitle: string,
  exportedAt: Date,
  locale: string
) {
  const { width, height } = page.getSize();
  const left = 36;
  const right = width - 36;
  const date = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(exportedAt);

  drawText(page, fonts, projectTitle, {
    x: left,
    y: height - 48,
    size: HEADER_PROJECT_SIZE_PT,
    strong: true
  });
  drawText(page, fonts, pageTitle, {
    x: left,
    y: height - 66,
    size: HEADER_TITLE_SIZE_PT,
    strong: true
  });
  drawText(page, fonts, date, {
    x: right - textWidth(fonts, date, HEADER_DATE_SIZE_PT),
    y: height - 48,
    size: HEADER_DATE_SIZE_PT,
    color: COLORS.muted
  });
}

function drawScaleBar(
  page: PDFPage,
  fonts: PdfFonts,
  unit: DisplayUnit,
  scalePtPerMm: number
) {
  const lengthMm = chooseScaleBarLengthMm(scalePtPerMm, unit);
  const widthPt = lengthMm * scalePtPerMm;
  const x = 36;
  const y = 47;
  drawLine(page, { x, y }, { x: x + widthPt, y }, 1, COLORS.ink);
  drawLine(page, { x, y: y - 3 }, { x, y: y + 3 }, 1, COLORS.ink);
  drawLine(
    page,
    { x: x + widthPt, y: y - 3 },
    { x: x + widthPt, y: y + 3 },
    1,
    COLORS.ink
  );
  drawText(page, fonts, formatLength(lengthMm, { unit }), {
    x,
    y: y + 6,
    size: SMALL_SIZE_PT,
    strong: true,
    color: COLORS.muted
  });
}

function gridStart(min: number, spacing: number): number {
  return Math.ceil(min / spacing) * spacing;
}

function drawPlanGrid(
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

function drawElevationGrid(
  page: PDFPage,
  scene: ElevationScene,
  transform: ElevationTransform,
  unit: DisplayUnit
) {
  const minor = getMinorGridIntervalMm(unit, transform.scalePtPerMm, {
    targetMinorPx: GRID_TARGET_PT
  });
  const major = getMajorGridIntervalMm(unit, minor);
  const maxLines = 2_000;
  let count = 0;

  for (let x = 0; x <= scene.wallLengthMm && count < maxLines; x += minor, count += 1) {
    const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
    drawLine(
      page,
      transform.point({ xMm: x, yMm: 0 }),
      transform.point({ xMm: x, yMm: scene.wallHeightMm }),
      isMajor ? 0.45 : 0.25,
      isMajor ? COLORS.gridMajor : COLORS.gridMinor
    );
  }
  for (let y = 0; y <= scene.wallHeightMm && count < maxLines; y += minor, count += 1) {
    const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-6;
    drawLine(
      page,
      transform.point({ xMm: 0, yMm: y }),
      transform.point({ xMm: scene.wallLengthMm, yMm: y }),
      isMajor ? 0.45 : 0.25,
      isMajor ? COLORS.gridMajor : COLORS.gridMinor
    );
  }
}

function roomScene(
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

function drawPlanScene(
  page: PDFPage,
  scene: PlanScene,
  bounds: DocumentBoundsMm,
  drawingRect: PageRectPt,
  unit: DisplayUnit,
  grid: boolean
): PlanTransform {
  const fit = fitBoundsToRect(bounds, drawingRect);
  const transform = createPlanTransform(bounds, fit);
  if (grid) drawPlanGrid(page, bounds, transform, unit);

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
  for (const entry of scene.wallObjects) {
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
  }
  for (const entry of scene.floorObjects) {
    drawPlanObject(page, transform, entry.rect, entry.object.kind, true);
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

function drawRoomWallDimensions(
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

export function artworkPlaceholderLabel(
  artwork: Artwork | undefined,
  ordinal: number
): string {
  return (
    artwork?.title?.trim() ||
    artwork?.accessionNumber?.trim() ||
    artwork?.artist?.trim() ||
    `Untitled work ${ordinal}`
  );
}

function drawWrappedCenteredText(
  page: PDFPage,
  fonts: PdfFonts,
  lines: string[],
  rect: { x: number; y: number; width: number; height: number }
) {
  if (rect.width < 28 || rect.height < 18) return;
  const size = Math.min(BODY_SIZE_PT, Math.max(5, rect.height / (lines.length + 2)));
  const lineHeight = size + 2;
  const totalHeight = lines.length * lineHeight;
  let y = rect.y + (rect.height + totalHeight) / 2 - lineHeight;
  for (const line of lines) {
    const width = textWidth(fonts, line, size, line === lines.at(-1));
    const clipped =
      width <= rect.width - 8
        ? line
        : `${line.slice(0, Math.max(1, Math.floor((line.length * (rect.width - 14)) / width)))}…`;
    const clippedWidth = textWidth(fonts, clipped, size, line === lines.at(-1));
    drawText(page, fonts, clipped, {
      x: rect.x + (rect.width - clippedWidth) / 2,
      y,
      size,
      strong: line === lines.at(-1),
      color: COLORS.muted
    });
    y -= lineHeight;
  }
}

function imageRectInside(
  container: { x: number; y: number; width: number; height: number },
  image: PDFImage
) {
  const scale = Math.min(
    container.width / image.width,
    container.height / image.height
  );
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: container.x + (container.width - width) / 2,
    y: container.y + (container.height - height) / 2,
    width,
    height
  };
}

function elevationRect(
  transform: ElevationTransform,
  xMm: number,
  yMm: number,
  widthMm: number,
  heightMm: number
) {
  const bottomLeft = transform.point({ xMm, yMm });
  return {
    x: bottomLeft.x,
    y: bottomLeft.y,
    width: widthMm * transform.scalePtPerMm,
    height: heightMm * transform.scalePtPerMm
  };
}

function drawArtworkPlaceholder(
  page: PDFPage,
  fonts: PdfFonts,
  rect: { x: number; y: number; width: number; height: number },
  label: string,
  unavailable: boolean
) {
  page.drawRectangle({
    ...rect,
    color: COLORS.surface,
    borderColor: COLORS.muted,
    borderWidth: 0.7
  });
  drawWrappedCenteredText(
    page,
    fonts,
    unavailable ? ["Image unavailable", label] : [label],
    rect
  );
}

function drawElevationOpening(
  page: PDFPage,
  transform: ElevationTransform,
  opening: ElevationScene["openings"][number]
) {
  const xMm = opening.centerMm.xMm - opening.sizeMm.widthMm / 2;
  const yMm = opening.centerMm.yMm - opening.sizeMm.heightMm / 2;
  const rect = elevationRect(
    transform,
    xMm,
    yMm,
    opening.sizeMm.widthMm,
    opening.sizeMm.heightMm
  );
  page.drawRectangle({
    ...rect,
    borderColor: COLORS.muted,
    borderWidth: 0.7,
    ...(opening.object.kind === "blocked-zone"
      ? { color: COLORS.surfaceStrong }
      : {})
  });
  if (opening.object.kind === "window") {
    drawLine(
      page,
      { x: rect.x + rect.width / 2, y: rect.y },
      { x: rect.x + rect.width / 2, y: rect.y + rect.height },
      0.5,
      COLORS.muted
    );
    drawLine(
      page,
      { x: rect.x, y: rect.y + rect.height / 2 },
      { x: rect.x + rect.width, y: rect.y + rect.height / 2 },
      0.5,
      COLORS.muted
    );
  } else if (opening.object.kind === "door") {
    const radius = Math.min(rect.width, rect.height);
    drawLine(
      page,
      { x: rect.x, y: rect.y },
      { x: rect.x, y: rect.y + radius },
      0.45,
      COLORS.subtle
    );
    drawLine(
      page,
      { x: rect.x, y: rect.y },
      { x: rect.x + radius, y: rect.y },
      0.45,
      COLORS.subtle
    );
  } else {
    const step = 7;
    for (let x = rect.x - rect.height; x < rect.x + rect.width; x += step) {
      const startX = Math.max(rect.x, x);
      const startY = rect.y + Math.max(0, rect.x - x);
      const endX = Math.min(rect.x + rect.width, x + rect.height);
      const endY = rect.y + Math.min(rect.height, rect.x + rect.width - x);
      if (endX > startX) {
        drawLine(
          page,
          { x: startX, y: startY },
          { x: endX, y: endY },
          0.35,
          COLORS.subtle
        );
      }
    }
  }
}

// A white didactic panel with a subtle border and light-grey skeleton bars —
// the export twin of ElevationWallText / the 3D wall-text panel, all three
// sharing computeWallTextSkeleton so the bar layout is identical everywhere.
function drawElevationWallText(
  page: PDFPage,
  transform: ElevationTransform,
  wallText: ElevationScene["wallTexts"][number]
) {
  const xMm = wallText.centerMm.xMm - wallText.sizeMm.widthMm / 2;
  const yMm = wallText.centerMm.yMm - wallText.sizeMm.heightMm / 2;
  const rect = elevationRect(
    transform,
    xMm,
    yMm,
    wallText.sizeMm.widthMm,
    wallText.sizeMm.heightMm
  );
  page.drawRectangle({
    ...rect,
    color: COLORS.white,
    borderColor: COLORS.muted,
    borderWidth: 0.7
  });
  const skeleton = computeWallTextSkeleton(wallText.sizeMm.widthMm, wallText.sizeMm.heightMm);
  for (const bar of skeleton.bars) {
    page.drawRectangle({
      // Bars are normalized top-left/y-down; PDF is y-up, so flip the top.
      x: rect.x + bar.xFrac * rect.width,
      y: rect.y + rect.height - (bar.yFrac + bar.heightFrac) * rect.height,
      width: bar.widthFrac * rect.width,
      height: bar.heightFrac * rect.height,
      color: COLORS.skeletonBar
    });
  }
}

// A wall display case in elevation: a solid side-profile box (outline) with a
// thin inner glass inset — the export twin of ElevationCase.tsx / the plan-view
// case glyph.
function drawElevationCase(
  page: PDFPage,
  transform: ElevationTransform,
  displayCase: ElevationScene["cases"][number]
) {
  const xMm = displayCase.centerMm.xMm - displayCase.sizeMm.widthMm / 2;
  const yMm = displayCase.centerMm.yMm - displayCase.sizeMm.heightMm / 2;
  const rect = elevationRect(
    transform,
    xMm,
    yMm,
    displayCase.sizeMm.widthMm,
    displayCase.sizeMm.heightMm
  );
  page.drawRectangle({
    ...rect,
    color: COLORS.white,
    borderColor: COLORS.muted,
    borderWidth: 0.7
  });
  // Real front-face construction from the shared glyph (glass-lid line inset
  // between the tray walls + a base-slab line) instead of the old generic
  // 0.22 concentric inset. No live zoom, so the raw mm case constants apply;
  // the glyph is in local mm, y-DOWN from the box top — the model space here is
  // y-up, so the box top sits at (yMm + heightMm) and local y subtracts down.
  const widthMm = displayCase.sizeMm.widthMm;
  const heightMm = displayCase.sizeMm.heightMm;
  const glyph = caseElevationGlyph({ widthMm, heightMm });
  if (glyph.showMarks) {
    const topYMm = yMm + heightMm;
    const glassY = topYMm - glyph.glassLid.yMm;
    const slabY = topYMm - glyph.slab.yMm;
    drawLine(
      page,
      transform.point({ xMm: xMm + glyph.glassLid.x1Mm, yMm: glassY }),
      transform.point({ xMm: xMm + glyph.glassLid.x2Mm, yMm: glassY }),
      0.5,
      COLORS.subtle
    );
    drawLine(
      page,
      transform.point({ xMm: xMm + glyph.slab.x1Mm, yMm: slabY }),
      transform.point({ xMm: xMm + glyph.slab.x2Mm, yMm: slabY }),
      0.5,
      COLORS.subtle
    );
  }
}

// The elevation shadow of a freestanding floor case standing in front of the
// wall: a light dashed outline from the floor line up to the case height,
// spanning the along-wall range its footprint projects onto. Non-structural —
// drawn before the wall objects (an alignment aid, never an occluder).
function drawElevationFloorCaseGhost(
  page: PDFPage,
  transform: ElevationTransform,
  ghost: ElevationScene["floorCaseGhosts"][number]
) {
  const widthMm = Math.max(0, ghost.xMaxMm - ghost.xMinMm);
  const glyph = caseFloorGhostGlyph({ widthMm, heightMm: ghost.heightMm });
  const dash = { borderColor: COLORS.subtle, borderWidth: 0.5, borderDashArray: [3, 2] };

  if (!glyph.hasLegs) {
    // Too short for legs — a plain dashed silhouette, exactly as before.
    page.drawRectangle({
      ...elevationRect(transform, ghost.xMinMm, 0, widthMm, ghost.heightMm),
      ...dash
    });
    return;
  }

  // The real ghost construction (glass box + base slab line + two legs to the
  // floor), all kept dashed/subtle since the whole ghost is an alignment aid.
  // Model space is y-up (floor at 0); the glyph is local y-down from the top,
  // so a local y maps to model (heightMm − localY).
  const glassBox = glyph.glassBox;
  page.drawRectangle({
    ...elevationRect(
      transform,
      ghost.xMinMm,
      ghost.heightMm - glassBox.heightMm,
      glassBox.widthMm,
      glassBox.heightMm
    ),
    ...dash
  });
  const slabY = ghost.heightMm - glyph.slabYMm;
  drawLine(
    page,
    transform.point({ xMm: ghost.xMinMm, yMm: slabY }),
    transform.point({ xMm: ghost.xMinMm + widthMm, yMm: slabY }),
    0.5,
    COLORS.subtle,
    [3, 2]
  );
  for (const leg of glyph.legs) {
    drawLine(
      page,
      transform.point({ xMm: ghost.xMinMm + leg.xMm, yMm: slabY }),
      transform.point({ xMm: ghost.xMinMm + leg.xMm, yMm: ghost.heightMm - glyph.floorYMm }),
      0.5,
      COLORS.subtle,
      [3, 2]
    );
  }
}

function participantObstacleBoxes(
  scene: ElevationScene,
  transform: ElevationTransform,
  paddingPt = 3
): PdfLabelBox[] {
  return elevationSceneToDimensionParticipants(scene).map((participant) => {
    const bottomLeft = transform.point({
      xMm: participant.rect.xMm,
      yMm: participant.rect.yMm
    });
    const topRight = transform.point({
      xMm: participant.rect.xMm + participant.rect.widthMm,
      yMm: participant.rect.yMm + participant.rect.heightMm
    });
    return {
      left: bottomLeft.x - paddingPt,
      right: topRight.x + paddingPt,
      bottom: bottomLeft.y - paddingPt,
      top: topRight.y + paddingPt
    };
  });
}

function drawGapDimension(
  page: PDFPage,
  fonts: PdfFonts,
  transform: ElevationTransform,
  dimension: GapDimension | BoundaryDimension,
  unit: DisplayUnit,
  occupied: PdfLabelBox[],
  obstacles: readonly PdfLabelBox[],
  leaderObstacles: readonly PdfLabelBox[],
  wallFrame: { leftX: number; rightX: number; topY: number; bottomY: number }
) {
  const label = formatDocumentDimension(dimension.gapMm, unit);
  const isBoundary = !("axis" in dimension);
  const lineColor = isBoundary ? COLORS.subtle : COLORS.dimension;
  const lineWidth = isBoundary ? 0.3 : 0.4;
  if ("axis" in dimension && dimension.axis === "vertical") {
    const xMm =
      (dimension.corridorLoMm + dimension.corridorHiMm) / 2;
    const a = transform.point({ xMm, yMm: dimension.fromMm });
    const b = transform.point({ xMm, yMm: dimension.toMm });
    drawLine(page, a, b, lineWidth, lineColor);
    drawLine(
      page,
      { x: a.x - 2.5, y: a.y },
      { x: a.x + 2.5, y: a.y },
      lineWidth,
      lineColor
    );
    drawLine(
      page,
      { x: b.x - 2.5, y: b.y },
      { x: b.x + 2.5, y: b.y },
      lineWidth,
      lineColor
    );
    const available = Math.abs(b.y - a.y);
    const labelHeight = textWidth(fonts, label, DIMENSION_SIZE_PT, true);
    const midY = (a.y + b.y) / 2;
    if (available >= labelHeight + 8) {
      const labelPosition = choosePdfLabelCandidate(
        [0, 8, -8, 16, -16, 24, -24].map((offset) => {
          const x = a.x + offset;
          return {
            x,
            box: {
              left: x - DIMENSION_SIZE_PT * 0.25,
              right: x + DIMENSION_SIZE_PT + 3,
              bottom: midY - labelHeight / 2 - 2,
              top: midY + labelHeight / 2 + 2
            }
          };
        }),
        occupied,
        obstacles
      );
      if (!labelPosition) return;
      const labelX = labelPosition.x;
      occupied.push(labelPosition.box);
      if (Math.abs(labelX - a.x) > 3) {
        drawLine(
          page,
          { x: a.x, y: midY },
          { x: labelX, y: midY },
          0.3,
          COLORS.subtle
        );
      }
      drawCenteredLabel(
        page,
        fonts,
        label,
        labelX,
        midY,
        DIMENSION_SIZE_PT,
        90
      );
      return;
    }

    // The label keeps the line's mid-height and escapes sideways past the
    // contiguous cluster around the gap, on the side the gap's own column
    // is on — a 2x2 block's left-column gap labels to the block's left, the
    // right-column gap to its right, so position names the column. The
    // flood joins footprints separated by less than a label-sized gap; a
    // real inter-group gap breaks the chain and the label stays adjacent.
    const labelWidth = textWidth(fonts, label, DIMENSION_SIZE_PT, true);
    const labelY = midY - DIMENSION_SIZE_PT / 2;
    // Footprints sharing the gap's vertical extent — the works the label
    // must escape past to stay unambiguous.
    const bandLo = Math.min(a.y, b.y) - 2;
    const bandHi = Math.max(a.y, b.y) + 2;
    const band = obstacles.filter(
      (box) => box.top > bandLo && box.bottom < bandHi
    );
    // Contiguous crowd around the gap: footprints separated by less than 8pt
    // read as one block the label must not sit inside.
    let crowdLeft = a.x - 6;
    let crowdRight = a.x + 6;
    for (let changed = true; changed; ) {
      changed = false;
      for (const box of band) {
        if (
          box.left < crowdRight + 8 &&
          box.right > crowdLeft - 8 &&
          (box.left < crowdLeft || box.right > crowdRight)
        ) {
          crowdLeft = Math.min(crowdLeft, box.left);
          crowdRight = Math.max(crowdRight, box.right);
          changed = true;
        }
      }
    }
    // Escape toward the block's nearer outside edge, judged over the crowd
    // plus its immediate ring — so a 2x2 block's left-column gap labels to
    // the block's left and the right column to its right, and the position
    // itself names the column.
    let contextLeft = crowdLeft;
    let contextRight = crowdRight;
    for (const box of band) {
      if (box.left < crowdRight + 24 && box.right > crowdLeft - 24) {
        contextLeft = Math.min(contextLeft, box.left);
        contextRight = Math.max(contextRight, box.right);
      }
    }
    const rightward = a.x - contextLeft >= contextRight - a.x;
    // Nearest x on the given side where the label clears every band
    // footprint (monotone outward walk, so it terminates). Distance is a
    // preference, not a reason to place a knockout over artwork.
    const slideClear = (direction: 1 | -1): number | null => {
      let x =
        (direction === 1 ? crowdRight : crowdLeft) +
        direction * (labelWidth / 2 + 6);
      for (let moved = true; moved; ) {
        moved = false;
        for (const box of band) {
          if (
            box.right > x - labelWidth / 2 - 2 &&
            box.left < x + labelWidth / 2 + 2
          ) {
            x =
              direction === 1
                ? box.right + labelWidth / 2 + 4
                : box.left - labelWidth / 2 - 4;
            moved = true;
          }
        }
      }
      return x;
    };
    const nearX = slideClear(rightward ? 1 : -1);
    const farX = slideClear(rightward ? -1 : 1);
    const step = rightward ? 9 : -9;
    const diagonalX = a.x + (rightward ? 1 : -1) * (labelWidth / 2 + 9);
    const leaderStart = { x: a.x, y: midY };
    const candidates = [
      ...(nearX !== null
        ? [
            { x: nearX, y: labelY },
            { x: nearX + step, y: labelY },
            { x: nearX, y: labelY + 10 },
            { x: nearX, y: labelY - 10 },
            { x: nearX + step, y: labelY + 10 },
            { x: nearX + step, y: labelY - 10 }
          ]
        : []),
      ...(farX !== null
        ? [
            { x: farX, y: labelY },
            { x: farX, y: labelY + 10 },
            { x: farX, y: labelY - 10 }
          ]
        : []),
      { x: diagonalX, y: midY + 8 },
      { x: diagonalX, y: midY - 12 },
      { x: a.x, y: midY + 8 }
    ].map((candidate) => {
        const leaderRoute = findPdfLeaderRoute(
          leaderStart,
          {
            x: candidate.x,
            y: candidate.y + DIMENSION_SIZE_PT / 2
          },
          leaderObstacles
        );
        return {
          x: candidate.x,
          y: candidate.y,
          leaderRoute,
          box: {
            left: candidate.x - labelWidth / 2 - 2,
            right: candidate.x + labelWidth / 2 + 2,
            bottom: candidate.y - 1,
            top: candidate.y + DIMENSION_SIZE_PT + 3
          }
        };
      })
      // A close diagonal is only acceptable when its path actually clears
      // the artwork. Otherwise leave the label on a clear exterior lane.
      .filter(
        (candidate) =>
          candidate.leaderRoute !== null &&
          candidate.box.left >= wallFrame.leftX + 4 &&
          candidate.box.right <= wallFrame.rightX - 4 &&
          candidate.box.bottom >= wallFrame.bottomY + 4 &&
          candidate.box.top <= wallFrame.topY - 4
      );
    const labelPosition = choosePdfLabelCandidate(
      candidates,
      occupied,
      obstacles
    );
    if (!labelPosition) return;
    occupied.push(labelPosition.box);
    labelPosition.leaderRoute!.slice(1).forEach((point, index) =>
      drawLine(
        page,
        labelPosition.leaderRoute![index]!,
        point,
        0.3,
        COLORS.subtle
      )
    );
    drawCenteredLabel(
      page,
      fonts,
      label,
      labelPosition.x,
      labelPosition.y
    );
    return;
  }

  const yMm =
    (dimension.corridorLoMm + dimension.corridorHiMm) / 2;
  const a = transform.point({ xMm: dimension.fromMm, yMm });
  const b = transform.point({ xMm: dimension.toMm, yMm });
  drawLine(page, a, b, lineWidth, lineColor);
  drawLine(
    page,
    { x: a.x, y: a.y - 2.5 },
    { x: a.x, y: a.y + 2.5 },
    lineWidth,
    lineColor
  );
  drawLine(
    page,
    { x: b.x, y: b.y - 2.5 },
    { x: b.x, y: b.y + 2.5 },
    lineWidth,
    lineColor
  );
  const available = Math.abs(b.x - a.x);
  const labelWidth = textWidth(fonts, label, DIMENSION_SIZE_PT, true);
  const midX = (a.x + b.x) / 2;
  const labelLeft = midX - labelWidth / 2 - 2;
  const labelRight = midX + labelWidth / 2 + 2;
  const fitsInGap = available >= labelWidth + 6;
  // A label wider than its gap must clear the flanking artworks anyway, so
  // it escapes to a lane just past the local footprints — on the side its
  // own line is on, so a stacked block's top-row dims read above the block
  // and bottom-row dims below it, and the position names the row.
  let baseY = a.y + 2;
  let offsets = [0, 8, 16, -8, -16, 24, -24];
  if (!fitsInGap) {
    let crowdTop = a.y + 6;
    let crowdBottom = a.y - 6;
    for (const box of obstacles) {
      if (box.right > labelLeft && box.left < labelRight) {
        crowdTop = Math.max(crowdTop, box.top);
        crowdBottom = Math.min(crowdBottom, box.bottom);
      }
    }
    let upward = a.y >= (crowdTop + crowdBottom) / 2;
    // Never leave the wall: a downward lane that would land on or below the
    // floor line (into the overall-width dimension) flips upward, and vice
    // versa — the wall interior is the only space these labels may use.
    if (!upward && crowdBottom - DIMENSION_SIZE_PT - 4 < wallFrame.bottomY + 4) {
      upward = true;
    } else if (upward && crowdTop + 3 + DIMENSION_SIZE_PT > wallFrame.topY - 4) {
      upward = false;
    }
    baseY = upward ? crowdTop + 3 : crowdBottom - DIMENSION_SIZE_PT - 4;
    offsets = upward ? [0, 9, 18, 27] : [0, -9, -18, -27];
  }
  const labelPosition = choosePdfLabelCandidate(
    offsets.map((offset) => {
      const y = baseY + offset;
      return {
        y,
        box: {
          left: labelLeft,
          right: labelRight,
          bottom: y - 1,
          top: y + DIMENSION_SIZE_PT + 3
        }
      };
    }),
    occupied,
    obstacles
  );
  if (!labelPosition) return;
  const labelY = labelPosition.y;
  occupied.push(labelPosition.box);
  if (Math.abs(labelY - a.y) > 3) {
    drawLine(
      page,
      { x: midX, y: a.y },
      { x: midX, y: labelY },
      0.3,
      COLORS.subtle
    );
  }
  drawCenteredLabel(page, fonts, label, midX, labelY);
}

function drawElevationDimensions(
  page: PDFPage,
  fonts: PdfFonts,
  scene: ElevationScene,
  transform: ElevationTransform,
  unit: DisplayUnit
) {
  const dimensions = deriveElevationSceneDimensions(scene);
  // Participant footprints are hard obstacles; the occupied list contains
  // only labels, so later annotations still prefer their own clear lanes.
  const obstacleBoxes = participantObstacleBoxes(scene, transform);
  const leaderObstacleBoxes = participantObstacleBoxes(scene, transform, 0);
  const occupiedLabels: PdfLabelBox[] = [];
  const wallBottomLeft = transform.point({ xMm: 0, yMm: 0 });
  const wallTopRight = transform.point({
    xMm: scene.wallLengthMm,
    yMm: scene.wallHeightMm
  });

  const overallY = wallBottomLeft.y - 16;
  drawLine(
    page,
    { x: wallBottomLeft.x, y: overallY },
    { x: wallTopRight.x, y: overallY },
    0.65,
    COLORS.muted
  );
  drawLine(
    page,
    { x: wallBottomLeft.x, y: overallY - 4 },
    { x: wallBottomLeft.x, y: overallY + 4 },
    0.65,
    COLORS.muted
  );
  drawLine(
    page,
    { x: wallTopRight.x, y: overallY - 4 },
    { x: wallTopRight.x, y: overallY + 4 },
    0.65,
    COLORS.muted
  );
  drawCenteredLabel(
    page,
    fonts,
    formatDocumentDimension(dimensions.overallWidthMm, unit),
    (wallBottomLeft.x + wallTopRight.x) / 2,
    overallY - 3
  );

  const overallX = wallBottomLeft.x - 17;
  drawLine(
    page,
    { x: overallX, y: wallBottomLeft.y },
    { x: overallX, y: wallTopRight.y },
    0.65,
    COLORS.muted
  );
  drawLine(
    page,
    { x: overallX - 4, y: wallBottomLeft.y },
    { x: overallX + 4, y: wallBottomLeft.y },
    0.65,
    COLORS.muted
  );
  drawLine(
    page,
    { x: overallX - 4, y: wallTopRight.y },
    { x: overallX + 4, y: wallTopRight.y },
    0.65,
    COLORS.muted
  );
  drawCenteredLabel(
    page,
    fonts,
    formatDocumentDimension(dimensions.overallHeightMm, unit),
    overallX,
    (wallBottomLeft.y + wallTopRight.y) / 2,
    DIMENSION_SIZE_PT,
    90
  );

  // Parallel gaps with the same printed value and the same facing edges (a
  // stacked row's top and bottom both offset equally from a flanking work,
  // or a 2x2 block's two column gaps) collapse to one printed dimension —
  // the second line restates the first. The widest corridor draws it.
  const uniqueGaps = new Map<string, GapDimension>();
  for (const gap of dimensions.neighborGaps) {
    const key = [
      gap.axis,
      formatDocumentDimension(gap.gapMm, unit),
      Math.round(gap.fromMm),
      Math.round(gap.toMm)
    ].join("|");
    const existing = uniqueGaps.get(key);
    if (
      !existing ||
      gap.corridorHiMm - gap.corridorLoMm >
        existing.corridorHiMm - existing.corridorLoMm
    ) {
      uniqueGaps.set(key, gap);
    }
  }

  const allGaps = [...uniqueGaps.values(), ...dimensions.boundaryGaps];
  allGaps.forEach((dimension) =>
    drawGapDimension(
      page,
      fonts,
      transform,
      dimension,
      unit,
      occupiedLabels,
      obstacleBoxes,
      leaderObstacleBoxes,
      {
        leftX: wallBottomLeft.x,
        rightX: wallTopRight.x,
        topY: wallTopRight.y,
        bottomY: wallBottomLeft.y
      }
    )
  );

  if (dimensions.centerHeights.length === 0) return;
  const datumX = wallTopRight.x + 12;
  const centerHeights = [...dimensions.centerHeights].sort(
    (a, b) => a.centerHeightMm - b.centerHeightMm
  );
  const highestDatumY = transform.point({
    xMm: scene.wallLengthMm,
    yMm: centerHeights[centerHeights.length - 1]!.centerHeightMm
  }).y;
  drawLine(
    page,
    { x: datumX, y: wallBottomLeft.y },
    { x: datumX, y: highestDatumY },
    0.4,
    COLORS.subtle
  );
  drawLine(
    page,
    { x: datumX - 3, y: wallBottomLeft.y },
    { x: datumX + 3, y: wallBottomLeft.y },
    0.4,
    COLORS.subtle
  );

  centerHeights.forEach((dimension, index) => {
    const datumY = transform.point({
      xMm: scene.wallLengthMm,
      yMm: dimension.centerHeightMm
    }).y;
    // Dashed leader: a work's boundary margin arrives at the wall edge at
    // this exact height (its own centerline), and a solid leader would fuse
    // the two into one apparent measurement running past the corner. The
    // dash break keeps the anchor without the fusion.
    drawLine(
      page,
      { x: wallTopRight.x + 3, y: datumY },
      { x: datumX + 3, y: datumY },
      0.3,
      COLORS.subtle,
      [2, 2]
    );
    const label = formatDocumentDimension(dimension.centerHeightMm, unit);
    const labelWidth = textWidth(fonts, label, DIMENSION_SIZE_PT, true);
    const labelX = datumX + 8 + labelWidth / 2;
    const position = choosePdfLabelCandidate(
      [0, 9, -9, 18, -18, 27, -27].map((offset) => {
        const y =
          datumY - DIMENSION_SIZE_PT / 2 + offset + (index % 2) * 0.5;
        return {
          x: labelX,
          y,
          box: {
            left: labelX - labelWidth / 2 - 2,
            right: labelX + labelWidth / 2 + 2,
            bottom: y - 1,
            top: y + DIMENSION_SIZE_PT + 3
          }
        };
      }),
      occupiedLabels,
      obstacleBoxes
    );
    if (!position) return;
    occupiedLabels.push(position.box);
    const labelMidY = position.y + DIMENSION_SIZE_PT / 2;
    if (Math.abs(labelMidY - datumY) > 2) {
      drawLine(
        page,
        { x: datumX + 3, y: datumY },
        { x: position.box.left, y: labelMidY },
        0.3,
        COLORS.subtle
      );
    }
    drawCenteredLabel(
      page,
      fonts,
      label,
      position.x,
      position.y
    );
  });
}

async function loadPdfFonts(
  pdf: PDFDocument,
  fontBytes?: CreateDocumentPdfInput["fontBytes"]
): Promise<PdfFonts> {
  if (fontBytes) {
    pdf.registerFontkit(fontkit);
    const regularBytes =
      fontBytes instanceof Uint8Array ? fontBytes : fontBytes.regular;
    const strongBytes =
      fontBytes instanceof Uint8Array ? undefined : fontBytes.strong;
    const regular = await pdf.embedFont(regularBytes, { subset: true });
    const strong = strongBytes
      ? await pdf.embedFont(strongBytes, { subset: true })
      : regular;
    return {
      regular,
      strong,
      supportedCodePoints: new Set(regular.getCharacterSet()),
      substitutedUnsupportedText: false
    };
  }
  const [regular, strong] = await Promise.all([
    pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold)
  ]);
  return {
    regular,
    strong,
    supportedCodePoints: new Set(regular.getCharacterSet()),
    substitutedUnsupportedText: false
  };
}

async function embedBlob(
  pdf: PDFDocument,
  blob: Blob,
  options?: PdfImageOptions
): Promise<PDFImage> {
  const prepared = await prepareImageForPdf(blob, options);
  return prepared.format === "png"
    ? pdf.embedPng(prepared.bytes)
    : pdf.embedJpg(prepared.bytes);
}

// Raster budget for an artwork image from the rect it actually prints in:
// 300dpi at the drawn size with headroom for a slightly larger appearance on
// another wall (the first draw sizes the shared embed). Most works print at
// an inch or two, so this lands far below the global 1400px ceiling.
const ARTWORK_PRINT_DPI = 300;
function artworkImageBudgetPx(drawnRect: { width: number; height: number }): number {
  const drawnPt = Math.max(drawnRect.width, drawnRect.height);
  const target = Math.ceil(drawnPt * (ARTWORK_PRINT_DPI / 72) * 1.25);
  return Math.min(1400, Math.max(220, target));
}

function warningName(artwork: Artwork | undefined, fallback: string): string {
  return (
    artwork?.title?.trim() ||
    artwork?.accessionNumber?.trim() ||
    artwork?.artist?.trim() ||
    fallback
  );
}

export async function createDocumentPdf(
  input: CreateDocumentPdfInput
): Promise<CreateDocumentPdfResult> {
  const exportedAt = input.exportedAt ?? new Date();
  const locale = input.locale ?? "en-US";
  const artworksById = new Map(input.artworks.map((artwork) => [artwork.id, artwork]));
  const manifest = deriveDocumentPageManifest(
    input.project,
    input.settings,
    artworksById
  );
  const pdf = await PDFDocument.create();
  const fonts = await loadPdfFonts(pdf, input.fontBytes);
  const warnings = new Set<string>();
  const imageCache = new Map<string, Promise<EmbeddedArtworkImage>>();

  pdf.setTitle(input.project.title);
  pdf.setCreator("Sightlines");
  pdf.setLanguage(locale);
  pdf.setCreationDate(exportedAt);
  pdf.setModificationDate(exportedAt);

  const artworkImage = (
    artwork: Artwork | undefined,
    maxDimensionPx: number
  ): Promise<EmbeddedArtworkImage> => {
    if (!artwork?.assetId) return Promise.resolve({ status: "absent" });
    const cached = imageCache.get(artwork.assetId);
    if (cached) return cached;
    const pending = (async (): Promise<EmbeddedArtworkImage> => {
      if (!input.getAsset || !input.getBlob) return { status: "missing" };
      try {
        const asset = await input.getAsset(artwork.assetId!);
        const blob = await input.getBlob(asset.displayKey);
        return {
          status: "ready",
          image: await embedBlob(pdf, blob, { maxDimensionPx })
        };
      } catch {
        return { status: "missing" };
      }
    })();
    imageCache.set(artwork.assetId, pending);
    return pending;
  };

  const fullPlanScene = buildPlanScene(input.project, { artworksById });

  for (const manifestPage of manifest) {
    const size = getPageSizePt(input.settings.paperSize, manifestPage.orientation);
    const page = pdf.addPage([size.widthPt, size.heightPt]);
    drawHeader(
      page,
      fonts,
      input.project.title,
      manifestPage.title,
      exportedAt,
      locale
    );
    const baseRect = getPageDrawingRectPt(
      input.settings.paperSize,
      manifestPage.orientation
    );

    if (manifestPage.kind === "overview") {
      const transform = drawPlanScene(
        page,
        fullPlanScene,
        manifestPage.boundsMm,
        insetRect(baseRect, DRAWING_INSET_PT),
        input.project.unit,
        input.settings.grid
      );
      drawScaleBar(page, fonts, input.project.unit, transform.scalePtPerMm);
      continue;
    }

    if (manifestPage.kind === "room-plan") {
      const scene = roomScene(fullPlanScene, input.project, manifestPage.roomId);
      const transform = drawPlanScene(
        page,
        scene,
        manifestPage.boundsMm,
        insetRect(
          baseRect,
          input.settings.dimensions
            ? DIMENSION_DRAWING_INSET_PT
            : DRAWING_INSET_PT
        ),
        input.project.unit,
        input.settings.grid
      );
      if (input.settings.dimensions && scene.rooms[0]) {
        drawRoomWallDimensions(
          page,
          fonts,
          scene.rooms[0],
          transform,
          input.project.unit
        );
      }
      drawScaleBar(page, fonts, input.project.unit, transform.scalePtPerMm);
      continue;
    }

    if (manifestPage.kind === "elevation") {
      const placement = input.project.floor.rooms.find(
        (candidate) => candidate.roomId === manifestPage.roomId
      );
      const wall = placement
        ? getRoomPlaceableWalls(placement.room).find(
            (candidate) => candidate.id === manifestPage.wallId
          )
        : undefined;
      if (!placement || !wall) continue;
      // Freestanding cases in this room project onto the wall face as ghost
      // outlines. The wall's floor-space endpoints lift its room-local geometry
      // by the placement offset; the room polygon filters out cases in other
      // rooms (the builder then drops any that don't overlap this wall's extent).
      const roomPolygonMm = placement.room.vertices.map((vertex) => ({
        xMm: vertex.xMm + placement.offsetXMm,
        yMm: vertex.yMm + placement.offsetYMm
      }));
      const elevationFloorCases = input.project.floorObjects.filter(
        (object): object is CaseFloorObject =>
          object.kind === "case" &&
          isPointInPolygon({ xMm: object.xMm, yMm: object.yMm }, roomPolygonMm)
      );
      const scene = buildElevationScene(input.project.wallObjects, {
        wallId: wall.id,
        wallLengthMm: wall.lengthMm,
        wallHeightMm: wall.heightMm,
        centerlineMm:
          wall.defaultCenterlineHeightMm ??
          input.project.defaultCenterlineHeightMm,
        artworksById,
        floorCases: elevationFloorCases,
        wallStartFloorMm: {
          xMm: wall.start.xMm + placement.offsetXMm,
          yMm: wall.start.yMm + placement.offsetYMm
        },
        wallEndFloorMm: {
          xMm: wall.end.xMm + placement.offsetXMm,
          yMm: wall.end.yMm + placement.offsetYMm
        }
      });
      const drawingRect = input.settings.dimensions
        ? insetRectByEdges(baseRect, ELEVATION_DIMENSION_INSETS_PT)
        : insetRect(baseRect, DRAWING_INSET_PT);
      const fit = fitBoundsToRect(manifestPage.boundsMm, drawingRect);
      const transform = createElevationTransform(manifestPage.boundsMm, fit);

      page.drawRectangle({
        x: fit.xPt,
        y: fit.yPt,
        width: fit.widthPt,
        height: fit.heightPt,
        color: COLORS.white,
        borderColor: COLORS.muted,
        borderWidth: 0.75
      });
      if (input.settings.grid) {
        drawElevationGrid(page, scene, transform, input.project.unit);
      }
      drawLine(
        page,
        transform.point({ xMm: 0, yMm: 0 }),
        transform.point({ xMm: scene.wallLengthMm, yMm: 0 }),
        1.4,
        COLORS.ink
      );

      // Freestanding-case ghosts first, behind the wall objects.
      for (const ghost of scene.floorCaseGhosts) {
        drawElevationFloorCaseGhost(page, transform, ghost);
      }

      let anonymousOrdinal = 0;
      for (const entry of scene.artworks) {
        const artwork = entry.artwork;
        const framing = effectiveFraming(artwork);
        const imageRectSvg = getArtworkRectSvg(
          scene.wallHeightMm,
          entry.centerMm,
          entry.sizeMm
        );
        const imageYUp =
          scene.wallHeightMm -
          imageRectSvg.yMm -
          imageRectSvg.heightMm;
        const matBand = framing.matWidthMm ?? 0;
        const frameBand = framing.frame?.widthMm ?? 0;
        const matRect = elevationRect(
          transform,
          imageRectSvg.xMm - matBand,
          imageYUp - matBand,
          imageRectSvg.widthMm + matBand * 2,
          imageRectSvg.heightMm + matBand * 2
        );
        const outerRect = {
          x: matRect.x - frameBand * transform.scalePtPerMm,
          y: matRect.y - frameBand * transform.scalePtPerMm,
          width: matRect.width + frameBand * 2 * transform.scalePtPerMm,
          height: matRect.height + frameBand * 2 * transform.scalePtPerMm
        };
        const imageRect = elevationRect(
          transform,
          imageRectSvg.xMm,
          imageYUp,
          imageRectSvg.widthMm,
          imageRectSvg.heightMm
        );

        if (frameBand > 0 && framing.frame) {
          page.drawRectangle({
            ...outerRect,
            color: colorFromHex(FRAME_FINISH_HEX[framing.frame.finish]),
            borderColor: colorFromHex(FRAME_EDGE_HAIRLINE_HEX[framing.frame.finish]),
            borderWidth: 0.45
          });
        }
        if (matBand > 0) {
          page.drawRectangle({
            ...matRect,
            color: colorFromHex(MAT_FILL_HEX),
            borderColor: colorFromHex(MAT_BEVEL_HAIRLINE_HEX),
            borderWidth: 0.45
          });
        }

        const embedded = await artworkImage(
          artwork,
          artworkImageBudgetPx(imageRect)
        );
        if (embedded.status === "ready") {
          page.drawImage(embedded.image, imageRectInside(imageRect, embedded.image));
          page.drawRectangle({
            ...imageRect,
            borderColor: COLORS.muted,
            borderWidth: 0.65
          });
        } else {
          if (!artwork?.title && !artwork?.accessionNumber && !artwork?.artist) {
            anonymousOrdinal += 1;
          }
          const label = artworkPlaceholderLabel(
            artwork,
            Math.max(1, anonymousOrdinal)
          );
          drawArtworkPlaceholder(
            page,
            fonts,
            imageRect,
            label,
            embedded.status === "missing"
          );
          if (embedded.status === "missing") {
            warnings.add(
              `Image unavailable for ${warningName(
                artwork,
                `work ${entry.object.id}`
              )}.`
            );
          }
        }
        page.drawRectangle({
          ...outerRect,
          borderColor: COLORS.muted,
          borderWidth: 0.75
        });
      }

      for (const opening of scene.openings) {
        drawElevationOpening(page, transform, opening);
      }
      for (const wallText of scene.wallTexts) {
        drawElevationWallText(page, transform, wallText);
      }
      for (const displayCase of scene.cases) {
        drawElevationCase(page, transform, displayCase);
      }
      if (input.settings.dimensions) {
        drawElevationDimensions(
          page,
          fonts,
          scene,
          transform,
          input.project.unit
        );
      }
      drawScaleBar(page, fonts, input.project.unit, transform.scalePtPerMm);
      continue;
    }

    const savedView = input.project.savedViews?.find(
      (view) => view.id === manifestPage.savedViewId
    );
    const renderRect = insetRect(baseRect, DRAWING_INSET_PT);
    // A failed 3D render degrades to a placeholder page instead of discarding
    // the whole document, matching the missing-artwork-image behavior.
    let image: PDFImage | null = null;
    if (savedView && input.renderSavedView) {
      const renderScale = THREE_D_RENDER_DPI / 72;
      const renderPx = {
        widthPx: Math.max(1, Math.round(renderRect.widthPt * renderScale)),
        heightPx: Math.max(1, Math.round(renderRect.heightPt * renderScale))
      };
      try {
        const blob = await input.renderSavedView(savedView, renderPx);
        // Already rendered at exactly the needed resolution; preferCompact
        // routes the canvas PNG through the opaque->JPEG re-encode.
        image = await embedBlob(pdf, blob, {
          maxDimensionPx: Math.max(renderPx.widthPx, renderPx.heightPx),
          preferCompact: true
        });
      } catch {
        image = null;
      }
    }
    const savedViewRect = {
      x: renderRect.xPt,
      y: renderRect.yPt,
      width: renderRect.widthPt,
      height: renderRect.heightPt
    };
    if (image) {
      page.drawImage(image, imageRectInside(savedViewRect, image));
    } else {
      const title = savedView?.title ?? manifestPage.title;
      drawArtworkPlaceholder(page, fonts, savedViewRect, title, true);
      warnings.add(`Saved view "${title}" could not be rendered.`);
    }
  }

  if (fonts.substitutedUnsupportedText) {
    warnings.add(
      "Some text used fallback characters because the PDF font did not include every glyph."
    );
  }
  const bytes = await pdf.save();
  return {
    bytes,
    pageCount: manifest.length,
    warnings: [...warnings],
    manifest
  };
}
