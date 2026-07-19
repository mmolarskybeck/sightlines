import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  PDFImage,
  PDFPage,
  StandardFonts
} from "pdf-lib";
import {
  FRAME_EDGE_HAIRLINE_HEX,
  FRAME_FINISH_HEX,
  MAT_BEVEL_HAIRLINE_HEX,
  MAT_FILL_HEX,
  effectiveFraming,
  getArtworkRingRectsMm
} from "../../domain/framing";
import { getRoomPlaceableWalls } from "../../domain/geometry/placeableWalls";
import { isPointInPolygon } from "../../domain/geometry/polygon";
import type {
  Artwork,
  Asset,
  CaseFloorObject,
  Project,
  SavedView
} from "../../domain/project";
import {
  buildElevationScene,
  getArtworkRectSvg
} from "../../domain/scene2d/elevationScene";
import { buildPlanScene } from "../../domain/scene2d/planScene";
import type { EffectiveDocumentSettings } from "../../domain/export/documentSettings";
import {
  deriveDocumentPageManifest,
  fitBoundsToRect,
  getPageDrawingRectPt,
  getPageSizePt,
  getPlanStructureBounds,
  type DocumentPageManifest
} from "../../domain/export/pageComposition";
import { prepareImageForPdf, type PdfImageOptions } from "./pdfImage";
import {
  COLORS,
  colorFromHex,
  drawLine,
  drawScaleBar,
  drawText,
  insetRect,
  insetRectByEdges,
  textWidth,
  formatDocumentDimension,
  type PdfFonts
} from "./pdf/primitives";
import {
  createElevationTransform,
  imageRectInside,
  elevationRect
} from "./pdf/transforms";
import {
  drawPlanScene,
  roomScene,
  drawRoomWallDimensions,
  resolveWallDimensionOutwardMm
} from "./pdf/planPage";
import {
  drawElevationGrid,
  drawElevationOpening,
  drawElevationWallText,
  drawElevationCase,
  drawElevationFloorCaseGhost,
  drawArtworkPlaceholder
} from "./pdf/elevationPage";
import { drawElevationDimensions } from "./pdf/dimensionLines";

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

type EmbeddedArtworkImage =
  | { status: "ready"; image: PDFImage }
  | { status: "absent" }
  | { status: "missing" };

const HEADER_PROJECT_SIZE_PT = 9;
const HEADER_TITLE_SIZE_PT = 14;
const HEADER_DATE_SIZE_PT = 8;
const DRAWING_INSET_PT = 22;
const DIMENSION_DRAWING_INSET_PT = 38;
const ELEVATION_DIMENSION_INSETS_PT = {
  left: 30,
  right: 72,
  bottom: 34,
  top: 22
};
const THREE_D_RENDER_DPI = 144;

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
      // Grid stops at the walls (structure bounds); the fit still uses the
      // object-inflated manifest bounds so protruding wall objects aren't clipped.
      const transform = drawPlanScene(
        page,
        fullPlanScene,
        manifestPage.boundsMm,
        insetRect(baseRect, DRAWING_INSET_PT),
        input.project.unit,
        input.settings.grid,
        getPlanStructureBounds(fullPlanScene)
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
        const { matRect: matRectMm, outerRect: outerRectMm } = getArtworkRingRectsMm(
          {
            xMm: imageRectSvg.xMm,
            yMm: imageYUp,
            widthMm: imageRectSvg.widthMm,
            heightMm: imageRectSvg.heightMm
          },
          matBand,
          frameBand
        );
        const matRect = elevationRect(
          transform,
          matRectMm.xMm,
          matRectMm.yMm,
          matRectMm.widthMm,
          matRectMm.heightMm
        );
        const outerRect = elevationRect(
          transform,
          outerRectMm.xMm,
          outerRectMm.yMm,
          outerRectMm.widthMm,
          outerRectMm.heightMm
        );
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

export { formatDocumentDimension, resolveWallDimensionOutwardMm };
