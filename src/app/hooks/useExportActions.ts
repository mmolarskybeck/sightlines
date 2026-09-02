import { useRef, useState } from "react";
import { toast } from "sonner";
import type { Artwork, Asset, Project } from "../../domain/project";
import type { ChecklistExportRequest } from "../../domain/checklistExport/types";
import type { PackageExportMode } from "../../domain/schema/packageSchema";
import type { EffectiveDocumentSettings } from "../../domain/export/documentSettings";
import type { PackageSliceActions } from "../store/packageSlice";
import type { CloudBackupSliceActions } from "../store/cloudBackupSlice";
import type { ViewMode } from "../store";
import { useAppStore } from "../store";
import { buildSightlinesDropboxShareUrl } from "../cloud/dropboxShare";
import { captureSvgSnapshot } from "../export/captureSnapshot";
import { deliverExport } from "../export/deliverExport";
import { telemetry } from "../telemetry/telemetry";
import type { ThreeDViewActions } from "../components/three/ThreeDView";
import type { SavedViewRenderRef } from "../savedViewRenderRef";

export type UseExportActionsParams = {
  project: Project | null;
  viewMode: ViewMode;
  libraryArtworks: Artwork[];
  // Only the elevation image export reads it, for the filename's view label.
  selectedWall: { name: string } | null;
  exportProjectPackage: PackageSliceActions["exportProjectPackage"];
  exportProjectPackageById: PackageSliceActions["exportProjectPackageById"];
  exportChecklistSpreadsheet: PackageSliceActions["exportChecklistSpreadsheet"];
  exportChecklistPdf: PackageSliceActions["exportChecklistPdf"];
  createCloudShareLink: CloudBackupSliceActions["createCloudShareLink"];
  getAsset: (assetId: string) => Promise<Asset>;
  getBlob: (key: string) => Promise<Blob>;
  threeDActionsRef: React.MutableRefObject<ThreeDViewActions | null>;
  planSvgElementRef: React.MutableRefObject<SVGSVGElement | null>;
  elevationSvgElementRef: React.MutableRefObject<SVGSVGElement | null>;
  savedViewRenderRef: SavedViewRenderRef;
  setSnapshotExportMode: (value: boolean) => void;
  setIsExportChecklistOpen: (open: boolean) => void;
  setIsExportPdfOpen: (open: boolean) => void;
};

// Owns every export/share handler and the state that exists only for them. The
// dialogs' open flags stay with App (other code reads them), so the two that a
// finished export closes come in as setters.
export function useExportActions({
  project,
  viewMode,
  libraryArtworks,
  selectedWall,
  exportProjectPackage,
  exportProjectPackageById,
  exportChecklistSpreadsheet,
  exportChecklistPdf,
  createCloudShareLink,
  getAsset,
  getBlob,
  threeDActionsRef,
  planSvgElementRef,
  elevationSvgElementRef,
  savedViewRenderRef,
  setSnapshotExportMode,
  setIsExportChecklistOpen,
  setIsExportPdfOpen
}: UseExportActionsParams) {
  // Prevent re-entry while package assets are hashed and zipped.
  const [isExportingPackage, setIsExportingPackage] = useState(false);
  const [isExportingChecklist, setIsExportingChecklist] = useState(false);
  const [isSharingProject, setIsSharingProject] = useState(false);
  const [shareProjectUrl, setShareProjectUrl] = useState<string | null>(null);
  const [shareProjectWarningCount, setShareProjectWarningCount] = useState(0);
  // Determinate progress for the in-flight PDF export; null when idle (§6.2).
  const [pdfExportProgress, setPdfExportProgress] = useState<
    { done: number; total: number } | null
  >(null);
  // Aborts the in-flight PDF export; a cancel or a mid-export dialog dismissal
  // trips it, delivering nothing (§12).
  const pdfExportAbortRef = useRef<AbortController | null>(null);

  const handleExportPackage = async (mode: PackageExportMode) => {
    if (isExportingPackage) return;
    setIsExportingPackage(true);
    try {
      const result = await exportProjectPackage(mode);
      if (result) {
        await deliverExport({
          data: result.zip,
          filename: result.filename,
          mimeType: "application/octet-stream",
          description: "Sightlines project package",
          warnings: result.warnings
        });
      } else {
        // exportProjectPackage catches its own failures and records them on
        // `error` (see store.ts) rather than throwing — read that message
        // back out so the toast and the banner agree.
        toast.error(useAppStore.getState().error ?? "Export failed: the package could not be built.");
      }
    } catch (error) {
      // Guards anything unexpected outside exportProjectPackage's own try/
      // catch — e.g. triggerDownload failing on the returned blob.
      toast.error(
        `Export failed: ${error instanceof Error ? error.message : "the package could not be built."}`
      );
    } finally {
      setIsExportingPackage(false);
    }
  };

  // Checklist export (export-spec §3.4 spreadsheet, §3.5 PDF). Same delivery
  // contract as handleExportPackage: the store action catches its own failures
  // onto `error`, so a null result means "read the banner back out", and the
  // dialog only closes once bytes were actually delivered. The two formats
  // differ only in which builder runs — everything downstream is one path,
  // because both return the same {filename, bytes, mimeType, warnings}.
  const handleExportChecklist = async (request: ChecklistExportRequest) => {
    if (isExportingChecklist) return;
    setIsExportingChecklist(true);
    try {
      const result =
        request.kind === "pdf"
          ? await exportChecklistPdf(request.options)
          : await exportChecklistSpreadsheet(request.options);
      if (result) {
        // Pass a typed Blob rather than the raw bytes: triggerDownload's
        // Uint8Array path stamps application/octet-stream, which loses the
        // .xlsx/.zip type the save picker offers.
        await deliverExport({
          data: new Blob([result.bytes.slice()], { type: result.mimeType }),
          filename: result.filename,
          mimeType: result.mimeType,
          warnings: result.warnings,
          onDelivered: () => setIsExportChecklistOpen(false)
        });
      } else {
        toast.error(
          useAppStore.getState().error ?? "Export failed: the checklist could not be built."
        );
      }
    } catch (error) {
      toast.error(
        `Export failed: ${error instanceof Error ? error.message : "the checklist could not be built."}`
      );
    } finally {
      setIsExportingChecklist(false);
    }
  };

  // Project-row quick export uses the standard display-quality mode.
  const handleExportProjectById = async (id: string) => {
    try {
      const result = await exportProjectPackageById(id, "display");
      if (result) {
        await deliverExport({
          data: result.zip,
          filename: result.filename,
          mimeType: "application/octet-stream",
          description: "Sightlines project package",
          warnings: result.warnings
        });
      } else {
        toast.error(useAppStore.getState().error ?? "Export failed: the package could not be built.");
      }
    } catch (error) {
      toast.error(
        `Export failed: ${error instanceof Error ? error.message : "the package could not be built."}`
      );
    }
  };

  const handleShareProject = async () => {
    if (isSharingProject) return;
    setIsSharingProject(true);
    try {
      const result = await createCloudShareLink();
      const appRoot = new URL(import.meta.env.BASE_URL || "/", window.location.origin).toString();
      setShareProjectUrl(buildSightlinesDropboxShareUrl(result.url, appRoot));
      setShareProjectWarningCount(result.warnings.length);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create the Dropbox share link."
      );
    } finally {
      setIsSharingProject(false);
    }
  };

  const handleExportImage = async (format: "png" | "jpeg" = "png") => {
    if (!project) return;
    try {
      let blob: Blob;
      let viewLabel: string;
      if (viewMode === "3d") {
        if (!threeDActionsRef.current) return;
        blob = await threeDActionsRef.current.captureSnapshot(format);
        viewLabel = "3D view";
      } else if (viewMode === "elevation") {
        if (!elevationSvgElementRef.current || !selectedWall) return;
        setSnapshotExportMode(true);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        blob = await captureSvgSnapshot(elevationSvgElementRef.current, { format: "png" });
        setSnapshotExportMode(false);
        viewLabel = `${selectedWall.name} elevation`;
      } else if (viewMode === "plan") {
        if (!planSvgElementRef.current) return;
        setSnapshotExportMode(true);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        blob = await captureSvgSnapshot(planSvgElementRef.current, { format: "png" });
        setSnapshotExportMode(false);
        viewLabel = "Plan";
      } else {
        return;
      }
      const extension = format === "jpeg" ? "jpg" : "png";
      await deliverExport({
        data: blob,
        filename: `${project.title} — ${viewLabel}.${extension}`,
        mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
        description: format === "jpeg" ? "JPEG image" : "PNG image"
      });
    } catch (error) {
      setSnapshotExportMode(false);
      toast.error(`Export failed: ${error instanceof Error ? error.message : "the image could not be created."}`);
    }
  };

  // Compose and deliver the document PDF (spec §5, §12, §13). App owns the async
  // so the dialog can reflect progress and cancel synchronously; exportDocumentPdf
  // owns the abort contract and the determinate progress arithmetic.
  const handleExportPdf = async (settings: EffectiveDocumentSettings) => {
    // Re-entry guard: a live controller means an export is already in flight.
    if (!project || pdfExportAbortRef.current) return;
    const controller = new AbortController();
    pdfExportAbortRef.current = controller;
    setPdfExportProgress({ done: 0, total: 1 });
    // Hold the Saved-view render stage mounted for the whole export. The
    // exporter renders any 3D Saved views sequentially, emptying the host's
    // queue between each; without this hold the stage would drop and recreate
    // its WebGL context per view, and a many-view document could exhaust the
    // browser's context budget and evict the live 3D canvas. Released in the
    // finally below so an abort or error frees it too. `let`, not `const`:
    // when the host hasn't mounted yet (fresh session, three chunk still
    // loading) the hold is taken later, by the first renderSavedView call.
    let releaseRenderBatch =
      savedViewRenderRef.current?.beginRenderBatch() ?? null;
    try {
      // Dynamic imports keep pdf-lib/fontkit (the "pdf" manual chunk) out of
      // the entry closure — they load on first export, like three does for
      // the 3D view. assert-chunk-graph enforces this.
      const [{ exportDocumentPdf }, { loadPdfFontBytes }] = await Promise.all([
        import("../export/exportDocumentPdf"),
        import("../export/pdfFonts")
      ]);
      const result = await exportDocumentPdf({
        project,
        settings,
        artworks: libraryArtworks,
        getAsset: (assetId) => getAsset(assetId),
        getBlob,
        // Bundled Geist for PDF text; undefined on fetch failure, which falls
        // back to the writer's standard-Helvetica path (see pdfFonts.ts).
        fontBytes: await loadPdfFontBytes(),
        renderSavedView: async (view, size) => {
          // The host mounts lazily once the export begins (pdfExportProgress
          // gates it in AppDialogs) and attaches its handle in an effect, so a
          // fresh session can reach the first 3D page before the handle
          // exists. Wait for it — abortable, bounded — instead of failing the
          // page to a placeholder; on timeout the writer's placeholder path
          // still applies per view.
          const handle = await savedViewRenderRef.whenReady(controller.signal);
          // The batch hold above couldn't be taken while the host was
          // unmounted; take it on first render so the rest of the batch still
          // shares one WebGL context.
          releaseRenderBatch ??= handle.beginRenderBatch();
          return handle.renderSavedView(view, size);
        },
        signal: controller.signal,
        onProgress: setPdfExportProgress
      });
      // Dismissing the save dialog behaves like the dialog's own cancel: no
      // file, no toast, and the dialog stays open in its ready state.
      await deliverExport({
        data: new Blob([result.bytes.slice()], { type: "application/pdf" }),
        filename: `${project.title}.pdf`,
        mimeType: "application/pdf",
        description: "PDF document",
        warnings: result.warnings,
        onDelivered: () => {
          telemetry.track("pdf_export_completed", {});
          setIsExportPdfOpen(false);
        }
      });
    } catch (error) {
      // A cancel leaves the dialog open in its ready state — no file, no error
      // toast (§12). Any other failure surfaces the one plain-language message;
      // the cause goes to the console because the toast copy deliberately
      // carries no diagnostics.
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.error("Export PDF failed:", error);
        toast.error("Couldn't create the PDF. Your project is unchanged.");
      }
    } finally {
      releaseRenderBatch?.();
      pdfExportAbortRef.current = null;
      setPdfExportProgress(null);
    }
  };

  const handleCancelExportPdf = () => {
    pdfExportAbortRef.current?.abort();
  };

  // Esc/overlay dismissal while exporting aborts and keeps the dialog open (it
  // returns to its ready state once the abort settles); otherwise it closes.
  const handleExportPdfOpenChange = (open: boolean) => {
    if (!open && pdfExportAbortRef.current) {
      pdfExportAbortRef.current.abort();
      return;
    }
    setIsExportPdfOpen(open);
  };

  return {
    isExportingPackage,
    isExportingChecklist,
    isSharingProject,
    shareProjectUrl,
    setShareProjectUrl,
    shareProjectWarningCount,
    pdfExportProgress,
    handleExportPackage,
    handleExportChecklist,
    handleExportProjectById,
    handleShareProject,
    handleExportImage,
    handleExportPdf,
    handleCancelExportPdf,
    handleExportPdfOpenChange
  };
}
