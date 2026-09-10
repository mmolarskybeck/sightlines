import { useEffect, useMemo, useState } from "react";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import type { Artwork, Project } from "../../../domain/project";
import type { EffectiveDocumentSettings } from "../../../domain/export/documentSettings";
import {
  buildPlanScene,
  type PlanScene
} from "../../../domain/scene2d/planScene";
import {
  DOCUMENT_PAGE_MARGIN_PT,
  fitBoundsToRect,
  getPageSizePt,
  getPlanSceneBounds,
  type DocumentOrientation,
  type DocumentPageManifest
} from "../../../domain/export/pageComposition";
import { Button } from "../ui/button";
import {
  clampPageIndex,
  derivePreviewPages,
  previewPageCaption,
  type PreviewPage
} from "./exportPreviewModel";
import { FILL_WEAK, INK, MUTED } from "../../export/preview/previewStyle";
import {
  drawingRectPt,
  elevationTransform,
  planTransform
} from "../../export/preview/previewTransforms";
import { planPageMarks, roomScenePreview } from "../../export/preview/planPageMarks";
import {
  buildElevationForPage,
  elevationPageMarks
} from "../../export/preview/elevationPageMarks";

export { planTransform } from "../../export/preview/previewTransforms";
export { planDimensionMarks } from "../../export/preview/planPageMarks";

// Page-card sizing: exact aspect ratio, width-driven, but never taller than
// ~a third of the viewport — the preview is pinned above the scrolling
// controls, so its height budget has to leave the Options group room on
// short screens. Computing width from the height cap (instead of max-height)
// keeps the card's border hugging the page proportions exactly.
function previewCardStyle(widthPt: number, heightPt: number) {
  const ratio = widthPt / heightPt;
  return {
    aspectRatio: `${widthPt} / ${heightPt}`,
    width: `min(100%, calc(min(280px, 22dvh) * ${ratio.toFixed(4)}))`
  };
}

type ExportPdfPreviewProps = {
  project: Project;
  settings: EffectiveDocumentSettings;
  artworksById?: ReadonlyMap<string, Artwork>;
  thumbnailUrls?: Readonly<Record<string, string>>;
};

export function ExportPdfPreview({
  project,
  settings,
  artworksById = new Map(),
  thumbnailUrls = {}
}: ExportPdfPreviewProps) {
  const pages = useMemo(
    () => derivePreviewPages(project, settings, artworksById),
    [project, settings, artworksById]
  );
  // Full plan scene once — overview and every room page filter this same build.
  const fullPlanScene = useMemo(
    () => buildPlanScene(project, { artworksById }),
    [project, artworksById]
  );

  // Empty-state card keeps the chosen paper's portrait proportions, so
  // switching paper size reads in the preview even with nothing selected.
  const emptyPageSize = getPageSizePt(settings.paperSize, "portrait");

  const total = pages.length;
  const [index, setIndex] = useState(0);
  // Clamp back into range when the manifest shrinks under the cursor.
  useEffect(() => {
    setIndex((current) => clampPageIndex(current, total));
  }, [total]);
  const safeIndex = clampPageIndex(index, total);
  const page: PreviewPage | undefined = pages[safeIndex];

  // <section>, not <aside>: this now lives inside the dialog's options rail
  // (itself an aside), so it's a named region rather than a nested landmark.
  return (
    <section className="export-preview" aria-label="PDF preview">
      {page ? (
        <PreviewPageCard
          page={page}
          project={project}
          settings={settings}
          fullPlanScene={fullPlanScene}
          artworksById={artworksById}
          thumbnailUrls={thumbnailUrls}
        />
      ) : (
        <div
          className="export-preview-card export-preview-empty"
          style={previewCardStyle(emptyPageSize.widthPt, emptyPageSize.heightPt)}
        >
          <span>Nothing selected</span>
        </div>
      )}
      <div className="export-preview-pager">
        <Button
          aria-label="Previous page"
          className="export-preview-pager-button"
          disabled={total === 0 || safeIndex <= 0}
          size="icon-sm"
          variant="ghost"
          onClick={() => setIndex((current) => clampPageIndex(current - 1, total))}
        >
          <CaretLeftIcon aria-hidden="true" size={16} />
        </Button>
        <span className="export-preview-caption" aria-live="polite">
          {page
            ? previewPageCaption(page, total)
            : "No pages to preview"}
        </span>
        <Button
          aria-label="Next page"
          className="export-preview-pager-button"
          disabled={total === 0 || safeIndex >= total - 1}
          size="icon-sm"
          variant="ghost"
          onClick={() => setIndex((current) => clampPageIndex(current + 1, total))}
        >
          <CaretRightIcon aria-hidden="true" size={16} />
        </Button>
      </div>
    </section>
  );
}

function PreviewPageCard({
  page,
  project,
  settings,
  fullPlanScene,
  artworksById,
  thumbnailUrls
}: {
  page: PreviewPage;
  project: Project;
  settings: EffectiveDocumentSettings;
  fullPlanScene: PlanScene;
  artworksById: ReadonlyMap<string, Artwork>;
  thumbnailUrls: Readonly<Record<string, string>>;
}) {
  const manifest = page.manifest;
  const orientation = manifest.orientation;
  const pageSize = getPageSizePt(settings.paperSize, orientation);

  const svgChildren = useMemo(() => {
    const rect = drawingRectPt(settings.paperSize, orientation);
    if (manifest.kind === "three-d") {
      return null; // rendered as an image below, not SVG marks
    }
    if (manifest.kind === "elevation") {
      const scene = buildElevationForPage(project, manifest, artworksById);
      if (!scene) return [];
      const bounds = manifest.boundsMm;
      const fit = fitBoundsToRect(bounds, rect);
      const xf = elevationTransform(bounds, fit);
      return elevationPageMarks(scene, bounds, xf, settings, settings.dimensions);
    }
    // overview / room-plan
    const scene =
      manifest.kind === "overview"
        ? fullPlanScene
        : roomScenePreview(fullPlanScene, project, manifest.roomId);
    const bounds =
      manifest.kind === "overview"
        ? getPlanSceneBounds(fullPlanScene)
        : manifest.boundsMm;
    const fit = fitBoundsToRect(bounds, rect);
    const xf = planTransform(bounds, fit);
    // Room plans carry dimensions; the overview never does (matches the export).
    const withDimensions =
      settings.dimensions && manifest.kind === "room-plan";
    return planPageMarks(scene, bounds, xf, settings, withDimensions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, project, settings, fullPlanScene, artworksById, orientation]);

  const thumbnailSrc =
    manifest.kind === "three-d" ? thumbnailUrls[manifest.savedViewId] : undefined;

  return (
    <div
      className="export-preview-card"
      style={previewCardStyle(pageSize.widthPt, pageSize.heightPt)}
    >
      <svg
        className="export-preview-svg"
        viewBox={`0 0 ${pageSize.widthPt} ${pageSize.heightPt}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={page.detail}
      >
        <rect x={0} y={0} width={pageSize.widthPt} height={pageSize.heightPt} fill="#ffffff" />
        {/* Header band echo: the page title, small, top-left. */}
        <text
          x={DOCUMENT_PAGE_MARGIN_PT}
          y={DOCUMENT_PAGE_MARGIN_PT + 14}
          fontSize={11}
          fontWeight={600}
          fill={INK}
        >
          {manifest.title}
        </text>
        {manifest.kind === "three-d" ? (
          <ThreeDPageContent
            manifest={manifest}
            paperSize={settings.paperSize}
            orientation={orientation}
            src={thumbnailSrc}
          />
        ) : (
          svgChildren
        )}
      </svg>
    </div>
  );
}

function ThreeDPageContent({
  paperSize,
  orientation,
  src
}: {
  manifest: Extract<DocumentPageManifest, { kind: "three-d" }>;
  paperSize: EffectiveDocumentSettings["paperSize"];
  orientation: DocumentOrientation;
  src?: string;
}) {
  const rect = drawingRectPt(paperSize, orientation);
  if (src) {
    return (
      <image
        href={src}
        x={rect.xPt}
        y={rect.yPt}
        width={rect.widthPt}
        height={rect.heightPt}
        preserveAspectRatio="xMidYMid meet"
      />
    );
  }
  return (
    <rect
      x={rect.xPt}
      y={rect.yPt}
      width={rect.widthPt}
      height={rect.heightPt}
      fill={FILL_WEAK}
      stroke={MUTED}
      strokeWidth={0.7}
    />
  );
}
