import { create } from "zustand";
import { toast } from "sonner";
import { z } from "zod";
import { createBrowserImageProcessor } from "../domain/assets/browserImageProcessor";
import { type ImageProcessor } from "../domain/assets/imageIntake";
import {
  type GeometryEditResult
} from "../domain/geometry/editRoom";
import { findSharedBoundary } from "../domain/geometry/sharedWalls";
import { newId } from "../domain/id";
import {
  analyzeSharedOpenings,
  applySharedOpeningActions,
  type SharedOpeningScope
} from "../domain/placement/sharedOpeningAnalysis";
import { normalizeOpeningPairs } from "../domain/placement/openingPairs";
import { isBlockingKind } from "../domain/placement/overlapPolicy";
import { repairSharedOpeningsOnLoad } from "../domain/placement/sharedOpeningLoadRepair";
import { getEffectivePlacementSizeMm } from "../domain/placement/placeArtwork";
import {
  effectiveFloorDepthMm,
  SIZE_MATCH_TOLERANCE_MM
} from "../domain/placement/artworkForm";
import { isMonitorArtwork, monitorBoxSizeMm } from "../domain/geometry/monitorGlyphs";
import { withArtworkFootprintFromMap } from "../domain/framing";
import type { PixelAspect } from "../domain/units/aspectFill";
import type { PlacementWarning } from "../domain/placement/validatePlacement";
import {
  validateChangedWallPlacements as validateChangedWallPlacementsRaw,
  validateWallObjectPlacements as validateWallObjectPlacementsRaw
} from "../domain/placement/validatePlacement";
import {
  type Artwork,
  type ChecklistViewPreferences,
  type DisplayUnit,
  type Project,
  type ProjectSummary,
  type WallObject
} from "../domain/project";
import type { ArtworkLibraryRepository } from "../domain/repositories/artworkLibraryRepository";
import type { AssetRepository } from "../domain/repositories/assetRepository";
import { IndexedDbArtworkLibraryRepository } from "../domain/repositories/indexedDbArtworkLibraryRepository";
import { IndexedDbAssetRepository } from "../domain/repositories/indexedDbAssetRepository";
import { IndexedDbProjectRepository } from "../domain/repositories/indexedDbProjectRepository";
import { IndexedDbProjectSnapshotRepository } from "../domain/repositories/indexedDbProjectSnapshotRepository";
import { IndexedDbSavedViewThumbnailRepository } from "../domain/repositories/indexedDbSavedViewThumbnailRepository";
import { IndexedDbSyncMetaRepository } from "../domain/repositories/indexedDbSyncMetaRepository";
import type { SyncMetaRepository } from "../domain/repositories/syncMetaRepository";
import type { ProjectRepository } from "../domain/repositories/projectRepository";
import { ProjectValidationError } from "../domain/repositories/indexedDbProjectRepository";
import type { ProjectSnapshotRepository } from "../domain/repositories/projectSnapshotRepository";
import { SNAPSHOT_MIN_INTERVAL_MS } from "../domain/repositories/projectSnapshotRepository";
import { selectReferencedArtworks } from "../domain/package/buildPackage";
import { collectReferencedAssetIds, computeBackupFingerprint } from "../domain/backup/fingerprint";
import { migrateProject, migrateProjectWithReport } from "../domain/schema/projectSchema";
import { createSampleProject } from "../domain/sample/sampleProject";
import { parseArtwork } from "../domain/schema/artworkSchema";
import { getFirstWall } from "./projectWalls";
export { getProjectWalls, getSelectedWall } from "./projectWalls";
import { createCrossTabSync, type CrossTabMessage, type CrossTabSync } from "./crossTabSync";
import {
  ARRANGE_SLICE_INITIAL,
  createArrangeSlice,
  type ArrangeSliceActions,
  type ArrangeSliceState
} from "./store/arrangeSlice";
export type { ArrangeSession } from "./store/arrangeSlice";
import {
  ARTWORK_INTAKE_SLICE_INITIAL,
  createArtworkIntakeSlice,
  type ArtworkIntakeSliceActions,
  type ArtworkIntakeSliceState
} from "./store/artworkIntakeSlice";
import {
  createDocumentMetaSlice,
  type DocumentMetaSliceActions
} from "./store/documentMetaSlice";
import {
  createPackageSlice,
  type PackageSliceActions,
  type PendingPackageImport
} from "./store/packageSlice";
import {
  createPlacementSlice,
  type PlacementSliceActions
} from "./store/placementSlice";
export {
  FORBIDDEN_OVERLAP_MESSAGE,
  OVERLAP_BLOCKED_MESSAGE,
  SHARED_OPENING_OFF_BOUNDARY_MESSAGE,
  SHARED_OPENING_SLOT_BLOCKED_MESSAGE,
  sharedOpeningRefusalMessage
} from "./store/placementSlice";
import {
  createSharedOpeningSlice,
  type SharedOpeningSliceActions
} from "./store/sharedOpeningSlice";
export {
  SHARED_OPENING_ALREADY_PAIRED_MESSAGE,
  SHARED_OPENING_REALIGN_BLOCKED_MESSAGE,
  SHARED_OPENING_SPLIT_REFUSED_MESSAGE,
  SHARED_OPENING_TARGET_UNAVAILABLE_MESSAGE,
  sharedOpeningRealignBlockedMessage
} from "./store/sharedOpeningSlice";
import {
  createFloorObjectSlice,
  withNormalizedSupport,
  type FloorObjectSliceActions
} from "./store/floorObjectSlice";
import {
  CLOUD_BACKUP_SLICE_INITIAL,
  createCloudBackupSlice,
  type CloudBackupSliceActions,
  type CloudBackupSliceState
} from "./store/cloudBackupSlice";
import {
  CLOUD_PROJECTS_SLICE_INITIAL,
  createCloudProjectsSlice,
  type CloudProjectsSliceActions,
  type CloudProjectsSliceState
} from "./store/cloudProjectsSlice";
import {
  CLOUD_SYNC_SLICE_INITIAL,
  createCloudSyncSlice,
  createSyncEpoch,
  type CloudSyncSliceActions,
  type CloudSyncSliceState
} from "./store/cloudSyncSlice";
import type { CloudBackupProvider } from "./cloud/provider";
import { createDropboxProvider } from "./cloud/dropbox";
import {
  createProjectManagerSlice,
  type ProjectManagerSliceActions
} from "./store/projectManagerSlice";
import {
  createRoomGeometrySlice,
  type RoomGeometrySliceActions
} from "./store/roomGeometrySlice";
import {
  createSelectionSlice,
  NO_SELECTION,
  selectionWrite,
  type Selection,
  type SelectionSliceActions
} from "./store/selectionSlice";
export {
  objectIdsOf,
  roomIdOf,
  freestandingWallIdOf,
  pickedWallIdOf,
  getSelectedArtworkId,
  getSelectedOpeningId,
  getSelectedWallTextId
} from "./store/selectionSlice";

export type ViewMode = "plan" | "elevation" | "3d" | "library";
export type ArtworkImportDestination = "library" | "checklist";
export type ArtworkProjectMembership = {
  artworkId: string;
  projects: ProjectSummary[];
};

// Entries may atomically undo project state, artwork state, or both.
export type EditEntry = {
  label: string;
  project?: { before: Project; after: Project };
  artwork?: { before: Artwork; after: Artwork };
  // A batch of artwork halves committed under one undo entry (bulk mat/frame),
  // so undo/redo restores the whole batch as a single step. Distinct from the
  // singular `artwork` half a plain updateArtwork records.
  artworks?: { before: Artwork; after: Artwork }[];
};

const UNDO_STACK_LIMIT = 100;

// Whether a stored placement axis still equals the value placement seeded it
// with. Shares SIZE_MATCH_TOLERANCE_MM with the inspector's "Match size to
// work" hint on purpose: that hint appears exactly when a floor placement has
// DIVERGED from the work, and the dimension-edit rebake follows a placement
// exactly while it has NOT. One tolerance, so a box can never be both.
function matchesSeededMm(storedMm: number, seededMm: number): boolean {
  return Math.abs(storedMm - seededMm) < SIZE_MATCH_TOLERANCE_MM;
}

type GeometryEditInfo = {
  anchorVertexId: string;
  changedWallIds: string[];
};

type UpdateArtworkChanges = Partial<
  Pick<
    Artwork,
    | "title"
    | "artist"
    | "date"
    | "accessionNumber"
    | "locationOrLender"
    | "creditLine"
    | "dimensions"
    | "placementForm"
    | "displayAs"
    | "matWidthMm"
    | "frame"
    | "frameIncludedInImage"
  >
> & {
  // VIRTUAL field. Medium is not a column on Artwork: it lives at
  // metadata.medium, the key the spreadsheet import wizard writes
  // (domain/spreadsheetImport/importPlan.ts) and the key every export reads.
  // updateArtwork translates it into that metadata slot so an inspector edit
  // and an import land in exactly the same place. `undefined` (or blank)
  // DELETES the key rather than storing an empty string.
  medium?: string;
};

// The subset a bulk mat/frame apply can write across many works at once. Narrower
// than UpdateArtworkChanges: identity/dimension/placement metadata is per-work,
// so the batch dialog only ever sets or clears the mat band and the frame.
type BulkMatFrameChanges = Partial<Pick<Artwork, "matWidthMm" | "frame">>;

// Which boundary a save failure came from, so its Retry re-runs the right work.
// "project" = the open document's persist; "artworkLibrary" = an artwork-library
// write; the rest are project-management/restore boundaries that also drive the
// error badge.
export type SaveErrorScope =
  | "project"
  | "artworkLibrary"
  | "projectLoad"
  | "projectCreate"
  | "projectDuplicate"
  | "projectDelete"
  | "restore";

export type SaveError = {
  scope: SaveErrorScope;
  message: string;
  // Re-runs exactly what failed; a successful retry clears the error state.
  retry: () => Promise<void>;
};

export type AppState = ArrangeSliceState &
  ArrangeSliceActions &
  ArtworkIntakeSliceState &
  ArtworkIntakeSliceActions &
  CloudBackupSliceState &
  CloudBackupSliceActions &
  CloudProjectsSliceState &
  CloudProjectsSliceActions &
  CloudSyncSliceState &
  CloudSyncSliceActions &
  DocumentMetaSliceActions &
  FloorObjectSliceActions &
  PackageSliceActions &
  PlacementSliceActions &
  ProjectManagerSliceActions &
  RoomGeometrySliceActions &
  SelectionSliceActions &
  SharedOpeningSliceActions & {
  project: Project | null;
  // Sole selection state; write through selectionWrite and derive via helpers.
  selection: Selection;
  // Persistent sidebar wall context. Survives object selection; dropped only by
  // room selection and full clears. NOT part of the selection union.
  wallContextId: string | null;
  viewMode: ViewMode;
  saveState: "idle" | "saving" | "saved" | "error";
  error: string | null;
  // Scoped provenance for the current save failure (null when not erroring).
  // `saveState === "error"` alone can't tell a failed project save from a failed
  // artwork-library save (or a failed load/restore) — so a generic retry would
  // re-run the wrong thing. Each failing boundary records what failed and a
  // closure that re-runs exactly that. Cleared on a real recovery, not per
  // keystroke, so the failure toast fires only on the transition into error.
  saveError: SaveError | null;
  placementWarnings: PlacementWarning[];
  lastGeometryEdit: GeometryEditInfo | null;
  undoStack: EditEntry[];
  redoStack: EditEntry[];
  libraryArtworks: Artwork[];
  intakeState: "idle" | "processing";
  // A .sightlines import paused on §6 artwork conflicts, awaiting one review
  // step in the conflict dialog. Nothing has been persisted yet. Carries the
  // plan plus the provenance the eventual commit still needs.
  pendingPackageImport: PendingPackageImport | null;
  // Set when a project fails to load with a typed corruption error AND a
  // schema-valid earlier snapshot exists. Drives the recovery dialog; a restore
  // is never applied silently.
  recoveryOffer: RecoveryOffer | null;
  boot: () => Promise<void>;
  /**
   * Begin listening for saves from this app's other tabs. Idempotent; boot()
   * calls it, and boot runs once per tab.
   */
  startCrossTabSync: () => void;
  /** Dev-only, non-persisting document swap used by renderer benchmarks. */
  loadBenchmarkFixture: (project: Project, artworks: Artwork[]) => void;
  renameProject: (title: string) => Promise<void>;
  // Saved-project rename; the open document still routes through undoable renameProject.
  renameProjectById: (id: string, title: string) => Promise<void>;
  setUnit: (unit: DisplayUnit) => Promise<void>;
  setDefaultWallHeightMm: (heightMm: number) => Promise<void>;
  setDefaultCenterlineHeightMm: (heightMm: number) => Promise<void>;
  // Records the checklist panel's explicit sort/grouping choice on the
  // project (project.checklistView) — an undoable edit like any other, so it
  // travels with the exhibition through packages and sync.
  setChecklistView: (view: ChecklistViewPreferences) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  updateArtwork: (artworkId: string, changes: UpdateArtworkChanges) => Promise<void>;
  // Applies one mat/frame change to many library works in a single undo entry.
  // Skips works whose stored size already includes the frame
  // (frameIncludedInImage) — the single inspector locks their mat/frame too —
  // and reports how many were skipped so the caller can say so.
  updateArtworksMatFrame: (
    artworkIds: string[],
    changes: BulkMatFrameChanges
  ) => Promise<{ updated: number; skipped: number }>;
  // Restore a stored snapshot as the open document: snapshot the current doc
  // first (a pre-restore copy), then load, migrate, and persist the snapshot.
  restoreProjectSnapshot: (key: string) => Promise<void>;
  // Accept/dismiss the recovery offer surfaced after a failed load.
  acceptRecovery: () => Promise<void>;
  dismissRecovery: () => void;
};

// Selection rides along as the whole {selection, wallContextId} bundle
// (spread from selectionWrite), never as loose fields — so an edit that
// changes selection can't set the union without its wall context.
export type EditExtras = Partial<
  Pick<
    AppState,
    | "placementWarnings"
    | "lastGeometryEdit"
    | "arrangeSession"
    | "viewMode"
    | "selection"
    | "wallContextId"
  >
>;

export type AppStoreDeps = {
  projectRepository: ProjectRepository;
  artworkLibraryRepository: ArtworkLibraryRepository;
  assetRepository: AssetRepository;
  imageProcessor: ImageProcessor;
  projectSnapshotRepository: ProjectSnapshotRepository;
  // Per-project cross-device sync bookkeeping (account id + accepted revision).
  // Device-local, never part of the project document.
  syncMetaRepository: SyncMetaRepository;
  // Cloud-backup provider seam. Absent (or unconfigured) leaves the whole
  // feature inert — status stays "disconnected" and the UI hides it.
  cloudBackupProvider?: CloudBackupProvider;
  // Cross-tab notification seam. Absent means the store opens a real
  // BroadcastChannel the first time it needs one, which is what the app wants.
  // Tests pass createInertCrossTabSync() (or a fake) instead: a test process is
  // ONE browsing context, so every store built in it would otherwise share one
  // channel and hear every other store's saves.
  crossTabSync?: CrossTabSync;
  onProjectDeleted?: (projectId: string) => void | Promise<void>;
};

// A schema-valid earlier copy of a project that failed to load, offered for
// restore via the recovery dialog. Populated only on a typed load failure
// (ProjectValidationError) with a snapshot that itself parses/migrates cleanly.
export type RecoveryOffer = {
  projectId: string;
  snapshotKey: string;
  createdAt: string;
};

export function createAppStore(deps: AppStoreDeps) {
  return create<AppState>((set, get) => {
    // Which authorization in-flight sync operations were started under. It
    // lives out here because setDocument — the choke point every document
    // entry path goes through — has to bump it, while the sync slice does the
    // checking. Deliberately not store state: see createSyncEpoch.
    const syncEpoch = createSyncEpoch();

    function projectWithArtworkFootprints(
      project: Project,
      artworks: Artwork[] = get().libraryArtworks
    ): Project {
      const artworksById = new Map(artworks.map((artwork) => [artwork.id, artwork]));
      return {
        ...project,
        wallObjects: project.wallObjects.map((wallObject) =>
          withArtworkFootprintFromMap(wallObject, artworksById)
        )
      };
    }

    // Placement validation stays framing-agnostic. Widen resolved artwork
    // copies only at this store boundary; persisted placement dimensions remain
    // image-sized.
    function validateChangedWallPlacements(project: Project, changedWallIds: string[]) {
      return validateChangedWallPlacementsRaw(
        projectWithArtworkFootprints(project),
        changedWallIds
      );
    }

    function validateWallObjectPlacements(
      project: Project,
      wallObjectIds: string[],
      artworks?: Artwork[]
    ) {
      return validateWallObjectPlacementsRaw(
        projectWithArtworkFootprints(project, artworks),
        wallObjectIds
      );
    }

    // --- silent recovery snapshots -------------------------------------------
    //
    // Module-level (per createAppStore call) session state, all keyed by project
    // id: which projects have SUCCEEDED at their once-per-session open snapshot,
    // how many open snapshots have failed for each, the attempt currently in
    // flight, and when each was last snapshotted (for the interval gate).
    //
    // Membership in snapshottedThisSession means "a copy is down", never "we
    // tried". Recording the attempt instead would let a failed snapshot silence
    // every later attempt AND, worse, report success to the write-back that is
    // about to overwrite the only stored copy.
    const snapshottedThisSession = new Set<string>();
    const failedOpenSnapshotsByProject = new Map<string, number>();
    const openSnapshotInFlight = new Map<string, Promise<boolean>>();
    const lastSnapshotAtByProject = new Map<string, number>();

    // A device that cannot write snapshots at all (quota, corrupt store) would
    // otherwise pay the full failing write on every open, forever. Retry a
    // handful of times per project per session — enough to ride out a transient
    // failure, bounded enough that a permanent one stops costing anything.
    const OPEN_SNAPSHOT_ATTEMPT_LIMIT = 3;

    // Fingerprint the document plus the referenced artwork/asset set, then store
    // a snapshot. The repo dedupes identical fingerprints; we still record the
    // attempt time so the interval gate advances.
    async function writeSnapshot(project: Project): Promise<void> {
      const artworks = selectReferencedArtworks(project, get().libraryArtworks);
      const assetIds = collectReferencedAssetIds(artworks);
      const fingerprint = computeBackupFingerprint({ project, artworks, assetIds });
      await deps.projectSnapshotRepository.add({
        projectId: project.id,
        createdAt: new Date().toISOString(),
        projectTitle: project.title,
        fingerprint,
        project
      });
      lastSnapshotAtByProject.set(project.id, Date.now());
    }

    // Once per project per app session, when it becomes the open document.
    // Fire-and-forget for every caller that only wants a recovery copy taken;
    // a snapshot failure never affects opening, which is why the returned
    // promise RESOLVES on failure rather than rejecting.
    //
    // It resolves to whether a copy is down, and it returns that promise, so the
    // one caller that is about to overwrite the stored original — the
    // load-repair write-back in openLoadedDocument — can both wait for the copy
    // and find out whether it landed. A resolved-but-failed promise used to be
    // indistinguishable from success, which let the destructive write proceed
    // with nothing behind it. Awaiting is still the caller's choice: making the
    // snapshot block every open would trade a rare hazard for a certain delay.
    function snapshotOnOpen(project: Project): Promise<boolean> {
      if (snapshottedThisSession.has(project.id)) return Promise.resolve(true);

      // Two opens of the same document can overlap (open, switch away, switch
      // back while the first write is still in flight). Share the attempt
      // rather than starting a second write of the same copy.
      const inFlight = openSnapshotInFlight.get(project.id);
      if (inFlight) return inFlight;

      if ((failedOpenSnapshotsByProject.get(project.id) ?? 0) >= OPEN_SNAPSHOT_ATTEMPT_LIMIT) {
        return Promise.resolve(false);
      }

      const attempt = writeSnapshot(project)
        .then(
          () => {
            snapshottedThisSession.add(project.id);
            return true;
          },
          (error) => {
            failedOpenSnapshotsByProject.set(
              project.id,
              (failedOpenSnapshotsByProject.get(project.id) ?? 0) + 1
            );
            console.warn("Could not write a recovery snapshot", error);
            return false;
          }
        )
        .finally(() => {
          openSnapshotInFlight.delete(project.id);
        });
      // Safe to register after the chain is built: writeSnapshot is async, so
      // nothing above can have run its .finally before this line.
      openSnapshotInFlight.set(project.id, attempt);
      return attempt;
    }

    // Interval-gated snapshot from the save path: skip when the last snapshot of
    // this project was under SNAPSHOT_MIN_INTERVAL_MS ago. The last-snapshot time
    // is seeded lazily from stored snapshots so a fresh session doesn't
    // immediately re-snapshot a project that was snapshotted moments before.
    async function maybeIntervalSnapshot(project: Project): Promise<void> {
      try {
        let last = lastSnapshotAtByProject.get(project.id);
        if (last === undefined) {
          const summaries = await deps.projectSnapshotRepository.listByProject(project.id);
          last = summaries[0] ? Date.parse(summaries[0].createdAt) : 0;
          lastSnapshotAtByProject.set(project.id, last);
        }
        if (Date.now() - last < SNAPSHOT_MIN_INTERVAL_MS) return;
        await writeSnapshot(project);
      } catch (error) {
        console.warn("Could not write a recovery snapshot", error);
      }
    }

    // Search a project's snapshots newest→oldest for the first whose stored
    // document still parses/migrates cleanly, and offer it for recovery. Returns
    // true when an offer was set. Any snapshot-store failure degrades to "no
    // offer" rather than throwing over the load error that triggered it.
    async function offerRecovery(projectId: string): Promise<boolean> {
      try {
        const summaries = await deps.projectSnapshotRepository.listByProject(projectId);
        for (const summary of summaries) {
          const record = await deps.projectSnapshotRepository.get(summary.key);
          if (!record) continue;
          try {
            migrateProject(record.project);
          } catch {
            // A snapshot can itself be stale/invalid — skip to an older one.
            continue;
          }
          set({
            recoveryOffer: {
              projectId,
              snapshotKey: summary.key,
              createdAt: summary.createdAt
            }
          });
          return true;
        }
      } catch (error) {
        console.warn("Could not search for a recovery snapshot", error);
      }
      return false;
    }

    // --- cross-tab refresh ---------------------------------------------------
    //
    // All tabs share one IndexedDB database, but each holds its OWN full copy of
    // the open project and writes the whole document on every edit. A second tab
    // that boots and then sits idle is holding a stale document whose first edit
    // would overwrite everything the first tab saved. So: after a successful
    // save we say so on a BroadcastChannel, and a tab that hears about a newer
    // copy of the document it has open reloads that document from storage.
    //
    // The advertised trade-offs, deliberately not "fixed" here: two tabs editing
    // the same instant still resolve last-write-wins, and an external reload
    // resets that tab's undo/redo history and selection (setDocument's contract
    // — undoing across a document swap would resurrect the old document). This
    // is a refresh, not a merge, and never a multiplayer session.
    let crossTabSync: CrossTabSync | null = null;
    let crossTabSyncStarted = false;
    // The project id of a reload we know we owe but have not been able to take
    // yet. At most one is ever outstanding: a second announcement about the same
    // project just means "still stale", which is what this already records.
    let pendingExternalReloadProjectId: string | null = null;

    // Resolved lazily so a store that never saves and never boots — most unit
    // tests — opens no channel at all.
    function getCrossTabSync(): CrossTabSync {
      if (!crossTabSync) crossTabSync = deps.crossTabSync ?? createCrossTabSync();
      return crossTabSync;
    }

    // Why a reload is DEFERRED rather than applied on arrival: it wipes undo,
    // redo and selection, so doing it under the user's hands mid-drag would be
    // worse than the staleness it cures. An unfocused tab has no hands in it, so
    // it refreshes immediately; a focused one waits for the user to leave and
    // come back, and re-checks on every later trigger in the meantime.
    type ExternalReloadTrigger = "message" | "focus" | "save";

    async function flushExternalReload(trigger: ExternalReloadTrigger): Promise<void> {
      const projectId = pendingExternalReloadProjectId;
      if (!projectId) return;

      // The project was closed, swapped or deleted while we owed it a reload —
      // whatever is open now is not what the announcement was about.
      if (get().project?.id !== projectId) {
        pendingExternalReloadProjectId = null;
        return;
      }

      // "focus" IS the moment the user came back, so it is allowed to reload a
      // now-focused tab; every other trigger defers while the tab has focus.
      const focused = typeof document !== "undefined" && document.hasFocus();
      if (focused && trigger !== "focus") return;
      // Mid-save: our own write is in flight and about to move updatedAt.
      if (get().saveState === "saving") return;
      // A live arrange preview is uncommitted work drawn from this document.
      if (get().arrangeSession != null) return;

      // Claim the pending reload before the await. Every path from here drops it
      // (applied, overtaken, or failed); a fresh announcement arriving during the
      // load re-arms it, and that later flush is the one that should win.
      pendingExternalReloadProjectId = null;

      let loaded: Project;
      try {
        loaded = await deps.projectRepository.load(projectId);
      } catch (error) {
        // A passive refresh never gets to speak: no toast, no error state, no
        // saveError. The next save in the other tab announces again and this
        // retries naturally.
        console.warn("Could not refresh the project after another tab saved it", error);
        return;
      }

      const current = get().project;
      // Re-check both facts after the await — the document can have been swapped
      // or edited past the announcement while we were reading storage.
      if (current?.id !== projectId) return;
      if (loaded.updatedAt <= current.updatedAt) return;

      // NOT openLoadedDocument, and nothing persists after this. A tab
      // refreshing someone else's save must never write the document back: no
      // snapshot (there is nothing to protect — we are not overwriting anything)
      // and no save (writing what we just read is how a stale tab clobbers a
      // fresh one in the first place). If setDocument's load repair changes the
      // document it downgrades saveState to "idle" on its own — that is honest,
      // because the repaired copy is genuinely not what storage holds, and the
      // user's next edit writes it.
      setDocument(loaded, { saveState: "saved" });

      // The project id has not changed, so App's project-keyed refresh will not
      // run — and the document this tab now holds is the other tab's, whose
      // fingerprint decides whether this project still reads as synced. Nothing
      // is written here: the refresh only reads the metadata record.
      await get().refreshProjectSyncState();
    }

    async function refreshLibraryArtworks(): Promise<void> {
      try {
        const libraryArtworks = await deps.artworkLibraryRepository.list();
        // ONLY libraryArtworks. saveState/error/saveError belong to this tab's
        // own in-flight work (see how carefully saveArtworkHalves manages them);
        // another tab's library write says nothing about them.
        set({ libraryArtworks });
      } catch (error) {
        console.warn("Could not refresh the artwork library after another tab saved it", error);
      }
    }

    async function handleCrossTabMessage(message: CrossTabMessage): Promise<void> {
      if (message.kind === "artworks-saved") {
        // The library is device-level and not undoable, so there is nothing to
        // defer for: re-list it immediately.
        await refreshLibraryArtworks();
        return;
      }

      const project = get().project;
      if (!project || project.id !== message.projectId) return;
      // Both timestamps are Date#toISOString output (UTC, fixed width), so
      // lexical comparison is chronological. Equal counts as "already have it":
      // the other tab may simply have re-saved the same document.
      if (message.updatedAt <= project.updatedAt) return;

      pendingExternalReloadProjectId = message.projectId;
      await flushExternalReload("message");
    }

    function startCrossTabSync(): void {
      if (crossTabSyncStarted) return;
      crossTabSyncStarted = true;

      getCrossTabSync().subscribe((message) => {
        void handleCrossTabMessage(message);
      });

      // The deferred reload's other half: a tab that skipped its refresh because
      // the user was working in it takes it the moment they come back.
      if (typeof window !== "undefined") {
        window.addEventListener("focus", () => {
          void flushExternalReload("focus");
        });
      }
    }

    function finishProjectPersist(project: Project): void {
      // Clear any prior save failure — a successful persist is the recovery.
      set({ saveState: "saved", saveError: null });
      // Tell the other tabs what is now in storage, so the one holding a stale
      // copy of THIS project can reload instead of overwriting us later.
      getCrossTabSync().announceProjectSaved(project.id, project.updatedAt);
      // Fire-and-forget: an interval snapshot must never affect saving.
      void maybeIntervalSnapshot(project);
      // A reload we owed but deferred may be flushable now that this save is
      // done (the "saving" gate above is one of the reasons it can be stuck).
      void flushExternalReload("save");
    }

    // A ZodError's .message is the JSON-stringified issue array, which is
    // what used to be dumped into the banner and the retry toast. Show the
    // issue's own sentence instead — unlike formatZodIssue (used on the
    // artwork path, where the path names an editable field), a schema
    // path here is an internal object id the user cannot act on.
    function describeSaveError(error: unknown): string {
      return error instanceof z.ZodError
        ? `Couldn't save: ${formatZodIssueMessage(error)}`
        : error instanceof Error
          ? error.message
          : "Could not save project.";
    }

    function failProjectPersist(
      error: unknown,
      retry: () => Promise<void>
    ): void {
      const message = describeSaveError(error);
      set({
        saveState: "error",
        error: message,
        saveError: {
          scope: "project",
          message,
          retry
        }
      });
    }

    async function persist(project: Project): Promise<boolean> {
      set({ saveState: "saving", error: null });

      try {
        await deps.projectRepository.save(project);
        finishProjectPersist(project);
        return true;
      } catch (error) {
        failProjectPersist(error, async () => {
          await persist(project);
        });
        return false;
      }
    }

    async function persistIfAbsent(
      project: Project
    ): Promise<"created" | "exists" | "failed"> {
      // The record this call writes is NOT the open document — it is an import
      // claiming an id — so an outcome that writes nothing at all must leave
      // the open document's save bookkeeping reading exactly as it did before.
      // Captured before the "saving" paint below overwrites it.
      const beforeCall: Pick<AppState, "saveState" | "error" | "saveError"> = {
        saveState: get().saveState,
        error: get().error,
        saveError: get().saveError
      };
      set({ saveState: "saving", error: null });

      // INVARIANT: the capture goes back only while the bookkeeping still reads
      // as this call's own entry left it — "saving", over the same save failure
      // (or absence of one) it found. Anything else means a save of the OPEN
      // document wrote in between, and its outcome is both newer than the
      // capture and about a document this call never touched: putting "saving"
      // back over a save that has since finished leaves a badge spinning with
      // nothing in flight, and putting "saved" back over one that has since
      // failed drops the retry closure that is the curator's only way out.
      const restoreBookkeeping = (): void => {
        if (get().saveState !== "saving" || get().saveError !== beforeCall.saveError) return;
        set(beforeCall);
      };

      try {
        const created = await deps.projectRepository.create(project);
        if (!created) {
          // A create-only collision is an import refusal, not a failure to save
          // the document already open in this tab. Leave no red save badge or
          // retry that could later turn the guarded insert into an overwrite —
          // and equally, do not report "Saved" over a save failure the open
          // document already had, whose retry closure is the user's way back.
          restoreBookkeeping();
          return "exists";
        }
        finishProjectPersist(project);
        return "created";
      } catch (error) {
        // No saveError, and so no retry: the only thing that closure could
        // re-run is this create, which would put the import's project record on
        // this device with no assets, no artworks and no sync metadata behind
        // it — the unrecoverable orphan the import's own unwind exists to
        // prevent, one toast click away. The import reports its own failure,
        // and retrying it re-runs the whole handoff, which now has no record in
        // its way. Only the banner carries the reason the caller reports.
        restoreBookkeeping();
        set({ error: describeSaveError(error) });
        return "failed";
      }
    }

    // Open a document from local storage (boot, openProject) and, when the
    // shared-opening load repair changed it, write the repaired copy back.
    //
    // INVARIANT: that write overwrites the user's stored original, so the
    // recovery snapshot of the original must have LANDED first; the bail-outs
    // below leave the repair in memory on the "idle" badge rather than claiming
    // "Saved" over a document storage does not hold.
    //
    // `stored` is the document as the repository read it BEFORE the support
    // repair (ProjectLoadReport.stored): the same reference as `project` unless
    // the load normaliser re-fitted a support. It is what the snapshot copies,
    // and its differing from `project` is the second reason to write back —
    // the repository has already applied that repair, so setDocument sees
    // nothing left to do and would otherwise leave the malformed record in
    // storage to be repaired and announced again on every open.
    async function openLoadedDocument(
      project: Project,
      extras: Partial<AppState> = {},
      stored: Project = project
    ): Promise<Project> {
      // Pass the PRE-repair document to the snapshot: the whole point of the
      // copy is to be what storage held before this open touched it.
      const opened = setDocument(project, extras);
      const snapshot = snapshotOnOpen(stored);
      // setDocument returns its input by reference when the repair applied
      // nothing (the openingPairs.ts:123 memoization convention).
      if (opened === project && stored === project) return opened;

      // No copy, no destructive write. Opening still succeeds — a snapshot
      // problem must never be the reason a project won't open — but overwriting
      // the user's ONLY stored copy with nothing behind it is exactly the
      // hazard the ordering above exists to prevent.
      if (!(await snapshot)) return opened;

      // LOST-UPDATE GUARD. This is the only open path with an await between
      // installing the document and persisting it, so it is the only one with a
      // window in which the app is interactive and the document can move on
      // under us. (duplicateProject and commitPackageImport persist in the same
      // beat as their setDocument — no window, no guard needed.) Writing
      // `opened` now would clobber a newer edit and, worse, badge it "Saved".
      //
      // Reference identity is sufficient because every path that changes the
      // open document installs a NEW Project object: applyEdit/pushEditEntry
      // build `{...next, updatedAt}` object literals, and setDocument installs a
      // freshly loaded, migrated or imported document. Nothing mutates
      // state.project in place. The one case where identity still holds after a
      // detour is undo restoring this exact object — and then `opened` IS the
      // current document, so writing it is correct rather than stale.
      if (get().project !== opened) return opened;

      // persist() owns the failure surface: a repair that could not be written
      // settles on "Save issue" with a retry, never on a saved-looking badge.
      await persist(opened);
      return opened;
    }

    // Apply project/artwork halves together and create one undo entry.
    function pushEditEntry(entry: EditEntry, extras: EditExtras = {}) {
      set({
        ...(entry.project ? { project: entry.project.after } : {}),
        undoStack: [...get().undoStack, entry].slice(-UNDO_STACK_LIMIT),
        redoStack: [],
        placementWarnings: [],
        lastGeometryEdit: null,
        // Committed edits cannot leave previews pointing at stale positions.
        arrangeSession: null,
        ...extras
      });
    }

    // Project-only transaction boundary: timestamp, undo, redo reset, persistence.
    async function applyEdit(
      label: string,
      buildNextProject: (project: Project) => Project,
      extras: EditExtras = {}
    ) {
      const before = get().project;
      if (!before) return;

      const after = {
        ...buildNextProject(before),
        updatedAt: new Date().toISOString()
      };

      pushEditEntry({ label, project: { before, after } }, extras);
      await persist(after);
    }

    // Shared by undo/redo to reapply an entry's artwork half: save the given
    // side of the artwork to the library and refresh libraryArtworks from
    // it, the same shape as a forward updateArtwork commit.
    async function saveArtworkHalf(artwork: Artwork) {
      await saveArtworkHalves([artwork]);
    }

    // Batch variant of saveArtworkHalf: persist several artwork records, then
    // refresh libraryArtworks once. Shared by the bulk mat/frame apply and by
    // undo/redo reapplying a batched entry's halves.
    async function saveArtworkHalves(artworks: Artwork[]) {
      try {
        for (const artwork of artworks) {
          await deps.artworkLibraryRepository.save(artwork);
        }
        const libraryArtworks = await deps.artworkLibraryRepository.list();
        // The happy path leaves saveState alone (the project half owns it); but
        // when this succeeds as the retry of a prior artwork-save failure, it is
        // the recovery — clear the error state so the badge and toast settle.
        if (get().saveError) {
          set({ libraryArtworks, saveState: "saved", error: null, saveError: null });
        } else {
          set({ libraryArtworks });
        }
        // The artwork library is device-level: every tab shows the same works
        // regardless of which project is open, so this needs no id or timestamp
        // to compare — the other tabs just re-read it.
        getCrossTabSync().announceArtworksSaved();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not save the artwork library.";
        set({
          saveState: "error",
          error: message,
          // Retry re-saves this exact batch of artwork records.
          saveError: {
            scope: "artworkLibrary",
            message,
            retry: async () => {
              await saveArtworkHalves(artworks);
            }
          }
        });
      }
    }

    // Best-effort image aspect for an artwork's linked asset, feeding
    // getEffectivePlacementSizeMm so partial/unknown dims still bake a placement
    // at the image's true proportions. A missing assetId or a failed load
    // degrades to "no ratio" (placeholder behavior), never throws.
    async function loadArtworkAspect(artwork: Artwork): Promise<PixelAspect | undefined> {
      if (!artwork.assetId) return undefined;
      try {
        const asset = await deps.assetRepository.getAsset(artwork.assetId);
        return { widthPx: asset.widthPx, heightPx: asset.heightPx };
      } catch {
        return undefined;
      }
    }

    // Replacing the whole document (boot, import, reset) starts a new edit
    // history — undoing across a document swap would resurrect the old one.
    //
    // This is also the choke point for the shared-opening load repair, which
    // has to cover EVERY document-entry path — boot, sample reset, open,
    // duplicate, JSON import, .sightlines import, snapshot restore, recovery —
    // and this is the one function all of them go through. The repair rides the
    // swap and pushes no undo entry, because the stacks are reset here anyway.
    //
    // RETURNS the document actually installed, which is not necessarily the one
    // passed in. A caller that persists after a swap must persist THIS, or it
    // writes the pre-repair document and then reports "Saved".
    function setDocument(project: Project, extras: Partial<AppState> = {}): Project {
      // A swap supersedes every sync operation in flight: whatever it decided
      // was decided against a document that is no longer here, so its outcome
      // must not paint over this one. Bumped before the state below is written
      // so nothing can bind to the new document under the old authorization.
      // Synchronous and storage-free, like the rest of this function —
      // loadBenchmarkFixture depends on that.
      syncEpoch.documentSwapped();

      const repair = repairSharedOpeningsOnLoad(project, newId);
      const repaired = repair.project !== project;

      // A realign is allowed to land an opening on artwork (isBlockingKind
      // deliberately excludes artwork — that overlap is overridable, not
      // forbidden) but must not do so SILENTLY. Validate only what the repair
      // actually moved; an adopt-only repair has nothing to check.
      //
      // Artwork list: extras.libraryArtworks when the caller is swapping the
      // library in the same beat (package import, boot) — at this point
      // get().libraryArtworks is still the OUTGOING document's library, and
      // validating a just-imported project against it would compute
      // footprints for the wrong artwork set. validateWallObjectPlacements
      // already falls back to get().libraryArtworks when passed undefined,
      // which is what every other caller (open, duplicate, restore) wants:
      // the artwork library is device-level and unchanged by those swaps.
      const placementWarnings =
        repair.realignedIds.length > 0
          ? validateWallObjectPlacements(repair.project, repair.realignedIds, extras.libraryArtworks)
          : [];

      // What the state would settle on if the repair had changed nothing.
      // Callers that omit saveState inherit whatever the previous document left
      // behind — a package import persists BEFORE opening, so "saved" is
      // already on the state by the time it swaps.
      const saveStateWithoutRepair = extras.saveState ?? get().saveState;

      set({
        project: repair.project,
        ...selectionWrite(
          repair.project,
          NO_SELECTION,
          getFirstWall(repair.project)?.id ?? null
        ),
        arrangeSession: null,
        placementWarnings,
        lastGeometryEdit: null,
        undoStack: [],
        redoStack: [],
        error: null,
        // A swap is a clean slate: a prior save failure no longer applies.
        saveError: null,
        pendingDuplicateUploads: [],
        pendingPackageImport: null,
        // Sync state describes the document that was here, so none of it
        // survives a swap; refreshProjectSyncState re-derives the new link, and
        // a same-id swap owes that refresh itself.
        ...CLOUD_SYNC_SLICE_INITIAL,
        ...extras,
        // AFTER extras: a repaired document is not what storage holds, so a
        // caller's saveState:"saved" is downgraded to the interim "idle" until
        // its own persist settles it.
        ...(repaired && saveStateWithoutRepair === "saved"
          ? { saveState: "idle" as const }
          : {})
      });

      // Counted separately from normalizeOpeningPairs' repairedCount, and said
      // separately: that one DISCONNECTS invalid pairs, this one JOINS two faces
      // back into one opening. Rolling them into a single number would describe
      // neither. Declined twins are not reported here — they are standing issues
      // in the rail, not news about this load.
      if (repair.linkedCount > 0) {
        toast.warning(
          repair.linkedCount === 1
            ? "One shared opening was linked while opening this project."
            : `${repair.linkedCount} shared openings were linked while opening this project.`
        );
      }

      return repair.project;
    }

    // Floor supports the LOAD NORMALISER had to re-fit on the way in
    // (migrateProjectWithReport's supportRepairCount): a pedestal narrower than
    // the work standing on it, an offset that had detached it, a stale bonnet
    // height. Said in its own words and counted on its own, never folded into
    // either shared-opening number above — those two are about openings, and
    // reusing their copy for a pedestal would describe the wrong repair.
    //
    // Every path that HAS a report says so: a snapshot restore, a JSON import,
    // and the ordinary opens (boot and openProject), which ask the project
    // repository for loadWithReport rather than dropping the count. Paths that
    // only pass a document through (a passive cross-tab refresh, a rename of a
    // project that isn't open) stay silent — they still normalise, exactly as a
    // shared-opening repair is applied there, they just have no one to tell.
    function reportSupportRepairs(supportRepairCount: number): void {
      if (supportRepairCount <= 0) return;
      toast.warning(
        supportRepairCount === 1
          ? "One pedestal was re-fitted to the work standing on it while opening this project."
          : `${supportRepairCount} pedestals were re-fitted to the works standing on them while opening this project.`
      );
    }

    // The scope a geometry edit reconciles within: the walls it touched, PLUS
    // the walls those face. Both sides are required — an edit scoped to only
    // the moved room's walls cannot see the boundary it is meant to reconcile,
    // because the other face lives on a wall the edit never named.
    //
    // Scope is what stops an opted-in edit repairing the whole document:
    // without it, nudging one room could create a twin in an unrelated gallery.
    function sharedOpeningScope(project: Project, wallIds: Iterable<string>): SharedOpeningScope {
      const walls = new Set<string>();
      for (const wallId of wallIds) {
        walls.add(wallId);
        const boundary = findSharedBoundary(project, wallId);
        if (boundary.status === "confirmed") {
          walls.add(boundary.boundary.wallId);
        } else if (boundary.status === "ambiguous") {
          for (const candidate of boundary.boundaries) walls.add(candidate.wallId);
        }
      }
      return { wallIds: [...walls] };
    }

    // Reconcile shared openings over a CANDIDATE draft, within scope. Returns
    // the draft unchanged (same array reference) when there is nothing to do,
    // so a caller's no-op detection still works.
    //
    // Analysis reads the candidate, not the pre-edit project: the whole point is
    // to answer "given the geometry this edit is about to commit, which openings
    // are now two faces of one opening?".
    // `scopeWallIds` is the scope analysis actually ran over, which is WIDER
    // than `touchedWallIds`: sharedOpeningScope expands again here, against the
    // candidate's completed topology. A caller that validates by wall must use
    // this rather than what it passed in, or an opening created on a wall only
    // the internal expansion reached escapes validation entirely.
    function reconcileSharedOpenings(
      project: Project,
      candidateWallObjects: WallObject[],
      touchedWallIds: string[]
    ): { wallObjects: WallObject[]; validateIds: string[]; scopeWallIds: string[] } {
      const candidate: Project = { ...project, wallObjects: candidateWallObjects };
      const scope = sharedOpeningScope(candidate, touchedWallIds);
      const scopeWallIds = scope.wallIds ?? [];
      const { actions } = analyzeSharedOpenings(candidate, scope);
      if (actions.length === 0) {
        return { wallObjects: candidateWallObjects, validateIds: [], scopeWallIds };
      }

      const applied = applySharedOpeningActions(candidate, actions, newId);
      return {
        wallObjects: applied.project.wallObjects,
        validateIds: [
          ...applied.createdOpeningIds,
          ...applied.realignedIds,
          ...applied.formedPairIds.flat()
        ],
        scopeWallIds
      };
    }

    // Reconciliation for a ROOM-GEOMETRY edit, which commits through applyEdit
    // rather than the placement gate. Returns the reconciled project plus the
    // wall ids whose placements should now be re-validated — the changed walls
    // AND the walls they face, since that is where a twin may have appeared.
    //
    // Scope is the union of what the changed walls faced BEFORE the edit and
    // what they face AFTER it. Post-edit alone misses every edit that REMOVES
    // topology: if wall A was ambiguously backed by B and C, moving (or
    // deleting) C is exactly what makes A↔B uniquely resolvable — but in the
    // completed geometry C's walls no longer lead back to A, so a post-only
    // scope would never reconsider it.
    function reconcileGeometryEdit(
      preProject: Project,
      postProject: Project,
      changedWallIds: string[]
    ): { project: Project; validateWallIds: string[] } {
      const preScope = sharedOpeningScope(preProject, changedWallIds).wallIds ?? [];
      const postScope = sharedOpeningScope(postProject, changedWallIds).wallIds ?? [];
      const scopedWallIds = [...new Set([...preScope, ...postScope])];

      const reconciled = reconcileSharedOpenings(
        postProject,
        postProject.wallObjects,
        scopedWallIds
      );

      // Validate over what reconciliation actually ANALYSED, not over what it
      // was handed. reconcileSharedOpenings expands the scope again through the
      // completed topology, and that expansion is where new geometry appears:
      // resolving an ambiguous A↔B/C by moving C away leaves the pre/post union
      // holding only C and A, then the internal expansion reaches B through the
      // now-unique boundary and creates a twin there. Returning the narrower set
      // let that twin land on B unchecked — no bounds, no collision.
      const validateWallIds = [...new Set([...scopedWallIds, ...reconciled.scopeWallIds])];

      if (reconciled.wallObjects === postProject.wallObjects) {
        return { project: postProject, validateWallIds };
      }
      return {
        project: { ...postProject, wallObjects: reconciled.wallObjects },
        validateWallIds
      };
    }

    // Partition edit boundary: compute, validate affected placements, and commit.
    async function runPartitionEdit(args: {
      label: string;
      errorFallback: string;
      compute: (project: Project) => GeometryEditResult;
      validate?: boolean;
      extras?: (result: GeometryEditResult) => EditExtras;
    }): Promise<void> {
      const project = get().project;
      if (!project) return;

      let result: GeometryEditResult;
      try {
        result = args.compute(project);
      } catch (error) {
        set({
          error: `${args.errorFallback} (${
            error instanceof Error ? error.message : "invalid input."
          }).`
        });
        return;
      }

      const extras: EditExtras = {
        ...(args.extras?.(result) ?? {}),
        ...(args.validate === false
          ? {}
          : {
              placementWarnings: validateChangedWallPlacements(
                result.project,
                result.changedWallIds
              )
            })
      };
      await applyEdit(args.label, () => result.project, extras);
    }

    const placement = createPlacementSlice(set, get, {
      applyEdit,
      pushEditEntry,
      persist: async (project) => {
        await persist(project);
      },
      validateWallObjectPlacements,
      reconcileSharedOpenings,
      loadArtworkAspect
    });
    const { commitWallObjectEdit, commitWallObjectMoves } = placement;

    const sharedOpening = createSharedOpeningSlice(set, get, {
      applyEdit,
      commitWallObjectEdit
    });

    const floorObject = createFloorObjectSlice(set, get, { applyEdit });

    const arrange = createArrangeSlice(set, get, {
      commitWallObjectMoves,
      persist: async (project) => {
        await persist(project);
      }
    });
    const { settleArrangeSession, autoAcceptArrangeSession } = arrange;

    const documentMeta = createDocumentMetaSlice(set, get, { applyEdit });

    const selectionSlice = createSelectionSlice(set, get, { autoAcceptArrangeSession });

    const projectManager = createProjectManagerSlice(set, get, {
      setDocument,
      persist,
      deps,
      openLoadedDocument,
      offerRecovery,
      reportSupportRepairs
    });

    const packageSlice = createPackageSlice(set, get, {
      persist,
      persistIfAbsent,
      setDocument,
      deps,
      syncEpoch
    });

    const cloudBackupSlice = createCloudBackupSlice(set, get, { deps });

    const cloudProjectsSlice = createCloudProjectsSlice(set, get, { deps });

    const cloudSyncSlice = createCloudSyncSlice(set, get, { deps, syncEpoch });

    const artworkIntake = createArtworkIntakeSlice(set, get, {
      applyEdit,
      persist,
      // Intake owns its own library writes (they are outside applyEdit on
      // purpose), so it announces them itself — saveArtworkHalves is not the
      // choke point for the library the way persist is for the document.
      announceArtworksSaved: () => getCrossTabSync().announceArtworksSaved(),
      deps
    });

    const roomGeometry = createRoomGeometrySlice(set, get, {
      applyEdit,
      runPartitionEdit,
      validateChangedWallPlacements,
      reconcileGeometryEdit
    });

    return {
      project: null,
      selection: NO_SELECTION,
      wallContextId: null,
      ...ARRANGE_SLICE_INITIAL,
      viewMode: "plan",
      saveState: "idle",
      error: null,
      saveError: null,
      placementWarnings: [],
      lastGeometryEdit: null,
      undoStack: [],
      redoStack: [],
      libraryArtworks: [],
      intakeState: "idle",
      ...ARTWORK_INTAKE_SLICE_INITIAL,
      ...CLOUD_BACKUP_SLICE_INITIAL,
      ...CLOUD_PROJECTS_SLICE_INITIAL,
      ...CLOUD_SYNC_SLICE_INITIAL,
      pendingPackageImport: null,
      recoveryOffer: null,

      startCrossTabSync,

      async boot() {
        // Listen before anything is loaded. Boot runs once per tab, and a
        // message that lands mid-boot is simply about a project this tab does
        // not have open yet, which handleCrossTabMessage already ignores.
        startCrossTabSync();

        // The library is a secondary document from the project's point of
        // view (docs/plan.md §4.1) — a failure to load it shouldn't take
        // down boot the way a failed project load does. Keep it empty and
        // say so calmly, but only if nothing more important already needs
        // to be surfaced.
        let libraryArtworks: Artwork[] = [];
        let libraryError: string | null = null;
        try {
          libraryArtworks = await deps.artworkLibraryRepository.list();
        } catch (error) {
          libraryError = `Could not load the artwork library (${
            error instanceof Error ? error.message : "unknown error"
          }). Your project is unaffected. Try reloading to pick the library back up.`;
        }

        try {
          const summaries = await deps.projectRepository.list();
          // loadWithReport, not load: this is the everyday open, and a support
          // the load normaliser had to re-fit is exactly the kind of silent
          // change the user should hear about (announced after the document is
          // actually on screen, below).
          const loaded = summaries[0]
            ? await deps.projectRepository.loadWithReport(summaries[0].id)
            : null;
          const project = loaded ? loaded.project : createSampleProject();

          if (!summaries[0]) {
            await deps.projectRepository.save(project);
          }

          await openLoadedDocument(
            project,
            {
              saveState: "saved",
              libraryArtworks,
              error: libraryError
            },
            loaded ? loaded.stored : project
          );
          // persist() clears `error` on its way through "saving", so a repair
          // write-back would swallow the library-load note — which is not a save
          // error and still applies. Restore it only over a clean state, never
          // over a fresh save failure that has more to say.
          if (libraryError && get().error === null) set({ error: libraryError });
          if (loaded) reportSupportRepairs(loaded.supportRepairCount);
        } catch (error) {
          // Keep the app usable with an in-memory sample, but say plainly that
          // the saved project could not load — never silently substitute.
          // The project load failure is the more important message here, so
          // it wins over any calmer library-load note.
          const message = `Could not load the saved project (${
            error instanceof Error ? error.message : "unknown error"
          }). Showing an unsaved sample instead. Your data is still in browser storage.`;
          // setDocument clears saveError by default; pass it through in extras so
          // the load failure keeps its provenance. Retry re-runs the whole boot.
          setDocument(createSampleProject(), {
            saveState: "error",
            libraryArtworks,
            error: message,
            saveError: {
              scope: "projectLoad",
              message,
              retry: async () => {
                await get().boot();
              }
            }
          });
          // A typed corruption error may have a schema-valid earlier copy to
          // offer — a transient read error does not.
          if (error instanceof ProjectValidationError) {
            await offerRecovery(error.projectId);
          }
        }
      },

      loadBenchmarkFixture(project, artworks) {
        // Deliberately bypass persistence: benchmark data must never replace a
        // user's saved local project. The action is only wired to the dev
        // benchmark entry point in App.tsx.
        setDocument(project, {
          viewMode: "3d",
          saveState: "saved",
          libraryArtworks: artworks
        });
      },

      ...selectionSlice.actions,

      ...documentMeta.actions,

      ...roomGeometry.actions,

      ...artworkIntake.actions,

      async renameProject(title) {
        const project = get().project;
        const trimmed = title.trim();
        if (!project || trimmed.length === 0 || trimmed === project.title) return;

        await applyEdit("Rename project", (current) => ({
          ...current,
          title: trimmed
        }));
      },

      async renameProjectById(id, title) {
        const trimmed = title.trim();
        if (trimmed.length === 0) return;

        // Route open-document renames through its undoable live state.
        if (get().project?.id === id) {
          await get().renameProject(title);
          return;
        }

        try {
          const project = await deps.projectRepository.load(id);
          // The project may have become the open document while the load was
          // pending. Never write that now-stale snapshot over live edits.
          if (get().project?.id === id) {
            await get().renameProject(title);
            return;
          }
          if (trimmed === project.title) return;

          await deps.projectRepository.save({
            ...project,
            title: trimmed,
            updatedAt: new Date().toISOString()
          });
        } catch (error) {
          set({
            error: `Could not rename that project (${
              error instanceof Error ? error.message : "unknown error"
            }).`
          });
        }
      },

      async setUnit(unit) {
        const project = get().project;
        if (!project || project.unit === unit) return;

        await applyEdit("Change display unit", (current) => ({
          ...current,
          unit
        }));
      },

      async setDefaultWallHeightMm(heightMm) {
        const project = get().project;
        if (
          !project ||
          !Number.isFinite(heightMm) ||
          heightMm <= 0 ||
          heightMm === project.defaultWallHeightMm
        )
          return;

        await applyEdit("Change default wall height", (current) => ({
          ...current,
          defaultWallHeightMm: heightMm
        }));
      },

      async setDefaultCenterlineHeightMm(heightMm) {
        const project = get().project;
        if (
          !project ||
          !Number.isFinite(heightMm) ||
          heightMm <= 0 ||
          heightMm === project.defaultCenterlineHeightMm
        )
          return;

        await applyEdit("Change default eyeline height", (current) => ({
          ...current,
          defaultCenterlineHeightMm: heightMm
        }));
      },

      async setChecklistView(view) {
        const project = get().project;
        if (
          !project ||
          (project.checklistView?.sort === view.sort &&
            project.checklistView?.groupByArtist === view.groupByArtist)
        )
          return;

        await applyEdit("Change checklist sorting", (current) => ({
          ...current,
          checklistView: view
        }));
      },

      async undo() {
        const entry = get().undoStack.at(-1);
        if (!entry) return;

        set({
          ...(entry.project ? { project: entry.project.before } : {}),
          undoStack: get().undoStack.slice(0, -1),
          redoStack: [...get().redoStack, entry],
          placementWarnings: [],
          lastGeometryEdit: null,
          arrangeSession: null
        });

        if (entry.project) await persist(entry.project.before);
        if (entry.artwork) await saveArtworkHalf(entry.artwork.before);
        if (entry.artworks) await saveArtworkHalves(entry.artworks.map((half) => half.before));
      },

      async redo() {
        const entry = get().redoStack.at(-1);
        if (!entry) return;

        set({
          ...(entry.project ? { project: entry.project.after } : {}),
          redoStack: get().redoStack.slice(0, -1),
          undoStack: [...get().undoStack, entry],
          placementWarnings: [],
          lastGeometryEdit: null,
          arrangeSession: null
        });

        if (entry.project) await persist(entry.project.after);
        if (entry.artwork) await saveArtworkHalf(entry.artwork.after);
        if (entry.artworks) await saveArtworkHalves(entry.artworks.map((half) => half.after));
      },

      ...packageSlice.actions,

      ...cloudBackupSlice.actions,

      ...cloudProjectsSlice.actions,

      ...cloudSyncSlice.actions,

      ...projectManager.actions,

      async updateArtwork(artworkId, changes) {
        const before = get().libraryArtworks.find((artwork) => artwork.id === artworkId);
        if (!before) return;

        // `medium` is virtual (see UpdateArtworkChanges): peel it off before the
        // spread so it can never land as a stray Artwork column, then write it
        // into the metadata slot every importer and exporter already reads.
        const { medium, ...direct } = changes;
        const next: Artwork = { ...before, ...direct };
        if ("medium" in changes) {
          const metadata = { ...before.metadata };
          const trimmed = medium?.trim() ?? "";
          if (trimmed.length === 0) delete metadata.medium;
          else metadata.medium = trimmed;
          next.metadata = metadata;
        }

        const touchedKeys = Object.keys(direct) as (keyof Artwork)[];
        const changedKeys = touchedKeys.filter(
          (key) => JSON.stringify(before[key]) !== JSON.stringify(next[key])
        );
        const metadataChanged =
          JSON.stringify(before.metadata) !== JSON.stringify(next.metadata);
        if (changedKeys.length === 0 && !metadataChanged) return;
        const dimensionsChanged = changedKeys.includes("dimensions");
        // frameIncludedInImage flips the outer footprint (a flagged work drops
        // its mat/frame band via effectiveFraming), so toggling it must trigger
        // the same placement revalidation as a mat/frame edit — otherwise a work
        // that newly fits (or newly overflows) wouldn't re-flag.
        const framingChanged =
          changedKeys.includes("matWidthMm") ||
          changedKeys.includes("frame") ||
          changedKeys.includes("frameIncludedInImage");
        const displayAsChanged = changedKeys.includes("displayAs");

        let parsed: Artwork;
        try {
          parsed = parseArtwork(next);
        } catch (error) {
          // Validate before mutating persistence, project state, or undo history.
          set({
            error: `Could not save that change (${
              error instanceof z.ZodError ? formatZodIssue(error) : "invalid value."
            }).`
          });
          return;
        }

        // Resize wall placements without display overrides, and follow FLOOR
        // placements that have not diverged from the size they were seeded at.
        // Artwork and placement changes share one undo entry.
        const project = get().project;
        let projectEdit: { before: Project; after: Project } | undefined;
        let placementWarnings: PlacementWarning[] = [];
        const affectedIds = new Set<string>();

        if (project && dimensionsChanged) {
          // A derived axis needs the image ratio; skip the asset fetch on the
          // common both-known path (no axis to derive) so a plain dimension
          // edit stays synchronous-cheap. BOTH sides are checked because the
          // floor rebake below reconstructs the OLD seeded size as well — a
          // half-known "before" needs the same ratio the seeding used, or the
          // comparison would read every placement as diverged.
          const needsAspect = [parsed.dimensions, before.dimensions].some(
            (dimensions) =>
              dimensions.widthMm === undefined || dimensions.heightMm === undefined
          );
          const aspect = needsAspect ? await loadArtworkAspect(parsed) : undefined;

          const nextWallObjects = project.wallObjects.map((wallObject) => {
            if (
              wallObject.kind !== "artwork" ||
              wallObject.artworkId !== artworkId ||
              wallObject.displayDimensionsOverride
            ) {
              return wallObject;
            }

            const size = getEffectivePlacementSizeMm(parsed.dimensions, aspect);
            if (size.widthMm === wallObject.widthMm && size.heightMm === wallObject.heightMm) {
              return wallObject;
            }

            affectedIds.add(wallObject.id);
            return { ...wallObject, widthMm: size.widthMm, heightMm: size.heightMm };
          });

          // A floor placement's box is a SEPARATE measurement from the work
          // (see FloorArtworkImageSizeNote): the box is the thing standing on
          // the floor — a projection board, a plinth, a cabinet — and a curator
          // may legitimately have resized it. So this follows a dimension edit
          // only while the box still equals what placement seeded it with; once
          // it has diverged, retyping the work's height must not silently shrink
          // the board back. Divergence is judged against the OLD dimensions,
          // reconstructed through exactly the sources that seeded it
          // (monitorBoxSizeMm for a cabinet, getEffectivePlacementSizeMm +
          // effectiveFloorDepthMm for everything else), so the two can't drift.
          const isMonitor = isMonitorArtwork(parsed);
          const seededBefore = isMonitor
            ? monitorBoxSizeMm(before.dimensions)
            : {
                ...getEffectivePlacementSizeMm(before.dimensions, aspect),
                depthMm: effectiveFloorDepthMm(before.dimensions)
              };
          const seededAfter = isMonitor
            ? monitorBoxSizeMm(parsed.dimensions)
            : {
                ...getEffectivePlacementSizeMm(parsed.dimensions, aspect),
                depthMm: effectiveFloorDepthMm(parsed.dimensions)
              };

          let floorChanged = false;
          const nextFloorObjects = project.floorObjects.map((object) => {
            if (
              object.kind !== "artwork" ||
              object.artworkId !== artworkId ||
              // Same exemption the wall path makes: an explicit display size is
              // the curator's own answer about how big this placement reads.
              object.displayDimensionsOverride
            ) {
              return object;
            }

            // A monitor's cabinet is one indivisible object — its face is 4:3
            // by construction — so all three axes move together or none do.
            // Everything else is judged per CONCERN: the face (width × height,
            // which the work's own dimensions size) and the depth (how thick
            // the board or plinth is, which effectiveFloorDepthMm sizes) are
            // two different questions a curator answers separately in
            // FloorPlacementFields, so each follows on its own.
            const faceMatches =
              matchesSeededMm(object.widthMm, seededBefore.widthMm) &&
              matchesSeededMm(object.heightMm, seededBefore.heightMm);
            const depthMatches = matchesSeededMm(object.depthMm, seededBefore.depthMm);
            const followFace = faceMatches && (!isMonitor || depthMatches);
            const followDepth = isMonitor ? followFace : depthMatches;

            const next = {
              ...object,
              ...(followFace
                ? { widthMm: seededAfter.widthMm, heightMm: seededAfter.heightMm }
                : {}),
              ...(followDepth ? { depthMm: seededAfter.depthMm } : {})
            };
            if (
              next.widthMm === object.widthMm &&
              next.heightMm === object.heightMm &&
              next.depthMm === object.depthMm
            ) {
              return object;
            }
            floorChanged = true;
            // The support's invariants are all stated against the work, so a
            // rebake that grows the work re-fits its pedestal IN THIS SAME
            // entry (and re-derives an unlocked bonnet). Splitting it out would
            // leave one undo restoring a work its own box no longer contains.
            return withNormalizedSupport(next);
          });

          if (affectedIds.size > 0 || floorChanged) {
            const after = {
              ...project,
              ...(affectedIds.size > 0 ? { wallObjects: nextWallObjects } : {}),
              // Floor objects carry no wall bounds to validate (see
              // placeArtworkOnFloor), so this extends the edit without ever
              // joining affectedIds.
              ...(floorChanged ? { floorObjects: nextFloorObjects } : {}),
              updatedAt: new Date().toISOString()
            };
            projectEdit = { before: project, after };
          }
        }

        // Turning a work INTO a box monitor changes the placement's geometry,
        // not just its look: a monitor's floor object is the CABINET (a 4:3
        // face, MONITOR_DEPTH_MM deep), while a framed image's is the work
        // itself. Without this re-seed a flat 20mm-deep board would keep its
        // paper-thin footprint and render as a CRT with no tube.
        //
        // One-directional on purpose. Switching AWAY from monitor leaves the box
        // alone: the only sizes available then are the work's own dimensions,
        // which may be entirely unrecorded, and replacing a real box with a
        // placeholder is a worse answer than leaving a box the curator can drag
        // or retype. (Placing fresh always seeds correctly — placeArtworkOnFloor.)
        if (project && displayAsChanged && parsed.displayAs === "monitor") {
          const base = projectEdit?.after ?? project;
          let floorChanged = false;
          const nextFloorObjects = base.floorObjects.map((object) => {
            if (object.kind !== "artwork" || object.artworkId !== artworkId) return object;
            const size = monitorBoxSizeMm(parsed.dimensions);
            if (
              object.widthMm === size.widthMm &&
              object.heightMm === size.heightMm &&
              object.depthMm === size.depthMm
            ) {
              return object;
            }
            floorChanged = true;
            // Re-seeding the cabinet resizes the work, so its support is
            // re-fitted in the same entry — see the dimension rebake above.
            return withNormalizedSupport({
              ...object,
              widthMm: size.widthMm,
              heightMm: size.heightMm,
              depthMm: size.depthMm
            });
          });
          if (floorChanged) {
            // Floor objects carry no wall bounds to validate (see
            // placeArtworkOnFloor), so this only extends the edit — it never
            // joins affectedIds.
            projectEdit = {
              before: projectEdit?.before ?? project,
              after: {
                ...base,
                floorObjects: nextFloorObjects,
                updatedAt: new Date().toISOString()
              }
            };
          }
        }

        if (project && framingChanged) {
          for (const wallObject of project.wallObjects) {
            if (wallObject.kind === "artwork" && wallObject.artworkId === artworkId) {
              affectedIds.add(wallObject.id);
            }
          }
        }

        if (project && affectedIds.size > 0) {
          const validationArtworks = get().libraryArtworks.map((artwork) =>
            artwork.id === artworkId ? parsed : artwork
          );
          placementWarnings = validateWallObjectPlacements(
            projectEdit?.after ?? project,
            [...affectedIds],
            validationArtworks
          );
        }

        pushEditEntry(
          {
            label: "Edit artwork",
            artwork: { before, after: parsed },
            ...(projectEdit ? { project: projectEdit } : {})
          },
          { placementWarnings }
        );

        await saveArtworkHalf(parsed);
        if (projectEdit) await persist(projectEdit.after);
      },

      async updateArtworksMatFrame(artworkIds, changes) {
        const library = get().libraryArtworks;
        const project = get().project;

        // Distinct ids only: a placement-derived id list can name one artwork
        // twice (a work placed on two walls resolves to the same record).
        const distinctIds = [...new Set(artworkIds)];

        let skipped = 0;
        const halves: { before: Artwork; after: Artwork }[] = [];
        const affectedIds = new Set<string>();

        for (const artworkId of distinctIds) {
          const before = library.find((artwork) => artwork.id === artworkId);
          if (!before) continue;

          // A frame-inclusive work's stored size already contains the frame, so
          // there is no mat/frame band to set — the single inspector locks it,
          // and a bulk apply skips it the same way (counted for the UI note).
          if (before.frameIncludedInImage === true) {
            skipped += 1;
            continue;
          }

          const next: Artwork = { ...before, ...changes };
          // Only mat/frame can move here; a no-op work drops out so a batch
          // that changes nothing for it doesn't churn persistence or undo.
          const changed =
            JSON.stringify(before.matWidthMm) !== JSON.stringify(next.matWidthMm) ||
            JSON.stringify(before.frame) !== JSON.stringify(next.frame);
          if (!changed) continue;

          let parsed: Artwork;
          try {
            parsed = parseArtwork(next);
          } catch (error) {
            // Validate before mutating persistence, state, or undo history —
            // one bad value aborts the whole batch, mirroring updateArtwork.
            set({
              error: `Could not save that change (${
                error instanceof z.ZodError ? formatZodIssue(error) : "invalid value."
              }).`
            });
            return { updated: 0, skipped };
          }

          halves.push({ before, after: parsed });

          // Framing is a read-time expansion (no placement is resized), but the
          // footprint change still needs the same placement revalidation as a
          // single-work mat/frame edit.
          if (project) {
            for (const wallObject of project.wallObjects) {
              if (wallObject.kind === "artwork" && wallObject.artworkId === artworkId) {
                affectedIds.add(wallObject.id);
              }
            }
          }
        }

        if (halves.length === 0) {
          return { updated: 0, skipped };
        }

        let placementWarnings: PlacementWarning[] = [];
        if (project && affectedIds.size > 0) {
          const parsedById = new Map(halves.map((half) => [half.after.id, half.after]));
          const validationArtworks = get().libraryArtworks.map(
            (artwork) => parsedById.get(artwork.id) ?? artwork
          );
          placementWarnings = validateWallObjectPlacements(
            project,
            [...affectedIds],
            validationArtworks
          );
        }

        pushEditEntry(
          {
            // Singular batch still reads as a plain artwork edit in the history.
            label: halves.length === 1 ? "Edit artwork" : "Set mat & frame",
            artworks: halves
          },
          { placementWarnings }
        );

        await saveArtworkHalves(halves.map((half) => half.after));

        return { updated: halves.length, skipped };
      },

      ...placement.actions,

      ...sharedOpening.actions,

      ...floorObject.actions,

      ...arrange.actions,

      async restoreProjectSnapshot(key) {
        // Preserve the current document as a pre-restore copy so an unwanted
        // restore is itself recoverable. Best-effort — a snapshot failure must
        // not block the restore the user asked for.
        const current = get().project;
        if (current) {
          try {
            await writeSnapshot(current);
          } catch (error) {
            console.warn("Could not write a pre-restore snapshot", error);
          }
        }

        set({ saveState: "saving", error: null });

        // Both restore failures below re-run this same restore.
        const retry = async () => {
          await get().restoreProjectSnapshot(key);
        };

        try {
          const record = await deps.projectSnapshotRepository.get(key);
          if (!record) {
            const message = "That copy could no longer be found.";
            set({
              saveState: "error",
              error: message,
              saveError: { scope: "restore", message, retry }
            });
            return;
          }
          const { project, supportRepairCount } = migrateProjectWithReport(record.project);
          // Persist what setDocument actually opened: a snapshot may hold a
          // document the load repair links up, and writing the pre-repair copy
          // back would settle on "Saved" over a document that is not.
          const opened = setDocument(project, { viewMode: "plan", saveState: "saving" });
          reportSupportRepairs(supportRepairCount);
          await persist(opened);
          // Not openLoadedDocument: this path already persists what it opened,
          // and the document at risk here is the one being replaced, which the
          // awaited pre-restore snapshot above already covers.
          // The snapshot deliberately records the copy as it was restored.
          void snapshotOnOpen(project);
          // Same-id swap, so App's project-keyed refresh will not run: re-derive
          // the sync status against the copy that was just restored.
          await get().refreshProjectSyncState();
        } catch (error) {
          const message = `Could not restore that copy (${
            error instanceof Error ? error.message : "unknown error"
          }).`;
          set({
            saveState: "error",
            error: message,
            saveError: { scope: "restore", message, retry }
          });
        }
      },

      async acceptRecovery() {
        const offer = get().recoveryOffer;
        if (!offer) return;
        set({ recoveryOffer: null });
        await get().restoreProjectSnapshot(offer.snapshotKey);
      },

      dismissRecovery() {
        set({ recoveryOffer: null });
      }
    };
  });
}

// The first issue's sentence, lowercased to sit after a "Couldn't save: "
// prefix, with the trailing "(<object id>)" the pairing refinements append
// stripped — it identifies the record for a developer, not for the user.
function formatZodIssueMessage(error: z.ZodError): string {
  const [issue] = error.issues;
  const message = (issue?.message ?? "the project data is invalid.")
    .replace(/\s*\([0-9a-f-]{8,}\)\s*(?=\.?$)/i, "")
    .trim();
  return message.charAt(0).toLowerCase() + message.slice(1);
}

function formatZodIssue(error: z.ZodError): string {
  const [issue] = error.issues;
  const path = issue?.path.join(".");
  return `${path ? `${path}: ` : ""}${issue?.message ?? "invalid value."}`;
}

export const useAppStore = createAppStore({
  projectRepository: new IndexedDbProjectRepository(),
  artworkLibraryRepository: new IndexedDbArtworkLibraryRepository(),
  assetRepository: new IndexedDbAssetRepository(),
  imageProcessor: createBrowserImageProcessor(),
  projectSnapshotRepository: new IndexedDbProjectSnapshotRepository(),
  syncMetaRepository: new IndexedDbSyncMetaRepository(),
  cloudBackupProvider: createDropboxProvider() ?? undefined,
  onProjectDeleted: async (projectId) => {
    const { deleteStoredDocumentExportPreferences } = await import(
      "./hooks/useDocumentExportPreferences"
    );
    deleteStoredDocumentExportPreferences(projectId);
    // A project's Saved-view thumbnails are a derived cache outside the project;
    // they follow its lifecycle alongside the workspace-preference record
    // (saved-views spec §3.2, export-spec §6.3).
    await new IndexedDbSavedViewThumbnailRepository().deleteByProject(projectId);
    // Cloud-backup bookkeeping is a workspace-only record that follows the
    // project's lifecycle too.
    const { deleteCloudBackupMeta } = await import("./store/cloudBackupMeta");
    deleteCloudBackupMeta(projectId);
  }
});
