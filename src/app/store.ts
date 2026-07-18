import { create } from "zustand";
import { toast } from "sonner";
import { z } from "zod";
import { createBrowserImageProcessor } from "../domain/assets/browserImageProcessor";
import { type ImageProcessor } from "../domain/assets/imageIntake";
import {
  type GeometryEditResult
} from "../domain/geometry/editRoom";
import { parseFaceWallId } from "../domain/geometry/freestandingWalls";
import { getFloorWalls } from "../domain/geometry/planObjects";
import type { PlanPlacement } from "../domain/snapping/planSnapTargets";
import { newId } from "../domain/id";
import {
  getDefaultOpeningCenterYMm,
  getDefaultOpeningSizeMm,
  type OpeningKind
} from "../domain/placement/createOpening";
import {
  clearOpeningPartners,
  includePairedOpenings
} from "../domain/placement/openingPairs";
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
import { IndexedDbSavedViewThumbnailRepository } from "../domain/repositories/indexedDbSavedViewThumbnailRepository";
import type { ProjectRepository } from "../domain/repositories/projectRepository";
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
  buildOpeningWithMirror,
  moveObjectNoun,
  openingNoun,
  resolveFreeOpeningXMm,
  syncPartnerMove,
  syncPartnerResize
} from "./store/openingEdits";
import {
  createPackageSlice,
  type PackageSliceActions
} from "./store/packageSlice";
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
  getSelectedOpeningId
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

export type AppState = ArrangeSliceState &
  ArrangeSliceActions &
  ArtworkIntakeSliceState &
  ArtworkIntakeSliceActions &
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
  placementWarnings: PlacementWarning[];
  lastGeometryEdit: GeometryEditInfo | null;
  undoStack: EditEntry[];
  redoStack: EditEntry[];
  libraryArtworks: Artwork[];
  intakeState: "idle" | "processing";
  // A .sightlines import paused on §6 artwork conflicts, awaiting one review
  // step in the conflict dialog. Nothing has been persisted yet.
  pendingPackageImport: ImportPlan | null;
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
  addOpening: (wallId: string, kind: OpeningKind) => Promise<void>;
  moveOpening: (
    wallObjectId: string,
    xMm: number,
    yMm: number,
    allowOverlap?: boolean
  ) => Promise<void>;
  resizeOpening: (
    wallObjectId: string,
    widthMm: number,
    heightMm: number,
    allowOverlap?: boolean
  ) => Promise<void>;
  connectOpenings: (aId: string, bId: string) => Promise<void>;
  disconnectOpening: (id: string) => Promise<void>;
  placeOpeningFromPlan: (kind: OpeningKind, placement: PlanPlacement) => Promise<void>;
  placeOpeningOnElevation: (
    kind: OpeningKind,
    wallId: string,
    xMm: number,
    yMm: number
  ) => Promise<void>;
  placeArtworkOnFloor: (artworkId: string, xMm: number, yMm: number) => Promise<void>;
  commitPlanMove: (
    objectId: string,
    placement: PlanPlacement,
    allowOverlap?: boolean
  ) => Promise<void>;
  updateFloorObject: (
    objectId: string,
    changes: Partial<Pick<FloorObjectBase, "xMm" | "yMm" | "widthMm" | "depthMm">>
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
  onProjectDeleted?: (projectId: string) => void | Promise<void>;
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

    async function persist(project: Project): Promise<boolean> {
      set({ saveState: "saving", error: null });

      try {
        await deps.projectRepository.save(project);
        set({ saveState: "saved" });
        return true;
      } catch (error) {
        set({
          saveState: "error",
          error: error instanceof Error ? error.message : "Could not save project."
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
        set({ libraryArtworks: await deps.artworkLibraryRepository.list() });
      } catch (error) {
        set({
          saveState: "error",
          error: error instanceof Error ? error.message : "Could not save the artwork library."
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
        pendingDuplicateUploads: [],
        pendingPackageImport: null,
        ...extras
      });
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
      options: { nextFloorObjects?: FloorObject[]; extras?: EditExtras } = {}
    ): Promise<boolean> {
      const placementWarnings = gatePlacementWarnings(
        project,
        nextWallObjects,
        validateIds,
        allowOverlap
      );
      if (placementWarnings === null) return false;

      await applyEdit(
        label,
        (current) => ({
          ...current,
          wallObjects: nextWallObjects,
          ...(options.nextFloorObjects ? { floorObjects: options.nextFloorObjects } : {})
        }),
        { placementWarnings, ...options.extras }
      );
      return true;
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

      const nextWallObjects = project.wallObjects.map((object) =>
        object.id === wallObject.id
          ? { ...object, wallId: placement.wallId, xMm: placement.xMm }
          : object
      );

      await commitWallObjectEdit(
        `Move ${moveObjectNoun(wallObject.kind)}`,
        project,
        nextWallObjects,
        [wallObject.id],
        allowOverlap
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

      // One collision blocks the entire batch.
      const placementWarnings = gatePlacementWarnings(project, nextWallObjects, movedIds, allowOverlap);
      if (placementWarnings === null) return { status: "blocked" };

      const after = {
        ...project,
        wallObjects: nextWallObjects,
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

    const projectManager = createProjectManagerSlice(set, get, { setDocument, deps });

    const packageSlice = createPackageSlice(set, get, { persist, setDocument, deps });

    const artworkIntake = createArtworkIntakeSlice(set, get, { applyEdit, persist, deps });

    const roomGeometry = createRoomGeometrySlice(set, get, {
      applyEdit,
      runPartitionEdit,
      validateChangedWallPlacements
    });

    return {
      project: null,
      selection: NO_SELECTION,
      wallContextId: null,
      ...ARRANGE_SLICE_INITIAL,
      viewMode: "plan",
      saveState: "idle",
      error: null,
      placementWarnings: [],
      lastGeometryEdit: null,
      undoStack: [],
      redoStack: [],
      libraryArtworks: [],
      intakeState: "idle",
      ...ARTWORK_INTAKE_SLICE_INITIAL,
      pendingPackageImport: null,

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
        } catch (error) {
          // Keep the app usable with an in-memory sample, but say plainly that
          // the saved project could not load — never silently substitute.
          // The project load failure is the more important message here, so
          // it wins over any calmer library-load note.
          setDocument(createSampleProject(), {
            saveState: "error",
            libraryArtworks,
            error: `Could not load the saved project (${
              error instanceof Error ? error.message : "unknown error"
            }). Showing an unsaved sample instead. Your data is still in browser storage.`
          });
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

        // Both bulk surfaces (the inspector's Mat & frame section and the
        // library's dialog) otherwise finish silently — framing is a read-time
        // expansion, so nothing visibly moves near the Apply button. A quiet
        // one-shot toast confirms the landing, in the same voice as
        // export/import success.
        toast.success(
          `Mat & frame applied to ${halves.length} work${halves.length === 1 ? "" : "s"}`
        );

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
        const { nextWallObjects, primaryId, validateIds } = buildOpeningWithMirror(
          project,
          wall,
          kind,
          xMm
        );

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
        if (!project) return;

        const target = project.wallObjects.find((wallObject) => wallObject.id === wallObjectId);
        if (!target || target.kind === "artwork") return;

        // Doors must sit on the floorline (center at height/2).
        const clampedYMm = target.kind === "door" ? target.heightMm / 2 : yMm;

        if (target.xMm === xMm && target.yMm === clampedYMm) return;

        let nextWallObjects = project.wallObjects.map((wallObject) =>
          wallObject.id === wallObjectId ? { ...wallObject, xMm, yMm: clampedYMm } : wallObject
        );
        let validateIds = [wallObjectId];

        // Shared-wall sync: a paired door/window drags its twin in the same
        // commit so the two rooms stay aligned (spec §5.5) — unless the mirrored
        // slot would collide, in which case only the target moves.
        if (
          (target.kind === "door" || target.kind === "window") &&
          target.connectsToObjectId !== undefined
        ) {
          const synced = syncPartnerMove(project, nextWallObjects, target, xMm, clampedYMm);
          if (synced) {
            nextWallObjects = synced.nextWallObjects;
            validateIds = [wallObjectId, synced.partnerId];
          }
        }

        // Same shape as moveArtworkPlacement: the UI previews the drag
        // locally and calls this exactly once on release.
        await commitWallObjectEdit(
          `Move ${openingNoun(target.kind)}`,
          project,
          nextWallObjects,
          validateIds,
          allowOverlap
        );
      },

      async resizeOpening(wallObjectId, widthMm, heightMm, allowOverlap = false) {
        const project = get().project;
        if (!project) return;

        const target = project.wallObjects.find((wallObject) => wallObject.id === wallObjectId);
        if (!target || target.kind === "artwork") return;
        if (target.widthMm === widthMm && target.heightMm === heightMm) return;

        // For doors, recompute yMm so the bottom stays on the floor when height changes.
        const updatedYMm = target.kind === "door" ? heightMm / 2 : target.yMm;

        let nextWallObjects = project.wallObjects.map((wallObject) =>
          wallObject.id === wallObjectId ? { ...wallObject, widthMm, heightMm, yMm: updatedYMm } : wallObject
        );
        let validateIds = [wallObjectId];

        // Shared-wall sync: mirror the new size onto a paired twin in the same
        // commit (spec §5.5), skipping the twin when its new footprint would
        // collide with another opening on its wall.
        if (
          (target.kind === "door" || target.kind === "window") &&
          target.connectsToObjectId !== undefined
        ) {
          const synced = syncPartnerResize(project, nextWallObjects, target, widthMm, heightMm);
          if (synced) {
            nextWallObjects = synced.nextWallObjects;
            validateIds = [wallObjectId, synced.partnerId];
          }
        }

        await commitWallObjectEdit(
          `Resize ${openingNoun(target.kind)}`,
          project,
          nextWallObjects,
          validateIds,
          allowOverlap
        );
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

      async placeOpeningFromPlan(kind, placement) {
        const project = get().project;
        if (!project) return;

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
        const { nextWallObjects, primaryId, validateIds } = buildOpeningWithMirror(
          project,
          wall,
          kind,
          xMm
        );

        // Same as addOpening: never blocked by a collision.
        await commitWallObjectEdit(
          `Add ${openingNoun(kind)}`,
          project,
          nextWallObjects,
          validateIds,
          true,
          {
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

        const { nextWallObjects, primaryId, validateIds } = buildOpeningWithMirror(
          project,
          wall,
          kind,
          xCenterMm,
          resolvedYMm
        );

        await commitWallObjectEdit(
          `Add ${openingNoun(kind)}`,
          project,
          nextWallObjects,
          validateIds,
          true,
          {
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

        const keys = ["xMm", "yMm", "widthMm", "depthMm"] as const;
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

        // Floor objects get no bounds/collision validation in v1 (see
        // placeArtworkOnFloor) — only the wall-anchored members are checked.
        await commitWallObjectEdit(
          `Move ${movedWallIds.length + movedFloorIds.length} objects`,
          project,
          nextWallObjects,
          movedWallIds,
          allowOverlap,
          { nextFloorObjects }
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
      }
    };
  });
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
  onProjectDeleted: async (projectId) => {
    const { deleteStoredDocumentExportPreferences } = await import(
      "./hooks/useDocumentExportPreferences"
    );
    deleteStoredDocumentExportPreferences(projectId);
    // A project's Saved-view thumbnails are a derived cache outside the project;
    // they follow its lifecycle alongside the workspace-preference record
    // (saved-views spec §3.2, export-spec §6.3).
    await new IndexedDbSavedViewThumbnailRepository().deleteByProject(projectId);
  }
});

export function exportProjectJson(project: Project): string {
  return JSON.stringify(project, null, 2);
}
