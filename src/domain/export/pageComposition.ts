import type { Artwork, Project, SavedView } from "../project";
import { resolveSavedViewRoomLabel } from "../savedViews";
import {
  buildPlanScene,
  type PlanScene,
  type PlanSceneRoom
} from "../scene2d/planScene";
import type { PlanRect } from "../geometry/planObjects";
import { getRoomPlaceableWalls } from "../geometry/placeableWalls";
import type {
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

export function getPlanSceneBounds(scene: PlanScene): DocumentBoundsMm {
  const points = [
    ...scene.rooms.flatMap((room) => room.polygonMm),
    ...scene.partitions.flatMap((partition) => planRectCorners(partition.rect)),
    ...scene.wallObjects.flatMap((entry) => planRectCorners(entry.renderedRect)),
    ...scene.floorObjects.flatMap((entry) => planRectCorners(entry.rect))
  ];
  return boundsFromPoints(points);
}

export function getRoomPlanBounds(room: PlanSceneRoom): DocumentBoundsMm {
  return expandDocumentBounds(
    boundsFromPoints(room.polygonMm),
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
      const boundsMm = getRoomPlanBounds(room);
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
  unit: Project["unit"],
  targetWidthPt = 96
): number {
  const candidates =
    unit === "cm" || unit === "m"
      ? METRIC_SCALE_BAR_MM
      : IMPERIAL_SCALE_BAR_MM;
  const targetMm = targetWidthPt / Math.max(scalePtPerMm, 1e-9);
  const atOrBelow = candidates.filter((candidate) => candidate <= targetMm);
  return atOrBelow[atOrBelow.length - 1] ?? candidates[0];
}
