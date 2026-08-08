import type { Artwork, Project, SavedView } from "../project";
import { resolveSavedViewRoomLabel } from "../savedViews";
import {
  buildPlanScene,
  type PlanScene,
  type PlanSceneRoom,
  type PlanSceneWallObject
} from "../scene2d/planScene";
import type { DoorGlyphBoundsMm } from "../geometry/doorGlyphs";
import type { PlanRect } from "../geometry/planObjects";
import { getRoomPlaceableWalls } from "../geometry/placeableWalls";
import type {
  DocumentExportUnit,
  DocumentPaperSize,
  EffectiveDocumentSettings
} from "./documentSettings";

export type DocumentOrientation = "portrait" | "landscape";

export type DocumentBoundsMm = {
  minXMm: number;
  minYMm: number;
  maxXMm: number;
  maxYMm: number;
  widthMm: number;
  heightMm: number;
};

export type DocumentPageManifest =
  | {
      kind: "overview";
      title: "Overview";
      boundsMm: DocumentBoundsMm;
      orientation: DocumentOrientation;
    }
  | {
      kind: "room-plan";
      roomId: string;
      title: string;
      boundsMm: DocumentBoundsMm;
      orientation: DocumentOrientation;
    }
  | {
      kind: "elevation";
      roomId: string;
      wallId: string;
      title: string;
      boundsMm: DocumentBoundsMm;
      orientation: DocumentOrientation;
    }
  | {
      kind: "three-d";
      savedViewId: string;
      title: string;
      orientation: DocumentOrientation;
    };

export type PageSizePt = {
  widthPt: number;
  heightPt: number;
};

export type PageRectPt = {
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
};

export type FitToPageResult = {
  scalePtPerMm: number;
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
};

const POINTS_PER_INCH = 72;
const MM_PER_INCH = 25.4;
const pointsFromMm = (mm: number) => (mm / MM_PER_INCH) * POINTS_PER_INCH;

export const DOCUMENT_PAGE_MARGIN_PT = 36;
export const DOCUMENT_HEADER_HEIGHT_PT = 50;
export const DOCUMENT_FOOTER_HEIGHT_PT = 38;
export const ROOM_PLAN_CROP_MARGIN_MM = 300;
export const THREE_D_PAGE_ASPECT_RATIO = 4 / 3;

export const PAPER_SIZE_PT: Record<DocumentPaperSize, PageSizePt> = {
  a4: { widthPt: pointsFromMm(210), heightPt: pointsFromMm(297) },
  letter: { widthPt: 8.5 * POINTS_PER_INCH, heightPt: 11 * POINTS_PER_INCH },
  a3: { widthPt: pointsFromMm(297), heightPt: pointsFromMm(420) },
  tabloid: { widthPt: 11 * POINTS_PER_INCH, heightPt: 17 * POINTS_PER_INCH }
};

function makeBounds(
  minXMm: number,
  minYMm: number,
  maxXMm: number,
  maxYMm: number
): DocumentBoundsMm {
  const safeMaxX = maxXMm > minXMm ? maxXMm : minXMm + 1;
  const safeMaxY = maxYMm > minYMm ? maxYMm : minYMm + 1;
  return {
    minXMm,
    minYMm,
    maxXMm: safeMaxX,
    maxYMm: safeMaxY,
    widthMm: safeMaxX - minXMm,
    heightMm: safeMaxY - minYMm
  };
}

export function expandDocumentBounds(
  bounds: DocumentBoundsMm,
  marginMm: number
): DocumentBoundsMm {
  return makeBounds(
    bounds.minXMm - marginMm,
    bounds.minYMm - marginMm,
    bounds.maxXMm + marginMm,
    bounds.maxYMm + marginMm
  );
}

export function boundsFromPoints(
  points: readonly { xMm: number; yMm: number }[]
): DocumentBoundsMm {
  if (points.length === 0) return makeBounds(0, 0, 1, 1);
  return makeBounds(
    Math.min(...points.map((point) => point.xMm)),
    Math.min(...points.map((point) => point.yMm)),
    Math.max(...points.map((point) => point.xMm)),
    Math.max(...points.map((point) => point.yMm))
  );
}

export function planRectCorners(rect: PlanRect): {
  xMm: number;
  yMm: number;
}[] {
  const angleRad = (rect.angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const halfWidth = rect.widthMm / 2;
  const halfDepth = rect.depthMm / 2;

  return [
    { xMm: -halfWidth, yMm: -halfDepth },
    { xMm: halfWidth, yMm: -halfDepth },
    { xMm: halfWidth, yMm: halfDepth },
    { xMm: -halfWidth, yMm: halfDepth }
  ].map((point) => ({
    xMm: rect.centerXMm + point.xMm * cos - point.yMm * sin,
    yMm: rect.centerYMm + point.xMm * sin + point.yMm * cos
  }));
}

// The floor-space corners of a glyph's LOCAL-CENTERED mm box (doorGlyphs'
// `boundsMm`) carried by a plan rect. planRectCorners does the same rotation
// for the rect's own half-extents; a glyph box is deliberately NOT centered on
// the rect (a swing reaches out to one side only), so its corners are its own
// min/max pairs rather than ±half sizes. Same center/angle mapping as
// planRectWorldPoint, which is what the PDF and the preview draw the glyph
// with — so the fitted page and the drawn arc can never disagree.
export function planRectLocalBoundsCorners(
  rect: PlanRect,
  bounds: DoorGlyphBoundsMm
): { xMm: number; yMm: number }[] {
  const angleRad = (rect.angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  return [
    { xMm: bounds.minXMm, yMm: bounds.minYMm },
    { xMm: bounds.maxXMm, yMm: bounds.minYMm },
    { xMm: bounds.maxXMm, yMm: bounds.maxYMm },
    { xMm: bounds.minXMm, yMm: bounds.maxYMm }
  ].map((point) => ({
    xMm: rect.centerXMm + point.xMm * cos - point.yMm * sin,
    yMm: rect.centerYMm + point.xMm * sin + point.yMm * cos
  }));
}

// Paint points contributed by hinged doors' swing glyphs. The swing is the one
// glyph in the app that paints OUTSIDE its object's own rect — a leaf plus its
// quarter-circle reaches a full door width off the wall — so a page fitted
// from `renderedRect` alone crops a 915 mm outward swing on an exterior wall
// clean off the sheet. Paint/export bounds therefore union it; INTERACTION
// bounds (plan-object-hit, the marquee's planRectIntersectsRect) deliberately
// do not, and stay the thin opening rect (see PlanObject.tsx).
//
// renderedRect, not restRect, only because it is what the surrounding bounds
// code already holds: for a door the two share a center and an angle (the
// viewer-side offset applies to artwork/case only, and the min-depth clamp
// grows depth symmetrically about the center), and this reads nothing else
// from the rect. The glyph itself was built from restRect's true model
// geometry upstream, never from a clamped depth.
function doorSwingPointsMm(
  wallObjects: readonly PlanSceneWallObject[]
): { xMm: number; yMm: number }[] {
  return wallObjects.flatMap((entry) =>
    entry.doorSwing
      ? planRectLocalBoundsCorners(entry.renderedRect, entry.doorSwing.boundsMm)
      : []
  );
}

export function getPlanSceneBounds(scene: PlanScene): DocumentBoundsMm {
  const points = [
    ...scene.rooms.flatMap((room) => room.polygonMm),
    ...scene.partitions.flatMap((partition) => planRectCorners(partition.rect)),
    ...scene.wallObjects.flatMap((entry) => planRectCorners(entry.renderedRect)),
    ...doorSwingPointsMm(scene.wallObjects),
    ...scene.floorObjects.flatMap((entry) => planRectCorners(entry.rect))
  ];
  return boundsFromPoints(points);
}

// Structure-only bounds (room polygons alone), excluding wall/floor object
// rects. Wall-mounted objects straddle the wall centerline and can push
// getPlanSceneBounds a few mm past the outer wall — fine for page fit, but
// wrong as the grid's extent (it would leave cut-off grid stubs poking past
// the wall line). Falls back to the object-inflated bounds when there are no
// rooms to measure.
//
// Door swings are excluded here for exactly the same reason, and even more
// strongly: a swing reaches a full door width into (or out of) the room, so
// unioning it would drag the grid a metre past the wall line. This is the GRID
// extent, not the paint extent — growing it is never the fix for a clipped
// arc; getPlanSceneBounds (which drives the fit) already covers that.
export function getPlanStructureBounds(scene: PlanScene): DocumentBoundsMm {
  const points = scene.rooms.flatMap((room) => room.polygonMm);
  if (points.length === 0) return getPlanSceneBounds(scene);
  return boundsFromPoints(points);
}

// A room page crops to the room polygon plus a fixed model-space margin
// (export-spec §9.3). `wallObjects` is the WHOLE scene's list — filtered here
// to this room's own walls, the same membership roomScene uses to decide what
// the page draws — so a hinged door's swing is fitted on the page that will
// actually paint it. Without it a door swinging OUT of an exterior wall lands
// in the crop margin or past the sheet edge: 915 mm of swing against a 300 mm
// margin. Defaulted to [] so a caller that only wants the polygon crop (and
// draws no objects) keeps the old behavior verbatim.
export function getRoomPlanBounds(
  room: PlanSceneRoom,
  wallObjects: readonly PlanSceneWallObject[] = []
): DocumentBoundsMm {
  const roomWallIds = new Set(
    getRoomPlaceableWalls(room.placement.room).map((wall) => wall.id)
  );
  // The margin expands the UNION, not just the polygon: a swing that pokes out
  // of the room keeps the same breathing room at the page edge that the room's
  // own walls get, and a swing already inside the polygon changes nothing.
  return expandDocumentBounds(
    boundsFromPoints([
      ...room.polygonMm,
      ...doorSwingPointsMm(
        wallObjects.filter((entry) => roomWallIds.has(entry.object.wallId))
      )
    ]),
    ROOM_PLAN_CROP_MARGIN_MM
  );
}

export function getPageSizePt(
  paperSize: DocumentPaperSize,
  orientation: DocumentOrientation
): PageSizePt {
  const paper = PAPER_SIZE_PT[paperSize];
  return orientation === "portrait"
    ? paper
    : { widthPt: paper.heightPt, heightPt: paper.widthPt };
}

export function getPageDrawingRectPt(
  paperSize: DocumentPaperSize,
  orientation: DocumentOrientation
): PageRectPt {
  const page = getPageSizePt(paperSize, orientation);
  return {
    xPt: DOCUMENT_PAGE_MARGIN_PT,
    yPt: DOCUMENT_PAGE_MARGIN_PT + DOCUMENT_FOOTER_HEIGHT_PT,
    widthPt: page.widthPt - DOCUMENT_PAGE_MARGIN_PT * 2,
    heightPt:
      page.heightPt -
      DOCUMENT_PAGE_MARGIN_PT * 2 -
      DOCUMENT_HEADER_HEIGHT_PT -
      DOCUMENT_FOOTER_HEIGHT_PT
  };
}

export function fitBoundsToRect(
  bounds: DocumentBoundsMm,
  rect: PageRectPt
): FitToPageResult {
  const scalePtPerMm = Math.min(
    rect.widthPt / bounds.widthMm,
    rect.heightPt / bounds.heightMm
  );
  const widthPt = bounds.widthMm * scalePtPerMm;
  const heightPt = bounds.heightMm * scalePtPerMm;
  return {
    scalePtPerMm,
    widthPt,
    heightPt,
    xPt: rect.xPt + (rect.widthPt - widthPt) / 2,
    yPt: rect.yPt + (rect.heightPt - heightPt) / 2
  };
}

function orientationScale(
  paperSize: DocumentPaperSize,
  orientation: DocumentOrientation,
  aspectRatio: number
): number {
  const rect = getPageDrawingRectPt(paperSize, orientation);
  const modelWidth = Math.max(aspectRatio, 1e-9);
  return Math.min(rect.widthPt / modelWidth, rect.heightPt);
}

export function chooseDocumentOrientation(
  paperSize: DocumentPaperSize,
  aspectRatio: number
): DocumentOrientation {
  const portraitScale = orientationScale(paperSize, "portrait", aspectRatio);
  const landscapeScale = orientationScale(paperSize, "landscape", aspectRatio);
  return landscapeScale > portraitScale ? "landscape" : "portrait";
}

export function composeSavedViewTitle(
  project: Project,
  savedView: SavedView
): string {
  const roomLabel = resolveSavedViewRoomLabel(project, savedView);
  return roomLabel ? `${roomLabel} · ${savedView.title}` : savedView.title;
}

export function deriveDocumentPageManifest(
  project: Project,
  settings: EffectiveDocumentSettings,
  artworksById: ReadonlyMap<string, Artwork> = new Map()
): DocumentPageManifest[] {
  const planScene = buildPlanScene(project, { artworksById });
  const pages: DocumentPageManifest[] = [];

  if (settings.sections.overview) {
    const boundsMm = getPlanSceneBounds(planScene);
    pages.push({
      kind: "overview",
      title: "Overview",
      boundsMm,
      orientation: chooseDocumentOrientation(
        settings.paperSize,
        boundsMm.widthMm / boundsMm.heightMm
      )
    });
  }

  if (settings.sections.roomPlans) {
    for (const roomChoice of settings.rooms) {
      if (!roomChoice.planIncluded) continue;
      const room = planScene.rooms.find(
        (candidate) => candidate.roomId === roomChoice.roomId
      );
      if (!room) continue;
      const boundsMm = getRoomPlanBounds(room, planScene.wallObjects);
      pages.push({
        kind: "room-plan",
        roomId: roomChoice.roomId,
        title: roomChoice.name,
        boundsMm,
        orientation: chooseDocumentOrientation(
          settings.paperSize,
          boundsMm.widthMm / boundsMm.heightMm
        )
      });
    }
  }

  if (settings.sections.elevations) {
    for (const roomChoice of settings.rooms) {
      const placement = project.floor.rooms.find(
        (candidate) => candidate.roomId === roomChoice.roomId
      );
      if (!placement) continue;
      const wallsById = new Map(
        getRoomPlaceableWalls(placement.room).map((wall) => [wall.id, wall])
      );
      for (const wallChoice of roomChoice.walls) {
        if (!wallChoice.included) continue;
        const wall = wallsById.get(wallChoice.wallId);
        if (!wall) continue;
        const boundsMm = makeBounds(0, 0, wall.lengthMm, wall.heightMm);
        pages.push({
          kind: "elevation",
          roomId: roomChoice.roomId,
          wallId: wallChoice.wallId,
          title: `${roomChoice.name} · ${wallChoice.name}`,
          boundsMm,
          orientation: chooseDocumentOrientation(
            settings.paperSize,
            boundsMm.widthMm / boundsMm.heightMm
          )
        });
      }
    }
  }

  if (settings.sections.threeDViews) {
    for (const savedViewChoice of settings.savedViews) {
      if (!savedViewChoice.valid || !savedViewChoice.included) continue;
      pages.push({
        kind: "three-d",
        savedViewId: savedViewChoice.view.id,
        title: composeSavedViewTitle(project, savedViewChoice.view),
        orientation: chooseDocumentOrientation(
          settings.paperSize,
          THREE_D_PAGE_ASPECT_RATIO
        )
      });
    }
  }

  return pages;
}

const METRIC_SCALE_BAR_MM = [
  10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000
];
const IMPERIAL_SCALE_BAR_MM = [
  25.4,
  76.2,
  152.4,
  304.8,
  609.6,
  1_524,
  3_048,
  6_096,
  15_240,
  30_480
];

export function chooseScaleBarLengthMm(
  scalePtPerMm: number,
  unit: DocumentExportUnit,
  targetWidthPt = 96
): number {
  const candidates =
    unit === "cm" || unit === "m" || unit === "mm"
      ? METRIC_SCALE_BAR_MM
      : IMPERIAL_SCALE_BAR_MM;
  const targetMm = targetWidthPt / Math.max(scalePtPerMm, 1e-9);
  const atOrBelow = candidates.filter((candidate) => candidate <= targetMm);
  return atOrBelow[atOrBelow.length - 1] ?? candidates[0];
}
