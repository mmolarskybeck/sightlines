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
import { getRoomPlaceableWalls } from "../domain/geometry/placeableWalls";
import type { WallSwitcherEntry } from "./components/elevation/WallSwitcher";
import type {
  DisplayUnit,
  ProjectSummary,
  SavedView,
  SavedViewPose
} from "../domain/project";
import { isDegeneratePose, resolveSavedViewRoomLabel } from "../domain/savedViews";
import { hasDefaultWallNames } from "../domain/geometry/createRoom";
import { parseFaceWallId } from "../domain/geometry/freestandingWalls";
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
import { ArtworkLibraryView } from "./components/library/ArtworkLibrary";
import { PanelResizeHandle } from "./components/shared/PanelResizeHandle";
import { describeSharedOpeningConflict } from "./components/placement/sharedOpeningIssueCopy";
import { selectSharedOpeningConflicts } from "../domain/placement/sharedOpeningIssues";
import { ChecklistPanel } from "./components/panels/ChecklistPanel";
import { ElevationEmptyState } from "./components/elevation/ElevationEmptyState";
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
import { RoomsPanel } from "./components/panels/RoomsPanel";
import { SavedViewsPanel } from "./components/panels/SavedViewsPanel";
import { InspectorPane } from "./components/inspectors/InspectorPane";
import { MeasurementLiveRegion } from "./components/measurement/MeasurementLiveRegion";
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
import {
  freestandingWallIdOf,
  getSelectedArtworkId,
  getSelectedOpeningId,
  getSelectedWall,
  objectIdsOf,
  pickedWallIdOf,
  roomIdOf,
  useAppStore
} from "./store";
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
  const viewMode = useAppStore((state) => state.viewMode);
  const error = useAppStore((state) => state.error);
  const placementWarnings = useAppStore((state) => state.placementWarnings);
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
  const saveView = useAppStore((state) => state.saveView);
  const renameSavedView = useAppStore((state) => state.renameSavedView);
  const deleteSavedView = useAppStore((state) => state.deleteSavedView);
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
  const deleteFreestandingWall = useAppStore((state) => state.deleteFreestandingWall);
  const renameRoom = useAppStore((state) => state.renameRoom);
  const renameWall = useAppStore((state) => state.renameWall);
  const setRoomNorthWall = useAppStore((state) => state.setRoomNorthWall);
  const deleteRoom = useAppStore((state) => state.deleteRoom);
  const restoreWall = useAppStore((state) => state.restoreWall);
  const setUnit = useAppStore((state) => state.setUnit);
  const setChecklistView = useAppStore((state) => state.setChecklistView);
  const resizeWall = useAppStore((state) => state.resizeWall);
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
  const updateArtworksMatFrame = useAppStore((state) => state.updateArtworksMatFrame);
  const placeArtwork = useAppStore((state) => state.placeArtwork);
  const placeArtworkOnFloor = useAppStore((state) => state.placeArtworkOnFloor);
  const moveArtworkPlacement = useAppStore((state) => state.moveArtworkPlacement);
  const removePlacement = useAppStore((state) => state.removePlacement);
  const moveOpening = useAppStore((state) => state.moveOpening);
  // The five shared-opening resolutions. Each one re-derives its own guard from
  // the current project inside the store — the inspector only ever asks.
  const placeOpeningOnElevation = useAppStore((state) => state.placeOpeningOnElevation);
  const commitPlanMove = useAppStore((state) => state.commitPlanMove);
  const moveWallObjectPlacement = useAppStore((state) => state.moveWallObjectPlacement);
  const moveWallObjectsGroup = useAppStore((state) => state.moveWallObjectsGroup);
  const movePlanObjectsGroup = useAppStore((state) => state.movePlanObjectsGroup);
  const removeSelectedPlacements = useAppStore((state) => state.removeSelectedPlacements);
  const beginArrangeSession = useAppStore((state) => state.beginArrangeSession);
  const setArrangeSessionPreview = useAppStore((state) => state.setArrangeSessionPreview);
  const commitArrangeSession = useAppStore((state) => state.commitArrangeSession);
  const cancelArrangeSession = useAppStore((state) => state.cancelArrangeSession);
  // Selection union is the source of truth; single-subject ids resolve live.
  const selectedObjectIds = objectIdsOf(selection);
  const selectedRoomId = roomIdOf(selection);
  const selectedFreestandingWallId = freestandingWallIdOf(selection);
  const selectedArtworkId = getSelectedArtworkId(project, selection);
  const selectedOpeningId = getSelectedOpeningId(project, selection);
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

  // "Use as North wall" rewrites all four names. That is free when the room
  // still carries its birth names, and destructive as soon as one was typed —
  // so the confirm is raised only in the second case.
  const requestSetNorthWall = (roomId: string, wallId: string) => {
    const placement = project.floor.rooms.find(
      (candidate) => candidate.roomId === roomId
    );
    if (!placement) return;
    // Judged on the whole ordered pattern (hasDefaultWallNames), not name by
    // name: a typed "Wall 12" or a duplicated "East wall" is a custom name.
    if (!hasDefaultWallNames(placement.room.walls))
      dialogs.open("setNorthWall", { roomId, wallId });
    else void setRoomNorthWall(roomId, wallId);
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
            onRenameWall={renameWall}
            onResizeWall={resizeWall}
            // List navigation, not a canvas pick — see focusWallContext.
            onSelectWall={focusWallContext}
            onSetNorthWall={requestSetNorthWall}
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
        <InspectorPane
          measurement={measurement}
          measurementActive={measurementActive}
          elevationUnit={elevationUnit}
          selectedWall={selectedWall}
          reshapeRoomId={reshapeRoomId}
          dialogs={dialogs}
          sharedOpeningIssues={sharedOpeningIssues}
          allowOverlappingPlacement={allowOverlappingPlacement}
          inspectorSections={inspectorSections}
          setInspectorSectionOpen={setInspectorSectionOpen}
          toggleReshapeRoom={toggleReshapeRoom}
          armDuplicatePartition={armDuplicatePartition}
          requestSetNorthWall={requestSetNorthWall}
        />
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
