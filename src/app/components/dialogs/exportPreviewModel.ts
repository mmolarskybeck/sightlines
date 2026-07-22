// Pure mapping from the export page manifest to the inline preview's page
// descriptors. The preview MUST agree with the real export on page count,
// order and orientation, so it consumes the SAME deriveDocumentPageManifest
// the PDF writer does (see pageComposition.ts) — this module only adds the
// human-facing caption and the paging-index arithmetic. No rendering, no
// scene building: keep it trivially testable.

import type { Artwork, Project } from "../../../domain/project";
import type { EffectiveDocumentSettings } from "../../../domain/export/documentSettings";
import {
  deriveDocumentPageManifest,
  type DocumentPageManifest
} from "../../../domain/export/pageComposition";

// The short kind label that leads each caption. Kept beside the manifest kinds
// so a new page kind fails loudly here rather than falling back silently.
const PREVIEW_KIND_LABEL: Record<DocumentPageManifest["kind"], string> = {
  overview: "Overview",
  "room-plan": "Room plan",
  elevation: "Elevation",
  "three-d": "3D view"
};

export type PreviewPage = {
  // 0-based position in the manifest — the pager index.
  index: number;
  manifest: DocumentPageManifest;
  // The kind label alone ("Room plan"), for compact secondary use.
  kindLabel: string;
  // The full caption body, e.g. "Room plan — Main Gallery". The "Page N of M"
  // prefix is added by the caption formatter so the count stays in one place.
  detail: string;
};

// "Overview" has no distinct title (its manifest title IS "Overview"), so it
// shows the kind label alone; every other kind appends its own title.
function previewDetail(manifest: DocumentPageManifest): string {
  const kindLabel = PREVIEW_KIND_LABEL[manifest.kind];
  if (manifest.kind === "overview") return kindLabel;
  return `${kindLabel} — ${manifest.title}`;
}

export function derivePreviewPages(
  project: Project,
  settings: EffectiveDocumentSettings,
  artworksById: ReadonlyMap<string, Artwork> = new Map()
): PreviewPage[] {
  return deriveDocumentPageManifest(project, settings, artworksById).map(
    (manifest, index) => ({
      index,
      manifest,
      kindLabel: PREVIEW_KIND_LABEL[manifest.kind],
      detail: previewDetail(manifest)
    })
  );
}

// "Page 2 of 5 · Room plan — Main Gallery". Total is passed in (not read from
// the page) so an empty manifest can still be captioned by the caller.
export function previewPageCaption(page: PreviewPage, total: number): string {
  return `Page ${page.index + 1} of ${total} · ${page.detail}`;
}

// Keep a paging index inside [0, total). Clamps to 0 when the manifest is
// empty (nothing selected) and pulls a now-out-of-range index back to the last
// page when the manifest shrinks under the cursor.
export function clampPageIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(index, total - 1));
}
