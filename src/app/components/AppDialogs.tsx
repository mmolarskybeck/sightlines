import { Suspense, lazy, useMemo, type RefObject } from "react";
import { toast } from "sonner";
import type {
  Artwork,
  Project,
  RoomPlacement
} from "../../domain/project";
import type { ChecklistExportOptions } from "../../domain/checklistExport/types";
import type { PackageExportMode } from "../../domain/schema/packageSchema";
import type { EffectiveDocumentSettings } from "../../domain/export/documentSettings";
import { ArtworkLibraryPicker } from "./library/ArtworkLibrary";
import { DeleteRoomDialog } from "./dialogs/DeleteRoomDialog";
import { OpenWallDialog } from "./dialogs/OpenWallDialog";
import { RecoveryDialog } from "./dialogs/RecoveryDialog";
import { ShareProjectDialog } from "./dialogs/ShareProjectDialog";
import { SharedProjectImportDialog } from "./dialogs/SharedProjectImportDialog";
import { HelpDialog } from "./dialogs/HelpDialog";
import { ImportConflictDialog } from "./imports/ImportConflictDialog";
import type { SavedViewRenderHandle } from "./three/SavedViewRenderHost";
import type { StoragePersistenceState } from "../hooks/useStoragePersistence";
import type { CloudBackupProviderStatus } from "../cloud/provider";
import type { UseSavedViewThumbnails } from "../hooks/useSavedViewThumbnails";
import type { RoomContentsSummary } from "../roomDeletion";
import type { OpenWallRequest } from "../wallOpening";
import type { AppState, ArtworkImportDestination, ViewMode } from "../store";

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

type AppDialogsProps = {
  project: Project;
  viewMode: ViewMode;
  isHelpOpen: boolean;
  setIsHelpOpen: (open: boolean) => void;
  importWizardOpen: boolean;
  setImportWizardOpen: (open: boolean) => void;
  importDestination: ArtworkImportDestination;
  intakeState: AppState["intakeState"];
  importArtworkDrafts: AppState["importArtworkDrafts"];
  addArtworksFromFiles: AppState["addArtworksFromFiles"];
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  storagePersistence: StoragePersistenceState;
  retryStoragePersistence: () => void;
  cloudBackupConfigured: boolean;
  cloudBackupProviderStatus: CloudBackupProviderStatus;
  cloudBackupAccountLabel: string | null;
  cloudBackupStatus: AppState["cloudBackupStatus"];
  lastCloudBackupAt: string | null;
  connectCloudBackup: AppState["connectCloudBackup"];
  disconnectCloudBackup: AppState["disconnectCloudBackup"];
  runCloudBackupNow: AppState["runCloudBackupNow"];
  resetPreferences: () => void;
  handleExportPackage: (mode: PackageExportMode) => Promise<void>;
  shareProjectUrl: string | null;
  shareProjectWarningCount: number;
  onCloseShareProject: () => void;
  incomingDropboxShareUrl: string | null;
  importSharedSightlinesPackage: AppState["importSharedSightlinesPackage"];
  onLeaveIncomingShare: () => void;
  fileInputRef: RefObject<HTMLInputElement>;
  isExportPdfOpen: boolean;
  handleExportPdfOpenChange: (open: boolean) => void;
  isExportChecklistOpen: boolean;
  setIsExportChecklistOpen: (open: boolean) => void;
  handleExportChecklist: (options: ChecklistExportOptions) => Promise<void>;
  isExportingChecklist: boolean;
  handleExportPdf: (settings: EffectiveDocumentSettings) => Promise<void>;
  savedViewThumbnailUrls: UseSavedViewThumbnails["urls"];
  pdfExportProgress: { done: number; total: number } | null;
  handleCancelExportPdf: () => void;
  savedViewsPaneVisible: boolean;
  thumbnailsPending: boolean;
  artworksById: Map<string, Artwork>;
  getAssetBlob: (key: string) => Promise<Blob>;
  savedViewRenderRef: { current: SavedViewRenderHandle | null };
  libraryPickerOpen: boolean;
  setLibraryPickerOpen: (open: boolean) => void;
  libraryArtworks: Artwork[];
  addExistingArtworksToChecklist: AppState["addExistingArtworksToChecklist"];
  confirmDeleteRoomId: string | null;
  setConfirmDeleteRoomId: (roomId: string | null) => void;
  confirmDeleteRoomPlacement: RoomPlacement | null;
  confirmDeleteRoomSummary: RoomContentsSummary | null;
  deleteRoom: AppState["deleteRoom"];
  openWallRequest: OpenWallRequest | null;
  setConfirmOpenWallId: (wallId: string | null) => void;
  openWall: AppState["openWall"];
  pendingPackageImport: AppState["pendingPackageImport"];
  resolvePackageImportConflicts: AppState["resolvePackageImportConflicts"];
  dismissPackageImport: AppState["dismissPackageImport"];
  recoveryOffer: AppState["recoveryOffer"];
  acceptRecovery: AppState["acceptRecovery"];
  dismissRecovery: AppState["dismissRecovery"];
  usageAnalyticsEnabled: boolean;
  crashReportsEnabled: boolean;
  onUsageAnalyticsChange: (enabled: boolean) => boolean;
  onCrashReportsChange: (enabled: boolean) => boolean;
};

export function AppDialogs({
  project,
  viewMode,
  isHelpOpen,
  setIsHelpOpen,
  importWizardOpen,
  setImportWizardOpen,
  importDestination,
  intakeState,
  importArtworkDrafts,
  addArtworksFromFiles,
  isSettingsOpen,
  setIsSettingsOpen,
  storagePersistence,
  retryStoragePersistence,
  cloudBackupConfigured,
  cloudBackupProviderStatus,
  cloudBackupAccountLabel,
  cloudBackupStatus,
  lastCloudBackupAt,
  connectCloudBackup,
  disconnectCloudBackup,
  runCloudBackupNow,
  resetPreferences,
  handleExportPackage,
  shareProjectUrl,
  shareProjectWarningCount,
  onCloseShareProject,
  incomingDropboxShareUrl,
  importSharedSightlinesPackage,
  onLeaveIncomingShare,
  fileInputRef,
  isExportPdfOpen,
  isExportChecklistOpen,
  setIsExportChecklistOpen,
  handleExportChecklist,
  isExportingChecklist,
  handleExportPdfOpenChange,
  handleExportPdf,
  savedViewThumbnailUrls,
  pdfExportProgress,
  handleCancelExportPdf,
  savedViewsPaneVisible,
  thumbnailsPending,
  artworksById,
  getAssetBlob,
  savedViewRenderRef,
  libraryPickerOpen,
  setLibraryPickerOpen,
  libraryArtworks,
  addExistingArtworksToChecklist,
  confirmDeleteRoomId,
  setConfirmDeleteRoomId,
  confirmDeleteRoomPlacement,
  confirmDeleteRoomSummary,
  deleteRoom,
  openWallRequest,
  setConfirmOpenWallId,
  openWall,
  pendingPackageImport,
  resolvePackageImportConflicts,
  dismissPackageImport,
  recoveryOffer,
  acceptRecovery,
  dismissRecovery,
  usageAnalyticsEnabled,
  crashReportsEnabled,
  onUsageAnalyticsChange,
  onCrashReportsChange
}: AppDialogsProps) {
  // How many checklist works currently have a placement — the checklist export
  // dialog's "Placed works only" count. Membership and placement are
  // independent (a work can be placed without being on the checklist), so this
  // is an intersection, not a length.
  const placedChecklistCount = useMemo(() => {
    const placedIds = new Set<string>();
    for (const object of project.wallObjects) {
      if (object.kind === "artwork") placedIds.add(object.artworkId);
    }
    for (const object of project.floorObjects) {
      if (object.kind === "artwork") placedIds.add(object.artworkId);
    }
    return project.checklistArtworkIds.filter((id) => placedIds.has(id)).length;
  }, [project.checklistArtworkIds, project.wallObjects, project.floorObjects]);

  return (
    <>
      {FontLab ? (
        <Suspense fallback={null}>
          <FontLab />
        </Suspense>
      ) : null}
      <HelpDialog open={isHelpOpen} viewMode={viewMode} onOpenChange={setIsHelpOpen} />
      <Suspense fallback={null}>
        <ImportWizard
          intakeState={intakeState}
          open={importWizardOpen}
          projectUnit={project.unit}
          destination={importDestination}
          onImportDrafts={(drafts) => importArtworkDrafts(drafts, { destination: importDestination })}
          onImportImages={(files) => addArtworksFromFiles(files, { destination: importDestination })}
          onOpenChange={setImportWizardOpen}
        />
        <SettingsDialog
          open={isSettingsOpen}
          onOpenChange={setIsSettingsOpen}
          storageState={storagePersistence}
          onRetryStorage={retryStoragePersistence}
          cloudBackupConfigured={cloudBackupConfigured}
          cloudBackupProviderStatus={cloudBackupProviderStatus}
          cloudBackupAccountLabel={cloudBackupAccountLabel}
          cloudBackupStatus={cloudBackupStatus}
          lastCloudBackupAt={lastCloudBackupAt}
          onConnectCloudBackup={connectCloudBackup}
          onDisconnectCloudBackup={disconnectCloudBackup}
          onRunCloudBackup={runCloudBackupNow}
          resetPreferences={resetPreferences}
          onExport={() => void handleExportPackage("display")}
          onImport={() => fileInputRef.current?.click()}
          onOpenHelp={() => { setIsSettingsOpen(false); setIsHelpOpen(true); }}
          usageAnalyticsEnabled={usageAnalyticsEnabled}
          crashReportsEnabled={crashReportsEnabled}
          onUsageAnalyticsChange={onUsageAnalyticsChange}
          onCrashReportsChange={onCrashReportsChange}
        />
        <ExportPdfDialog
          open={isExportPdfOpen}
          project={project}
          onOpenChange={handleExportPdfOpenChange}
          onExport={(settings) => void handleExportPdf(settings)}
          onPersistenceError={(message) => toast.error(message)}
          thumbnailUrls={savedViewThumbnailUrls}
          artworksById={artworksById}
          exportState={pdfExportProgress}
          onCancelExport={handleCancelExportPdf}
        />
        <ExportChecklistDialog
          open={isExportChecklistOpen}
          checklistCount={project.checklistArtworkIds.length}
          placedCount={placedChecklistCount}
          onOpenChange={setIsExportChecklistOpen}
          onExport={(options) => void handleExportChecklist(options)}
          busy={isExportingChecklist}
        />
      </Suspense>
      {isExportPdfOpen || savedViewsPaneVisible || pdfExportProgress || thumbnailsPending ? (
        <Suspense fallback={null}>
          <SavedViewRenderHost
            project={project}
            artworksById={artworksById}
            getBlob={getAssetBlob}
            actionsRef={savedViewRenderRef}
          />
        </Suspense>
      ) : null}
      <ArtworkLibraryPicker
        open={libraryPickerOpen}
        artworks={libraryArtworks}
        project={project}
        getBlob={getAssetBlob}
        onOpenChange={setLibraryPickerOpen}
        onAddToChecklist={addExistingArtworksToChecklist}
      />
      <DeleteRoomDialog
        roomName={confirmDeleteRoomPlacement?.room.name ?? ""}
        summary={confirmDeleteRoomSummary}
        onConfirm={() => {
          const roomId = confirmDeleteRoomId;
          setConfirmDeleteRoomId(null);
          if (roomId) void deleteRoom(roomId);
        }}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteRoomId(null);
        }}
      />
      <OpenWallDialog
        request={openWallRequest}
        onConfirm={() => {
          // Read the id off the REQUEST, not the raw pending state, so the wall
          // we act on is always the one the dialog just described.
          const wallId = openWallRequest?.wallId ?? null;
          setConfirmOpenWallId(null);
          if (wallId) void openWall(wallId);
        }}
        onOpenChange={(open) => {
          if (!open) setConfirmOpenWallId(null);
        }}
      />
      <ImportConflictDialog
        assetsToSave={pendingPackageImport?.plan.assetsToSave ?? null}
        conflicts={pendingPackageImport?.plan.conflicts ?? null}
        getBlob={getAssetBlob}
        unit={project.unit}
        onResolve={(resolutions) => void resolvePackageImportConflicts(resolutions)}
        onDismiss={dismissPackageImport}
      />
      <ShareProjectDialog
        url={shareProjectUrl}
        warningCount={shareProjectWarningCount}
        onClose={onCloseShareProject}
      />
      <SharedProjectImportDialog
        dropboxUrl={incomingDropboxShareUrl}
        onImport={importSharedSightlinesPackage}
        onLeave={onLeaveIncomingShare}
      />
      <RecoveryDialog
        offer={recoveryOffer}
        onRestore={() => void acceptRecovery()}
        onDismiss={dismissRecovery}
      />
    </>
  );
}
