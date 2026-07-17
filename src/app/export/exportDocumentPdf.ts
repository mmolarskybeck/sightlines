// Phase 5 orchestrator (spec §3.2, §6.2, §12): wraps the pure PDF writer with
// determinate progress and cooperative cancellation. The writer itself stays
// caller-agnostic — App owns the AbortController, the toast copy, and delivery;
// this module owns the progress arithmetic and the abort contract so both the
// writer and the UI stay simple.

import { createDocumentPdf } from "./createDocumentPdf";
import type {
  CreateDocumentPdfResult,
  RenderSavedView
} from "./createDocumentPdf";
import type { EffectiveDocumentSettings } from "../../domain/export/documentSettings";
import type { Artwork, Asset, Project } from "../../domain/project";

// 3D pages dominate wall-clock time (an offscreen render per view), so a
// rendered Saved view advances the bar three units against one unit per unique
// embedded artwork image. The single trailing assembly unit is only ever
// satisfied by the writer resolving, which keeps the bar honest: it can reach
// total − 1 while pages compose but only hits total when bytes exist (§6.2).
const SAVED_VIEW_WEIGHT = 3;
const IMAGE_EMBED_WEIGHT = 1;
const ASSEMBLY_WEIGHT = 1;

export type ExportProgress = { done: number; total: number };

export type ExportDocumentPdfOptions = {
  project: Project;
  settings: EffectiveDocumentSettings;
  artworks: readonly Artwork[];
  getAsset?: (assetId: string) => Promise<Asset>;
  getBlob?: (key: string) => Promise<Blob>;
  renderSavedView?: RenderSavedView;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
  // Injectable so tests can drive the wrapped callbacks without the real
  // pdf-lib writer; production always uses createDocumentPdf.
  createPdf?: typeof createDocumentPdf;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The PDF export was canceled.", "AbortError");
  }
}

// The determinate denominator, precomputed so the bar never rescales mid-run.
// Images embed only on included elevation pages, so only assets on included
// walls count; each unique asset is fetched once (the writer caches by assetId)
// and so ticks once. The count is a deliberate approximation — overcounting
// merely leaves the bar short of total until the final tick, undercounting is
// absorbed by the clamp in advance() — but it must never regress run to run.
function computeProgressTotal(
  project: Project,
  settings: EffectiveDocumentSettings,
  artworksById: ReadonlyMap<string, Artwork>
): number {
  const includedWallIds = new Set<string>();
  if (settings.sections.elevations) {
    for (const room of settings.rooms) {
      for (const wall of room.walls) {
        if (wall.included) includedWallIds.add(wall.wallId);
      }
    }
  }

  const assetIds = new Set<string>();
  for (const object of project.wallObjects) {
    if (object.kind !== "artwork") continue;
    if (!includedWallIds.has(object.wallId)) continue;
    const assetId = artworksById.get(object.artworkId)?.assetId;
    if (assetId) assetIds.add(assetId);
  }

  const savedViewPages = settings.sections.threeDViews
    ? settings.savedViews.filter((view) => view.valid && view.included).length
    : 0;

  return (
    savedViewPages * SAVED_VIEW_WEIGHT +
    assetIds.size * IMAGE_EMBED_WEIGHT +
    ASSEMBLY_WEIGHT
  );
}

export async function exportDocumentPdf(
  options: ExportDocumentPdfOptions
): Promise<CreateDocumentPdfResult> {
  const {
    project,
    settings,
    artworks,
    getAsset,
    getBlob,
    renderSavedView,
    signal,
    onProgress,
    createPdf = createDocumentPdf
  } = options;

  throwIfAborted(signal);

  const artworksById = new Map(artworks.map((artwork) => [artwork.id, artwork]));
  const total = computeProgressTotal(project, settings, artworksById);
  let done = 0;
  onProgress?.({ done, total });

  // Monotonic and capped at total − 1: intermediate ticks can never claim
  // completion, only the post-writer tick below reports done === total.
  const advance = (weight: number): void => {
    if (weight > 0) {
      done = Math.min(done + weight, Math.max(0, total - 1));
    }
    onProgress?.({ done, total });
  };

  // Each wrapped call refuses to start once aborted and rechecks after settling
  // so an abort mid-flight rejects rather than ticking. getAsset is the cheap
  // precursor to getBlob (the actual embed), so only getBlob advances the bar.
  const wrappedGetAsset = getAsset
    ? async (assetId: string): Promise<Asset> => {
        throwIfAborted(signal);
        const asset = await getAsset(assetId);
        throwIfAborted(signal);
        advance(0);
        return asset;
      }
    : undefined;

  const wrappedGetBlob = getBlob
    ? async (key: string): Promise<Blob> => {
        throwIfAborted(signal);
        const blob = await getBlob(key);
        throwIfAborted(signal);
        advance(IMAGE_EMBED_WEIGHT);
        return blob;
      }
    : undefined;

  const wrappedRenderSavedView: RenderSavedView | undefined = renderSavedView
    ? async (view, size) => {
        throwIfAborted(signal);
        const blob = await renderSavedView(view, size);
        throwIfAborted(signal);
        advance(SAVED_VIEW_WEIGHT);
        return blob;
      }
    : undefined;

  const result = await createPdf({
    project,
    settings,
    artworks,
    getAsset: wrappedGetAsset,
    getBlob: wrappedGetBlob,
    renderSavedView: wrappedRenderSavedView
    // No fontBytes: v1 uses the standard Helvetica fallback (spec §16); the
    // writer emits its own substitution warning for unsupported glyphs.
  });

  // An abort that lands mid-assembly must still deliver nothing (§6.2, §12).
  throwIfAborted(signal);
  onProgress?.({ done: total, total });
  return result;
}
