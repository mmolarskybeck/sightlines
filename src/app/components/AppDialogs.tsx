import { Suspense, lazy, type RefObject } from "react";
import { toast } from "sonner";
import type {
  Artwork,
  Project,
  RoomPlacement
} from "../../domain/project";
import type { PackageExportMode } from "../../domain/schema/packageSchema";
import type { EffectiveDocumentSettings } from "../../domain/export/documentSettings";
import { ArtworkLibraryPicker } from "./library/ArtworkLibrary";
import { DeleteRoomDialog } from "./dialogs/DeleteRoomDialog";
import { RecoveryDialog } from "./dialogs/RecoveryDialog";
import { HelpDialog } from "./dialogs/HelpDialog";
import { ImportConflictDialog } from "./imports/ImportConflictDialog";
import type { SavedViewRenderHandle } from "./three/SavedViewRenderHost";
import type { StoragePersistenceState } from "../hooks/useStoragePersistence";
import type { CloudBackupProviderStatus } from "../cloud/provider";
import type { UseSavedViewThumbnails } from "../hooks/useSavedViewThumbnails";
import type { RoomContentsSummary } from "../roomDeletion";
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
// Lazy so the three.js it pulls in (via SnapshotStage) stays out of the initial
// bundle, like ThreeDView. Mounted only while a thumbnail consumer is visible or
// thumbnail work is pending (Export dialog, or a just-saved view's seed render);
// the code itself is usually already warm via App's idle prefetch.
const SavedViewRenderHost = lazy(() =>
  import("./three/SavedViewRenderHost").then((module) => ({
    default: module.SavedViewRenderHost
  }))
);
const FontLab = import.meta.env.DEV
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
  lastCloudBackupAt: string | null;
  connectCloudBackup: AppState["connectCloudBackup"];
  disconnectCloudBackup: AppState["disconnectCloudBackup"];
  resetPreferences: () => void;
  handleExportPackage: (mode: PackageExportMode) => Promise<void>;
  fileInputRef: RefObject<HTMLInputElement>;
  isExportPdfOpen: boolean;
  handleExportPdfOpenChange: (open: boolean) => void;
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
  pendingPackageImport: AppState["pendingPackageImport"];
  resolvePackageImportConflicts: AppState["resolvePackageImportConflicts"];
  dismissPackageImport: AppState["dismissPackageImport"];
  recoveryOffer: AppState["recoveryOffer"];
  acceptRecovery: AppState["acceptRecovery"];
  dismissRecovery: AppState["dismissRecovery"];
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
  lastCloudBackupAt,
  connectCloudBackup,
  disconnectCloudBackup,
  resetPreferences,
  handleExportPackage,
  fileInputRef,
  isExportPdfOpen,
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
  pendingPackageImport,
  resolvePackageImportConflicts,
  dismissPackageImport,
  recoveryOffer,
  acceptRecovery,
  dismissRecovery
}: AppDialogsProps) {
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
          lastCloudBackupAt={lastCloudBackupAt}
          onConnectCloudBackup={connectCloudBackup}
          onDisconnectCloudBackup={disconnectCloudBackup}
          resetPreferences={resetPreferences}
          onExport={() => void handleExportPackage("display")}
          onImport={() => fileInputRef.current?.click()}
          onOpenHelp={() => { setIsSettingsOpen(false); setIsHelpOpen(true); }}
        />
        <ExportPdfDialog
          open={isExportPdfOpen}
          project={project}
          onOpenChange={handleExportPdfOpenChange}
          onExport={(settings) => void handleExportPdf(settings)}
          onPersistenceError={(message) => toast.error(message)}
          thumbnailUrls={savedViewThumbnailUrls}
          exportState={pdfExportProgress}
          onCancelExport={handleCancelExportPdf}
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
      <ImportConflictDialog
        conflicts={pendingPackageImport?.conflicts ?? null}
        onResolve={(resolutions) => void resolvePackageImportConflicts(resolutions)}
        onDismiss={dismissPackageImport}
      />
      <RecoveryDialog
        offer={recoveryOffer}
        onRestore={() => void acceptRecovery()}
        onDismiss={dismissRecovery}
      />
    </>
  );
}
