import { Suspense, lazy, useMemo, type RefObject } from "react";
import { toast } from "sonner";
import type { ChecklistExportRequest } from "../../domain/checklistExport/types";
import type { PackageExportMode } from "../../domain/schema/packageSchema";
import type { EffectiveDocumentSettings } from "../../domain/export/documentSettings";
import { ArtworkLibraryPicker } from "./library/ArtworkLibrary";
import { DeleteRoomDialog } from "./dialogs/DeleteRoomDialog";
import { OpenWallDialog } from "./dialogs/OpenWallDialog";
import { RecoveryDialog } from "./dialogs/RecoveryDialog";
import { ShareProjectDialog } from "./dialogs/ShareProjectDialog";
import { SharedProjectImportDialog } from "./dialogs/SharedProjectImportDialog";
import { SyncConflictDialog } from "./dialogs/SyncConflictDialog";
import { HelpDialog } from "./dialogs/HelpDialog";
import { ImportConflictDialog } from "./imports/ImportConflictDialog";
import type { SavedViewRenderHandle } from "./three/SavedViewRenderHost";
import type { StoragePersistenceState } from "../hooks/useStoragePersistence";
import type { DialogsHandle } from "../hooks/useDialogs";
import type { UseSavedViewThumbnails } from "../hooks/useSavedViewThumbnails";
import { useArtworksById } from "../hooks/useArtworksById";
import { summarizeRoomContents } from "../roomDeletion";
import { buildOpenWallRequest } from "../wallOpening";
import { useAppStore, type ArtworkImportDestination } from "../store";

const ImportWizard = lazy(() => import("./imports/ImportWizard"));
const SettingsDialog = lazy(() =>
  import("./dialogs/SettingsDialog").then((module) => ({ default: module.SettingsDialog }))
);
const ExportPdfDialog = lazy(() =>
  import("./dialogs/ExportPdfDialog").then((module) => ({
    default: module.ExportPdfDialog
  }))
);
// Lazy for the same reason the PDF dialog is: nothing here is needed until the
// Export menu is used, and the export it launches dynamically imports SheetJS.
const ExportChecklistDialog = lazy(() =>
  import("./dialogs/ExportChecklistDialog").then((module) => ({
    default: module.ExportChecklistDialog
  }))
);
// Lazy so the three.js it pulls in (via SnapshotStage) stays out of the initial
// bundle, like ThreeDView. Mounted only while a thumbnail consumer is visible or
// thumbnail work is pending (Export dialog, or a just-saved view's seed render);
// the code itself is usually already warm via App's idle prefetch.
const SavedViewRenderHost = lazy(() =>
  import("./three/SavedViewRenderHost").then((module) => ({
    default: module.SavedViewRenderHost
  }))
);
// Suppressed under automation (navigator.webdriver): the open-by-default panel
// overlays real UI and intercepts e2e clicks that pass in a human session.
const FontLab = import.meta.env.DEV && !globalThis.navigator?.webdriver
  ? lazy(() => import("./FontLab"))
  : null;

// Only what App genuinely owns reaches this file as a prop: the dialog registry,
// the hooks App must hold exactly once (storage persistence, view preferences,
// the export cluster, the saved-view thumbnail cache) and its own local state.
// Everything else each dialog needs is project or store state, which the thin
// connected wrappers below read for themselves.
type AppDialogsProps = {
  // Every dialog's open state, from App's registry.
  dialogs: DialogsHandle;
  importDestination: ArtworkImportDestination;
  storagePersistence: StoragePersistenceState;
  retryStoragePersistence: () => void;
  cloudBackupConfigured: boolean;
  resetPreferences: () => void;
  handleExportPackage: (mode: PackageExportMode) => Promise<void>;
  shareProjectUrl: string | null;
  shareProjectWarningCount: number;
  onCloseShareProject: () => void;
  incomingDropboxShareUrl: string | null;
  onLeaveIncomingShare: () => void;
  fileInputRef: RefObject<HTMLInputElement>;
  handleExportPdfOpenChange: (open: boolean) => void;
  handleExportChecklist: (request: ChecklistExportRequest) => Promise<void>;
  isExportingChecklist: boolean;
  handleExportPdf: (settings: EffectiveDocumentSettings) => Promise<void>;
  savedViewThumbnailUrls: UseSavedViewThumbnails["urls"];
  pdfExportProgress: { done: number; total: number } | null;
  handleCancelExportPdf: () => void;
  savedViewsPaneVisible: boolean;
  thumbnailsPending: boolean;
  getAssetBlob: (key: string) => Promise<Blob>;
  savedViewRenderRef: { current: SavedViewRenderHandle | null };
};

export function AppDialogs({
  dialogs,
  importDestination,
  storagePersistence,
  retryStoragePersistence,
  cloudBackupConfigured,
  resetPreferences,
  handleExportPackage,
  shareProjectUrl,
  shareProjectWarningCount,
  onCloseShareProject,
  incomingDropboxShareUrl,
  onLeaveIncomingShare,
  fileInputRef,
  handleExportChecklist,
  isExportingChecklist,
  handleExportPdfOpenChange,
  handleExportPdf,
  savedViewThumbnailUrls,
  pdfExportProgress,
  handleCancelExportPdf,
  savedViewsPaneVisible,
  thumbnailsPending,
  getAssetBlob,
  savedViewRenderRef
}: AppDialogsProps) {
  return (
    <>
      {FontLab ? (
        <Suspense fallback={null}>
          <FontLab />
        </Suspense>
      ) : null}
      <ConnectedHelpDialog
        open={dialogs.isOpen("help")}
        onOpenChange={dialogs.setOpen("help")}
      />
      <Suspense fallback={null}>
        <ConnectedImportWizard
          open={dialogs.isOpen("importWizard")}
          destination={importDestination}
          onOpenChange={dialogs.setOpen("importWizard")}
        />
        <SettingsDialog
          open={dialogs.isOpen("settings")}
          onOpenChange={dialogs.setOpen("settings")}
          storageState={storagePersistence}
          onRetryStorage={retryStoragePersistence}
          cloudBackupConfigured={cloudBackupConfigured}
          resetPreferences={resetPreferences}
          onExport={() => void handleExportPackage("display")}
          onImport={() => fileInputRef.current?.click()}
          onOpenHelp={() => {
            dialogs.close("settings");
            dialogs.open("help");
          }}
        />
        <ConnectedExportPdfDialog
          open={dialogs.isOpen("exportPdf")}
          onOpenChange={handleExportPdfOpenChange}
          onExport={(settings) => void handleExportPdf(settings)}
          thumbnailUrls={savedViewThumbnailUrls}
          exportState={pdfExportProgress}
          onCancelExport={handleCancelExportPdf}
        />
        <ConnectedExportChecklistDialog
          open={dialogs.isOpen("exportChecklist")}
          onOpenChange={dialogs.setOpen("exportChecklist")}
          onExport={(request) => void handleExportChecklist(request)}
          busy={isExportingChecklist}
        />
      </Suspense>
      {dialogs.isOpen("exportPdf") ||
      savedViewsPaneVisible ||
      pdfExportProgress ||
      thumbnailsPending ? (
        <Suspense fallback={null}>
          <ConnectedSavedViewRenderHost
            getBlob={getAssetBlob}
            actionsRef={savedViewRenderRef}
          />
        </Suspense>
      ) : null}
      <ConnectedArtworkLibraryPicker
        open={dialogs.isOpen("libraryPicker")}
        getBlob={getAssetBlob}
        onOpenChange={dialogs.setOpen("libraryPicker")}
      />
      <ConnectedDeleteRoomDialog dialogs={dialogs} />
      <ConnectedOpenWallDialog dialogs={dialogs} />
      <ConnectedImportConflictDialog getBlob={getAssetBlob} />
      {/* The whole-project sync decision. It is deliberately NOT stacked with
          the artwork review: a pull resolves the layout question here first,
          and only then does the import park on library conflicts. */}
      <ConnectedSyncConflictDialog />
      <ShareProjectDialog
        url={shareProjectUrl}
        warningCount={shareProjectWarningCount}
        onClose={onCloseShareProject}
      />
      <ConnectedSharedProjectImportDialog
        dropboxUrl={incomingDropboxShareUrl}
        onLeave={onLeaveIncomingShare}
      />
      <ConnectedRecoveryDialog />
    </>
  );
}

// Below: one thin wrapper per dialog whose inputs are store state. Each
// subscribes to exactly the fields its leaf needs, so a change to one dialog's
// slice cannot re-render the others, and every leaf keeps the plain prop
// contract its own unit test renders it with.

function ConnectedHelpDialog({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const viewMode = useAppStore((state) => state.viewMode);
  return <HelpDialog open={open} viewMode={viewMode} onOpenChange={onOpenChange} />;
}

function ConnectedImportWizard({
  open,
  destination,
  onOpenChange
}: {
  open: boolean;
  destination: ArtworkImportDestination;
  onOpenChange: (open: boolean) => void;
}) {
  const projectUnit = useAppStore((state) => state.project?.unit);
  const intakeState = useAppStore((state) => state.intakeState);
  const importArtworkDrafts = useAppStore((state) => state.importArtworkDrafts);
  const addArtworksFromFiles = useAppStore((state) => state.addArtworksFromFiles);
  if (!projectUnit) return null;
  return (
    <ImportWizard
      intakeState={intakeState}
      open={open}
      projectUnit={projectUnit}
      destination={destination}
      onImportDrafts={(drafts) => importArtworkDrafts(drafts, { destination })}
      onImportImages={(files) => addArtworksFromFiles(files, { destination })}
      onOpenChange={onOpenChange}
    />
  );
}

function ConnectedExportPdfDialog({
  open,
  onOpenChange,
  onExport,
  thumbnailUrls,
  exportState,
  onCancelExport
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: (settings: EffectiveDocumentSettings) => void;
  thumbnailUrls: UseSavedViewThumbnails["urls"];
  exportState: { done: number; total: number } | null;
  onCancelExport: () => void;
}) {
  const project = useAppStore((state) => state.project);
  const artworksById = useArtworksById();
  if (!project) return null;
  return (
    <ExportPdfDialog
      open={open}
      project={project}
      onOpenChange={onOpenChange}
      onExport={onExport}
      onPersistenceError={(message) => toast.error(message)}
      thumbnailUrls={thumbnailUrls}
      artworksById={artworksById}
      exportState={exportState}
      onCancelExport={onCancelExport}
    />
  );
}

function ConnectedExportChecklistDialog({
  open,
  onOpenChange,
  onExport,
  busy
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: (request: ChecklistExportRequest) => void;
  busy: boolean;
}) {
  const project = useAppStore((state) => state.project);
  const checklistArtworkIds = project?.checklistArtworkIds;
  const wallObjects = project?.wallObjects;
  const floorObjects = project?.floorObjects;
  // How many checklist works currently have a placement — the checklist export
  // dialog's "Placed works only" count. Membership and placement are
  // independent (a work can be placed without being on the checklist), so this
  // is an intersection, not a length.
  const placedChecklistCount = useMemo(() => {
    if (!checklistArtworkIds || !wallObjects || !floorObjects) return 0;
    const placedIds = new Set<string>();
    for (const object of wallObjects) {
      if (object.kind === "artwork") placedIds.add(object.artworkId);
    }
    for (const object of floorObjects) {
      if (object.kind === "artwork") placedIds.add(object.artworkId);
    }
    return checklistArtworkIds.filter((id) => placedIds.has(id)).length;
  }, [checklistArtworkIds, wallObjects, floorObjects]);
  if (!project) return null;
  return (
    <ExportChecklistDialog
      open={open}
      checklistCount={project.checklistArtworkIds.length}
      placedCount={placedChecklistCount}
      onOpenChange={onOpenChange}
      onExport={onExport}
      busy={busy}
    />
  );
}

function ConnectedSavedViewRenderHost({
  getBlob,
  actionsRef
}: {
  getBlob: (key: string) => Promise<Blob>;
  actionsRef: { current: SavedViewRenderHandle | null };
}) {
  const project = useAppStore((state) => state.project);
  const artworksById = useArtworksById();
  if (!project) return null;
  return (
    <SavedViewRenderHost
      project={project}
      artworksById={artworksById}
      getBlob={getBlob}
      actionsRef={actionsRef}
    />
  );
}

function ConnectedArtworkLibraryPicker({
  open,
  getBlob,
  onOpenChange
}: {
  open: boolean;
  getBlob: (key: string) => Promise<Blob>;
  onOpenChange: (open: boolean) => void;
}) {
  const project = useAppStore((state) => state.project);
  const libraryArtworks = useAppStore((state) => state.libraryArtworks);
  const addExistingArtworksToChecklist = useAppStore(
    (state) => state.addExistingArtworksToChecklist
  );
  if (!project) return null;
  return (
    <ArtworkLibraryPicker
      open={open}
      artworks={libraryArtworks}
      project={project}
      getBlob={getBlob}
      onOpenChange={onOpenChange}
      onAddToChecklist={addExistingArtworksToChecklist}
    />
  );
}

function ConnectedDeleteRoomDialog({ dialogs }: { dialogs: DialogsHandle }) {
  const project = useAppStore((state) => state.project);
  const deleteRoom = useAppStore((state) => state.deleteRoom);
  // A stale pending-delete id closes the dialog safely.
  const roomId = dialogs.payload("deleteRoom")?.roomId ?? null;
  const placement =
    roomId && project
      ? (project.floor.rooms.find((candidate) => candidate.roomId === roomId) ?? null)
      : null;
  const summary = project && placement ? summarizeRoomContents(project, placement) : null;
  return (
    <DeleteRoomDialog
      roomName={placement?.room.name ?? ""}
      summary={summary}
      onConfirm={() => {
        const confirmedRoomId = dialogs.payload("deleteRoom")?.roomId ?? null;
        dialogs.close("deleteRoom");
        if (confirmedRoomId) void deleteRoom(confirmedRoomId);
      }}
      onOpenChange={(open) => {
        if (!open) dialogs.close("deleteRoom");
      }}
    />
  );
}

function ConnectedOpenWallDialog({ dialogs }: { dialogs: DialogsHandle }) {
  const project = useAppStore((state) => state.project);
  const openWall = useAppStore((state) => state.openWall);
  // Same idiom as the room confirm: a stale pending-open id (after an undo, or
  // a room delete that took the wall with it) resolves to null and closes the
  // dialog safely. Every wall confirms (no empty-wall fast path — an empty wall
  // can still be shared), and a blocked wall gets an explanatory dialog rather
  // than a no-op.
  const wallId = dialogs.payload("openWall")?.wallId ?? null;
  const request = wallId && project ? buildOpenWallRequest(project, wallId) : null;
  return (
    <OpenWallDialog
      request={request}
      onConfirm={() => {
        // Read the id off the REQUEST, not the raw pending state, so the wall
        // we act on is always the one the dialog just described.
        const confirmedWallId = request?.wallId ?? null;
        dialogs.close("openWall");
        if (confirmedWallId) void openWall(confirmedWallId);
      }}
      onOpenChange={(open) => {
        if (!open) dialogs.close("openWall");
      }}
    />
  );
}

function ConnectedImportConflictDialog({
  getBlob
}: {
  getBlob: (key: string) => Promise<Blob>;
}) {
  const pendingPackageImport = useAppStore((state) => state.pendingPackageImport);
  const projectUnit = useAppStore((state) => state.project?.unit);
  const resolvePackageImportConflicts = useAppStore(
    (state) => state.resolvePackageImportConflicts
  );
  const dismissPackageImport = useAppStore((state) => state.dismissPackageImport);
  return (
    <ImportConflictDialog
      assetsToSave={pendingPackageImport?.plan.assetsToSave ?? null}
      conflicts={pendingPackageImport?.plan.conflicts ?? null}
      getBlob={getBlob}
      unit={projectUnit}
      onResolve={(resolutions) => void resolvePackageImportConflicts(resolutions)}
      onDismiss={dismissPackageImport}
    />
  );
}

function ConnectedSyncConflictDialog() {
  const syncConflict = useAppStore((state) => state.syncConflict);
  const resolveSyncConflict = useAppStore((state) => state.resolveSyncConflict);
  const disableProjectSync = useAppStore((state) => state.disableProjectSync);
  return (
    <SyncConflictDialog
      conflict={syncConflict}
      onDisableSync={() => void disableProjectSync()}
      onResolve={(choice) => void resolveSyncConflict(choice)}
    />
  );
}

function ConnectedSharedProjectImportDialog({
  dropboxUrl,
  onLeave
}: {
  dropboxUrl: string | null;
  onLeave: () => void;
}) {
  const importSharedSightlinesPackage = useAppStore(
    (state) => state.importSharedSightlinesPackage
  );
  return (
    <SharedProjectImportDialog
      dropboxUrl={dropboxUrl}
      onImport={importSharedSightlinesPackage}
      onLeave={onLeave}
    />
  );
}

function ConnectedRecoveryDialog() {
  const recoveryOffer = useAppStore((state) => state.recoveryOffer);
  const acceptRecovery = useAppStore((state) => state.acceptRecovery);
  const dismissRecovery = useAppStore((state) => state.dismissRecovery);
  return (
    <RecoveryDialog
      offer={recoveryOffer}
      onRestore={() => void acceptRecovery()}
      onDismiss={dismissRecovery}
    />
  );
}
