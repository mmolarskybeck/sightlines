import { create } from "zustand";
import { toast } from "sonner";
import { z } from "zod";
import { createBrowserImageProcessor } from "../domain/assets/browserImageProcessor";
import { type ImageProcessor } from "../domain/assets/imageIntake";
import {
  type GeometryEditResult
} from "../domain/geometry/editRoom";
import { parseFaceWallId } from "../domain/geometry/freestandingWalls";
import { areSharedBoundaryWalls, findSharedBoundary } from "../domain/geometry/sharedWalls";
import { getFloorWalls } from "../domain/geometry/planObjects";
import type { PlanPlacement } from "../domain/snapping/planSnapTargets";
import { newId } from "../domain/id";
import {
  analyzeSharedOpenings,
  applySharedOpeningActions,
  type SharedOpeningScope
} from "../domain/placement/sharedOpeningAnalysis";
import {
  getDefaultOpeningCenterYMm,
  getDefaultOpeningSizeMm,
  type InsertToolKind,
  type OpeningKind
} from "../domain/placement/createOpening";
import {
  createWallTextPlacement,
  WALL_TEXT_DEFAULT_NAME
} from "../domain/placement/createWallText";
import {
  clearOpeningPartners,
  includePairedOpenings,
  normalizeOpeningPairs
} from "../domain/placement/openingPairs";
import {
  FIT_EPSILON_MM,
  fitOpeningOnWall,
  getOpeningLegalSpan,
  type OpeningFit
} from "../domain/placement/fitOpeningOnWall";
import { createFloorCase, createWallCase } from "../domain/placement/createCase";
import { createArtworkPlacement, getEffectivePlacementSizeMm } from "../domain/placement/placeArtwork";
import { effectiveFloorDepthMm } from "../domain/placement/artworkForm";
import { withArtworkFootprintFromMap } from "../domain/framing";
import type { PixelAspect } from "../domain/units/aspectFill";
import type { PlacementWarning } from "../domain/placement/validatePlacement";
import {
  validateChangedWallPlacements as validateChangedWallPlacementsRaw,
  validateWallObjectPlacements as validateWallObjectPlacementsRaw
} from "../domain/placement/validatePlacement";
import {
  DEFAULT_FLOOR_OBJECT_DEPTH_MM,
  type Artwork,
  type ArtworkFloorObject,
  type BlockedZoneFloorObject,
  type CaseWallObject,
  type ConnectableOpeningWallObject,
  type DisplayUnit,
  type FloorObject,
  type FloorObjectBase,
  type Project,
  type ProjectSummary,
  type WallObject
} from "../domain/project";
import { type ImportPlan } from "../domain/package/importPackage";
import type { ArtworkLibraryRepository } from "../domain/repositories/artworkLibraryRepository";
import type { AssetRepository } from "../domain/repositories/assetRepository";
import { IndexedDbArtworkLibraryRepository } from "../domain/repositories/indexedDbArtworkLibraryRepository";
import { IndexedDbAssetRepository } from "../domain/repositories/indexedDbAssetRepository";
import { IndexedDbProjectRepository } from "../domain/repositories/indexedDbProjectRepository";
import { IndexedDbProjectSnapshotRepository } from "../domain/repositories/indexedDbProjectSnapshotRepository";
import { IndexedDbSavedViewThumbnailRepository } from "../domain/repositories/indexedDbSavedViewThumbnailRepository";
import type { ProjectRepository } from "../domain/repositories/projectRepository";
import { ProjectValidationError } from "../domain/repositories/indexedDbProjectRepository";
import type { ProjectSnapshotRepository } from "../domain/repositories/projectSnapshotRepository";
import { SNAPSHOT_MIN_INTERVAL_MS } from "../domain/repositories/projectSnapshotRepository";
import { selectReferencedArtworks } from "../domain/package/buildPackage";
import { collectReferencedAssetIds, computeBackupFingerprint } from "../domain/backup/fingerprint";
import { migrateProject } from "../domain/schema/projectSchema";
import { createSampleProject } from "../domain/sample/sampleProject";
import { parseArtwork } from "../domain/schema/artworkSchema";
import { getFirstWall, getProjectWalls } from "./projectWalls";
export { getProjectWalls, getSelectedWall } from "./projectWalls";
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
  buildOpeningOnWall,
  moveObjectNoun,
  openingNoun,
  resolveFreeOpeningXMm,
  resolvePairedOpeningSpan,
  syncMovedPairHalves,
  appliedPartnerSync,
  syncPartnerMove,
  syncPartnerResize
} from "./store/openingEdits";
import {
  createPackageSlice,
  type PackageSliceActions
} from "./store/packageSlice";
import {
  CLOUD_BACKUP_SLICE_INITIAL,
  createCloudBackupSlice,
  type CloudBackupSliceActions,
  type CloudBackupSliceState
} from "./store/cloudBackupSlice";
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
  freestandingWallIdOf,
  NO_SELECTION,
  objectIdsOf,
  selectionWrite,
  type Selection,
  type SelectionSliceActions
} from "./store/selectionSlice";
export {
  objectIdsOf,
  roomIdOf,
  freestandingWallIdOf,
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
type EditEntry = {
  label: string;
  project?: { before: Project; after: Project };
  artwork?: { before: Artwork; after: Artwork };
  // A batch of artwork halves committed under one undo entry (bulk mat/frame),
  // so undo/redo restores the whole batch as a single step. Distinct from the
  // singular `artwork` half a plain updateArtwork records.
  artworks?: { before: Artwork; after: Artwork }[];
};

const UNDO_STACK_LIMIT = 100;

// Artwork overlaps require the caller's explicit allowOverlap preference.
export const OVERLAP_BLOCKED_MESSAGE =
  'Can’t place it there. It would overlap another object on this wall. Turn on "Allow overlap" in view options to allow it.';

// Non-artwork overlaps cannot be overridden.
export const FORBIDDEN_OVERLAP_MESSAGE =
  "Can’t place it there. Doors, windows and blocked zones can’t overlap each other.";

// A door or window on a wall two rooms share is ONE opening, stored as one half
// per room. An edit that cannot keep both halves together is refused outright
// rather than quietly leaving two facing alcoves behind, so these say which
// half could not follow and why.
// Worded to fit a move, a resize and a group drag alike — every one of them
// fails for the same reason, and none of them committed anything.
export const SHARED_OPENING_SLOT_BLOCKED_MESSAGE =
  "This opening is shared with the room next door, and something on the other side is in the way.";

export const SHARED_OPENING_OFF_BOUNDARY_MESSAGE =
  "This opening is shared with the room next door, so it can’t leave the wall the two rooms share.";

export function sharedOpeningRefusalMessage(
  reason: "slot-occupied" | "off-boundary" | "not-aligned"
): string {
  return reason === "slot-occupied"
    ? SHARED_OPENING_SLOT_BLOCKED_MESSAGE
    : SHARED_OPENING_OFF_BOUNDARY_MESSAGE;
}

// Enforce one placement only when adding; preserve duplicates already loaded.
const ALREADY_PLACED_MESSAGE =
  "This artwork is already placed. To try another arrangement, duplicate the project and experiment there.";

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
    | "dimensions"
    | "placementForm"
    | "matWidthMm"
    | "frame"
    | "frameIncludedInImage"
  >
>;

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
  DocumentMetaSliceActions &
  PackageSliceActions &
  ProjectManagerSliceActions &
  RoomGeometrySliceActions &
  SelectionSliceActions & {
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
  // step in the conflict dialog. Nothing has been persisted yet.
  pendingPackageImport: ImportPlan | null;
  // Set when a project fails to load with a typed corruption error AND a
  // schema-valid earlier snapshot exists. Drives the recovery dialog; a restore
  // is never applied silently.
  recoveryOffer: RecoveryOffer | null;
  boot: () => Promise<void>;
  /** Dev-only, non-persisting document swap used by renderer benchmarks. */
  loadBenchmarkFixture: (project: Project, artworks: Artwork[]) => void;
  renameProject: (title: string) => Promise<void>;
  // Saved-project rename; the open document still routes through undoable renameProject.
  renameProjectById: (id: string, title: string) => Promise<void>;
  setUnit: (unit: DisplayUnit) => Promise<void>;
  setDefaultWallHeightMm: (heightMm: number) => Promise<void>;
  setDefaultCenterlineHeightMm: (heightMm: number) => Promise<void>;
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
  placeArtwork: (
    artworkId: string,
    wallId: string,
    xMm: number,
    yMm: number,
    allowOverlap?: boolean
  ) => Promise<void>;
  moveArtworkPlacement: (
    wallObjectId: string,
    xMm: number,
    yMm: number,
    allowOverlap?: boolean
  ) => Promise<void>;
  removePlacement: (wallObjectId: string) => Promise<void>;
  addOpening: (wallId: string, kind: InsertToolKind) => Promise<void>;
  // Both return how the request was adjusted to stay on the wall, so the
  // inspector can say what it did ("Moved 2' 6\" to fit the wall."), or null
  // when there was nothing to report at all (no such object, no resolvable
  // wall). A REFUSED request still returns a fit — one carrying noMutualSpan or
  // partnerBlocked — describing the state that was kept rather than a committed
  // change; nothing is written and no undo entry is pushed. See fitOpeningOnWall.
  moveOpening: (
    wallObjectId: string,
    xMm: number,
    yMm: number,
    allowOverlap?: boolean
  ) => Promise<OpeningFit | null>;
  resizeOpening: (
    wallObjectId: string,
    widthMm: number,
    heightMm: number,
    allowOverlap?: boolean
  ) => Promise<OpeningFit | null>;
  // Widen an opening to fill the legal span it currently sits in — bounded by
  // its same-wall neighbours, else the wall's ends. Widens in place; never
  // relocates the opening to a larger gap elsewhere on the wall.
  fitOpeningToAvailableSpan: (wallObjectId: string) => Promise<OpeningFit | null>;
  connectOpenings: (aId: string, bId: string) => Promise<void>;
  disconnectOpening: (id: string) => Promise<void>;
  // Rename a wall text (the only editable field it carries). An empty/blank
  // name resets it to the default label.
  renameWallText: (wallObjectId: string, name: string) => Promise<void>;
  // The two Insert-cluster placement paths accept the widened InsertToolKind:
  // wall text is armed and placed here alongside openings, then branches to its
  // own (non-pairing, non-blocking) constructor at the creation step.
  placeOpeningFromPlan: (kind: InsertToolKind, placement: PlanPlacement) => Promise<void>;
  placeOpeningOnElevation: (
    kind: InsertToolKind,
    wallId: string,
    xMm: number,
    yMm: number
  ) => Promise<void>;
  placeArtworkOnFloor: (artworkId: string, xMm: number, yMm: number) => Promise<void>;
  // The single armed "Case" insert tool: a wall anchor creates a wall case, a
  // floor anchor creates a freestanding floor case (capture-any at the plan
  // layer decides which). Selects the new object; one undo step.
  placeCaseFromPlan: (placement: PlanPlacement) => Promise<void>;
  // The wall inspector's "Wall case" chip. Freestanding cases have no wall to
  // belong to, so they stay a plan-tool placement. Selects the new case; one
  // undo step.
  addWallCase: (wallId: string) => Promise<void>;
  // Numeric edits to a wall case (its own fields, including the new depthMm
  // protrusion). Separate from resizeOpening because a case carries depthMm and
  // is never an opening/does not pair.
  updateWallCase: (
    wallObjectId: string,
    changes: Partial<Pick<CaseWallObject, "xMm" | "yMm" | "widthMm" | "heightMm" | "depthMm">>
  ) => Promise<void>;
  commitPlanMove: (
    objectId: string,
    placement: PlanPlacement,
    allowOverlap?: boolean
  ) => Promise<void>;
  updateFloorObject: (
    objectId: string,
    changes: Partial<Pick<FloorObjectBase, "xMm" | "yMm" | "widthMm" | "depthMm" | "heightMm">>
  ) => Promise<void>;
  moveWallObjectsGroup: (
    moves: { id: string; xMm: number; yMm: number }[],
    allowOverlap?: boolean
  ) => Promise<void>;
  movePlanObjectsGroup: (
    moves: { id: string; xMm: number; yMm?: number; wallId?: string }[],
    allowOverlap?: boolean
  ) => Promise<void>;
  removeSelectedPlacements: () => Promise<void>;
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
  // Cloud-backup provider seam. Absent (or unconfigured) leaves the whole
  // feature inert — status stays "disconnected" and the UI hides it.
  cloudBackupProvider?: CloudBackupProvider;
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
    // Module-level (per createAppStore call) session state: which projects have
    // taken their once-per-session open snapshot, and when each was last
    // snapshotted (for the interval gate). Both are keyed by project id.
    const snapshottedThisSession = new Set<string>();
    const lastSnapshotAtByProject = new Map<string, number>();

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
    // Fire-and-forget; a snapshot failure never affects opening.
    function snapshotOnOpen(project: Project): void {
      if (snapshottedThisSession.has(project.id)) return;
      snapshottedThisSession.add(project.id);
      void writeSnapshot(project).catch((error) => {
        console.warn("Could not write a recovery snapshot", error);
      });
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

    async function persist(project: Project): Promise<boolean> {
      set({ saveState: "saving", error: null });

      try {
        await deps.projectRepository.save(project);
        // Clear any prior save failure — a successful persist is the recovery.
        set({ saveState: "saved", saveError: null });
        // Fire-and-forget: an interval snapshot must never affect saving.
        void maybeIntervalSnapshot(project);
        return true;
      } catch (error) {
        // A ZodError's .message is the JSON-stringified issue array, which is
        // what used to be dumped into the banner and the retry toast. Show the
        // issue's own sentence instead — unlike formatZodIssue (used on the
        // artwork path, where the path names an editable field), a schema
        // path here is an internal object id the user cannot act on.
        const message =
          error instanceof z.ZodError
            ? `Couldn't save: ${formatZodIssueMessage(error)}`
            : error instanceof Error
              ? error.message
              : "Could not save project.";
        set({
          saveState: "error",
          error: message,
          // Retry re-saves this exact project document.
          saveError: {
            scope: "project",
            message,
            retry: async () => {
              await persist(project);
            }
          }
        });
        return false;
      }
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
    function setDocument(project: Project, extras: Partial<AppState> = {}) {
      set({
        project,
        ...selectionWrite(project, NO_SELECTION, getFirstWall(project)?.id ?? null),
        arrangeSession: null,
        placementWarnings: [],
        lastGeometryEdit: null,
        undoStack: [],
        redoStack: [],
        error: null,
        // A document swap (boot, open, import, restore) is a clean slate — any
        // prior save failure no longer applies, so clear its provenance too.
        saveError: null,
        pendingDuplicateUploads: [],
        pendingPackageImport: null,
        ...extras
      });
    }

    // Only architecture opts a transaction into reconciliation. Artwork, wall
    // text and display cases also live in wallObjects, but moving one says
    // nothing about where a room's boundaries are.
    function isOpeningKind(kind: WallObject["kind"]): boolean {
      return kind === "door" || kind === "window" || kind === "blocked-zone";
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

    // Placement commit gate. Forbidden collisions always block; artwork
    // collisions block unless allowOverlap is true. null means do not commit.
    function gatePlacementWarnings(
      project: Project,
      candidateWallObjects: WallObject[],
      validateIds: string[],
      allowOverlap: boolean
    ): PlacementWarning[] | null {
      const placementWarnings = validateWallObjectPlacements(
        { ...project, wallObjects: candidateWallObjects },
        validateIds
      );

      const blocking = placementWarnings.filter(
        (warning) =>
          warning.type === "collision" && (warning.overridable === false || !allowOverlap)
      );
      if (blocking.length > 0) {
        const hasForbidden = blocking.some((warning) => warning.overridable === false);
        set({ error: hasForbidden ? FORBIDDEN_OVERLAP_MESSAGE : OVERLAP_BLOCKED_MESSAGE });
        return null;
      }
      return placementWarnings;
    }

    // Gate and persist one placement edit, optionally with a floor-object change.
    async function commitWallObjectEdit(
      label: string,
      project: Project,
      nextWallObjects: WallObject[],
      validateIds: string[],
      allowOverlap: boolean,
      options: {
        nextFloorObjects?: FloorObject[];
        extras?: EditExtras;
        // OPT-IN, by name. Present only on transactions whose intent is to
        // change architecture — opening create/move/resize/re-anchor. Never on
        // artwork, cases, wall text or partitions, which also rewrite
        // wallObjects but say nothing about where a room's boundaries are.
        reconcileWallIds?: string[];
      } = {}
    ): Promise<boolean> {
      // Reconcile BEFORE the gate, so a twin this edit creates is bounds- and
      // collision-validated like anything else, and rides the same commit —
      // one undo step covers the edit and its reconciliation, or neither
      // happens.
      const reconciled = options.reconcileWallIds
        ? reconcileSharedOpenings(project, nextWallObjects, options.reconcileWallIds)
        : { wallObjects: nextWallObjects, validateIds: [] };

      const placementWarnings = gatePlacementWarnings(
        project,
        reconciled.wallObjects,
        [...validateIds, ...reconciled.validateIds],
        allowOverlap
      );
      if (placementWarnings === null) return false;

      await applyEdit(
        label,
        (current) => ({
          ...current,
          wallObjects: reconciled.wallObjects,
          ...(options.nextFloorObjects ? { floorObjects: options.nextFloorObjects } : {})
        }),
        { placementWarnings, ...options.extras }
      );
      return true;
    }

    // The legal span an opening may occupy on its wall, or null when its wall
    // can't be resolved. Bounded by same-wall neighbours, else the wall's ends.
    function resolveOpeningSpan(project: Project, target: WallObject) {
      const wall = getProjectWalls(project).find((candidate) => candidate.id === target.wallId);
      if (!wall) return null;

      const sameWallObjects = project.wallObjects.filter(
        (object) => object.wallId === target.wallId
      );
      return getOpeningLegalSpan(target, sameWallObjects, wall.lengthMm);
    }

    // Resolve a requested width/position for `target`. Returns null when the
    // wall can't be resolved, in which case callers commit the raw request
    // unchanged (the pre-existing behaviour).
    //
    // `bounds` decides what the request is fitted against:
    //   "free-span" — the run between same-wall neighbours. For WIDTH, where a
    //     neighbour-aware result is collision-free by construction, so a widen
    //     never has to be rejected.
    //   "wall" — the wall's own ends only. For MOVES, which must keep their
    //     existing contract: an opening dragged onto another opening is BLOCKED
    //     (opening x opening is forbidden and unoverridable), not quietly slid
    //     flush against it. Clamping here only stops a typed X from leaving the
    //     wall entirely; collisions stay the commit gate's decision.
    function fitOpeningForRequest(
      project: Project,
      target: WallObject,
      requestedWidthMm: number,
      currentXMm: number,
      bounds: "free-span" | "wall"
    ): OpeningFit | null {
      const wall = getProjectWalls(project).find((candidate) => candidate.id === target.wallId);
      if (!wall) return null;

      const span =
        bounds === "wall"
          ? { spanStartMm: 0, spanEndMm: wall.lengthMm, boundedByNeighbor: false }
          : resolveOpeningSpan(project, target);
      if (!span) return null;

      return fitOpeningOnWall({
        requestedWidthMm,
        currentXMm,
        spanStartMm: span.spanStartMm,
        spanEndMm: span.spanEndMm,
        constraintSource: span.boundedByNeighbor ? "neighbor" : "wall"
      });
    }

    // --- commitPlanMove case handlers ----------------------------------------

    // wall → wall: same wall (x only) or re-anchor to another wall. Either way
    // the hang height (yMm) and size carry over unchanged — an artwork keeps
    // its height across a wall change. No-op if nothing moved. Runs the shared
    // collision gate via commitWallObjectEdit (identical warnings/label/error).
    async function planMoveWithinWalls(
      project: Project,
      wallObject: WallObject,
      placement: Extract<PlanPlacement, { anchor: "wall" }>,
      allowOverlap: boolean
    ): Promise<void> {
      if (wallObject.wallId === placement.wallId && wallObject.xMm === placement.xMm) {
        return;
      }

      const movedWallObjects = project.wallObjects.map((object) =>
        object.id === wallObject.id
          ? { ...object, wallId: placement.wallId, xMm: placement.xMm }
          : object
      );

      let draftWallObjects = movedWallObjects;
      let validateIds = [wallObject.id];

      // A plan drag of one half of a shared opening drags the other half with
      // it — the pair is one physical hole and cannot be dragged apart. The
      // classification reads the PRE-EDIT project and runs BEFORE
      // normalizeOpeningPairs, so a repair that would sever the pair can never
      // pre-empt the refusal below. A plan drag carries no hang height, so the
      // twin follows at the moved half's existing yMm (cf. movePlanObjectsGroup).
      if (
        (wallObject.kind === "door" || wallObject.kind === "window") &&
        wallObject.connectsToObjectId !== undefined
      ) {
        const synced = syncPartnerMove(
          project,
          movedWallObjects,
          wallObject,
          placement.xMm,
          wallObject.yMm,
          placement.wallId
        );
        if (synced.status === "blocked") {
          set({ error: sharedOpeningRefusalMessage(synced.reason) });
          return;
        }
        // Only `synced` — deliberately NOT appliedPartnerSync. This path never
        // mirrored anything before, so honouring a legacy pair's best-effort
        // draft here would be a NEW behaviour for plan dragging, not a
        // preserved one. Legacy best-effort belongs to the two direct-edit
        // paths that already had it.
        if (synced.status === "synced") {
          draftWallObjects = synced.nextWallObjects;
          validateIds = [wallObject.id, synced.partnerId];
        }
      }

      // A wallId rewrite can invalidate a shared-wall pairing (the moved half is
      // no longer on its partner's coincident twin face). Normalize the FINISHED
      // draft, so the repair never reads a half-applied batch, and let it ride
      // the same commit — one undo step covers the move and the disconnect.
      const nextWallObjects = normalizeOpeningPairs({
        ...project,
        wallObjects: draftWallObjects
      }).project.wallObjects;

      await commitWallObjectEdit(
        `Move ${moveObjectNoun(wallObject.kind)}`,
        project,
        nextWallObjects,
        validateIds,
        allowOverlap,
        // Both walls: a re-anchoring drag leaves one boundary and joins
        // another, and each side needs reconciling.
        isOpeningKind(wallObject.kind)
          ? { reconcileWallIds: [wallObject.wallId, placement.wallId] }
          : {}
      );
    }

    // wall → floor conversion. Doors/windows must never leave a wall (throws).
    // No collision gate: floor objects get no bounds/collision validation in v1
    // (see placeArtworkOnFloor), so this keeps its own gate-free applyEdit.
    async function planMoveWallToFloor(
      project: Project,
      wallObject: WallObject,
      placement: Extract<PlanPlacement, { anchor: "floor" }>
    ): Promise<void> {
      if (wallObject.kind !== "artwork" && wallObject.kind !== "blocked-zone") {
        throw new Error(
          `A ${wallObject.kind} cannot be moved onto the floor. It must stay on a wall.`
        );
      }

      // Preserve the wall's floor-space angle so the freed object keeps
      // its orientation at the moment of release (0 if the wall vanished).
      const sourceWall = getFloorWalls(project.floor).find(
        (candidate) => candidate.id === wallObject.wallId
      );
      const rotationDeg = sourceWall ? (sourceWall.angleRad * 180) / Math.PI : 0;

      const base = {
        id: wallObject.id,
        xMm: placement.xMm,
        yMm: placement.yMm,
        widthMm: wallObject.widthMm,
        rotationDeg,
        heightMm: wallObject.heightMm,
        // Remember the hang height so a later floor→wall conversion can
        // restore it.
        wallYMm: wallObject.yMm
      };

      let newFloorObject: FloorObject;
      if (wallObject.kind === "artwork") {
        const artwork = get().libraryArtworks.find(
          (candidate) => candidate.id === wallObject.artworkId
        );
        newFloorObject = {
          ...base,
          kind: "artwork",
          artworkId: wallObject.artworkId,
          depthMm:
            wallObject.displayDimensionsOverride?.depthMm ??
            artwork?.dimensions.depthMm ??
            DEFAULT_FLOOR_OBJECT_DEPTH_MM,
          ...(wallObject.displayDimensionsOverride
            ? { displayDimensionsOverride: wallObject.displayDimensionsOverride }
            : {})
        };
      } else {
        newFloorObject = {
          ...base,
          kind: "blocked-zone",
          depthMm: DEFAULT_FLOOR_OBJECT_DEPTH_MM
        };
      }

      // Selection survives for free: the id is preserved, and the
      // selection slots store the id (openings) / artworkId (artworks),
      // neither of which changes here.
      await applyEdit(
        `Move ${moveObjectNoun(wallObject.kind)}`,
        (current) => ({
          ...current,
          wallObjects: current.wallObjects.filter((object) => object.id !== wallObject.id),
          floorObjects: [...current.floorObjects, newFloorObject]
        })
      );
    }

    // floor → floor slide. No-op if nothing moved. No collision gate (floor
    // objects are unvalidated in v1), so it keeps its own applyEdit.
    async function planMoveFloorToFloor(
      project: Project,
      floorObject: FloorObject,
      placement: Extract<PlanPlacement, { anchor: "floor" }>
    ): Promise<void> {
      if (floorObject.xMm === placement.xMm && floorObject.yMm === placement.yMm) {
        return;
      }

      const nextFloorObjects = project.floorObjects.map((object) =>
        object.id === floorObject.id
          ? { ...object, xMm: placement.xMm, yMm: placement.yMm }
          : object
      );

      await applyEdit(`Move ${moveObjectNoun(floorObject.kind)}`, (current) => ({
        ...current,
        floorObjects: nextFloorObjects
      }));
    }

    // floor → wall conversion: restore the remembered hang height and
    // elevation height, reconstruct the kind-specific wall fields, then run the
    // shared collision gate via commitWallObjectEdit (identical to the old
    // inline validate+gate+applyEdit — `current === project` at commit time, so
    // the precomputed nextFloorObjects filter matches the old current-based one).
    async function planMoveFloorToWall(
      project: Project,
      floorObject: FloorObject,
      placement: Extract<PlanPlacement, { anchor: "wall" }>,
      allowOverlap: boolean
    ): Promise<void> {
      // Cases never convert between wall and floor (that machinery is
      // artwork-specific): a floor case that captures a wall must not become a
      // wall object. Refuse the conversion — the case stays on the floor.
      if (floorObject.kind === "case") {
        throw new Error("A display case cannot be moved onto a wall.");
      }

      const base = {
        id: floorObject.id,
        wallId: placement.wallId,
        xMm: placement.xMm,
        yMm: floorObject.wallYMm,
        widthMm: floorObject.widthMm,
        heightMm: floorObject.heightMm
      };

      let newWallObject: WallObject;
      if (floorObject.kind === "artwork") {
        newWallObject = {
          ...base,
          kind: "artwork",
          artworkId: floorObject.artworkId,
          ...(floorObject.displayDimensionsOverride
            ? { displayDimensionsOverride: floorObject.displayDimensionsOverride }
            : {})
        };
      } else {
        newWallObject = { ...base, kind: "blocked-zone", blocksPlacement: true };
      }

      const nextWallObjects = [...project.wallObjects, newWallObject];
      const nextFloorObjects = project.floorObjects.filter(
        (object) => object.id !== floorObject.id
      );

      await commitWallObjectEdit(
        `Move ${moveObjectNoun(floorObject.kind)}`,
        project,
        nextWallObjects,
        [floorObject.id],
        allowOverlap,
        { nextFloorObjects }
      );
    }

    // Synchronous all-or-nothing batch commit. Persistence stays caller-owned
    // because arrange settling must finish state changes before awaiting.
    function commitWallObjectMoves(
      moves: { id: string; xMm: number; yMm: number }[],
      label: string | ((movedCount: number) => string),
      allowOverlap: boolean,
      extras: EditExtras = {}
    ):
      | { status: "committed"; project: Project }
      | { status: "no-op" }
      | { status: "blocked" } {
      const project = get().project;
      if (!project) return { status: "no-op" };

      // A stale id (a member removed since the group was selected, e.g. by an
      // undo) is filtered out rather than treated as an error — the rest of
      // the group still moves.
      const applicable = moves.filter((move) =>
        project.wallObjects.some((wallObject) => wallObject.id === move.id)
      );
      if (applicable.length === 0) return { status: "no-op" };

      const moveById = new Map(applicable.map((move) => [move.id, move]));
      const movedIds: string[] = [];
      const nextWallObjects = project.wallObjects.map((wallObject) => {
        const move = moveById.get(wallObject.id);
        if (!move || (wallObject.xMm === move.xMm && wallObject.yMm === move.yMm)) {
          return wallObject;
        }
        movedIds.push(wallObject.id);
        return { ...wallObject, xMm: move.xMm, yMm: move.yMm };
      });
      if (movedIds.length === 0) return { status: "no-op" };

      // Shared openings survive a batch as one opening or not at all: one half
      // in the batch drags the other, both halves in the batch are validated
      // against the finished draft. Classified pre-edit, and a refusal blocks
      // the whole batch — the same all-or-nothing rule as a collision.
      const paired = syncMovedPairHalves(project, nextWallObjects, movedIds);
      if (paired.status === "blocked") {
        set({ error: sharedOpeningRefusalMessage(paired.reason) });
        return { status: "blocked" };
      }

      // Reconcile the batch's own architecture before the gate, scoped to the
      // walls it touched, so a created twin is validated with everything else.
      const touchedOpeningWallIds = project.wallObjects
        .filter((object) => movedIds.includes(object.id) && isOpeningKind(object.kind))
        .map((object) => object.wallId);
      const reconciled =
        touchedOpeningWallIds.length > 0
          ? reconcileSharedOpenings(project, paired.nextWallObjects, touchedOpeningWallIds)
          : { wallObjects: paired.nextWallObjects, validateIds: [] };

      // One collision blocks the entire batch.
      const placementWarnings = gatePlacementWarnings(
        project,
        reconciled.wallObjects,
        [...movedIds, ...paired.validateIds, ...reconciled.validateIds],
        allowOverlap
      );
      if (placementWarnings === null) return { status: "blocked" };

      const after = {
        ...project,
        wallObjects: reconciled.wallObjects,
        updatedAt: new Date().toISOString()
      };
      const resolvedLabel = typeof label === "function" ? label(movedIds.length) : label;
      pushEditEntry(
        { label: resolvedLabel, project: { before: project, after } },
        { placementWarnings, ...extras }
      );
      return { status: "committed", project: after };
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
      deps,
      snapshotOnOpen,
      offerRecovery
    });

    const packageSlice = createPackageSlice(set, get, { persist, setDocument, deps });

    const cloudBackupSlice = createCloudBackupSlice(set, get, { deps });

    const artworkIntake = createArtworkIntakeSlice(set, get, { applyEdit, persist, deps });

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
      pendingPackageImport: null,
      recoveryOffer: null,

      async boot() {
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
          const project = summaries[0]
            ? await deps.projectRepository.load(summaries[0].id)
            : createSampleProject();

          if (!summaries[0]) {
            await deps.projectRepository.save(project);
          }

          setDocument(project, { saveState: "saved", libraryArtworks, error: libraryError });
          snapshotOnOpen(project);
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

      ...projectManager.actions,

      async updateArtwork(artworkId, changes) {
        const before = get().libraryArtworks.find((artwork) => artwork.id === artworkId);
        if (!before) return;

        const next: Artwork = { ...before, ...changes };
        const touchedKeys = Object.keys(changes) as (keyof UpdateArtworkChanges)[];
        const changedKeys = touchedKeys.filter(
          (key) => JSON.stringify(before[key]) !== JSON.stringify(next[key])
        );
        if (changedKeys.length === 0) return;
        const dimensionsChanged = changedKeys.includes("dimensions");
        // frameIncludedInImage flips the outer footprint (a flagged work drops
        // its mat/frame band via effectiveFraming), so toggling it must trigger
        // the same placement revalidation as a mat/frame edit — otherwise a work
        // that newly fits (or newly overflows) wouldn't re-flag.
        const framingChanged =
          changedKeys.includes("matWidthMm") ||
          changedKeys.includes("frame") ||
          changedKeys.includes("frameIncludedInImage");

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

        // Resize wall placements without display overrides. Floor footprints
        // remain stored as-is; artwork and placement changes share one undo entry.
        const project = get().project;
        let projectEdit: { before: Project; after: Project } | undefined;
        let placementWarnings: PlacementWarning[] = [];
        const affectedIds = new Set<string>();

        if (project && dimensionsChanged) {
          // A derived axis needs the image ratio; skip the asset fetch on the
          // common both-known path (no axis to derive) so a plain dimension
          // edit stays synchronous-cheap.
          const needsAspect =
            parsed.dimensions.widthMm === undefined || parsed.dimensions.heightMm === undefined;
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

          if (affectedIds.size > 0) {
            const after = {
              ...project,
              wallObjects: nextWallObjects,
              updatedAt: new Date().toISOString()
            };
            projectEdit = { before: project, after };
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

      async placeArtwork(artworkId, wallId, xMm, yMm, allowOverlap = false) {
        const project = get().project;
        if (!project) return;

        const artwork = get().libraryArtworks.find((candidate) => candidate.id === artworkId);
        if (!artwork) return;
        if (!getProjectWalls(project).some((wall) => wall.id === wallId)) return;

        const alreadyPlaced =
          project.wallObjects.some((o) => o.kind === "artwork" && o.artworkId === artworkId) ||
          project.floorObjects.some((o) => o.kind === "artwork" && o.artworkId === artworkId);
        if (alreadyPlaced) {
          set({ error: ALREADY_PLACED_MESSAGE });
          return;
        }

        const aspect = await loadArtworkAspect(artwork);
        const placement = createArtworkPlacement(artwork, wallId, xMm, yMm, aspect);
        const nextWallObjects = [...project.wallObjects, placement];

        await commitWallObjectEdit(
          "Place artwork",
          project,
          nextWallObjects,
          [placement.id],
          allowOverlap,
          {
            // Replace selection with the new placement.
            extras: selectionWrite(
              { ...project, wallObjects: nextWallObjects },
              { kind: "objects", ids: [placement.id] },
              get().wallContextId
            )
          }
        );
      },

      async moveArtworkPlacement(wallObjectId, xMm, yMm, allowOverlap = false) {
        const project = get().project;
        if (!project) return;

        const target = project.wallObjects.find((wallObject) => wallObject.id === wallObjectId);
        if (!target || (target.xMm === xMm && target.yMm === yMm)) return;

        const nextWallObjects = project.wallObjects.map((wallObject) =>
          wallObject.id === wallObjectId ? { ...wallObject, xMm, yMm } : wallObject
        );

        // The UI previews the drag locally and calls this exactly once on
        // release (docs/plan.md §7) — one call here is already one undo
        // entry, nothing extra to batch.
        await commitWallObjectEdit(
          "Move artwork",
          project,
          nextWallObjects,
          [wallObjectId],
          allowOverlap
        );
      },

      async removePlacement(wallObjectId) {
        const project = get().project;
        if (!project) return;
        const isWallObject = project.wallObjects.some(
          (wallObject) => wallObject.id === wallObjectId
        );
        const isFloorObject = project.floorObjects.some(
          (floorObject) => floorObject.id === wallObjectId
        );
        if (!isWallObject && !isFloorObject) return;

        // Removes the placement only — checklist membership is a separate
        // concept (docs/plan.md §4.1) and is untouched here. Generic over
        // object kind, so this same action deletes an opening or a
        // floor-placed object too (ids are unique across both arrays) —
        // there's no checklist-membership concept to preserve for those.
        //
        // Shared-wall full-sync delete (spec §5.5): removing a paired
        // door/window removes its twin in the same commit, so the two rooms
        // never diverge. (Deleting a whole ROOM only disconnects the neighbor's
        // opening — that cascade is elsewhere and deliberately unchanged.)
        // clearOpeningPartners still clears any other surviving partner's
        // connectsToObjectId that pointed at a removed opening, so no dangling
        // pairing ref persists.
        const removedIds = includePairedOpenings(project.wallObjects, [wallObjectId]);

        const nextProject: Project = {
          ...project,
          wallObjects: clearOpeningPartners(
            project.wallObjects.filter((wallObject) => !removedIds.has(wallObject.id)),
            removedIds
          ),
          floorObjects: project.floorObjects.filter((floorObject) => !removedIds.has(floorObject.id))
        };

        await applyEdit("Remove from wall", () => nextProject);
      },

      async addOpening(wallId, kind) {
        const project = get().project;
        if (!project) return;

        const wall = getProjectWalls(project).find((candidate) => candidate.id === wallId);
        if (!wall) return;

        // Wall text starts at the wall's midpoint on the centerline — same
        // landing spot as placeOpeningFromPlan's wall-text branch, and no
        // free-slot search since it never blocks or pairs.
        if (kind === "wall-text") {
          const centerlineYMm =
            wall.defaultCenterlineHeightMm ?? project.defaultCenterlineHeightMm;
          const wallText = createWallTextPlacement(wallId, wall.lengthMm / 2, centerlineYMm);
          const nextWallObjects = [...project.wallObjects, wallText];
          await commitWallObjectEdit("Add wall text", project, nextWallObjects, [wallText.id], true, {
            extras: selectionWrite(
              { ...project, wallObjects: nextWallObjects },
              { kind: "objects", ids: [wallText.id] },
              get().wallContextId
            )
          });
          return;
        }

        // Display cases are never added through this opening path — the plan
        // tool routes through placeCaseFromPlan and the wall inspector through
        // addCaseToWall, since each decides wall vs floor differently. Guarding
        // here also narrows `kind` to OpeningKind for the opening builders below.
        if (kind === "case") {
          throw new Error("Display cases are placed via placeCaseFromPlan or addCaseToWall.");
        }

        // Doors/windows can't be placed on a partition face in v1 (spec §2/§6.1);
        // blocked zones can. This guard backs up the plan tool's candidate filter.
        if (kind !== "blocked-zone" && parseFaceWallId(wallId) !== null) {
          set({ error: "Doors and windows can't be placed on a partition." });
          return;
        }

        // Start near center but never create a forbidden opening overlap.
        const xMm = resolveFreeOpeningXMm(project, wall, kind, wall.lengthMm / 2);
        if (xMm === null) {
          set({ error: "There isn’t room for another opening on this wall." });
          return;
        }

        // buildOpeningWithMirror is shared with placeOpeningFromPlan, whose only
        // difference is the chosen xMm (the plan drop point vs. wall center). It
        // also mirrors the opening onto a coincident twin wall in the same array
        // when the wall is shared between two rooms (spec §5.5).
        // Append the primary only. Mirroring onto a shared wall is
        // reconciliation's job now (opted in below via reconcileWallIds), so
        // creation and every later geometry edit build the twin the same way —
        // the old builder sized it from the kind's DEFAULTS while the analyzer
        // copies the primary's actual width, height and hang height.
        const primary = buildOpeningOnWall(project, wall, kind, xMm);
        const nextWallObjects = [...project.wallObjects, primary];
        const primaryId = primary.id;
        const validateIds = [primaryId];

        // Adding an opening is never blocked by a collision (there's no
        // allowOverlap knob for it) — allowOverlap: true skips the gate while
        // still surfacing the warning via placementWarnings.
        await commitWallObjectEdit(
          `Add ${openingNoun(kind)}`,
          project,
          nextWallObjects,
          validateIds,
          true,
          {
            reconcileWallIds: [wall.id],
            // Select only the primary; a mirrored twin is created silently.
            extras: selectionWrite(
              { ...project, wallObjects: nextWallObjects },
              { kind: "objects", ids: [primaryId] },
              get().wallContextId
            )
          }
        );
      },

      async moveOpening(wallObjectId, xMm, yMm, allowOverlap = false) {
        const project = get().project;
        if (!project) return null;

        const target = project.wallObjects.find((wallObject) => wallObject.id === wallObjectId);
        if (!target || target.kind === "artwork") return null;

        // Doors must sit on the floorline (center at height/2).
        const clampedYMm = target.kind === "door" ? target.heightMm / 2 : yMm;

        // Keep the opening on its wall. The numeric X field used to commit
        // whatever was typed, so X = 50' on a 12' wall left a door off the wall
        // entirely; the drag path has always clamped (resolveOnWall).
        const raw = fitOpeningForRequest(project, target, target.widthMm, xMm, "wall");
        // A move must never resize: an opening already wider than its span
        // keeps its width and simply centres.
        const fit: OpeningFit | null = raw
          ? { ...raw, widthMm: target.widthMm, requestedWidthMm: target.widthMm, widthClamped: false }
          : null;
        const nextXMm = fit ? fit.xMm : xMm;

        if (target.xMm === nextXMm && target.yMm === clampedYMm) return fit;

        let nextWallObjects = project.wallObjects.map((wallObject) =>
          wallObject.id === wallObjectId
            ? { ...wallObject, xMm: nextXMm, yMm: clampedYMm }
            : wallObject
        );
        let validateIds = [wallObjectId];

        // Shared-wall sync: a paired door/window drags its twin in the same
        // commit so the two rooms stay aligned (spec §5.5). The pair is
        // classified against the PRE-EDIT project — a live shared pair either
        // moves together or the move fails; a legacy pair across walls that
        // never faced each other may still drift, exactly as before.
        if (
          (target.kind === "door" || target.kind === "window") &&
          target.connectsToObjectId !== undefined
        ) {
          const synced = syncPartnerMove(project, nextWallObjects, target, nextXMm, clampedYMm);
          if (synced.status === "blocked") {
            // Same shape as the noMutualSpan refusal below: nothing committed,
            // no undo entry, and the request reported so the inspector can say
            // why it did not happen.
            set({ error: sharedOpeningRefusalMessage(synced.reason) });
            return {
              requestedWidthMm: target.widthMm,
              widthMm: target.widthMm,
              xMm: target.xMm,
              widthClamped: false,
              positionAdjusted: false,
              movedByMm: 0,
              constraint: "none",
              partnerBlocked: true
            };
          }
          const applied = appliedPartnerSync(synced);
          if (applied) {
            nextWallObjects = applied.nextWallObjects;
            validateIds = [wallObjectId, applied.partnerId];
          }
        }

        // Same shape as moveArtworkPlacement: the UI previews the drag
        // locally and calls this exactly once on release.
        await commitWallObjectEdit(
          `Move ${moveObjectNoun(target.kind)}`,
          project,
          nextWallObjects,
          validateIds,
          allowOverlap,
          { reconcileWallIds: [target.wallId] }
        );
        return fit;
      },

      async fitOpeningToAvailableSpan(wallObjectId) {
        const project = get().project;
        if (!project) return null;

        const target = project.wallObjects.find((wallObject) => wallObject.id === wallObjectId);
        if (!target || target.kind === "artwork") return null;

        const span = resolveOpeningSpan(project, target);
        if (!span) return null;

        // Request the whole span; the shared fit path clamps it to exactly the
        // available width and positions it, so this needs no geometry of its own.
        // That also means a refusal (noMutualSpan / partnerBlocked) is returned
        // verbatim rather than swallowed: "Fit wall" on half a shared opening
        // whose twin cannot follow commits nothing and reports why.
        return get().resizeOpening(
          wallObjectId,
          span.spanEndMm - span.spanStartMm,
          target.heightMm
        );
      },

      async resizeOpening(wallObjectId, widthMm, heightMm, allowOverlap = false) {
        const project = get().project;
        if (!project) return null;

        const target = project.wallObjects.find((wallObject) => wallObject.id === wallObjectId);
        if (!target || target.kind === "artwork") return null;

        // Keep the requested width whenever it fits somewhere on the wall,
        // sliding the opening the minimum distance to make room; reduce it only
        // when it cannot fit at all. See fitOpeningOnWall.
        //
        // A PAIRED opening is one physical hole through one wall, so it is
        // solved ONCE against the run both faces share — never fitted per face
        // and reconciled, which would let the two halves settle at locally
        // valid but physically different centres.
        const partner =
          (target.kind === "door" || target.kind === "window") &&
          target.connectsToObjectId !== undefined
            ? project.wallObjects.find((object) => object.id === target.connectsToObjectId)
            : undefined;
        // Only a REAL shared boundary is solved as one hole. A legacy pair on
        // unrelated walls has no meaningful mutual run — perpendicular walls
        // project to a zero-length one — and solving it that way would refuse
        // the resize with noMutualSpan before the non-refusing legacy branch
        // was ever reached. Legacy pairs keep their own-wall fit.
        const pairedSpan =
          partner &&
          (partner.kind === "door" || partner.kind === "window") &&
          areSharedBoundaryWalls(project, target.wallId, partner.wallId)
            ? resolvePairedOpeningSpan(
                project,
                target as ConnectableOpeningWallObject,
                partner
              )
            : null;

        const fit = pairedSpan
          ? fitOpeningOnWall({
              requestedWidthMm: widthMm,
              currentXMm: target.xMm,
              spanStartMm: pairedSpan.spanStartMm,
              spanEndMm: pairedSpan.spanEndMm,
              constraintSource: pairedSpan.constraintSource
            })
          : fitOpeningForRequest(project, target, widthMm, target.xMm, "free-span");

        // No run the two faces share: half a shared opening cannot move without
        // the other half, so report rather than desynchronise them.
        if (pairedSpan && pairedSpan.spanEndMm - pairedSpan.spanStartMm < FIT_EPSILON_MM) {
          return {
            requestedWidthMm: widthMm,
            widthMm: target.widthMm,
            xMm: target.xMm,
            widthClamped: false,
            positionAdjusted: false,
            movedByMm: 0,
            constraint: pairedSpan.constraintSource,
            noMutualSpan: true
          };
        }

        const nextWidthMm = fit ? fit.widthMm : widthMm;
        const nextXMm = fit ? fit.xMm : target.xMm;

        // For doors, recompute yMm so the bottom stays on the floor when height changes.
        const updatedYMm = target.kind === "door" ? heightMm / 2 : target.yMm;

        // Re-requesting a width that clamps to what the opening already has is a
        // no-op: report the adjustment so the field can explain itself, but do
        // not stack an undo entry for a document that did not change.
        if (
          target.widthMm === nextWidthMm &&
          target.heightMm === heightMm &&
          target.xMm === nextXMm
        ) {
          return fit;
        }

        let nextWallObjects = project.wallObjects.map((wallObject) =>
          wallObject.id === wallObjectId
            ? { ...wallObject, widthMm: nextWidthMm, heightMm, xMm: nextXMm, yMm: updatedYMm }
            : wallObject
        );
        let validateIds = [wallObjectId];

        // Shared-wall sync: mirror the new size onto a paired twin in the same
        // commit (spec §5.5). Classified against the PRE-EDIT project, so a
        // live shared pair resizes as one opening or not at all; a legacy pair
        // keeps its old freedom to diverge.
        if (
          (target.kind === "door" || target.kind === "window") &&
          target.connectsToObjectId !== undefined
        ) {
          const synced = syncPartnerResize(
            project,
            nextWallObjects,
            target,
            nextWidthMm,
            heightMm,
            nextXMm,
            updatedYMm
          );
          if (synced.status === "blocked") {
            set({ error: sharedOpeningRefusalMessage(synced.reason) });
            return {
              requestedWidthMm: widthMm,
              widthMm: target.widthMm,
              xMm: target.xMm,
              widthClamped: false,
              positionAdjusted: false,
              movedByMm: 0,
              constraint: pairedSpan ? pairedSpan.constraintSource : "none",
              partnerBlocked: true
            };
          }
          const applied = appliedPartnerSync(synced);
          if (applied) {
            nextWallObjects = applied.nextWallObjects;
            validateIds = [wallObjectId, applied.partnerId];
          }
        }

        await commitWallObjectEdit(
          `Resize ${moveObjectNoun(target.kind)}`,
          project,
          nextWallObjects,
          validateIds,
          allowOverlap,
          { reconcileWallIds: [target.wallId] }
        );
        return fit;
      },

      async connectOpenings(aId, bId) {
        const project = get().project;
        if (!project || aId === bId) return;

        const a = project.wallObjects.find((object) => object.id === aId);
        const b = project.wallObjects.find((object) => object.id === bId);
        const isConnectable = (
          object: WallObject | undefined
        ): object is ConnectableOpeningWallObject =>
          object?.kind === "door" || object?.kind === "window";

        if (!isConnectable(a) || !isConnectable(b)) {
          set({ error: "Only doors and windows can be connected." });
          return;
        }
        if (a.kind !== b.kind) {
          set({ error: "Connected openings must be the same kind." });
          return;
        }
        if (
          a.wallId === b.wallId ||
          parseFaceWallId(a.wallId) !== null ||
          parseFaceWallId(b.wallId) !== null
        ) {
          set({ error: "Connected openings must be on different perimeter walls." });
          return;
        }
        if (a.connectsToObjectId === b.id && b.connectsToObjectId === a.id) return;

        // Re-pair atomically so every persisted state keeps symmetric pointers.
        const displacedIds = new Set(
          [a.connectsToObjectId, b.connectsToObjectId].filter(
            (id): id is string => id !== undefined
          )
        );
        const nextWallObjects = project.wallObjects.map((object) => {
          if (object.id === a.id) return { ...a, connectsToObjectId: b.id };
          if (object.id === b.id) return { ...b, connectsToObjectId: a.id };
          if (
            (object.kind === "door" || object.kind === "window") &&
            (displacedIds.has(object.id) ||
              object.connectsToObjectId === a.id ||
              object.connectsToObjectId === b.id)
          ) {
            const { connectsToObjectId: _cleared, ...rest } = object;
            return rest;
          }
          return object;
        });

        await applyEdit(`Connect ${openingNoun(a.kind)}s`, (current) => ({
          ...current,
          wallObjects: nextWallObjects
        }));
      },

      async disconnectOpening(id) {
        const project = get().project;
        if (!project) return;
        const opening = project.wallObjects.find((object) => object.id === id);
        if (
          !opening ||
          (opening.kind !== "door" && opening.kind !== "window") ||
          opening.connectsToObjectId === undefined
        ) {
          return;
        }

        const partnerId = opening.connectsToObjectId;
        const nextWallObjects = project.wallObjects.map((object) => {
          if (
            (object.id === opening.id || object.id === partnerId) &&
            (object.kind === "door" || object.kind === "window")
          ) {
            const { connectsToObjectId: _cleared, ...rest } = object;
            return rest;
          }
          return object;
        });

        await applyEdit(`Disconnect ${openingNoun(opening.kind)}`, (current) => ({
          ...current,
          wallObjects: nextWallObjects
        }));
      },

      async renameWallText(wallObjectId, name) {
        const project = get().project;
        if (!project) return;
        const target = project.wallObjects.find((object) => object.id === wallObjectId);
        if (!target || target.kind !== "wall-text") return;

        const trimmed = name.trim();
        const nextName = trimmed.length > 0 ? trimmed : WALL_TEXT_DEFAULT_NAME;
        if ((target.name ?? WALL_TEXT_DEFAULT_NAME) === nextName) return;

        await applyEdit("Rename wall text", (current) => ({
          ...current,
          wallObjects: current.wallObjects.map((object) =>
            object.id === wallObjectId && object.kind === "wall-text"
              ? { ...object, name: nextName }
              : object
          )
        }));
      },

      async placeOpeningFromPlan(kind, placement) {
        const project = get().project;
        if (!project) return;

        // Wall text is placed here alongside openings but is wall-only and
        // never pairs/mirrors, so it takes its own simple path: land at the
        // clicked wall x, centered on the wall's centerline.
        if (kind === "wall-text") {
          if (placement.anchor !== "wall") {
            throw new Error("Wall text can only be placed on a wall.");
          }
          const wall = getProjectWalls(project).find(
            (candidate) => candidate.id === placement.wallId
          );
          if (!wall) return;
          const centerlineYMm =
            wall.defaultCenterlineHeightMm ?? project.defaultCenterlineHeightMm;
          const wallText = createWallTextPlacement(placement.wallId, placement.xMm, centerlineYMm);
          const nextWallObjects = [...project.wallObjects, wallText];
          await commitWallObjectEdit("Add wall text", project, nextWallObjects, [wallText.id], true, {
            extras: selectionWrite(
              { ...project, wallObjects: nextWallObjects },
              { kind: "objects", ids: [wallText.id] },
              get().wallContextId
            )
          });
          return;
        }

        // Display cases have their own plan placement action; guarding here keeps
        // them off the opening builders and narrows `kind` to OpeningKind.
        if (kind === "case") {
          throw new Error("Display cases are placed via placeCaseFromPlan, not placeOpeningFromPlan.");
        }

        if (placement.anchor === "floor") {
          // Only blocked zones can float. Doors and windows are excluded from
          // floor placement by the domain (FloorObject has no door/window
          // kind) and resolve under the "capture-any" float policy, so a
          // door/window landing here is an invariant break, not a user path —
          // fail loudly.
          if (kind !== "blocked-zone") {
            throw new Error(
              `Cannot place a ${kind} on the floor. Only blocked zones can be floor-placed.`
            );
          }

          const { widthMm, heightMm } = getDefaultOpeningSizeMm(kind);
          const floorObject: BlockedZoneFloorObject = {
            id: newId(),
            kind: "blocked-zone",
            xMm: placement.xMm,
            yMm: placement.yMm,
            widthMm,
            depthMm: DEFAULT_FLOOR_OBJECT_DEPTH_MM,
            rotationDeg: 0,
            heightMm,
            // Remembered hang-height for a later floor→wall conversion: the
            // same centerline default the object would take on a wall.
            wallYMm: getDefaultOpeningCenterYMm(kind, heightMm, project.defaultCenterlineHeightMm)
          };

          // No wallObjects change here, so an empty validate-ids list is a
          // trivial no-collision pass (see gatePlacementWarnings) — this just
          // rides the shared commit path for the floorObjects append + select.
          await commitWallObjectEdit(
            `Add ${openingNoun(kind)}`,
            project,
            project.wallObjects,
            [],
            true,
            {
              nextFloorObjects: [...project.floorObjects, floorObject],
              extras: selectionWrite(
                { ...project, floorObjects: [...project.floorObjects, floorObject] },
                { kind: "objects", ids: [floorObject.id] },
                get().wallContextId
              )
            }
          );
          return;
        }

        // Wall placement: identical to addOpening, but at the plan-chosen xMm
        // rather than the wall center.
        const wall = getProjectWalls(project).find((candidate) => candidate.id === placement.wallId);
        if (!wall) return;

        // Doors/windows can't land on a partition face in v1 (spec §2/§6.1).
        if (kind !== "blocked-zone" && parseFaceWallId(placement.wallId) !== null) {
          set({ error: "Doors and windows can't be placed on a partition." });
          return;
        }

        // Slide to the nearest free slot; refuse when no legal slot exists.
        const xMm = resolveFreeOpeningXMm(project, wall, kind, placement.xMm);
        if (xMm === null) {
          set({ error: "There isn’t room for another opening on this wall." });
          return;
        }

        // Same shared-wall mirroring as addOpening (spec §5.5): a twin wall gets
        // a paired opening in the same single commit.
        // Append the primary only. Mirroring onto a shared wall is
        // reconciliation's job now (opted in below via reconcileWallIds), so
        // creation and every later geometry edit build the twin the same way —
        // the old builder sized it from the kind's DEFAULTS while the analyzer
        // copies the primary's actual width, height and hang height.
        const primary = buildOpeningOnWall(project, wall, kind, xMm);
        const nextWallObjects = [...project.wallObjects, primary];
        const primaryId = primary.id;
        const validateIds = [primaryId];

        // Same as addOpening: never blocked by a collision.
        await commitWallObjectEdit(
          `Add ${openingNoun(kind)}`,
          project,
          nextWallObjects,
          validateIds,
          true,
          {
            reconcileWallIds: [wall.id],
            extras: selectionWrite(
              { ...project, wallObjects: nextWallObjects },
              { kind: "objects", ids: [primaryId] },
              get().wallContextId
            )
          }
        );
      },

      async placeOpeningOnElevation(kind, wallId, xMm, yMm) {
        const project = get().project;
        if (!project) return;

        const wall = getProjectWalls(project).find((candidate) => candidate.id === wallId);
        if (!wall) return;

        // Wall text lands at the clicked point (the elevation resolver already
        // keeps the pointer on the wall). It never pairs, mirrors, or blocks, so
        // it skips the opening free-slot search and takes the pointer's y.
        if (kind === "wall-text") {
          const wallText = createWallTextPlacement(wallId, xMm, yMm);
          const nextWallObjects = [...project.wallObjects, wallText];
          await commitWallObjectEdit("Add wall text", project, nextWallObjects, [wallText.id], true, {
            extras: selectionWrite(
              { ...project, wallObjects: nextWallObjects },
              { kind: "objects", ids: [wallText.id] },
              get().wallContextId
            )
          });
          return;
        }

        // Display cases are plan-only (they never reach the elevation canvas);
        // guarding here narrows `kind` to OpeningKind for the builders below.
        if (kind === "case") {
          throw new Error("Display cases cannot be placed from elevation.");
        }

        // Doors and windows remain disallowed on partition faces in elevation,
        // matching the plan insertion rules. Blocked zones are annotations and
        // can be placed on either face.
        if (kind !== "blocked-zone" && parseFaceWallId(wallId) !== null) {
          set({ error: "Doors and windows can’t be placed on a partition." });
          return;
        }

        // The elevation resolver already keeps the pointer inside the wall,
        // but preserve the creation-time opening-overlap guard here as well so
        // imported callers and future surfaces cannot create forbidden opening
        // pairs by bypassing the canvas.
        const xCenterMm = resolveFreeOpeningXMm(project, wall, kind, xMm, yMm);
        if (xCenterMm === null) {
          set({ error: "There isn’t room for another opening on this wall." });
          return;
        }

        // Doors must sit on the floorline (bottom edge at y=0, center at height/2).
        const resolvedYMm = kind === "door" ? undefined : yMm;

        const primary = buildOpeningOnWall(project, wall, kind, xCenterMm, resolvedYMm);
        const nextWallObjects = [...project.wallObjects, primary];
        const primaryId = primary.id;
        const validateIds = [primaryId];

        await commitWallObjectEdit(
          `Add ${openingNoun(kind)}`,
          project,
          nextWallObjects,
          validateIds,
          true,
          {
            reconcileWallIds: [wall.id],
            extras: selectionWrite(
              { ...project, wallObjects: nextWallObjects },
              { kind: "objects", ids: [primaryId] },
              get().wallContextId
            )
          }
        );
      },

      async placeArtworkOnFloor(artworkId, xMm, yMm) {
        const project = get().project;
        if (!project) return;

        const artwork = get().libraryArtworks.find((candidate) => candidate.id === artworkId);
        if (!artwork) return;

        const alreadyPlaced =
          project.wallObjects.some((o) => o.kind === "artwork" && o.artworkId === artworkId) ||
          project.floorObjects.some((o) => o.kind === "artwork" && o.artworkId === artworkId);
        if (alreadyPlaced) {
          set({ error: ALREADY_PLACED_MESSAGE });
          return;
        }

        const aspect = await loadArtworkAspect(artwork);
        const { widthMm, heightMm } = getEffectivePlacementSizeMm(artwork.dimensions, aspect);
        const floorObject: ArtworkFloorObject = {
          id: newId(),
          kind: "artwork",
          artworkId,
          xMm,
          yMm,
          widthMm,
          // A floor-standing work's real depth if known, else a squarish
          // footprint off its width, else the editable default (see
          // effectiveFloorDepthMm — shared with plan/3D rendering).
          depthMm: effectiveFloorDepthMm(artwork.dimensions),
          rotationDeg: 0,
          heightMm,
          // Remembered hang-height center for a later floor→wall conversion.
          wallYMm: project.defaultCenterlineHeightMm
        };

        // Floor objects get no bounds/collision validation in v1 (no wall
        // bounds; 2-D footprint collision is a v2 candidate) — an empty
        // validate-ids list keeps the shared gate a no-op here.
        await commitWallObjectEdit(
          "Place artwork",
          project,
          project.wallObjects,
          [],
          true,
          {
            nextFloorObjects: [...project.floorObjects, floorObject],
            // Replace selection with the new floor placement.
            extras: selectionWrite(
              { ...project, floorObjects: [...project.floorObjects, floorObject] },
              { kind: "objects", ids: [floorObject.id] },
              get().wallContextId
            )
          }
        );
      },

      async placeCaseFromPlan(placement) {
        const project = get().project;
        if (!project) return;

        // Wall anchor → wall case; floor anchor → freestanding floor case. Both
        // ride the shared commit path (floor objects and cases carry no wall
        // bounds/collision to validate in v1, so an empty validate-ids list
        // keeps the gate a no-op) and select the new object.
        if (placement.anchor === "wall") {
          const wallCase = createWallCase(placement.wallId, placement.xMm);
          const nextWallObjects = [...project.wallObjects, wallCase];
          await commitWallObjectEdit("Add display case", project, nextWallObjects, [], true, {
            extras: selectionWrite(
              { ...project, wallObjects: nextWallObjects },
              { kind: "objects", ids: [wallCase.id] },
              get().wallContextId
            )
          });
          return;
        }

        const floorCase = createFloorCase(placement.xMm, placement.yMm);
        await commitWallObjectEdit("Add display case", project, project.wallObjects, [], true, {
          nextFloorObjects: [...project.floorObjects, floorCase],
          extras: selectionWrite(
            { ...project, floorObjects: [...project.floorObjects, floorCase] },
            { kind: "objects", ids: [floorCase.id] },
            get().wallContextId
          )
        });
      },

      // The inspector-side counterpart to placeCaseFromPlan: with a wall already
      // selected there is no click point to classify, so this only ever makes
      // the hung kind (a freestanding case has no wall to belong to — it stays
      // a plan-tool placement). Hangs at the wall's midpoint at the default
      // mount height. Cases never block or pair, so — as in placeCaseFromPlan —
      // there is nothing to validate.
      async addWallCase(wallId) {
        const project = get().project;
        if (!project) return;

        const wall = getProjectWalls(project).find((candidate) => candidate.id === wallId);
        if (!wall) return;

        const wallCase = createWallCase(wallId, wall.lengthMm / 2);
        const nextWallObjects = [...project.wallObjects, wallCase];
        await commitWallObjectEdit("Add display case", project, nextWallObjects, [], true, {
          extras: selectionWrite(
            { ...project, wallObjects: nextWallObjects },
            { kind: "objects", ids: [wallCase.id] },
            get().wallContextId
          )
        });
      },

      async updateWallCase(wallObjectId, changes) {
        const project = get().project;
        if (!project) return;

        const target = project.wallObjects.find((object) => object.id === wallObjectId);
        if (!target || target.kind !== "case") return;

        const keys = ["xMm", "yMm", "widthMm", "heightMm", "depthMm"] as const;
        const hasChange = keys.some(
          (key) => changes[key] !== undefined && changes[key] !== target[key]
        );
        if (!hasChange) return;

        const nextWallObjects = project.wallObjects.map((object) =>
          object.id === wallObjectId && object.kind === "case"
            ? { ...object, ...changes }
            : object
        );

        // Cases never block placement and never pair, so there is nothing to
        // mirror; the collision gate still runs (a case can overlap other wall
        // objects, treated blocked-zone-style) via the shared commit path.
        await commitWallObjectEdit(
          "Edit display case",
          project,
          nextWallObjects,
          [wallObjectId],
          true
        );
      },

      async commitPlanMove(objectId, placement, allowOverlap = false) {
        const project = get().project;
        if (!project) return;

        const wallObject = project.wallObjects.find((object) => object.id === objectId);
        const floorObject = project.floorObjects.find((object) => object.id === objectId);
        if (!wallObject && !floorObject) return;

        // Classify the drag by source (wall/floor object) × target
        // (placement.anchor) and delegate to the matching case handler.

        // --- Source: wall object -------------------------------------------
        if (wallObject) {
          if (placement.anchor === "wall") {
            await planMoveWithinWalls(project, wallObject, placement, allowOverlap);
            return;
          }
          await planMoveWallToFloor(project, wallObject, placement);
          return;
        }

        // --- Source: floor object ------------------------------------------
        if (!floorObject) return; // unreachable — narrows the type below.

        if (placement.anchor === "floor") {
          await planMoveFloorToFloor(project, floorObject, placement);
          return;
        }

        await planMoveFloorToWall(project, floorObject, placement, allowOverlap);
      },

      async updateFloorObject(objectId, changes) {
        const project = get().project;
        if (!project) return;

        const target = project.floorObjects.find((object) => object.id === objectId);
        if (!target) return;

        // heightMm is editable for cases (their overall floor-to-top height);
        // for artwork/blocked-zone the inspector never sends it, so including it
        // here is harmless — the equality guard drops any no-op change.
        const keys = ["xMm", "yMm", "widthMm", "depthMm", "heightMm"] as const;
        const hasChange = keys.some(
          (key) => changes[key] !== undefined && changes[key] !== target[key]
        );
        if (!hasChange) return;

        const nextFloorObjects = project.floorObjects.map((object) =>
          object.id === objectId ? { ...object, ...changes } : object
        );

        // Floor objects carry no wall bounds, so there's nothing to validate
        // here in v1 (see placeArtworkOnFloor).
        await applyEdit(`Edit ${moveObjectNoun(target.kind)}`, (current) => ({
          ...current,
          floorObjects: nextFloorObjects
        }));
      },

      // A direct group drag with no active session: one "Move N objects" undo
      // entry via the shared commit path. (When a session is active the drag
      // routes into setArrangeSessionPreview instead — see App.tsx.)
      async moveWallObjectsGroup(moves, allowOverlap = false) {
        const result = commitWallObjectMoves(
          moves,
          (count) => `Move ${count} objects`,
          allowOverlap
        );
        if (result.status === "committed") await persist(result.project);
      },

      async movePlanObjectsGroup(moves, allowOverlap = false) {
        const project = get().project;
        if (!project) return;

        const wallMoveById = new Map(
          moves
            .filter((move) => project.wallObjects.some((wallObject) => wallObject.id === move.id))
            .map((move) => [move.id, move])
        );
        const floorMoveById = new Map(
          moves
            .filter((move) =>
              project.floorObjects.some((floorObject) => floorObject.id === move.id)
            )
            .map((move) => [move.id, move])
        );
        if (wallMoveById.size === 0 && floorMoveById.size === 0) return;

        const movedWallIds: string[] = [];
        const nextWallObjects = project.wallObjects.map((wallObject) => {
          const move = wallMoveById.get(wallObject.id);
          if (!move) return wallObject;
          // A move.wallId re-anchors an artwork member onto a different wall
          // (group drag onto a foreign wall); absent, the member slides along
          // its own wall. Either way the hang height and size carry over
          // unchanged — the plan view has no notion of hang height, so yMm (if
          // present on the move) is ignored — mirroring commitPlanMove's
          // wall→wall branch. The collision gate below validates the new wall.
          const nextWallId = move.wallId ?? wallObject.wallId;
          if (wallObject.wallId === nextWallId && wallObject.xMm === move.xMm) return wallObject;
          movedWallIds.push(wallObject.id);
          return { ...wallObject, wallId: nextWallId, xMm: move.xMm };
        });

        const movedFloorIds: string[] = [];
        const nextFloorObjects = project.floorObjects.map((floorObject) => {
          const move = floorMoveById.get(floorObject.id);
          if (!move) return floorObject;
          const yMm = move.yMm ?? floorObject.yMm;
          if (floorObject.xMm === move.xMm && floorObject.yMm === yMm) return floorObject;
          movedFloorIds.push(floorObject.id);
          return { ...floorObject, xMm: move.xMm, yMm };
        });

        if (movedWallIds.length === 0 && movedFloorIds.length === 0) return;

        // Shared openings first, against the pre-edit classification and the
        // COMPLETED draft: one half in the batch drags its twin, both halves in
        // the batch are validated to still be one aligned opening on the same
        // boundary. This runs BEFORE normalization so a severing repair cannot
        // pre-empt the refusal.
        const paired = syncMovedPairHalves(project, nextWallObjects, movedWallIds);
        if (paired.status === "blocked") {
          set({ error: sharedOpeningRefusalMessage(paired.reason) });
          return;
        }

        // One normalization pass over the COMPLETED draft. Doing it per-object
        // inside the map above would be order-dependent: the first twin's move
        // would be judged against the second twin's not-yet-applied wall and
        // sever a pair that the finished batch leaves perfectly valid (dragging
        // both halves onto a new shared wall together must keep them paired).
        const pairedWallObjects = normalizeOpeningPairs({
          ...project,
          wallObjects: paired.nextWallObjects
        }).project.wallObjects;

        // Floor objects get no bounds/collision validation in v1 (see
        // placeArtworkOnFloor) — only the wall-anchored members are checked.
        // The label counts what the USER moved; a twin dragged along is still
        // validated, so it joins validateIds without inflating the count.
        // Reconcile the batch too: a group drag can carry an UNPAIRED opening
        // onto (or off) a shared boundary just as a single drag can, and this
        // path commits through the same gate. Both the pre-edit and post-edit
        // walls of every moved opening are in scope, because a re-anchor
        // leaves one boundary and joins another.
        const movedOpeningWallIds = [
          ...new Set(
            [...project.wallObjects, ...pairedWallObjects]
              .filter((object) => movedWallIds.includes(object.id) && isOpeningKind(object.kind))
              .map((object) => object.wallId)
          )
        ];

        await commitWallObjectEdit(
          `Move ${movedWallIds.length + movedFloorIds.length} objects`,
          project,
          pairedWallObjects,
          [...movedWallIds, ...paired.validateIds],
          allowOverlap,
          {
            nextFloorObjects,
            ...(movedOpeningWallIds.length > 0
              ? { reconcileWallIds: movedOpeningWallIds }
              : {})
          }
        );
      },

      ...arrange.actions,

      async removeSelectedPlacements() {
        const project = get().project;
        const selectedIds = objectIdsOf(get().selection);
        if (!project || selectedIds.length === 0) return;

        const idSet = new Set(selectedIds);
        const removedCount =
          project.wallObjects.filter((wallObject) => idSet.has(wallObject.id)).length +
          project.floorObjects.filter((floorObject) => idSet.has(floorObject.id)).length;
        if (removedCount === 0) return;

        const label = removedCount === 1 ? "Remove 1 object" : `Remove ${removedCount} objects`;

        // Keyboard and multi-selection deletion obey the same shared-wall
        // full-sync contract as removePlacement: selecting either face removes
        // both stored halves of a paired door/window in this one commit. Keep
        // the label based on the user's selected objects; mirrored twins are a
        // storage detail rather than an additional selected object.
        const removedIds = includePairedOpenings(project.wallObjects, idSet);
        const nextProject: Project = {
          ...project,
          wallObjects: clearOpeningPartners(
            project.wallObjects.filter((wallObject) => !removedIds.has(wallObject.id)),
            removedIds
          ),
          floorObjects: project.floorObjects.filter(
            (floorObject) => !removedIds.has(floorObject.id)
          )
        };

        await applyEdit(
          label,
          () => nextProject,
          selectionWrite(project, NO_SELECTION, get().wallContextId)
        );
      },

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
          const project = migrateProject(record.project);
          setDocument(project, { viewMode: "plan", saveState: "saving" });
          await persist(project);
          snapshotOnOpen(project);
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
