import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { GhostIcon } from "@phosphor-icons/react/dist/csr/Ghost";
import { GridFourIcon } from "@phosphor-icons/react/dist/csr/GridFour";
import { MagnetIcon } from "@phosphor-icons/react/dist/csr/Magnet";
import { RulerIcon } from "@phosphor-icons/react/dist/csr/Ruler";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { StackIcon } from "@phosphor-icons/react/dist/csr/Stack";
import {
  getPlacedRoomBounds,
  getRectangleRoomDimensions,
} from "../domain/geometry/walls";
import { getRoomPlaceableWalls } from "../domain/geometry/placeableWalls";
import { getPlaceableFloorWalls } from "../domain/geometry/planObjects";
import {
  effectivePlacementForm,
  type PlacementForm
} from "../domain/placement/artworkForm";
import type { WallSwitcherEntry } from "./components/elevation/WallSwitcher";
import {
  getSharedOpeningStatus,
  sharedOpeningResolutions
} from "../domain/geometry/sharedOpeningStatus";
import { getOpeningKindLabel } from "../domain/placement/createOpening";
import { derivePartitionNeighborShimsForFloorWall } from "../domain/placement/partitionNeighbors";
import { withArtworkFootprintFromMap } from "../domain/framing";
import type {
  Artwork,
  ArtworkFloorObject,
  ArtworkWallObject,
  BlockedZoneFloorObject,
  CaseFloorObject,
  CaseWallObject,
  DisplayUnit,
  FreestandingWall,
  OpeningWallObject,
  ProjectSummary,
  SavedView,
  SavedViewPose,
  WallTextWallObject
} from "../domain/project";
import { isDegeneratePose, resolveSavedViewRoomLabel } from "../domain/savedViews";
import { faceWallId, parseFaceWallId } from "../domain/geometry/freestandingWalls";
import { getPartitionClearances } from "../domain/geometry/partitionSpacing";
import { readDropboxShareUrl } from "./cloud/dropboxShare";
import { CLOUD_BACKUP_CONFIGURED } from "./cloud/configured";
import { IndexedDbAssetRepository } from "../domain/repositories/indexedDbAssetRepository";
import {
  displayUnitForSystem,
  unitSystemFromDisplayUnit
} from "../domain/units/unitSystem";
import { AppDialogs } from "./components/AppDialogs";
import { PrivacyConsentNotice } from "./components/privacy/PrivacyConsentNotice";
import { usePrivacyPreferences } from "./telemetry/privacyPreferences";
import { AppRail } from "./components/AppRail";
import { ArtworkInspector } from "./components/inspectors/ArtworkInspector";
import { ArtworkLibraryView } from "./components/library/ArtworkLibrary";
import { PanelResizeHandle } from "./components/shared/PanelResizeHandle";
import { PlacementWarnings } from "./components/placement/PlacementWarnings";
import {
  describeSharedConnection,
  describeSharedOpeningConflict,
  describeSharedOpeningDrift,
  describeSharedOpeningTarget
} from "./components/placement/sharedOpeningIssueCopy";
import { selectSharedOpeningConflicts } from "../domain/placement/sharedOpeningIssues";
import { ChecklistPanel } from "./components/panels/ChecklistPanel";
import { ElevationEmptyState } from "./components/elevation/ElevationEmptyState";
import { FloorCaseInspector, WallCaseInspector } from "./components/inspectors/CaseInspector";
import { FloorObjectInspector, FloorPlacementFields } from "./components/inspectors/FloorObjectInspector";
import { FloorArtworkImageFacesField } from "./components/inspectors/FloorArtworkImageFacesField";
import { StandsOnField } from "./components/inspectors/StandsOnField";
import { FloorSupportFields } from "./components/inspectors/FloorSupportFields";
import { isMonitorArtwork } from "../domain/geometry/monitorGlyphs";
import { resolveFloorSupport } from "../domain/geometry/supportGlyphs";
import { FloorArtworkImageSizeNote } from "./components/inspectors/FloorArtworkImageSizeNote";
import { FreestandingWallInspector } from "./components/inspectors/FreestandingWallInspector";
import {
  OpeningInspector,
  type OpeningSharedSection
} from "./components/inspectors/OpeningInspector";
import { PlanEmptyState } from "./components/plan/PlanEmptyState";
import { PlanView } from "./components/plan/PlanView";
import {
  DrawPicker,
  InsertPicker,
  PrecisionSelect,
  ThreeDCameraTools,
  UnitSystemToggle,
  useResponsiveToolbarDensity,
  ViewOptionButton
} from "./components/toolbar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "./components/ui/tooltip";
import { Toaster } from "./components/ui/sonner";
import { toast } from "sonner";
import { TopBar } from "./components/topbar/TopBar";
import { RoomInspector } from "./components/inspectors/RoomInspector";
import { RoomsPanel } from "./components/panels/RoomsPanel";
import { SavedViewsPanel } from "./components/panels/SavedViewsPanel";
import { SelectionInspector } from "./components/inspectors/SelectionInspector";
import { MeasurementInspector, ReferenceMeasurementInspector } from "./components/inspectors/MeasurementInspector";
import { MeasurementLiveRegion } from "./components/measurement/MeasurementLiveRegion";
import {
  WallPlacementFields,
  getWallPlacementCenterTarget,
  getWallPlacementNeighborEdges
} from "./components/inspectors/WallPlacementFields";
import { WallInspector } from "./components/inspectors/WallInspector";
import { WallTextInspector } from "./components/inspectors/WallTextInspector";
import { useArtworksById } from "./hooks/useArtworksById";
import { useStoragePersistence } from "./hooks/useStoragePersistence";
import { useSaveErrorToast } from "./hooks/useSaveErrorToast";
import {
  useCloudBackupScheduler,
  useCloudBackupErrorToast
} from "./hooks/useCloudBackupScheduler";
import { useProjectSyncScheduler } from "./hooks/useProjectSyncScheduler";
import {
  escapeMeasurementState,
  useMeasurementTool
} from "./hooks/useMeasurementTool";
import { useTemporaryMeasurementShortcuts } from "./hooks/useTemporaryMeasurementShortcuts";
import {
  useViewPreferences,
  LEFT_PANEL_MIN_WIDTH,
  LEFT_PANEL_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  INSPECTOR_MAX_WIDTH
} from "./hooks/useViewPreferences";
import { useViewport2D } from "./hooks/useViewport2D";
import { usePlanMode } from "./hooks/usePlanMode";
import { isEditableTarget } from "./hooks/isEditableTarget";
import { useUndoRedoShortcuts } from "./hooks/useUndoRedoShortcuts";
import { useArrangeNudgeShortcuts } from "./hooks/useArrangeNudgeShortcuts";
import { useDeleteAndEscapeShortcuts } from "./hooks/useDeleteAndEscapeShortcuts";
import { useDialogs } from "./hooks/useDialogs";
import { useToolbarShortcuts } from "./hooks/useToolbarShortcuts";
import { deriveArrangeReadout } from "./hooks/arrangeReadout";
import {
  freestandingWallIdOf,
  getProjectWalls,
  getSelectedArtworkId,
  getSelectedOpeningId,
  getSelectedWallTextId,
  getSelectedWall,
  objectIdsOf,
  pickedWallIdOf,
  roomIdOf,
  useAppStore
} from "./store";
import { getWallDimensionLink, getWallNames } from "./projectWalls";
import { getArrangeEligibility } from "./store/arrangeEligibility";
import type { ThreeDViewActions } from "./components/three/ThreeDView";
import type { SavedViewRenderHandle } from "./components/three/SavedViewRenderHost";
import { createSavedViewRenderRef } from "./savedViewRenderRef";
import { useExportActions } from "./hooks/useExportActions";
import { useSavedViewThumbnails } from "./hooks/useSavedViewThumbnails";
import { rendererBenchmarkEnabled } from "./rendererBenchmarkFlag";

const ElevationView = lazy(() =>
  import("./components/elevation/ElevationView").then((module) => ({ default: module.ElevationView }))
);
const ThreeDView = lazy(() =>
  import("./components/three/ThreeDView").then((module) => ({ default: module.ThreeDView }))
);

// Warm the lazy 3D chunks (three.js download + parse) once the main thread is
// idle after boot: the initial bundle and time-to-first-paint are untouched,
// but by the time the user first switches to 3D, saves a view, or opens the
// Export dialog, the code is already in memory instead of costing a ~800 kB
// fetch + parse at that moment. A failed prefetch is silent — the lazy()
// mounts above retry the import on real demand. Skipped under test so
// rendering App doesn't drag three.js into jsdom.
if (typeof window !== "undefined" && !import.meta.env.TEST) {
  const warmThreeChunks = () => {
    import("./components/three/ThreeDView").catch(() => {});
    import("./components/three/SavedViewRenderHost").catch(() => {});
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(warmThreeChunks, { timeout: 5000 });
  } else {
    // Safari (iPad included) has no requestIdleCallback.
    window.setTimeout(warmThreeChunks, 3000);
  }
}

// Stable read-only asset lookup; the repository wrapper is stateless.
const assetRepository = new IndexedDbAssetRepository();
let rendererBenchmarkBlobLoader:
  | ((key: string) => Promise<Blob | null>)
  | null = null;
// At this viewport width the medium panel tracks leave the canvas at the edge
// of the compact toolbar's one-line budget. Collapse one side pane before the
// toolbar starts clipping; the CSS workspace breakpoints use the same range.
const SINGLE_PANE_WORKSPACE_MEDIA_QUERY = "(max-width: 1080px)";

function getAssetBlob(key: string): Promise<Blob> {
  if (rendererBenchmarkEnabled) {
    return (rendererBenchmarkBlobLoader?.(key) ?? Promise.resolve(null)).then((blob) => {
      if (blob) return blob;
      return assetRepository.getBlob(key);
    });
  }
  return assetRepository.getBlob(key);
}

export function App() {
  const project = useAppStore((state) => state.project);
  const selection = useAppStore((state) => state.selection);
  const wallContextId = useAppStore((state) => state.wallContextId);
  const arrangeSession = useAppStore((state) => state.arrangeSession);
  const lastArrangeMode = useAppStore((state) => state.lastArrangeMode);
  const lastInsetAnchor = useAppStore((state) => state.lastInsetAnchor);
  const lastEvenZone = useAppStore((state) => state.lastEvenZone);
  const viewMode = useAppStore((state) => state.viewMode);
  const error = useAppStore((state) => state.error);
  const placementWarnings = useAppStore((state) => state.placementWarnings);
  const lastGeometryEdit = useAppStore((state) => state.lastGeometryEdit);
  const libraryArtworks = useAppStore((state) => state.libraryArtworks);
  const intakeState = useAppStore((state) => state.intakeState);
  const pendingDuplicateUploads = useAppStore((state) => state.pendingDuplicateUploads);
  const boot = useAppStore((state) => state.boot);
  const createCloudShareLink = useAppStore((state) => state.createCloudShareLink);
  const completeCloudBackupConnect = useAppStore((state) => state.completeCloudBackupConnect);
  const refreshCloudBackupStatus = useAppStore((state) => state.refreshCloudBackupStatus);
  const refreshProjectSyncState = useAppStore((state) => state.refreshProjectSyncState);
  const loadBenchmarkFixture = useAppStore((state) => state.loadBenchmarkFixture);
  const setViewMode = useAppStore((state) => state.setViewMode);
  const selectWall = useAppStore((state) => state.selectWall);
  // Navigation counterpart: points the inspector/elevation at a wall without
  // arming Delete for it. Used by the Rooms panel list and the elevation wall
  // switcher; the plan and 3D canvases use selectWall.
  const focusWallContext = useAppStore((state) => state.focusWallContext);
  const selectArtwork = useAppStore((state) => state.selectArtwork);
  const selectOpening = useAppStore((state) => state.selectOpening);
  const addReferenceMeasurement = useAppStore((state) => state.addReferenceMeasurement);
  const updateReferenceMeasurement = useAppStore((state) => state.updateReferenceMeasurement);
  const deleteReferenceMeasurement = useAppStore((state) => state.deleteReferenceMeasurement);
  const saveView = useAppStore((state) => state.saveView);
  const renameSavedView = useAppStore((state) => state.renameSavedView);
  const deleteSavedView = useAppStore((state) => state.deleteSavedView);
  const viewFreestandingFace = useAppStore((state) => state.viewFreestandingFace);
  const selectObject = useAppStore((state) => state.selectObject);
  const setObjectSelection = useAppStore((state) => state.setObjectSelection);
  const clearObjectSelection = useAppStore((state) => state.clearObjectSelection);
  const addRectangleRoom = useAppStore((state) => state.addRectangleRoom);
  const addPolygonRoom = useAppStore((state) => state.addPolygonRoom);
  const addDrawnRectangleRoom = useAppStore((state) => state.addDrawnRectangleRoom);
  const addFreestandingWall = useAppStore((state) => state.addFreestandingWall);
  const duplicateFreestandingWall = useAppStore((state) => state.duplicateFreestandingWall);
  const moveFreestandingWall = useAppStore((state) => state.moveFreestandingWall);
  const moveFreestandingWallEndpoint = useAppStore((state) => state.moveFreestandingWallEndpoint);
  const rotateFreestandingWall = useAppStore((state) => state.rotateFreestandingWall);
  const centerFreestandingWall = useAppStore((state) => state.centerFreestandingWall);
  const setFreestandingWallThickness = useAppStore((state) => state.setFreestandingWallThickness);
  const setFreestandingWallLength = useAppStore((state) => state.setFreestandingWallLength);
  const setFreestandingWallHeight = useAppStore((state) => state.setFreestandingWallHeight);
  const setFreestandingWallClearance = useAppStore((state) => state.setFreestandingWallClearance);
  const deleteFreestandingWall = useAppStore((state) => state.deleteFreestandingWall);
  const renameRoom = useAppStore((state) => state.renameRoom);
  const deleteRoom = useAppStore((state) => state.deleteRoom);
  const openWall = useAppStore((state) => state.openWall);
  const restoreWall = useAppStore((state) => state.restoreWall);
  const setUnit = useAppStore((state) => state.setUnit);
  const setChecklistView = useAppStore((state) => state.setChecklistView);
  const resizeSelectedWall = useAppStore((state) => state.resizeSelectedWall);
  const resizeRoomHeight = useAppStore((state) => state.resizeRoomHeight);
  const resizeWall = useAppStore((state) => state.resizeWall);
  const setPolygonWallLength = useAppStore((state) => state.setPolygonWallLength);
  const undo = useAppStore((state) => state.undo);
  const redo = useAppStore((state) => state.redo);
  const importProjectJson = useAppStore((state) => state.importProjectJson);
  const exportProjectPackage = useAppStore((state) => state.exportProjectPackage);
  const exportProjectPackageById = useAppStore((state) => state.exportProjectPackageById);
  const exportChecklistSpreadsheet = useAppStore((state) => state.exportChecklistSpreadsheet);
  const exportChecklistPdf = useAppStore((state) => state.exportChecklistPdf);
  const importSightlinesPackage = useAppStore((state) => state.importSightlinesPackage);
  const listArtworkProjectMemberships = useAppStore((state) => state.listArtworkProjectMemberships);
  const openProject = useAppStore((state) => state.openProject);
  const addArtworksFromFiles = useAppStore((state) => state.addArtworksFromFiles);
  const addExistingArtworksToChecklist = useAppStore((state) => state.addExistingArtworksToChecklist);
  const confirmDuplicateUploads = useAppStore((state) => state.confirmDuplicateUploads);
  const dismissDuplicateUploads = useAppStore((state) => state.dismissDuplicateUploads);
  const removeArtworkFromChecklist = useAppStore((state) => state.removeArtworkFromChecklist);
  const deleteLibraryArtworks = useAppStore((state) => state.deleteLibraryArtworks);
  const updateArtwork = useAppStore((state) => state.updateArtwork);
  const updateArtworksMatFrame = useAppStore((state) => state.updateArtworksMatFrame);
  const placeArtwork = useAppStore((state) => state.placeArtwork);
  const placeArtworkOnFloor = useAppStore((state) => state.placeArtworkOnFloor);
  const setArtworkPlacementForm = useAppStore((state) => state.setArtworkPlacementForm);
  const moveArtworkPlacement = useAppStore((state) => state.moveArtworkPlacement);
  const removePlacement = useAppStore((state) => state.removePlacement);
  const addOpening = useAppStore((state) => state.addOpening);
  const addWallCase = useAppStore((state) => state.addWallCase);
  const moveOpening = useAppStore((state) => state.moveOpening);
  const resizeOpening = useAppStore((state) => state.resizeOpening);
  const fitOpeningToAvailableSpan = useAppStore((state) => state.fitOpeningToAvailableSpan);
  const updateDoorLeaf = useAppStore((state) => state.updateDoorLeaf);
  // The five shared-opening resolutions. Each one re-derives its own guard from
  // the current project inside the store — the inspector only ever asks.
  const resolveSharedOpening = useAppStore((state) => state.resolveSharedOpening);
  const completeSharedOpening = useAppStore((state) => state.completeSharedOpening);
  const realignSharedOpening = useAppStore((state) => state.realignSharedOpening);
  const splitSharedOpening = useAppStore((state) => state.splitSharedOpening);
  const keepThisOpeningOnly = useAppStore((state) => state.keepThisOpeningOnly);
  const renameWallText = useAppStore((state) => state.renameWallText);
  const placeOpeningOnElevation = useAppStore((state) => state.placeOpeningOnElevation);
  const commitPlanMove = useAppStore((state) => state.commitPlanMove);
  const updateFloorObject = useAppStore((state) => state.updateFloorObject);
  const setFloorArtworkImageFaces = useAppStore((state) => state.setFloorArtworkImageFaces);
  const setFloorArtworkStandsOn = useAppStore((state) => state.setFloorArtworkStandsOn);
  const updateFloorArtworkSupport = useAppStore(
    (state) => state.updateFloorArtworkSupport
  );
  const pairFloorArtworksBackToBack = useAppStore(
    (state) => state.pairFloorArtworksBackToBack
  );
  const updateWallCase = useAppStore((state) => state.updateWallCase);
  const moveWallObjectPlacement = useAppStore((state) => state.moveWallObjectPlacement);
  const moveWallObjectsGroup = useAppStore((state) => state.moveWallObjectsGroup);
  const movePlanObjectsGroup = useAppStore((state) => state.movePlanObjectsGroup);
  const removeSelectedPlacements = useAppStore((state) => state.removeSelectedPlacements);
  const beginArrangeSession = useAppStore((state) => state.beginArrangeSession);
  const setArrangeAnchor = useAppStore((state) => state.setArrangeAnchor);
  const setArrangeEvenZone = useAppStore((state) => state.setArrangeEvenZone);
  const updateArrangeSession = useAppStore((state) => state.updateArrangeSession);
  const setArrangeSessionPreview = useAppStore((state) => state.setArrangeSessionPreview);
  const commitArrangeSession = useAppStore((state) => state.commitArrangeSession);
  const cancelArrangeSession = useAppStore((state) => state.cancelArrangeSession);
  const centerSelectionBetweenBoundaries = useAppStore(
    (state) => state.centerSelectionBetweenBoundaries
  );
  // Selection union is the source of truth; single-subject ids resolve live.
  const selectedObjectIds = objectIdsOf(selection);
  const selectedRoomId = roomIdOf(selection);
  const selectedFreestandingWallId = freestandingWallIdOf(selection);
  const selectedArtworkId = getSelectedArtworkId(project, selection);
  const selectedOpeningId = getSelectedOpeningId(project, selection);
  const selectedWallTextId = getSelectedWallTextId(project, selection);
  const selectedReferenceMeasurement = selection.kind === "measurement"
    ? project?.referenceMeasurements?.find((item) => item.id === selection.measurementId) ?? null
    : null;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const threeDActionsRef = useRef<ThreeDViewActions | null>(null);
  const planSvgElementRef = useRef<SVGSVGElement | null>(null);
  const elevationSvgElementRef = useRef<SVGSVGElement | null>(null);
  const [snapshotExportMode, setSnapshotExportMode] = useState(false);
  // Every workspace dialog's open state, in one registry: the confirms carry
  // their subject, and `anyOpen` is the single "a dialog owns the keyboard" flag
  // the shortcut hooks below stand down on.
  const dialogs = useDialogs();
  const [importDestination, setImportDestination] = useState<"library" | "checklist">("checklist");
  const [projectMembershipsByArtworkId, setProjectMembershipsByArtworkId] = useState<
    Map<string, ProjectSummary[]>
  >(() => new Map());
  const [draggingArtworkId, setDraggingArtworkId] = useState<string | null>(null);
  const {
    preferences: privacyPreferences,
    decision: privacyDecision,
    setPreferences: setPrivacyPreferences
  } = usePrivacyPreferences();
  // A Saved view's pose, staged to become the 3D view's INITIAL camera when the
  // pane opens a view while 3D isn't the active mode yet (saved-views spec §4.3
  // handoff). CameraRig captures it at mount, so the lingering value is inert;
  // an effect clears it on leaving 3D to keep a later re-entry from reusing it.
  const [pendingViewPose, setPendingViewPose] = useState<SavedViewPose | null>(
    null
  );
  // The render host's handle. Exposed both as a live ref (the PDF export path
  // reads `.current` synchronously) and as state (so useSavedViewThumbnails's
  // processing loop re-runs when the host mounts and the handle attaches). The
  // wrapper mirrors every write into both, and `whenReady` lets the PDF export
  // wait out the host's lazy mount (three chunk fetch + Suspense + attach
  // effect) instead of failing a 3D page to a placeholder because Export was
  // clicked before the handle existed.
  const [savedViewRenderHandle, setSavedViewRenderHandle] =
    useState<SavedViewRenderHandle | null>(null);
  const savedViewRenderRef = useMemo(
    () => createSavedViewRenderRef(setSavedViewRenderHandle),
    []
  );

  const [incomingDropboxShareUrl, setIncomingDropboxShareUrl] = useState<string | null>(() =>
    readDropboxShareUrl(window.location.href)
  );

  useEffect(() => {
    if (viewMode !== "library" || !project) return;
    const { id: liveId, title: liveTitle, updatedAt: liveUpdatedAt } = project;
    const liveChecklist = new Set(project.checklistArtworkIds);
    let cancelled = false;
    void listArtworkProjectMemberships(libraryArtworks.map((artwork) => artwork.id)).then(
      (memberships) => {
        if (cancelled) return;
        // Async persistence may lag; derive the open project's membership live.
        const liveSummary: ProjectSummary = {
          id: liveId,
          title: liveTitle,
          updatedAt: liveUpdatedAt,
          roomCount: project.floor.rooms.length,
          artworkCount: project.checklistArtworkIds.length
        };
        setProjectMembershipsByArtworkId(
          new Map(
            memberships.map(({ artworkId, projects }) => {
              const others = projects.filter((summary) => summary.id !== liveId);
              return [
                artworkId,
                liveChecklist.has(artworkId) ? [liveSummary, ...others] : others
              ];
            })
          )
        );
      }
    );
    return () => {
      cancelled = true;
    };
  }, [libraryArtworks, listArtworkProjectMemberships, viewMode, project]);
  // Mutually exclusive, transient plan tools must not persist or enter undo history.
  const {
    mode: planMode,
    armOpeningTool,
    toggleDrawRect,
    toggleDrawRoom,
    toggleReshapeRoom,
    togglePartitionTool,
    armDuplicatePartition,
    toggleMeasure,
    disarm: disarmPlanMode
  } = usePlanMode(viewMode, selectedRoomId);
  // Compatibility aliases derived from planMode.
  const activeTool = planMode.kind === "placeOpening" ? planMode.tool : null;
  const drawRectActive = planMode.kind === "drawRect";
  const drawRoomActive = planMode.kind === "drawRoom";
  const reshapeRoomId = planMode.kind === "reshapeRoom" ? planMode.roomId : null;
  const partitionToolActive = planMode.kind === "drawPartition";
  const duplicatePartitionSourceWallId =
    planMode.kind === "duplicatePartition" ? planMode.sourceWallId : null;
  const measurementActive = planMode.kind === "measure";
  // PlanView uses boolean setters so completion and Escape can disarm tools.
  const setDrawRectActive = (active: boolean) => {
    if (!active) {
      if (planMode.kind === "drawRect") disarmPlanMode();
    } else if (planMode.kind !== "drawRect") {
      toggleDrawRect();
    }
  };
  const setDrawRoomActive = (active: boolean) => {
    if (!active) {
      if (planMode.kind === "drawRoom") disarmPlanMode();
    } else if (planMode.kind !== "drawRoom") {
      toggleDrawRoom();
    }
  };
  const setPartitionToolActive = (active: boolean) => {
    if (!active) {
      if (planMode.kind === "drawPartition") disarmPlanMode();
    } else if (planMode.kind !== "drawPartition") {
      togglePartitionTool();
    }
  };
  const {
    showGrid,
    snapToGrid,
    showCenterline,
    showElevationGhosts,
    gridPrecisionFloorMm,
    allowOverlappingPlacement,
    leftPanel,
    leftPanelWidth,
    inspectorWidth,
    inspectorCollapsed,
    inspectorSections,
    setInspectorSectionOpen,
    setLeftPanel,
    setLeftPanelWidth,
    setInspectorWidth,
    toggleInspectorCollapsed,
    toggleShowGrid,
    toggleSnapToGrid,
    toggleShowCenterline,
    toggleShowElevationGhosts,
    setGridPrecisionFloorMm,
    toggleAllowOverlappingPlacement,
    resetPreferences
  } = useViewPreferences((message) => toast.error(message));
  const [compactWorkspaceSide, setCompactWorkspaceSide] = useState<"left" | "right">("left");
  const compactWorkspaceEntryRef = useRef(false);
  const [isCompactWorkspace, setIsCompactWorkspace] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia(SINGLE_PANE_WORKSPACE_MEDIA_QUERY).matches
  );

  useEffect(() => {
    const query = window.matchMedia(SINGLE_PANE_WORKSPACE_MEDIA_QUERY);
    const update = () => setIsCompactWorkspace(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  // Preserve an already-collapsed side when entering the compact layout. If
  // both sides were open, the left pane is the stable default because it owns
  // the checklist/rooms navigation; the rail can switch to the inspector.
  useEffect(() => {
    if (!isCompactWorkspace) {
      compactWorkspaceEntryRef.current = false;
      return;
    }
    if (compactWorkspaceEntryRef.current) return;
    compactWorkspaceEntryRef.current = true;
    if (leftPanel === null && !inspectorCollapsed) {
      setCompactWorkspaceSide("right");
    } else if (leftPanel !== null && inspectorCollapsed) {
      setCompactWorkspaceSide("left");
    }
  }, [inspectorCollapsed, isCompactWorkspace, leftPanel]);

  const visibleLeftPanel =
    viewMode === "library" || (isCompactWorkspace && compactWorkspaceSide === "right")
      ? null
      : leftPanel;
  const visibleInspectorCollapsed = isCompactWorkspace
    ? compactWorkspaceSide === "left"
    : inspectorCollapsed;
  const { state: storagePersistence, retry: retryStoragePersistence } = useStoragePersistence();
  // One plan viewport per active project — resets to fit on project switch.
  const [planViewport, setPlanViewport] = useViewport2D(project?.id ?? "none");
  // The wall actually rendered by ElevationView — falls back to the floor's
  // first wall when wallContextId is null/stale, so the viewport key below
  // must use ITS id (not the raw wallContextId) or explicitly selecting that
  // same fallback wall would look like a wall switch and spuriously reset pan/zoom.
  const selectedWall = project ? getSelectedWall(project, wallContextId) : null;
  // What the CANVASES highlight. Deliberately not selectedWall: that one falls
  // back to walls[0], so highlighting it would draw a wall as selected on a
  // fresh project nobody had clicked — and then Delete (which keys off the same
  // deliberate pick) would appear to do nothing. The inspector and the sidebar
  // list still show selectedWall, because a default is honest there.
  const pickedWallId = pickedWallIdOf(selection);
  // Nothing can be inserted onto an open wall — there is no surface. Same
  // condition in all four places so the toolbar and the keyboard agree.
  const elevationInsertBlocked =
    viewMode === "elevation" && (!selectedWall || selectedWall.isOpenSide === true);
  // One elevation viewport, keyed on project id + resolved wall id so it
  // resets to fit on either a project switch OR a genuine wall switch (no
  // other reset code needed) — independent of planViewport, so switching
  // views never leaks one surface's pan/zoom into the other's.
  const [elevationViewport, setElevationViewport] = useViewport2D(
    `${project?.id ?? "none"}:${selectedWall?.id ?? "none"}`
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await boot();
      if (
        cancelled ||
        !import.meta.env.DEV ||
        new URLSearchParams(window.location.search).get("benchmark") !== "renderer"
      ) {
        return;
      }
      const fixture = await import("../../fixtures/benchmarks/renderer-10-room-200-work");
      const benchmarkAssets = await import("./rendererBenchmarkAssets");
      rendererBenchmarkBlobLoader = benchmarkAssets.getRendererBenchmarkBlob;
      if (!cancelled) {
        loadBenchmarkFixture(fixture.rendererBenchmarkProject, fixture.rendererBenchmarkArtworks);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boot, loadBenchmarkFixture]);

  useUndoRedoShortcuts({ undo, redo });

  // Surface save failures as a one-shot toast with a scoped Retry (transition
  // into error only — never per keystroke). The StatusBadge is unaffected.
  useSaveErrorToast();

  // Cloud backup: schedule auto-uploads (idle-settle + min-interval gates) and
  // surface upload failures on their own toast surface.
  useCloudBackupScheduler();
  useCloudBackupErrorToast();

  // Cross-device sync: evaluate the state machine on the settle/interval gates,
  // on focus/visibility (the device-handoff pull point), and on project open.
  // Inert unless the open project is linked to the connected account.
  useProjectSyncScheduler();

  // Finish a Dropbox connect redirect once on boot (?code=&state= tail), then
  // fold the provider's link status + this project's stored backup meta into
  // state whenever the open project changes.
  useEffect(() => {
    void completeCloudBackupConnect();
  }, [completeCloudBackupConnect]);
  useEffect(() => {
    refreshCloudBackupStatus();
    // The sync half of the same fold: which head (if any) this project's copy
    // descends from, so the status surfaces have it before any check runs.
    void refreshProjectSyncState();
  }, [refreshCloudBackupStatus, refreshProjectSyncState, project?.id]);

  // The staged Saved-view pose is a one-shot handoff for a 3D mount (spec §4.3);
  // clear it on leaving 3D so a later re-entry frames the overview, not a stale
  // bookmark. CameraRig has already captured it by mount, so this is safe.
  useEffect(() => {
    if (viewMode !== "3d") setPendingViewPose(null);
  }, [viewMode]);

  const toggleMeasureWhenAvailable = () => {
    if (viewMode === "elevation" && !selectedWall) return;
    toggleMeasure();
  };

  // Safety net for a stranded checklist-drag flag. The source row's onDragEnd
  // is unreliable (the row stops being draggable the moment its work lands, so
  // React drops the handler before dragend; iPadOS may never fire dragend), and
  // a stranded flag makes the delete/nudge shortcuts swallow input for the rest
  // of the session. `drop` covers a landed work, `dragend` a drag that ends off
  // target, and a trailing pointerdown reclaims it if neither fired. Clearing
  // on `drop` is safe: drop handlers close over this render's flag value.
  useEffect(() => {
    if (draggingArtworkId === null) return;
    const clearDragFlag = () => setDraggingArtworkId(null);
    window.addEventListener("drop", clearDragFlag, true);
    window.addEventListener("dragend", clearDragFlag, true);
    window.addEventListener("pointerdown", clearDragFlag, true);
    return () => {
      window.removeEventListener("drop", clearDragFlag, true);
      window.removeEventListener("dragend", clearDragFlag, true);
      window.removeEventListener("pointerdown", clearDragFlag, true);
    };
  }, [draggingArtworkId]);

  useDeleteAndEscapeShortcuts({
    project,
    selection,
    selectedObjectIds,
    selectedFreestandingWallId,
    deleteFreestandingWall,
    deleteRoom,
    reshapeRoomId,
    draggingArtworkId,
    removeSelectedPlacements,
    clearObjectSelection,
    arrangeSession,
    cancelArrangeSession,
    dialogs
  });

  useArrangeNudgeShortcuts({
    project,
    artworks: libraryArtworks,
    viewMode,
    selectedObjectIds,
    draggingArtworkId,
    arrangeSession,
    allowOverlappingPlacement,
    snapToGrid,
    gridPrecisionFloorMm,
    beginArrangeSession,
    setArrangeSessionPreview,
    commitArrangeSession,
    moveArtworkPlacement,
    moveOpening
  });

  useToolbarShortcuts({
    viewMode,
    // Any open workspace dialog owns the keyboard — stand down so a toolbar
    // letter never fires behind it.
    suspended: dialogs.anyOpen,
    insertDisabled: elevationInsertBlocked,
    activeTool,
    armOpeningTool,
    togglePartitionTool,
    toggleDrawRect,
    toggleDrawRoom,
    toggleMeasure: toggleMeasureWhenAvailable,
    toggleShowGrid,
    toggleSnapToGrid,
    toggleAllowOverlappingPlacement,
    toggleShowCenterline,
    toggleShowElevationGhosts
  });

  const measurementContext =
    viewMode === "elevation"
      ? ({ kind: "elevation", wallId: selectedWall?.id ?? "" } as const)
      : ({ kind: "plan" } as const);
  const measurement = useMeasurementTool(measurementContext);

  useTemporaryMeasurementShortcuts({
    active: measurementActive,
    suspended: dialogs.anyOpen,
    state: measurement.state,
    dispatch: measurement.dispatch
  });

  useEffect(() => {
    if (!measurementActive) measurement.clear();
  }, [measurementActive, measurement.clear]);

  useEffect(() => {
    if (!measurementActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (
        dialogs.anyOpen ||
        isEditableTarget(event.target) ||
        (event.target instanceof Element &&
          event.target.closest('[role="dialog"], [role="menu"], [role="listbox"]'))
      ) {
        return;
      }
      const next = escapeMeasurementState(measurement.state);
      event.preventDefault();
      event.stopImmediatePropagation();
      if (next.disarm) disarmPlanMode();
      else if (measurement.state.phase === "refining") {
        measurement.dispatch({ type: "cancel-refinement" });
      } else {
        measurement.dispatch({ type: "clear" });
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    measurementActive,
    measurement.state,
    measurement.dispatch,
    disarmPlanMode,
    dialogs.anyOpen
  ]);

  const selectedWallRoomPlacement =
    project && selectedWall
      ? (project.floor.rooms.find((placement) =>
          placement.room.walls.some((wall) => wall.id === selectedWall.id)
        ) ?? null)
      : null;
  const wallDimensionLink =
    project && selectedWall
      ? getWallDimensionLink(project, selectedWall.id)
      : null;
  const artworksById = useArtworksById();

  // The Saved views collection pane is a thumbnail consumer alongside the
  // Export dialog (saved-views spec §3.4): its rows show the same cached
  // previews, so it drives regeneration while visible.
  const savedViewsPaneVisible = visibleLeftPanel === "savedViews";

  // Saved-view thumbnail cache (saved-views spec §3). The Export dialog and the
  // collection pane are the visible consumers that drive regeneration;
  // `seedThumbnail` renders a just-saved view immediately. `thumbnailsPending`
  // keeps the render host mounted while any thumbnail is queued or rendering.
  const {
    urls: savedViewThumbnailUrls,
    hasPendingWork: thumbnailsPending,
    seed: seedThumbnail
  } = useSavedViewThumbnails({
    project,
    renderHandle: savedViewRenderHandle,
    active: dialogs.isOpen("exportPdf") || savedViewsPaneVisible
  });

  // Elevation navigation includes perimeter walls and partition faces in room order.
  const wallsForSwitcher = useMemo<WallSwitcherEntry[]>(
    () =>
      project
        ? project.floor.rooms.flatMap((placement) =>
            getRoomPlaceableWalls(placement.room).map((wall) => ({
              id: wall.id,
              name: wall.name,
              roomId: placement.roomId,
              roomName: placement.room.name,
              lengthMm: wall.lengthMm,
              heightMm: wall.heightMm,
              kind: parseFaceWallId(wall.id)
                ? ("partition-face" as const)
                : ("perimeter" as const),
              // Open walls stay in the switcher on purpose — navigating to one
              // is the route to its Restore action.
              isOpenSide: wall.isOpenSide === true
            }))
          )
        : [],
    [project]
  );
  const toolbarRef = useResponsiveToolbarDensity(
    [
      viewMode,
      project?.unit ?? "no-project",
      gridPrecisionFloorMm ?? "auto",
      project?.floor.rooms.length ?? 0
    ].join(":")
  );

  // Standing shared-opening problems, as opposed to placementWarnings' reaction
  // to the current edit. THE MEMO IS LOAD-BEARING: selectSharedOpeningConflicts
  // re-runs a whole-document analysis pass, so without keying it to `project`
  // identity this recomputes on every render, hover included.
  //
  // Declared ABOVE the `if (!project)` early return below: a hook placed after
  // it runs only on renders that have a document, which changes the hook count
  // between renders and tears the component down ("Rendered more hooks than
  // during the previous render"). The null guard lives inside the memo instead.
  const sharedOpeningIssues = useMemo(
    () =>
      project
        ? selectSharedOpeningConflicts(project).map((conflict) =>
            describeSharedOpeningConflict(conflict, project)
          )
        : [],
    [project]
  );

  // Everything the opening inspector needs to say about the wall this opening
  // shares — assembled here so the component stays a renderer and the words
  // stay in the app's copy layer. Memoized and placed above the early return
  // for the same reasons as sharedOpeningIssues.
  const sharedOpeningSection: OpeningSharedSection | null = useMemo(() => {
    if (!project || !selectedOpeningId) return null;
    const opening = project.wallObjects.find((object) => object.id === selectedOpeningId);
    // Blocked zones never pair, so they get no section at all.
    if (!opening || (opening.kind !== "door" && opening.kind !== "window")) return null;

    const status = getSharedOpeningStatus(project, opening.id);
    const message =
      status.kind === "exposed"
        ? null
        : status.kind === "shared"
          ? describeSharedConnection(project, opening.id, status.partnerId)
          : status.kind === "drifted"
            ? describeSharedOpeningDrift(project, opening.id)
            : describeSharedOpeningConflict(status.conflict, project).message;

    return {
      status,
      resolutions: sharedOpeningResolutions(status),
      message,
      candidates:
        status.kind === "conflict"
          ? status.candidates.map((target) => ({
              key:
                target.kind === "opening"
                  ? `opening:${target.openingId}`
                  : `wall:${target.wallId}`,
              label: describeSharedOpeningTarget(project, target),
              target
            }))
          : [],
      onResolve: (target) => void resolveSharedOpening(opening.id, target),
      onComplete: () => void completeSharedOpening(opening.id),
      onRealign: () => void realignSharedOpening(opening.id),
      onSplit: () => void splitSharedOpening(opening.id),
      onKeepThisOnly: () => void keepThisOpeningOnly(opening.id)
    };
  }, [
    project,
    selectedOpeningId,
    resolveSharedOpening,
    completeSharedOpening,
    realignSharedOpening,
    splitSharedOpening,
    keepThisOpeningOnly
  ]);

  // Above the early return, like every hook here (see sharedOpeningIssues).
  const {
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
  } = useExportActions({
    project,
    viewMode,
    libraryArtworks,
    selectedWall,
    exportProjectPackage,
    exportProjectPackageById,
    exportChecklistSpreadsheet,
    exportChecklistPdf,
    createCloudShareLink,
    getAsset: (assetId) => assetRepository.getAsset(assetId),
    getBlob: getAssetBlob,
    threeDActionsRef,
    planSvgElementRef,
    elevationSvgElementRef,
    savedViewRenderRef,
    setSnapshotExportMode,
    dialogs
  });

  if (!project) {
    return (
      <main className="loading-shell">
        <div className="skeleton-panel" />
      </main>
    );
  }

  // Keep the toolbar's unit family in sync with the view's governing scale.
  // Plan is room-scale (ft/m); Elevation is detail-scale (in/cm). The stored
  // project unit still represents the selected imperial/metric family until
  // per-view units become a user setting.
  const unitSystem = unitSystemFromDisplayUnit(project.unit);
  const elevationUnit: DisplayUnit = unitSystem === "imperial" ? "in" : "cm";
  const selectedRoomPlacement = selectedRoomId
    ? (project.floor.rooms.find((placement) => placement.roomId === selectedRoomId) ?? null)
    : null;
  // Stale partition ids from undo/redo resolve to null.
  const selectedFreestandingWall: FreestandingWall | null = selectedFreestandingWallId
    ? (project.floor.rooms
        .flatMap((placement) => placement.room.freestandingWalls)
        .find((wall) => wall.id === selectedFreestandingWallId) ?? null)
    : null;
  const selectedFreestandingWallPlacement = selectedFreestandingWallId
    ? project.floor.rooms.find((placement) =>
        placement.room.freestandingWalls.some((wall) => wall.id === selectedFreestandingWallId)
      ) ?? null
    : null;
  const selectedFreestandingWallClearances =
    selectedFreestandingWall && selectedFreestandingWallPlacement
      ? getPartitionClearances(selectedFreestandingWallPlacement.room, selectedFreestandingWall)
      : null;
  const selectedRoomDimensions = selectedRoomPlacement
    ? getRectangleRoomDimensions(selectedRoomPlacement.room)
    : null;
  const selectedRoomWallIds = new Set(
    selectedRoomPlacement?.room.walls.map((wall) => wall.id) ?? []
  );
  const selectedRoomBounds = selectedRoomPlacement
    ? getPlacedRoomBounds(selectedRoomPlacement)
    : null;
  const selectedRoomWallObjects = selectedRoomPlacement
    ? project.wallObjects.filter((wallObject) => selectedRoomWallIds.has(wallObject.wallId))
    : [];
  const selectedRoomFloorObjects = selectedRoomBounds
    ? project.floorObjects.filter(
        (floorObject) =>
          floorObject.xMm >= selectedRoomBounds.minX &&
          floorObject.xMm <= selectedRoomBounds.maxX &&
          floorObject.yMm >= selectedRoomBounds.minY &&
          floorObject.yMm <= selectedRoomBounds.maxY
      )
    : [];
  const selectedRoomObjectCount =
    selectedRoomWallObjects.length + selectedRoomFloorObjects.length;
  const selectedRoomArtworkCount =
    selectedRoomWallObjects.filter((wallObject) => wallObject.kind === "artwork").length +
    selectedRoomFloorObjects.filter((floorObject) => floorObject.kind === "artwork").length;

  // Dangling library selections fall through to the wall inspector.
  const selectedArtwork: Artwork | null =
    (selectedArtworkId ? artworksById.get(selectedArtworkId) : undefined) ?? null;
  const placedWallObject: ArtworkWallObject | null = selectedArtwork
    ? (project.wallObjects.find(
        (wallObject): wallObject is ArtworkWallObject =>
          wallObject.kind === "artwork" && wallObject.artworkId === selectedArtwork.id
      ) ?? null)
    : null;
  // Artwork ids survive wall↔floor conversion.
  const placedFloorArtwork: ArtworkFloorObject | null = selectedArtwork
    ? (project.floorObjects.find(
        (floorObject): floorObject is ArtworkFloorObject =>
          floorObject.kind === "artwork" && floorObject.artworkId === selectedArtwork.id
      ) ?? null)
    : null;
  // Whether the selected work is displayed on a CRT / box monitor. Read from
  // the RECORD (the display type travels with the work, not the placement), so
  // it is answerable for an unplaced work too.
  const selectedArtworkIsMonitor = isMonitorArtwork(selectedArtwork ?? undefined);
  // The pedestal/plinth under the selected floor placement, resolved the one
  // correct way (an untouched box monitor still stands on its implicit 800mm
  // pedestal — see resolveFloorSupport). Drives both the support fields and the
  // withheld "Height off floor": a support and a suspension height are
  // mutually exclusive states, and with a support present every renderer
  // ignores baseHeightMm, so offering the field would be offering a number
  // nothing draws.
  const placedFloorArtworkSupport = placedFloorArtwork
    ? resolveFloorSupport(placedFloorArtwork, selectedArtwork ?? undefined)
    : null;
  const isArtworkPlaced = placedWallObject !== null || placedFloorArtwork !== null;
  // Remove the artwork from whichever surface currently owns it.
  const artworkPlacementId = placedWallObject?.id ?? placedFloorArtwork?.id ?? null;
  // The inspector's Wall|Floor Type row shows where the object ACTUALLY is once
  // it's placed, never the library's placementForm — reading the flag for a
  // placed work is what let "Position on floor" render under "Type: Wall". The
  // flag speaks only while nothing is placed, which is the one case it still
  // decides anything (see store.setArtworkPlacementForm).
  const artworkPlacementForm: PlacementForm = placedWallObject
    ? "wall"
    : placedFloorArtwork
      ? "floor"
      : selectedArtwork
        ? effectivePlacementForm(selectedArtwork)
        : "wall";
  // Open walls have no surface, so a project made entirely of them offers a
  // standing work nowhere to go. The store refuses that conversion anyway; this
  // disables the segment so the refusal is never the way a curator finds out.
  const noWallToHangSelectedArtworkOn =
    placedFloorArtwork !== null && getPlaceableFloorWalls(project.floor).length === 0;

  // Placement readouts measure the same outer footprint the elevation paints.
  // Keep persisted image dimensions untouched and adapt only this geometry
  // boundary; openings and unresolved artwork records pass through unchanged.
  const wallPlacementGeometryObjects = project.wallObjects.map((wallObject) =>
    withArtworkFootprintFromMap(wallObject, artworksById)
  );
  const placedWallObjectFootprint: ArtworkWallObject | null = placedWallObject
    ? (wallPlacementGeometryObjects.find(
        (wallObject): wallObject is ArtworkWallObject =>
          wallObject.kind === "artwork" && wallObject.id === placedWallObject.id
      ) ?? null)
    : null;

  // Position fields consider artwork neighbors only, not openings.
  const placedWallObjectWall = placedWallObject
    ? (getProjectWalls(project).find((wall) => wall.id === placedWallObject.wallId) ?? null)
    : null;
  // A partition standing at a wall bounds that wall's hanging zone, so the
  // inspector's numeric affordances (neighbor distances, the Center button) have
  // to see it as a neighbor exactly like the elevation's dimension lines do.
  // Explicit actions are never gated on the canvas "Ghosts" toggle — see
  // derivePartitionNeighborShimsForFloorWall.
  const partitionNeighborShimsForWall = (wallId: string | null | undefined) =>
    wallId ? derivePartitionNeighborShimsForFloorWall(project.floor, wallId) : [];
  const placedWallObjectPartitions = partitionNeighborShimsForWall(placedWallObject?.wallId);
  const wallPlacementNeighbors = placedWallObjectFootprint
    ? getWallPlacementNeighborEdges(
        placedWallObjectFootprint,
        wallPlacementGeometryObjects.filter(
          (wallObject): wallObject is ArtworkWallObject => wallObject.kind === "artwork"
        ),
        placedWallObjectPartitions
      )
    : { leftNeighborRightEdgeMm: undefined, rightNeighborLeftEdgeMm: undefined };
  // Centering boundaries include every wall-object kind.
  const wallPlacementCenterTarget =
    placedWallObjectFootprint && placedWallObjectWall
      ? getWallPlacementCenterTarget(
          placedWallObjectFootprint,
          wallPlacementGeometryObjects,
          placedWallObjectWall.lengthMm,
          placedWallObjectPartitions
        )
      : { xMm: 0, boundaryKind: "wall" as const };

  // Deleted opening selections resolve to null. Wall text is a non-artwork
  // wall object too, so it is excluded here (it has its own inspector).
  const selectedOpening: OpeningWallObject | null = selectedOpeningId
    ? (project.wallObjects.find(
        (wallObject): wallObject is OpeningWallObject =>
          wallObject.kind !== "artwork" &&
          wallObject.kind !== "wall-text" &&
          wallObject.kind !== "case" &&
          wallObject.id === selectedOpeningId
      ) ?? null)
    : null;

  // The opening inspector reads and edits both jamb clearances, so it needs the
  // run of the wall the opening sits on (same lookup as selectedWallCaseWall).
  const selectedOpeningWall = selectedOpening
    ? (getProjectWalls(project).find((wall) => wall.id === selectedOpening.wallId) ?? null)
    : null;

  // Display cases share the opening-selection id space (ids are globally unique),
  // but have their own inspector, so they are resolved out of `selectedOpening`
  // above and derived separately here. A wall case lives in wallObjects; a floor
  // case in floorObjects. Deleted selections resolve to null.
  const selectedWallCase: CaseWallObject | null = selectedOpeningId
    ? (project.wallObjects.find(
        (wallObject): wallObject is CaseWallObject =>
          wallObject.kind === "case" && wallObject.id === selectedOpeningId
      ) ?? null)
    : null;
  const selectedWallCaseWall = selectedWallCase
    ? (getProjectWalls(project).find((wall) => wall.id === selectedWallCase.wallId) ?? null)
    : null;
  const wallCaseCenterTarget =
    selectedWallCase && selectedWallCaseWall
      ? getWallPlacementCenterTarget(
          selectedWallCase as unknown as ArtworkWallObject,
          project.wallObjects,
          selectedWallCaseWall.lengthMm,
          partitionNeighborShimsForWall(selectedWallCase.wallId)
        )
      : { xMm: 0, boundaryKind: "wall" as const };
  const selectedFloorCase: CaseFloorObject | null = selectedOpeningId
    ? (project.floorObjects.find(
        (floorObject): floorObject is CaseFloorObject =>
          floorObject.kind === "case" && floorObject.id === selectedOpeningId
      ) ?? null)
    : null;

  // Deleted wall-text selections resolve to null.
  const selectedWallText: WallTextWallObject | null = selectedWallTextId
    ? (project.wallObjects.find(
        (wallObject): wallObject is WallTextWallObject =>
          wallObject.kind === "wall-text" && wallObject.id === selectedWallTextId
      ) ?? null)
    : null;
  const selectedWallTextWall = selectedWallText
    ? (getProjectWalls(project).find((wall) => wall.id === selectedWallText.wallId) ?? null)
    : null;
  const wallTextCenterTarget =
    selectedWallText && selectedWallTextWall
      ? getWallPlacementCenterTarget(
          selectedWallText as unknown as ArtworkWallObject,
          project.wallObjects,
          selectedWallTextWall.lengthMm,
          partitionNeighborShimsForWall(selectedWallText.wallId)
        )
      : { xMm: 0, boundaryKind: "wall" as const };
  // Opening selection also represents floor blocked zones; ids are globally unique.
  const selectedFloorBlockedZone: BlockedZoneFloorObject | null =
    selectedOpeningId && !selectedOpening
      ? (project.floorObjects.find(
          (floorObject): floorObject is BlockedZoneFloorObject =>
            floorObject.kind === "blocked-zone" && floorObject.id === selectedOpeningId
        ) ?? null)
      : null;

  // Drop stale multi-selection ids before deriving arrange eligibility.
  const isMultiSelect = selectedObjectIds.length > 1;
  // Arrangement ignores selected architecture and operates on artworks only.
  const selectedArtworkMembers = project.wallObjects.filter(
    (wallObject) =>
      wallObject.kind === "artwork" && selectedObjectIds.includes(wallObject.id)
  );
  // beginArrangeSession enforces the same eligibility at commit time.
  const arrangeEligibility = getArrangeEligibility(project, selectedObjectIds);
  const arrangeWall = arrangeEligibility.eligible
    ? (getProjectWalls(project).find(
        (wall) => wall.id === arrangeEligibility.wallId
      ) ?? null)
    : null;
  // Read arrangement values from live preview positions when a session exists.
  const activeArrangeSession =
    arrangeWall && arrangeSession && arrangeSession.wallId === arrangeWall.id
      ? arrangeSession
      : null;
  const arrangeMembers = activeArrangeSession
    ? selectedArtworkMembers.map((member) => {
        const preview = activeArrangeSession.previewById[member.id];
        return preview ? { ...member, xMm: preview.xMm, yMm: preview.yMm } : member;
      })
    : selectedArtworkMembers;
  const arrangeReadout = deriveArrangeReadout({
    arrangeWall,
    arrangeMembers,
    activeArrangeSession,
    selectedArtworkMembers,
    wallObjects: project.wallObjects,
    selectedObjectIds,
    artworksById,
    lastInsetAnchor,
    lastArrangeMode,
    lastEvenZone,
    partitionNeighbors: partitionNeighborShimsForWall(arrangeWall?.id)
  });

  // Distinct artwork records behind the current multi-selection, for the bulk
  // mat/frame dialog. Both wall and floor placements resolve to a library
  // record; a work placed on two surfaces dedupes to one id.
  const selectedArtworkIds = [
    ...new Set(
      [...project.wallObjects, ...project.floorObjects].flatMap((object) =>
        object.kind === "artwork" && selectedObjectIds.includes(object.id)
          ? [object.artworkId]
          : []
      )
    )
  ];
  // The store skips frame-inclusive works; split the ids the same way so the
  // dialog's count and note match what it will actually apply.
  const bulkMatFrameTargets = selectedArtworkIds.flatMap((id) => {
    const artwork = artworksById.get(id);
    return artwork && artwork.frameIncludedInImage !== true ? [artwork] : [];
  });
  const bulkMatFrameSkippedCount = selectedArtworkIds.length - bulkMatFrameTargets.length;
  const bulkMatFrameTargetCount = bulkMatFrameTargets.length;

  // Back-to-back pairing needs exactly two floor-placed artworks — the anchor
  // (first selected, stays put) and the mover. Selection order is click order
  // for shift-clicks; a marquee hands ids in document order, which is still a
  // deterministic anchor the curator can flip by reselecting.
  const backToBackFloorArtworks =
    selectedObjectIds.length === 2
      ? selectedObjectIds.map((id) =>
          project.floorObjects.find(
            (floorObject) => floorObject.kind === "artwork" && floorObject.id === id
          )
        )
      : [];
  const backToBackPair =
    backToBackFloorArtworks.length === 2 && backToBackFloorArtworks.every(Boolean)
      ? { anchorId: backToBackFloorArtworks[0]!.id, movingId: backToBackFloorArtworks[1]!.id }
      : null;

  // Branch order mirrors arrange eligibility so the hint names the first blocker.
  const arrangeDisabledReason = arrangeEligibility.eligible
    ? ""
    : arrangeEligibility.reason === "floorMember"
      ? "Arranging is for works hung on a wall. This selection includes floor-placed objects."
      : arrangeEligibility.reason === "noArtworks"
        ? "Arranging is for works only. Doors, windows, and blocked zones stay where they are."
        : arrangeEligibility.reason === "singleArtwork"
        ? "Arranging is for works only. Select at least two works on the same wall to arrange them."
        : "Select works on a single wall to arrange them. This selection spans more than one wall.";
  // Explain that selected openings are excluded from arrangement.
  const arrangeIgnoredNote =
    arrangeWall && selectedObjectIds.length > selectedArtworkMembers.length
      ? "Only the works are arranged. Doors, windows, and blocked zones stay put."
      : undefined;

  // Resolve warning ids to artwork titles or human-readable opening labels.
  const labeledPlacementWarnings = placementWarnings.map((warning) => {
    const wallObject = project.wallObjects.find(
      (candidate) => candidate.id === warning.wallObjectId
    );
    const subject =
      wallObject?.kind === "artwork"
        ? (artworksById.get(wallObject.artworkId)?.title ?? "Untitled artwork")
        : wallObject
          ? wallObject.kind === "wall-text"
            ? "Wall text"
            : wallObject.kind === "case"
              ? "Display case" // TODO(case-ui): dedicated label source
              : getOpeningKindLabel(wallObject.kind)
          : undefined;
    return { ...warning, subject };
  });

  // Issues navigation selects the first warning's placement in the inspector,
  // falling back to a standing shared-opening issue when nothing is wrong with
  // the current edit — otherwise the rail could report a count it won't move to.
  const selectFirstWarningObject = () => {
    const first = placementWarnings[0];
    if (!first) {
      const issue = sharedOpeningIssues[0];
      if (issue) selectOpening(issue.openingId);
      return;
    }

    const wallObject = project.wallObjects.find(
      (candidate) => candidate.id === first.wallObjectId
    );
    if (!wallObject) return;

    if (wallObject.kind === "artwork") {
      selectObject(wallObject.id);
    } else {
      selectOpening(wallObject.id);
    }
  };

  // Routes an elevation-view move into the live arrange session's preview
  // instead of committing it directly, when applicable — returns whether it
  // routed, so callers fall through to their normal commit action otherwise.
  // Two call shapes:
  // - a single-object drag (alt-drag of one opening/artwork) passes one move
  //   and requires membership: an unselected neighbour dragged past a live
  //   session still commits directly, only a session MEMBER's drag joins the
  //   preview.
  // - a group drag (onMoveWallObjects) passes the whole batch and does NOT
  //   require membership: a group drag only ever moves the current
  //   selection, which is exactly the session's members whenever one is
  //   open, so a live session alone is enough to route it.
  const routeMoveThroughSession = (
    moves: { id: string; xMm: number; yMm: number }[],
    { requireMembership }: { requireMembership: boolean }
  ): boolean => {
    if (!arrangeSession) return false;
    if (
      requireMembership &&
      !moves.every((move) => arrangeSession.memberIds.includes(move.id))
    ) {
      return false;
    }
    setArrangeSessionPreview(moves);
    return true;
  };

  // Rail toggle semantic: clicking the active panel's icon collapses the
  // column (null), clicking the other switches to it. In the compact layout,
  // selecting a left pane also makes it the visible side of the workspace.
  const selectLeftPanel = (panel: "checklist" | "rooms" | "savedViews") => {
    if (viewMode === "library") setViewMode("plan");
    if (isCompactWorkspace) {
      const shouldCollapse = visibleLeftPanel === panel && compactWorkspaceSide === "left";
      setCompactWorkspaceSide("left");
      setLeftPanel(shouldCollapse ? null : panel);
      return;
    }

    setLeftPanel(leftPanel === panel ? null : panel);
  };

  const handleInspectorToggle = () => {
    if (isCompactWorkspace) {
      setCompactWorkspaceSide((current) => (current === "right" ? "left" : "right"));
      return;
    }

    toggleInspectorCollapsed();
  };

  const leaveIncomingShare = () => {
    window.history.replaceState(null, "", import.meta.env.BASE_URL || "/");
    setIncomingDropboxShareUrl(null);
  };

  // Save view: a single-click camera bookmark for the 3D view (spec §8.2). No
  // dialog — the store persists it (undoable, round-tripped) and we confirm with
  // an inline toast composing the LIVE room label with the default title.
  const handleSaveView = async () => {
    if (!project || !threeDActionsRef.current) return;
    const pose = threeDActionsRef.current.getCurrentPose();
    if (!pose) return;
    const saved = await saveView(pose);
    if (!saved) return;
    // Seed its first render now (§3.4) so the thumbnail exists before the user
    // next opens the dialog or pane — no wait for the visible-consumer gate.
    seedThumbnail(saved);
    const roomLabel = resolveSavedViewRoomLabel(project, saved);
    const composed = roomLabel ? `${roomLabel} · ${saved.title}` : saved.title;
    toast.success(`Saved "${composed}"`);
  };

  // Open a Saved view from the collection pane (saved-views spec §4.3): switch
  // to the 3D mode if needed, then move the camera to the stored pose. When 3D
  // is already live we drive its actions directly; otherwise the pose is staged
  // as the initial camera and handed to the freshly-mounted view — not a race
  // against mount. Read-only: opening never writes the project.
  const openSavedView = (view: SavedView) => {
    // An invalid pose has no camera to fly to (the pane leaves its row inert);
    // guard here too so a stray call can't drive the rig with bad numbers.
    if (isDegeneratePose(view.pose)) return;
    if (viewMode === "3d" && threeDActionsRef.current) {
      threeDActionsRef.current.flyToPose(view.pose);
      return;
    }
    setPendingViewPose(view.pose);
    if (viewMode !== "3d") setViewMode("3d");
  };

  // Detect package vs. project JSON by zip magic, not file extension.
  const handleImportFile = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    const isZip =
      head.length === 4 &&
      head[0] === 0x50 &&
      head[1] === 0x4b &&
      head[2] === 0x03 &&
      head[3] === 0x04;
    if (isZip) await importSightlinesPackage(buffer);
    else await importProjectJson(new TextDecoder().decode(buffer));
  };

  // CSS variables let narrow-view media queries override the grid layout.
  const workspaceStyle = {
    "--left-panel-width": `${leftPanelWidth}px`,
    "--inspector-width": `${inspectorWidth}px`
  } as React.CSSProperties;
  const workspaceClassName = [
    "workspace",
    visibleLeftPanel ? null : "left-collapsed",
    visibleInspectorCollapsed ? "right-collapsed" : null,
    // Library view seats the inspector toggle in its header lane.
    viewMode === "library" ? "library-view" : null
  ]
    .filter(Boolean)
    .join(" ");

  return (
    // Disable hoverable content: the grace polygon can swallow adjacent 32px triggers.
    <TooltipProvider delayDuration={400} disableHoverableContent>
    <Toaster />
    <PrivacyConsentNotice
      undecided={privacyDecision === "unset"}
      onAllow={() =>
        setPrivacyPreferences(
          { usageAnalytics: true, crashReports: true },
          "accepted"
        )
      }
      onDecline={() =>
        setPrivacyPreferences(
          { usageAnalytics: false, crashReports: false },
          "declined"
        )
      }
    />
    {measurementActive ? (
      <MeasurementLiveRegion
        state={measurement.state}
        unit={viewMode === "elevation" ? elevationUnit : project.unit}
      />
    ) : null}
    <main className="app-shell">
      <AppRail
        leftPanel={visibleLeftPanel}
        onSelectLeftPanel={selectLeftPanel}
        isLibraryView={viewMode === "library"}
        onOpenLibrary={() => setViewMode("library")}
        onOpenSettings={() => dialogs.open("settings")}
        onOpenHelp={() => dialogs.open("help")}
        issueCount={placementWarnings.length + sharedOpeningIssues.length}
        onSelectFirstIssue={selectFirstWarningObject}
      />
      <div className="app-main">
      <TopBar
        project={project}
        viewMode={viewMode}
        setViewMode={setViewMode}
        selectedWall={selectedWall}
        storagePersistence={storagePersistence}
        isExportingPackage={isExportingPackage}
        isSharingProject={isSharingProject}
        handleExportPackage={handleExportPackage}
        handleShareProject={handleShareProject}
        handleExportProjectById={handleExportProjectById}
        handleExportImage={handleExportImage}
        handleImportFile={handleImportFile}
        onOpenSettings={() => dialogs.open("settings")}
        onOpenExportPdf={() => dialogs.open("exportPdf")}
        onOpenExportChecklist={() => dialogs.open("exportChecklist")}
        fileInputRef={fileInputRef}
      />

      {error ? <p className="error-banner">{error}</p> : null}

      <section className={workspaceClassName} style={workspaceStyle}>
        {visibleLeftPanel ? (
          <PanelResizeHandle
            side="left"
            width={leftPanelWidth}
            min={LEFT_PANEL_MIN_WIDTH}
            max={LEFT_PANEL_MAX_WIDTH}
            label="Resize left panel"
            onResize={setLeftPanelWidth}
            // Dragging well past the min width collapses the panel — the
            // same `leftPanel: null` the rail toggle sets, so a drag and a
            // click land in the exact same state.
            onCollapse={() => setLeftPanel(null)}
          />
        ) : null}
        {!visibleInspectorCollapsed ? (
          <PanelResizeHandle
            side="right"
            width={inspectorWidth}
            min={INSPECTOR_MIN_WIDTH}
            max={INSPECTOR_MAX_WIDTH}
            label="Resize inspector"
            onResize={setInspectorWidth}
            // Routes through the same toggle as the floating chip below, so
            // the compact-workspace side-swap special case stays honored here too.
            onCollapse={handleInspectorToggle}
          />
        ) : null}
        {/* The single persistent inspector toggle — a borderless floating chip
            (same raised-chip grammar as the canvas's zoom cluster) anchored
            top-right, always present regardless of collapse state. It hugs
            the inspector seam: sitting just left of it when the inspector is
            open, and sliding to the screen's right edge once collapsed (see
            .workspace.right-collapsed .inspector-toggle). The rail
            deliberately does not own the inspector — this floating chip is
            the only affordance for it, keeping the inspector's own cramped
            pane free of chrome. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inspector-toggle"
              aria-label={visibleInspectorCollapsed ? "Show inspector" : "Hide inspector"}
              aria-expanded={!visibleInspectorCollapsed}
              onClick={handleInspectorToggle}
            >
              <SidebarSimpleIcon
                aria-hidden="true"
                size={18}
                style={{ transform: "scaleX(-1)" }}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent className="toolbar-tooltip" side="left">
            {visibleInspectorCollapsed ? "Show inspector" : "Hide inspector"}
          </TooltipContent>
        </Tooltip>
        {visibleLeftPanel === "checklist" ? (
          <ChecklistPanel
            getBlob={getAssetBlob}
            intakeState={intakeState}
            libraryArtworks={libraryArtworks}
            project={project}
            selectedArtworkId={selectedArtworkId}
            pendingDuplicateUploads={pendingDuplicateUploads}
            onAddArtworksFromFiles={addArtworksFromFiles}
            onArtworkDragStateChange={setDraggingArtworkId}
            onChangeChecklistView={setChecklistView}
            onConfirmDuplicateUploads={confirmDuplicateUploads}
            onDismissDuplicateUploads={dismissDuplicateUploads}
            onOpenImportWizard={() => {
              setImportDestination("checklist");
              dialogs.open("importWizard");
            }}
            onOpenArtworkLibrary={() => dialogs.open("libraryPicker")}
            onRemoveArtworkFromChecklist={removeArtworkFromChecklist}
            onRemovePlacement={removePlacement}
            onSelectArtwork={selectArtwork}
          />
        ) : visibleLeftPanel === "rooms" ? (
          <RoomsPanel
            project={project}
            selectedWallId={selectedWall?.id ?? null}
            onAddRectangleRoom={() => void addRectangleRoom()}
            onDeleteRoom={deleteRoom}
            onRenameRoom={renameRoom}
            onResizeWall={resizeWall}
            // List navigation, not a canvas pick — see focusWallContext.
            onSelectWall={focusWallContext}
          />
        ) : visibleLeftPanel === "savedViews" ? (
          <SavedViewsPanel
            project={project}
            thumbnailUrls={savedViewThumbnailUrls}
            onOpenView={openSavedView}
            onRenameSavedView={renameSavedView}
            onDeleteSavedView={deleteSavedView}
          />
        ) : null}

        <section className="canvas-column">
          {viewMode !== "library" &&
          (viewMode !== "3d" || project.floor.rooms.length > 0) ? (
            <div className="view-toolbar" ref={toolbarRef}>
              <div className="view-tools-primary">
                {/* Draw leads: creating structure precedes decorating it, and
                    the plan workflow starts by drawing a room. Elevation drops
                    the whole Draw block, leaving Insert alone at the zone's
                    start in both views. */}
                {viewMode === "plan" ? (
                  <>
                    <DrawPicker
                      variant="full"
                      rectActive={drawRectActive}
                      onRectToggle={toggleDrawRect}
                      outlineActive={drawRoomActive}
                      onOutlineToggle={toggleDrawRoom}
                      partitionActive={partitionToolActive}
                      onPartitionToggle={togglePartitionTool}
                    />
                    <DrawPicker
                      variant="compact"
                      rectActive={drawRectActive}
                      onRectToggle={toggleDrawRect}
                      outlineActive={drawRoomActive}
                      onOutlineToggle={toggleDrawRoom}
                      partitionActive={partitionToolActive}
                      onPartitionToggle={togglePartitionTool}
                    />
                    {/* The hairline scopes each caption to its own cluster —
                        without it "Draw"/"Insert" read as labels for the whole
                        zone rather than their three tools. */}
                    <div aria-hidden="true" className="toolbar-divider" />
                  </>
                ) : null}
                {viewMode === "plan" || viewMode === "elevation" ? (
                  <>
                    <InsertPicker
                      variant="full"
                      activeTool={activeTool}
                      disabled={elevationInsertBlocked}
                      excludedTools={viewMode === "elevation" ? ["case"] : undefined}
                      onToolChange={armOpeningTool}
                    />
                    <InsertPicker
                      variant="compact"
                      activeTool={activeTool}
                      disabled={elevationInsertBlocked}
                      excludedTools={viewMode === "elevation" ? ["case"] : undefined}
                      onToolChange={armOpeningTool}
                    />
                    <ViewOptionButton
                      active={measurementActive}
                      disabled={elevationInsertBlocked}
                      icon={<RulerIcon aria-hidden="true" size={16} />}
                      label="Measure"
                      labelPriority
                      title={measurementActive ? "Stop measuring" : "Measure distance"}
                      kbd="M"
                      onClick={toggleMeasureWhenAvailable}
                    />
                  </>
                ) : null}
              </div>
              <div className="view-options" aria-label="View options">
                {viewMode === "3d" ? (
                  project.floor.rooms.length > 0 ? (
                    <ThreeDCameraTools
                      actionsRef={threeDActionsRef}
                      canFocus={Boolean(selectedRoomId || selectedWall || selectedObjectIds.length)}
                      onSaveView={() => void handleSaveView()}
                    />
                  ) : null
                ) : (
                  <>
                    <ViewOptionButton
                      active={showGrid}
                      disabled={false}
                      icon={<GridFourIcon aria-hidden="true" size={16} />}
                      label="Grid"
                      title={showGrid ? "Hide grid" : "Show grid"}
                      kbd="G"
                      onClick={toggleShowGrid}
                    />
                    <ViewOptionButton
                      active={snapToGrid}
                      disabled={false}
                      icon={<MagnetIcon aria-hidden="true" size={16} />}
                      label="Snap"
                      title={snapToGrid ? "Disable snap to grid" : "Enable snap to grid"}
                      kbd="S"
                      onClick={toggleSnapToGrid}
                    />
                    <PrecisionSelect
                      disabled={false}
                      floorMm={gridPrecisionFloorMm}
                      unit={viewMode === "elevation" ? elevationUnit : project.unit}
                      onChange={setGridPrecisionFloorMm}
                    />
                    {viewMode === "elevation" ? (
                      <ViewOptionButton
                        active={showCenterline}
                        disabled={false}
                        icon={<EyeIcon aria-hidden="true" size={16} />}
                        label="Eyeline"
                        title={showCenterline ? "Hide eyeline" : "Show eyeline"}
                        kbd="E"
                        onClick={toggleShowCenterline}
                      />
                    ) : null}
                    {viewMode === "elevation" ? (
                      <ViewOptionButton
                        active={showElevationGhosts}
                        disabled={false}
                        icon={<GhostIcon aria-hidden="true" size={16} />}
                        label="Ghosts"
                        title={showElevationGhosts ? "Hide ghosts" : "Show ghosts"}
                        kbd="H"
                        onClick={toggleShowElevationGhosts}
                      />
                    ) : null}
                    <ViewOptionButton
                      active={allowOverlappingPlacement}
                      disabled={false}
                      icon={<StackIcon aria-hidden="true" size={16} />}
                      label="Overlap"
                      labelPriority
                      title={
                        allowOverlappingPlacement
                          ? "Prevent overlapping placement"
                          : "Allow overlapping placement"
                      }
                      kbd="O"
                      onClick={toggleAllowOverlappingPlacement}
                    />
                    <UnitSystemToggle
                      disabled={false}
                      labels={
                        viewMode === "elevation"
                          ? { imperial: "in", metric: "cm" }
                          : { imperial: "ft", metric: "m" }
                      }
                      system={unitSystem}
                      onChange={(system) => setUnit(displayUnitForSystem(system))}
                    />
                  </>
                )}
              </div>
            </div>
          ) : null}

          {viewMode === "plan" ? (
            project.floor.rooms.length === 0 && !drawRoomActive && !drawRectActive ? (
              <PlanEmptyState onAddRoom={() => void addRectangleRoom()} />
            ) : (
              <PlanView
                activeTool={activeTool}
                drawRectActive={drawRectActive}
                onDrawRectChange={setDrawRectActive}
                onAddRectangleRoom={(rect) => void addDrawnRectangleRoom(rect)}
                drawRoomActive={drawRoomActive}
                onDrawRoomChange={setDrawRoomActive}
                onAddPolygonRoom={(points) => void addPolygonRoom(points)}
                reshapeRoomId={reshapeRoomId}
                onReshapeRoomChange={toggleReshapeRoom}
                partitionToolActive={partitionToolActive}
                onPartitionToolChange={setPartitionToolActive}
                onAddFreestandingWall={(start, end) =>
                  void addFreestandingWall(start, end)
                }
                duplicatePartitionSourceWallId={duplicatePartitionSourceWallId}
                onDuplicatePartitionChange={(active) => {
                  if (!active) armDuplicatePartition(null);
                }}
                onDuplicateFreestandingWall={(wallId, center) =>
                  void duplicateFreestandingWall(wallId, center)
                }
                selectedFreestandingWallId={selectedFreestandingWallId}
                onMoveFreestandingWall={(wallId, delta) =>
                  void moveFreestandingWall(wallId, delta)
                }
                onMoveFreestandingWallEndpoint={(wallId, end, next) =>
                  void moveFreestandingWallEndpoint(wallId, end, next)
                }
                artworksById={artworksById}
                draggingArtworkId={draggingArtworkId}
                getBlob={getAssetBlob}
                gridPrecisionFloorMm={gridPrecisionFloorMm}
                gridVisible={showGrid}
                selectedArtworkId={selectedArtworkId}
                selectedOpeningId={selectedOpeningId}
                selectedRoomId={selectedRoomId}
                selectedWallId={pickedWallId}
                snapToGrid={snapToGrid}
                viewport={planViewport}
                onViewportChange={setPlanViewport}
                measurementActive={measurementActive}
                measurementState={
                  measurement.state.context.kind === "plan" ? measurement.state : undefined
                }
                onMeasurementAction={measurement.dispatch}
                onCommitPlanMove={(objectId, placement) =>
                  void commitPlanMove(objectId, placement, allowOverlappingPlacement)
                }
                onPlaceArtwork={(artworkId, wallId, xMm, yMm) =>
                  void placeArtwork(artworkId, wallId, xMm, yMm, allowOverlappingPlacement)
                }
                onPlaceArtworkOnFloor={(artworkId, xMm, yMm) =>
                  void placeArtworkOnFloor(artworkId, xMm, yMm)
                }
                onToolChange={armOpeningTool}
                selectedObjectIds={selectedObjectIds}
                onCommitPlanMoveGroup={(moves) =>
                  void movePlanObjectsGroup(moves, allowOverlappingPlacement)
                }
                onMarqueeSelect={(ids, additive) =>
                  // An additive (shift) marquee extends the selection; a plain
                  // one replaces it. The union preserves already-selected ids'
                  // order so repeated shift-marquees stay stable.
                  setObjectSelection(
                    additive ? [...new Set([...selectedObjectIds, ...ids])] : ids
                  )
                }
                exportMode={snapshotExportMode}
                onSvgElementChange={(el) => {
                  planSvgElementRef.current = el;
                }}
              />
            )
          ) : null}
          {viewMode === "elevation" ? (
            // An open wall has no surface to elevate. It stays navigable in the
            // switcher (that is how Restore is reached), but it gets a real
            // empty state rather than a styled wall — a dashed wall-fill would
            // read as a surface with odd styling instead of no surface at all.
            selectedWall && selectedWall.isOpenSide !== true ? (
              <Suspense fallback={<div className="skeleton-panel" />}>
                <ElevationView
                  allowOverlappingPlacement={allowOverlappingPlacement}
                  artworksById={artworksById}
                  centerlineMm={
                    selectedWall.defaultCenterlineHeightMm ??
                    project.defaultCenterlineHeightMm
                  }
                  centerlineVisible={showCenterline}
                  ghostsVisible={showElevationGhosts}
                  draggingArtworkId={draggingArtworkId}
                  getBlob={getAssetBlob}
                  gridPrecisionFloorMm={gridPrecisionFloorMm}
                  gridVisible={showGrid}
                  // The display case is plan-only (its floor-vs-wall decision
                  // needs open floor); never hand it to the elevation canvas.
                  activeTool={activeTool === "case" ? null : activeTool}
                  onToolChange={armOpeningTool}
                  onPlaceOpeningOnElevation={(kind, wallId, xMm, yMm) =>
                    void placeOpeningOnElevation(kind, wallId, xMm, yMm)
                  }
                  selectedArtworkId={selectedArtworkId}
                  selectedOpeningId={selectedOpeningId}
                  snapToGrid={snapToGrid}
                  unit={elevationUnit}
                  wallHeightMm={selectedWall.heightMm}
                  wallId={selectedWall.id}
                  wallLengthMm={selectedWall.lengthMm}
                  wallName={selectedWall.name}
                  walls={wallsForSwitcher}
                  viewport={elevationViewport}
                  onViewportChange={setElevationViewport}
                  measurementActive={measurementActive}
                  measurementState={
                    measurement.state.context.kind === "elevation" ? measurement.state : undefined
                  }
                  onMeasurementDispatch={measurement.dispatch}
                  previewPositionsById={arrangeSession?.previewById}
                  arrangeSessionMode={arrangeSession?.mode ?? null}
                  onMoveOpening={(wallObjectId, xMm, yMm) => {
                    // A move of a session member (alt-drag of one work in the
                    // group) stays inside the live preview — the session's
                    // single commit will carry it; everything else commits
                    // directly as before.
                    if (
                      routeMoveThroughSession([{ id: wallObjectId, xMm, yMm }], {
                        requireMembership: true
                      })
                    ) {
                      return;
                    }
                    void moveOpening(wallObjectId, xMm, yMm, allowOverlappingPlacement);
                  }}
                  onMovePlacement={(wallObjectId, xMm, yMm) => {
                    if (
                      routeMoveThroughSession([{ id: wallObjectId, xMm, yMm }], {
                        requireMembership: true
                      })
                    ) {
                      return;
                    }
                    void moveArtworkPlacement(wallObjectId, xMm, yMm, allowOverlappingPlacement);
                  }}
                  onPlaceArtwork={(artworkId, wallId, xMm, yMm) =>
                    void placeArtwork(artworkId, wallId, xMm, yMm, allowOverlappingPlacement)
                  }
                  selectedObjectIds={selectedObjectIds}
                  onMoveWallObjects={(moves) => {
                    // With a session open, a group drag becomes more live
                    // preview (one undo entry on session commit); without one
                    // it keeps committing directly as "Move N objects".
                    if (routeMoveThroughSession(moves, { requireMembership: false })) {
                      return;
                    }
                    void moveWallObjectsGroup(moves, allowOverlappingPlacement);
                  }}
                  onMarqueeSelect={(ids, additive) =>
                    // An additive (shift) marquee extends the selection; a plain
                    // one replaces it. The union preserves already-selected ids'
                    // order so repeated shift-marquees stay stable.
                    setObjectSelection(
                      additive ? [...new Set([...selectedObjectIds, ...ids])] : ids
                    )
                  }
                  exportMode={snapshotExportMode}
                  onSvgElementChange={(el) => {
                    elevationSvgElementRef.current = el;
                  }}
                />
              </Suspense>
            ) : (
              <ElevationEmptyState
                hasRooms={project.floor.rooms.length > 0}
                openWallName={
                  selectedWall?.isOpenSide === true ? selectedWall.name : undefined
                }
                onRestoreWall={
                  selectedWall?.isOpenSide === true
                    ? () => void restoreWall(selectedWall.id)
                    : undefined
                }
                // Open walls only: the same chip ElevationView draws, so
                // navigating onto an open wall does not strand the curator with
                // no way to reach the next elevation.
                switcher={
                  selectedWall?.isOpenSide === true
                    ? {
                        walls: wallsForSwitcher,
                        currentWallId: selectedWall.id,
                        onSelectWall: focusWallContext,
                        unit: elevationUnit
                      }
                    : undefined
                }
              />
            )
          ) : null}
          {viewMode === "library" ? (
            <ArtworkLibraryView
              artworks={libraryArtworks}
              project={project}
              getBlob={getAssetBlob}
              onAddToChecklist={addExistingArtworksToChecklist}
              onDeleteArtworks={(ids) => void deleteLibraryArtworks(ids)}
              onApplyMatFrame={(ids, changes) => void updateArtworksMatFrame(ids, changes)}
              onAddFiles={(files) => void addArtworksFromFiles(files, { destination: "library" })}
              pendingDuplicateUploads={pendingDuplicateUploads.filter(
                (entry) => entry.destination === "library"
              )}
              onConfirmDuplicateUploads={confirmDuplicateUploads}
              onDismissDuplicateUploads={dismissDuplicateUploads}
              projectMembershipsByArtworkId={projectMembershipsByArtworkId}
              onOpenProject={(projectId) => void openProject(projectId)}
              onEditArtwork={(artworkId) => {
                selectArtwork(artworkId);
                if (inspectorCollapsed) toggleInspectorCollapsed();
              }}
              onOpenImportWizard={() => {
                setImportDestination("library");
                dialogs.open("importWizard");
              }}
            />
          ) : null}
          {viewMode === "3d" ? (
            <Suspense fallback={<div className="skeleton-panel" />}>
              <ThreeDView
                project={project}
                artworksById={artworksById}
                getBlob={getAssetBlob}
                selectedObjectIds={selectedObjectIds}
                selectedArtworkId={selectedArtworkId}
                selectedRoomId={selectedRoomId}
                selectedWallId={pickedWallId}
                onSelectWall={selectWall}
                onSelectObject={selectObject}
                onClearSelection={clearObjectSelection}
                draggingArtworkId={draggingArtworkId}
                onPlaceArtwork={(artworkId, wallId, xMm, yMm) =>
                  void placeArtwork(artworkId, wallId, xMm, yMm, allowOverlappingPlacement)
                }
                onPlaceArtworkOnFloor={(artworkId, xMm, yMm) =>
                  void placeArtworkOnFloor(artworkId, xMm, yMm)
                }
                // One release, one undo entry. A wall move needs BOTH axes and
                // possibly a new wall, which only moveWallObjectPlacement does;
                // a floor move is the same commitPlanMove the plan drag uses,
                // so the two surfaces commit through one path.
                onCommitObjectMove={(objectId, move) => {
                  if (move.anchor === "wall") {
                    void moveWallObjectPlacement(
                      objectId,
                      move.wallId,
                      move.xMm,
                      move.yMm,
                      allowOverlappingPlacement
                    );
                    return;
                  }
                  void commitPlanMove(
                    objectId,
                    { anchor: "floor", xMm: move.xMm, yMm: move.yMm },
                    allowOverlappingPlacement
                  );
                }}
                actionsRef={threeDActionsRef}
                initialPose={pendingViewPose ?? undefined}
              />
            </Suspense>
          ) : null}
        </section>

        {!visibleInspectorCollapsed ? (
        <aside className="inspector" aria-label="Inspector">
          <div className="inspector-zone">
            {(measurementActive &&
            (measurement.state.phase === "armed-complete" ||
              measurement.state.phase === "refining")) || selectedReferenceMeasurement ? (
              <div className="panel-heading inspector-subject measurement-subject">
                <h2>Measurement</h2>
                <span>{selectedReferenceMeasurement ? "Reference" : "Temporary"}</span>
              </div>
            ) : null}

            {!measurementActive && !isMultiSelect &&
            (selectedArtwork ||
              selectedOpening ||
              selectedFloorBlockedZone ||
              selectedFloorCase ||
              selectedWallCase ||
              selectedRoomPlacement ||
              selectedFreestandingWall ||
              selectedWall) ? (
              <div className="panel-heading inspector-subject">
                <h2>
                  {selectedArtwork
                    ? "Artwork"
                    : selectedOpening
                      ? getOpeningKindLabel(selectedOpening.kind)
                      : selectedFloorBlockedZone
                        ? getOpeningKindLabel(selectedFloorBlockedZone.kind)
                        : selectedFloorCase || selectedWallCase
                          ? "Display case"
                          : selectedRoomPlacement
                            ? selectedRoomPlacement.room.name
                            : selectedFreestandingWall
                              ? selectedFreestandingWall.name
                              : selectedWall?.name}
                </h2>
                {!selectedArtwork ? <span>
                  {selectedOpening
                      ? "Opening"
                      : selectedFloorBlockedZone
                        ? "Floor object"
                        : selectedFloorCase
                          ? "Floor object"
                          : selectedWallCase
                            ? "Wall object"
                            : selectedRoomPlacement
                              ? "Room"
                              : selectedFreestandingWall
                                ? "Partition"
                                : "Wall"}
                </span> : null}
              </div>
            ) : null}

            <PlacementWarnings
              warnings={labeledPlacementWarnings}
              documentIssues={sharedOpeningIssues}
              // Each row selects ITS OWN opening. The rail's "go to first
              // issue" affordance still exists separately; this is what makes
              // the second of two identically-worded rows reachable at all.
              onSelectIssue={selectOpening}
              selectedWallObjectId={
                placedWallObject?.id ??
                selectedOpening?.id ??
                selectedWallCase?.id ??
                selectedWallText?.id ??
                null
              }
            />

            {selectedReferenceMeasurement ? (
              <ReferenceMeasurementInspector
                name={selectedReferenceMeasurement.name}
                distanceMm={Math.hypot(
                  selectedReferenceMeasurement.end.xMm - selectedReferenceMeasurement.start.xMm,
                  selectedReferenceMeasurement.end.yMm - selectedReferenceMeasurement.start.yMm
                )}
                unit={selectedReferenceMeasurement.kind === "elevation" ? elevationUnit : project.unit}
                visible={selectedReferenceMeasurement.visible}
                locked={selectedReferenceMeasurement.locked}
                outOfBounds={selectedReferenceMeasurement.kind === "elevation" && selectedWall?.id === selectedReferenceMeasurement.wallId && [selectedReferenceMeasurement.start, selectedReferenceMeasurement.end].some((point) => point.xMm < 0 || point.xMm > selectedWall.lengthMm || point.yMm < 0 || point.yMm > selectedWall.heightMm)}
                onChange={(changes) => void updateReferenceMeasurement(selectedReferenceMeasurement.id, changes)}
                onDelete={() => void deleteReferenceMeasurement(selectedReferenceMeasurement.id)}
              />
            ) : measurementActive &&
            (measurement.state.phase === "armed-complete" ||
              measurement.state.phase === "refining") ? (
              <MeasurementInspector
                distanceMm={Math.hypot(
                  measurement.state.end.xMm - measurement.state.start.xMm,
                  measurement.state.end.yMm - measurement.state.start.yMm
                )}
                unit={viewMode === "elevation" ? elevationUnit : project.unit}
                onKeepAsReference={() => {
                  const state = measurement.state;
                  if (state.phase !== "armed-complete" && state.phase !== "refining") return;
                  if (state.context.kind === "plan") {
                    void addReferenceMeasurement({ kind: "plan", start: state.start, end: state.end });
                  } else {
                    void addReferenceMeasurement({ kind: "elevation", wallId: state.context.wallId, start: state.start, end: state.end });
                  }
                  measurement.clear();
                }}
                onClear={measurement.clear}
              />
            ) : isMultiSelect ? (
              // Multi-selection replaces the single-subject inspector chain.
              <SelectionInspector
                arrange={arrangeReadout}
                arrangeDisabledReason={arrangeDisabledReason}
                arrangeIgnoredNote={arrangeIgnoredNote}
                count={selectedObjectIds.length}
                selectionKey={[...selectedObjectIds].sort().join("\n")}
                unit={project.unit}
                wallName={arrangeWall?.name ?? null}
                onSetMode={(mode) => {
                  // A "Space evenly" click both opens the session and snaps to
                  // the equal solution; switching to "From wall edges"/"Between
                  // works" opens the session but moves nothing until a value is
                  // typed (a bare mode switch must never jump the works).
                  beginArrangeSession(mode);
                  if (mode === "equal") updateArrangeSession({ equal: true });
                }}
                onSetAnchor={setArrangeAnchor}
                onSetEvenZone={setArrangeEvenZone}
                onArrangeValue={(params) => {
                  if (!arrangeSession) {
                    beginArrangeSession("insetMm" in params ? "inset" : "gap");
                  }
                  updateArrangeSession(params);
                }}
                onAcceptArrange={() =>
                  commitArrangeSession(allowOverlappingPlacement)
                }
                onCancelArrange={cancelArrangeSession}
                onCenterGroup={() =>
                  void centerSelectionBetweenBoundaries(allowOverlappingPlacement)
                }
                backToBack={
                  backToBackPair
                    ? {
                        onPair: () =>
                          void pairFloorArtworksBackToBack(
                            backToBackPair.anchorId,
                            backToBackPair.movingId
                          )
                      }
                    : undefined
                }
                matFrame={
                  selectedArtworkIds.length > 0
                    ? {
                        targetCount: bulkMatFrameTargetCount,
                        skippedCount: bulkMatFrameSkippedCount,
                        currentValues: bulkMatFrameTargets.map(({ matWidthMm, frame }) => ({
                          matWidthMm,
                          frame
                        })),
                        onApply: (changes) =>
                          updateArtworksMatFrame(selectedArtworkIds, changes)
                      }
                    : undefined
                }
                onRemoveAll={() => void removeSelectedPlacements()}
              />
            ) : selectedArtwork ? (
              <ArtworkInspector
                artwork={selectedArtwork}
                scopeNote={
                  viewMode === "library"
                    ? "Changes apply everywhere this artwork is used."
                    : undefined
                }
                isPlaced={isArtworkPlaced}
                placementForm={artworkPlacementForm}
                disabledPlacementForm={
                  noWallToHangSelectedArtworkOn ? "wall" : undefined
                }
                disabledPlacementFormReason="No wall to hang it on."
                // A floor-placed work is dragged/dropped off a wall onto open
                // floor; its remove affordance disconnects that floor object.
                removeLabel={placedFloorArtwork ? "Remove from floor" : "Remove from wall"}
                placementTitle={
                  placedWallObject && placedWallObjectWall
                    ? `Position on ${placedWallObjectWall.name}`
                    : placedFloorArtwork
                      ? "Position on floor"
                      : undefined
                }
                placementSection={
                  placedWallObject && placedWallObjectWall ? (
                    <WallPlacementFields
                      placement={placedWallObjectFootprint ?? placedWallObject}
                      wallLengthMm={placedWallObjectWall.lengthMm}
                      leftNeighborRightEdgeMm={wallPlacementNeighbors.leftNeighborRightEdgeMm}
                      rightNeighborLeftEdgeMm={wallPlacementNeighbors.rightNeighborLeftEdgeMm}
                      leftNeighborIsPartition={wallPlacementNeighbors.leftNeighborIsPartition}
                      rightNeighborIsPartition={wallPlacementNeighbors.rightNeighborIsPartition}
                      centerTargetXMm={wallPlacementCenterTarget.xMm}
                      centerBoundaryKind={wallPlacementCenterTarget.boundaryKind}
                      unit={project.unit}
                      onCommit={(xMm, yMm) =>
                        void moveArtworkPlacement(
                          placedWallObject.id,
                          xMm,
                          yMm,
                          allowOverlappingPlacement
                        )
                      }
                    />
                  ) : placedFloorArtwork ? (
                    <>
                      <FloorPlacementFields
                        floorObject={placedFloorArtwork}
                        unit={project.unit}
                        onCommitPosition={(xMm, yMm) =>
                          void updateFloorObject(placedFloorArtwork.id, { xMm, yMm })
                        }
                        onCommitSize={(widthMm, depthMm) =>
                          void updateFloorObject(placedFloorArtwork.id, { widthMm, depthMm })
                        }
                        onCommitHeight={(heightMm) =>
                          void updateFloorObject(placedFloorArtwork.id, { heightMm })
                        }
                        onCommitRotation={(rotationDeg) =>
                          void updateFloorObject(placedFloorArtwork.id, { rotationDeg })
                        }
                        // A box monitor stands on a pedestal or on the floor
                        // — never on wires. A work standing on a support is
                        // the same case: its bottom edge IS the support's top
                        // face and every renderer ignores baseHeightMm, so the
                        // field would edit a number nothing draws (and "Stands
                        // on" below is how the work gets back into the air).
                        // Withholding the prop hides the field entirely, the
                        // same way a display case is denied it (see
                        // FloorPlacementFields' onCommitBaseHeight and
                        // CrtMonitorMesh, which ignores baseHeightMm for the
                        // same reason).
                        {...(selectedArtworkIsMonitor || placedFloorArtworkSupport
                          ? {}
                          : {
                              onCommitBaseHeight: (baseHeightMm: number) =>
                                void updateFloorObject(placedFloorArtwork.id, {
                                  baseHeightMm
                                })
                            })}
                      />
                      {/* What the work stands on is a fact about THIS
                          installation — it writes to the floor placement
                          (support / baseHeightMm / monitorSupport), so it lives
                          with the other placement fields rather than in the
                          identity block, and stays reachable when the record up
                          there has compacted. An unplaced work gets the default
                          (floor, or a monitor's pedestal) when it lands. */}
                      <StandsOnField
                        artwork={selectedArtwork}
                        floorObject={placedFloorArtwork}
                        isMonitor={selectedArtworkIsMonitor}
                        onChange={(standsOn) =>
                          void setFloorArtworkStandsOn(placedFloorArtwork.id, standsOn)
                        }
                      />
                      {/* The support BOX's own numbers, under the fields that
                          size the WORK. Only when there is one to edit. */}
                      {placedFloorArtworkSupport ? (
                        <FloorSupportFields
                          floorObject={placedFloorArtwork}
                          support={placedFloorArtworkSupport}
                          unit={project.unit}
                          onChange={(changes) =>
                            void updateFloorArtworkSupport(
                              placedFloorArtwork.id,
                              changes
                            )
                          }
                        />
                      ) : null}
                      {/* The box's Width/Height size the object standing on the
                          floor; the work has its own recorded size, and 3D draws
                          the image at THAT size. This note appears only once the
                          two have drifted apart, and offers the way back. A
                          monitor asks the same question about its CABINET, whose
                          target is the 4:3 box the work implies — see the note's
                          own monitor branch. */}
                      <FloorArtworkImageSizeNote
                        dimensions={selectedArtwork.dimensions}
                        isMonitor={selectedArtworkIsMonitor}
                        objectWidthMm={placedFloorArtwork.widthMm}
                        objectHeightMm={placedFloorArtwork.heightMm}
                        objectDepthMm={placedFloorArtwork.depthMm}
                        unit={project.unit}
                        onMatchSizeToWork={(widthMm, heightMm, depthMm) =>
                          void updateFloorObject(placedFloorArtwork.id, {
                            widthMm,
                            heightMm,
                            ...(depthMm !== undefined ? { depthMm } : {})
                          })
                        }
                      />
                      {/* Which box faces carry the image — a box-specific
                          question a wall-hung placement (a plane, not a box)
                          never has, so it rides only this floor branch. A
                          monitor is excluded on its own terms: it shows its
                          picture on ONE screen, so a six-face picker would be
                          offering to break it. */}
                      {selectedArtworkIsMonitor ? null : (
                        <FloorArtworkImageFacesField
                          imageFaces={placedFloorArtwork.imageFaces}
                          onChange={(faces) =>
                            void setFloorArtworkImageFaces(placedFloorArtwork.id, faces)
                          }
                        />
                      )}
                    </>
                  ) : null
                }
                sectionsOpen={inspectorSections}
                unit={project.unit}
                onCommitDimensions={(dimensions) =>
                  void updateArtwork(selectedArtwork.id, { dimensions })
                }
                onCommitField={(changes) => void updateArtwork(selectedArtwork.id, changes)}
                onChangePlacementForm={(placementForm) =>
                  void setArtworkPlacementForm(
                    selectedArtwork.id,
                    placementForm,
                    allowOverlappingPlacement
                  )
                }
                onCommitFraming={(changes) => void updateArtwork(selectedArtwork.id, changes)}
                onSectionOpenChange={setInspectorSectionOpen}
                onRemovePlacement={
                  artworkPlacementId
                    ? () => void removePlacement(artworkPlacementId)
                    : undefined
                }
              />
          ) : selectedFloorBlockedZone ? (
            <FloorObjectInspector
              floorObject={selectedFloorBlockedZone}
              unit={project.unit}
              onCommitPosition={(xMm, yMm) =>
                void updateFloorObject(selectedFloorBlockedZone.id, { xMm, yMm })
              }
              onCommitSize={(widthMm, depthMm) =>
                void updateFloorObject(selectedFloorBlockedZone.id, { widthMm, depthMm })
              }
              // Angle only, no Height off floor: a blocked zone is a keep-out
              // annotation about floor AREA, so hovering it has no referent
              // (see FloorObjectInspector / FloorObjectBox, which render it as a
              // flat floor-plane wash that already honors rotationDeg).
              onCommitRotation={(rotationDeg) =>
                void updateFloorObject(selectedFloorBlockedZone.id, { rotationDeg })
              }
              onDelete={() => void removePlacement(selectedFloorBlockedZone.id)}
            />
          ) : selectedWallText ? (
            <WallTextInspector
              wallText={selectedWallText}
              unit={project.unit}
              onRename={(name) => void renameWallText(selectedWallText.id, name)}
              onCommitSize={(widthMm, heightMm) =>
                void resizeOpening(selectedWallText.id, widthMm, heightMm, allowOverlappingPlacement)
              }
              onDelete={() => void removePlacement(selectedWallText.id)}
              placementSection={
                selectedWallTextWall ? (
                  <WallPlacementFields
                    placement={selectedWallText}
                    wallLengthMm={selectedWallTextWall.lengthMm}
                    centerTargetXMm={wallTextCenterTarget.xMm}
                    centerBoundaryKind={wallTextCenterTarget.boundaryKind}
                    unit={project.unit}
                    onCommit={(xMm, yMm) =>
                      void moveOpening(
                        selectedWallText.id,
                        xMm,
                        yMm,
                        allowOverlappingPlacement
                      )
                    }
                  />
                ) : null
              }
            />
          ) : selectedFloorCase ? (
            <FloorCaseInspector
              floorCase={selectedFloorCase}
              unit={project.unit}
              onCommitPosition={(xMm, yMm) =>
                void updateFloorObject(selectedFloorCase.id, { xMm, yMm })
              }
              onCommitSize={(widthMm, depthMm) =>
                void updateFloorObject(selectedFloorCase.id, { widthMm, depthMm })
              }
              onCommitHeight={(heightMm) =>
                void updateFloorObject(selectedFloorCase.id, { heightMm })
              }
              // Angle only, no Height off floor: a vitrine stands on its own
              // legs, whose height CaseMesh derives from heightMm ("overall,
              // floor to box top"). Lifting the box would leave the legs
              // ending in mid-air while invalidating the datum they are
              // computed from — so 3D ignores baseHeightMm for cases too.
              onCommitRotation={(rotationDeg) =>
                void updateFloorObject(selectedFloorCase.id, { rotationDeg })
              }
              onDelete={() => void removePlacement(selectedFloorCase.id)}
            />
          ) : selectedWallCase ? (
            <WallCaseInspector
              wallCase={selectedWallCase}
              wallLengthMm={selectedWallCaseWall?.lengthMm ?? 0}
              centerTargetXMm={wallCaseCenterTarget.xMm}
              centerBoundaryKind={wallCaseCenterTarget.boundaryKind}
              unit={project.unit}
              onCommitPosition={(xMm, yMm) =>
                void updateWallCase(selectedWallCase.id, { xMm, yMm })
              }
              onCommitSize={(widthMm, heightMm, depthMm) =>
                void updateWallCase(selectedWallCase.id, { widthMm, heightMm, depthMm })
              }
              onDelete={() => void removePlacement(selectedWallCase.id)}
            />
          ) : selectedOpening ? (
            <OpeningInspector
              opening={selectedOpening}
              unit={project.unit}
              wallLengthMm={selectedOpeningWall?.lengthMm ?? 0}
              sharedOpening={sharedOpeningSection}
              // Awaited, not void-ed: the resolved OpeningFit is how the
              // inspector learns that a request was slid or trimmed to fit.
              onCommitPosition={(xMm, yMm) =>
                moveOpening(selectedOpening.id, xMm, yMm, allowOverlappingPlacement)
              }
              onCommitSize={(widthMm, heightMm) =>
                resizeOpening(selectedOpening.id, widthMm, heightMm, allowOverlappingPlacement)
              }
              onFitToWall={() => fitOpeningToAvailableSpan(selectedOpening.id)}
              // Only ever reachable for a door (OpeningInspector narrows on
              // opening.kind itself), but wired unconditionally here: the
              // store action already no-ops for a non-door id, so a second
              // kind check on this line would just duplicate that guard.
              onUpdateDoorLeaf={(leaf) => updateDoorLeaf(selectedOpening.id, leaf)}
              onDelete={() => void removePlacement(selectedOpening.id)}
            />
          ) : selectedRoomPlacement ? (
            <RoomInspector
              artworkCount={selectedRoomArtworkCount}
              objectCount={selectedRoomObjectCount}
              rectangleDimensions={selectedRoomDimensions}
              reshapeActive={reshapeRoomId === selectedRoomPlacement.roomId}
              roomHeightMm={selectedRoomPlacement.room.heightMm}
              roomName={selectedRoomPlacement.room.name}
              unit={project.unit}
              wallCount={selectedRoomPlacement.room.walls.length}
              onCommitWidth={(lengthMm) =>
                selectedRoomDimensions
                  ? resizeWall(selectedRoomDimensions.widthWallId, lengthMm)
                  : Promise.resolve()
              }
              onCommitDepth={(lengthMm) =>
                selectedRoomDimensions
                  ? resizeWall(selectedRoomDimensions.depthWallId, lengthMm)
                  : Promise.resolve()
              }
              onCommitHeight={(heightMm) =>
                resizeRoomHeight(selectedRoomPlacement.roomId, heightMm)
              }
              onToggleReshape={() => toggleReshapeRoom(selectedRoomPlacement.roomId)}
            />
          ) : selectedFreestandingWall ? (
            <FreestandingWallInspector
              wall={selectedFreestandingWall}
              unit={project.unit}
              clearances={selectedFreestandingWallClearances}
              onCommitLength={(lengthMm) =>
                setFreestandingWallLength(selectedFreestandingWall.id, lengthMm)
              }
              onCommitAngle={(angleDeg) =>
                rotateFreestandingWall(selectedFreestandingWall.id, angleDeg)
              }
              onCommitThickness={(thicknessMm) =>
                setFreestandingWallThickness(selectedFreestandingWall.id, thicknessMm)
              }
              onCommitHeight={(heightMm) =>
                setFreestandingWallHeight(selectedFreestandingWall.id, heightMm)
              }
              onCenter={(axis) => centerFreestandingWall(selectedFreestandingWall.id, axis)}
              onCommitClearance={(side, distanceMm) =>
                setFreestandingWallClearance(selectedFreestandingWall.id, side, distanceMm)
              }
              onDuplicate={() => armDuplicatePartition(selectedFreestandingWall.id)}
              onViewFace={(face) =>
                viewFreestandingFace(faceWallId(selectedFreestandingWall.id, face))
              }
              onDelete={() => void deleteFreestandingWall(selectedFreestandingWall.id)}
            />
          ) : selectedWall ? (
            <WallInspector
              key={selectedWall.id}
              centerlineMm={project.defaultCenterlineHeightMm}
              changedWallNames={getWallNames(
                project,
                lastGeometryEdit?.changedWallIds ?? []
              )}
              dimensionLink={wallDimensionLink}
              lastGeometryEdit={lastGeometryEdit}
              isOpenSide={selectedWall.isOpenSide === true}
              // The button fires for the DISPLAYED wall (fallback included),
              // unlike the Delete key. That is not a hole in the safety rule:
              // the user clicked a labelled control inside a panel headed by
              // that wall's name, and the confirm names it again. The rule
              // protects the implicit gesture — a bare keypress — not this one.
              onOpenWall={() => dialogs.open("openWall", { wallId: selectedWall.id })}
              onRestoreWall={() => void restoreWall(selectedWall.id)}
              onAddCase={() => void addWallCase(selectedWall.id)}
              onAddOpening={(kind) => void addOpening(selectedWall.id, kind)}
              onCommitHeight={(heightMm) =>
                selectedWallRoomPlacement
                  ? resizeRoomHeight(selectedWallRoomPlacement.roomId, heightMm)
                  : Promise.resolve()
              }
              onCommitLength={(lengthMm, anchor) =>
                selectedWallRoomPlacement &&
                !getRectangleRoomDimensions(selectedWallRoomPlacement.room)
                  ? setPolygonWallLength(selectedWall.id, lengthMm, anchor)
                  : resizeSelectedWall(lengthMm)
              }
              polygonLengthEditing={Boolean(
                selectedWallRoomPlacement &&
                  !getRectangleRoomDimensions(selectedWallRoomPlacement.room)
              )}
              roomName={selectedWallRoomPlacement?.room.name ?? "this room"}
              unit={project.unit}
              wallHeightMm={selectedWall.heightMm}
              wallLengthMm={selectedWall.lengthMm}
              wallName={selectedWall.name}
            />
            ) : (
              <p className="empty-copy">
                Select a room, wall, artwork, or opening to inspect it.
              </p>
            )}
          </div>
        </aside>
        ) : null}
      </section>
      </div>
      <AppDialogs
        dialogs={dialogs}
        importDestination={importDestination}
        storagePersistence={storagePersistence}
        retryStoragePersistence={retryStoragePersistence}
        cloudBackupConfigured={CLOUD_BACKUP_CONFIGURED}
        resetPreferences={resetPreferences}
        handleExportPackage={handleExportPackage}
        shareProjectUrl={shareProjectUrl}
        shareProjectWarningCount={shareProjectWarningCount}
        onCloseShareProject={() => setShareProjectUrl(null)}
        incomingDropboxShareUrl={incomingDropboxShareUrl}
        onLeaveIncomingShare={leaveIncomingShare}
        fileInputRef={fileInputRef}
        handleExportPdfOpenChange={handleExportPdfOpenChange}
        handleExportChecklist={handleExportChecklist}
        isExportingChecklist={isExportingChecklist}
        handleExportPdf={handleExportPdf}
        savedViewThumbnailUrls={savedViewThumbnailUrls}
        pdfExportProgress={pdfExportProgress}
        handleCancelExportPdf={handleCancelExportPdf}
        savedViewsPaneVisible={savedViewsPaneVisible}
        thumbnailsPending={thumbnailsPending}
        getAssetBlob={getAssetBlob}
        savedViewRenderRef={savedViewRenderRef}
      />
    </main>
    </TooltipProvider>
  );
}
