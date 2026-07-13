import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { ArchiveIcon } from "@phosphor-icons/react/dist/csr/Archive";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { FileDashedIcon } from "@phosphor-icons/react/dist/csr/FileDashed";
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { GridFourIcon } from "@phosphor-icons/react/dist/csr/GridFour";
import { MagnetIcon } from "@phosphor-icons/react/dist/csr/Magnet";
import { MapTrifoldIcon } from "@phosphor-icons/react/dist/csr/MapTrifold";
import { PackageIcon } from "@phosphor-icons/react/dist/csr/Package";
import { PresentationIcon } from "@phosphor-icons/react/dist/csr/Presentation";
import { CubeIcon } from "@phosphor-icons/react/dist/csr/Cube";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/csr/SidebarSimple";
import { StackIcon } from "@phosphor-icons/react/dist/csr/Stack";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import {
  getPlacedRoomBounds,
  getRectangleRoomDimensions,
  getOrthogonalQuadWallPair,
} from "../domain/geometry/walls";
import { getRoomPlaceableWalls } from "../domain/geometry/placeableWalls";
import type { WallSwitcherEntry } from "./components/WallSwitcher";
import { evaluateOpeningPair } from "../domain/geometry/openingConnections";
import { getOpeningKindLabel, type OpeningKind } from "../domain/placement/createOpening";
import type {
  Artwork,
  ArtworkFloorObject,
  ArtworkWallObject,
  BlockedZoneFloorObject,
  DisplayUnit,
  FreestandingWall,
  OpeningWallObject,
  Project,
  ProjectSummary
} from "../domain/project";
import { faceWallId, parseFaceWallId } from "../domain/geometry/freestandingWalls";
import type { PackageExportMode } from "../domain/schema/packageSchema";
import { IndexedDbAssetRepository } from "../domain/repositories/indexedDbAssetRepository";
import {
  displayUnitForSystem,
  unitSystemFromDisplayUnit,
  type UnitSystem
} from "../domain/units/unitSystem";
import { AppRail } from "./components/AppRail";
import { ArtworkInspector } from "./components/ArtworkInspector";
import { ArtworkLibraryPicker, ArtworkLibraryView } from "./components/ArtworkLibrary";
import { PanelResizeHandle } from "./components/PanelResizeHandle";
import { ChecklistPanel } from "./components/ChecklistPanel";
import { DeleteRoomDialog } from "./components/DeleteRoomDialog";
import { ImportConflictDialog } from "./components/ImportConflictDialog";
import { HelpDialog } from "./components/HelpDialog";
import { ElevationEmptyState } from "./components/ElevationEmptyState";
import { FloorObjectInspector, FloorPlacementFields } from "./components/FloorObjectInspector";
import { FreestandingWallInspector } from "./components/FreestandingWallInspector";
import {
  OpeningInspector,
  type OpeningConnectionCandidate
} from "./components/OpeningInspector";
import { PlanEmptyState } from "./components/PlanEmptyState";
import { PlanView } from "./components/PlanView";
import {
  DrawPicker,
  InsertPicker,
  PrecisionSelect,
  StatusBadge,
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
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { Toaster } from "./components/ui/sonner";
import { toast } from "sonner";
import { ProjectPicker } from "./components/ProjectPicker";
import { RoomInspector } from "./components/RoomInspector";
import { RoomsPanel } from "./components/RoomsPanel";
import { SelectionInspector } from "./components/SelectionInspector";
import {
  WallPlacementFields,
  getWallPlacementCenterTarget,
  getWallPlacementNeighborEdges
} from "./components/WallPlacementFields";
import { WallInspector, type WallDimensionLink } from "./components/WallInspector";
import { Button } from "./components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "./components/ui/dropdown-menu";
import { Input } from "./components/ui/input";
import { UnderlineToggleGroup, UnderlineToggleGroupItem } from "./components/ui/segmented";
import { useStoragePersistence, getStorageNoteCopy } from "./hooks/useStoragePersistence";
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
import { useToolbarShortcuts } from "./hooks/useToolbarShortcuts";
import { deriveArrangeReadout } from "./hooks/arrangeReadout";
import { shouldDeleteRoomOnKey, summarizeRoomContents } from "./roomDeletion";
import {
  freestandingWallIdOf,
  getProjectWalls,
  getSelectedArtworkId,
  getSelectedOpeningId,
  getSelectedWall,
  objectIdsOf,
  roomIdOf,
  useAppStore
} from "./store";
import { getArrangeEligibility } from "./store/arrangeEligibility";
import type { ThreeDViewActions } from "./components/three/ThreeDView";

const ImportWizard = lazy(() => import("./components/ImportWizard"));
const SettingsDialog = lazy(() =>
  import("./components/SettingsDialog").then((module) => ({ default: module.SettingsDialog }))
);
const ElevationView = lazy(() =>
  import("./components/ElevationView").then((module) => ({ default: module.ElevationView }))
);
const ThreeDView = lazy(() =>
  import("./components/three/ThreeDView").then((module) => ({ default: module.ThreeDView }))
);
const FontLab = import.meta.env.DEV
  ? lazy(() => import("./components/FontLab"))
  : null;

// Stable read-only asset lookup; the repository wrapper is stateless.
const assetRepository = new IndexedDbAssetRepository();
const rendererBenchmarkEnabled =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("benchmark") === "renderer";
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
  const {
    project,
    selection,
    wallContextId,
    arrangeSession,
    lastArrangeMode,
    lastInsetAnchor,
    lastEvenZone,
    viewMode,
    saveState,
    error,
    placementWarnings,
    lastGeometryEdit,
    undoStack,
    redoStack,
    libraryArtworks,
    intakeState,
    pendingDuplicateUploads,
    pendingPackageImport,
    boot,
    loadBenchmarkFixture,
    setViewMode,
    selectWall,
    selectArtwork,
    selectOpening,
    selectRoom,
    selectFreestandingWall,
    viewFreestandingFace,
    selectObject,
    setObjectSelection,
    clearObjectSelection,
    addRectangleRoom,
    addPolygonRoom,
    addDrawnRectangleRoom,
    addFreestandingWall,
    moveFreestandingWall,
    moveFreestandingWallEndpoint,
    rotateFreestandingWall,
    centerFreestandingWall,
    setFreestandingWallThickness,
    setFreestandingWallLength,
    setFreestandingWallHeight,
    deleteFreestandingWall,
    renameProject,
    renameRoom,
    deleteRoom,
    setUnit,
    resizeSelectedWall,
    resizeRoomHeight,
    resizeWall,
    moveRoomVertex,
    moveRoomWall,
    splitWall,
    deleteRoomVertex,
    moveRoom,
    undo,
    redo,
    importProjectJson,
    exportProjectPackage,
    exportProjectPackageById,
    importSightlinesPackage,
    resolvePackageImportConflicts,
    dismissPackageImport,
    listProjectSummaries,
    listArtworkProjectMemberships,
    openProject,
    createProject,
    renameProjectById,
    deleteProject,
    addArtworksFromFiles,
    importArtworkDrafts,
    addExistingArtworksToChecklist,
    confirmDuplicateUploads,
    dismissDuplicateUploads,
    removeArtworkFromChecklist,
    deleteLibraryArtworks,
    updateArtwork,
    placeArtwork,
    placeArtworkOnFloor,
    moveArtworkPlacement,
    removePlacement,
    addOpening,
    moveOpening,
    resizeOpening,
    connectOpenings,
    disconnectOpening,
    placeOpeningFromPlan,
    placeOpeningOnElevation,
    commitPlanMove,
    updateFloorObject,
    moveWallObjectsGroup,
    movePlanObjectsGroup,
    removeSelectedPlacements,
    beginArrangeSession,
    setArrangeAnchor,
    setArrangeEvenZone,
    updateArrangeSession,
    setArrangeSessionPreview,
    commitArrangeSession,
    cancelArrangeSession
  } = useAppStore();
  // Selection union is the source of truth; single-subject ids resolve live.
  const selectedObjectIds = objectIdsOf(selection);
  const selectedRoomId = roomIdOf(selection);
  const selectedFreestandingWallId = freestandingWallIdOf(selection);
  const selectedArtworkId = getSelectedArtworkId(project, selection);
  const selectedOpeningId = getSelectedOpeningId(project, selection);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const threeDActionsRef = useRef<ThreeDViewActions | null>(null);
  const [importWizardOpen, setImportWizardOpen] = useState(false);
  const [importDestination, setImportDestination] = useState<"library" | "checklist">("checklist");
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [projectMembershipsByArtworkId, setProjectMembershipsByArtworkId] = useState<
    Map<string, ProjectSummary[]>
  >(() => new Map());
  const [draggingArtworkId, setDraggingArtworkId] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Prevent re-entry while package assets are hashed and zipped.
  const [isExportingPackage, setIsExportingPackage] = useState(false);

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
  // Transient confirmation state; empty rooms delete immediately.
  const [confirmDeleteRoomId, setConfirmDeleteRoomId] = useState<string | null>(null);
  // Mutually exclusive, transient plan tools must not persist or enter undo history.
  const {
    mode: planMode,
    armOpeningTool,
    toggleDrawRect,
    toggleDrawRoom,
    toggleReshapeRoom,
    togglePartitionTool,
    disarm: disarmPlanMode
  } = usePlanMode(viewMode, selectedRoomId);
  // Compatibility aliases derived from planMode.
  const activeTool = planMode.kind === "placeOpening" ? planMode.tool : null;
  const drawRectActive = planMode.kind === "drawRect";
  const drawRoomActive = planMode.kind === "drawRoom";
  const reshapeRoomId = planMode.kind === "reshapeRoom" ? planMode.roomId : null;
  const partitionToolActive = planMode.kind === "drawPartition";
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

  useDeleteAndEscapeShortcuts({
    project,
    selection,
    selectedObjectIds,
    selectedFreestandingWallId,
    deleteFreestandingWall,
    deleteRoom,
    reshapeRoomId,
    confirmDeleteRoomId,
    draggingArtworkId,
    isHelpOpen,
    removeSelectedPlacements,
    clearObjectSelection,
    arrangeSession,
    cancelArrangeSession,
    setIsHelpOpen,
    setConfirmDeleteRoomId
  });

  useArrangeNudgeShortcuts({
    project,
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
    suspended:
      isHelpOpen || isSettingsOpen || importWizardOpen || confirmDeleteRoomId !== null,
    insertDisabled: viewMode === "elevation" && !selectedWall,
    activeTool,
    armOpeningTool,
    togglePartitionTool,
    toggleDrawRect,
    toggleDrawRoom,
    toggleShowGrid,
    toggleSnapToGrid,
    toggleAllowOverlappingPlacement,
    toggleShowCenterline
  });

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
  const artworksById = useMemo(
    () => new Map(libraryArtworks.map((artwork) => [artwork.id, artwork])),
    [libraryArtworks]
  );

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
              kind: parseFaceWallId(wall.id) ? ("partition-face" as const) : ("perimeter" as const)
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
  const selectedRoomDimensions = selectedRoomPlacement
    ? getRectangleRoomDimensions(selectedRoomPlacement.room)
    : null;
  // A stale pending-delete id closes the dialog safely.
  const confirmDeleteRoomPlacement = confirmDeleteRoomId
    ? (project.floor.rooms.find(
        (placement) => placement.roomId === confirmDeleteRoomId
      ) ?? null)
    : null;
  const confirmDeleteRoomSummary = confirmDeleteRoomPlacement
    ? summarizeRoomContents(project, confirmDeleteRoomPlacement)
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
  const isArtworkPlaced = placedWallObject !== null || placedFloorArtwork !== null;
  // Remove the artwork from whichever surface currently owns it.
  const artworkPlacementId = placedWallObject?.id ?? placedFloorArtwork?.id ?? null;

  // Position fields consider artwork neighbors only, not openings.
  const placedWallObjectWall = placedWallObject
    ? (getProjectWalls(project).find((wall) => wall.id === placedWallObject.wallId) ?? null)
    : null;
  const wallPlacementNeighbors = placedWallObject
    ? getWallPlacementNeighborEdges(
        placedWallObject,
        project.wallObjects.filter(
          (wallObject): wallObject is ArtworkWallObject => wallObject.kind === "artwork"
        )
      )
    : { leftNeighborRightEdgeMm: undefined, rightNeighborLeftEdgeMm: undefined };
  // Centering boundaries include every wall-object kind.
  const wallPlacementCenterTarget =
    placedWallObject && placedWallObjectWall
      ? getWallPlacementCenterTarget(
          placedWallObject,
          project.wallObjects,
          placedWallObjectWall.lengthMm
        )
      : { xMm: 0, boundaryKind: "wall" as const };

  // Deleted opening selections resolve to null.
  const selectedOpening: OpeningWallObject | null = selectedOpeningId
    ? (project.wallObjects.find(
        (wallObject): wallObject is OpeningWallObject =>
          wallObject.kind !== "artwork" && wallObject.id === selectedOpeningId
      ) ?? null)
    : null;
  const openingConnectionCandidates: OpeningConnectionCandidate[] =
    selectedOpening && (selectedOpening.kind === "door" || selectedOpening.kind === "window")
      ? project.wallObjects
          .filter(
            (candidate) =>
              candidate.id !== selectedOpening.id &&
              candidate.kind === selectedOpening.kind &&
              candidate.wallId !== selectedOpening.wallId &&
              parseFaceWallId(candidate.wallId) === null
          )
          .map((candidate) => {
            const alignment = evaluateOpeningPair(project, selectedOpening.id, candidate.id);
            const owner = project.floor.rooms.find((placement) =>
              placement.room.walls.some((wall) => wall.id === candidate.wallId)
            );
            const wallName = owner?.room.walls.find((wall) => wall.id === candidate.wallId)?.name;
            return {
              id: candidate.id,
              label: owner
                ? `${owner.room.name}, ${wallName ?? "Wall"}`
                : wallName ?? "Unknown wall",
              alignment
            };
          })
          // Keep an invalid existing partner visible so it can be disconnected.
          .filter(
            (candidate) =>
              candidate.id === selectedOpening.connectsToObjectId ||
              candidate.alignment.status === "aligned" ||
              (candidate.alignment.reason !== "angle" && candidate.alignment.reason !== "gap")
          )
          .sort((a, b) => a.label.localeCompare(b.label))
      : [];
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
    lastEvenZone
  });

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
          ? getOpeningKindLabel(wallObject.kind)
          : undefined;
    return { ...warning, subject };
  });

  // Issues navigation selects the first warning's placement in the inspector.
  const selectFirstWarningObject = () => {
    const first = placementWarnings[0];
    if (!first) return;

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
  const selectLeftPanel = (panel: "checklist" | "rooms") => {
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

  const handleExportPackage = async (mode: PackageExportMode) => {
    if (isExportingPackage) return;
    setIsExportingPackage(true);
    try {
      const result = await exportProjectPackage(mode);
      if (result) {
        triggerDownload(result.zip, result.filename);
        if (result.warnings.length > 0) {
          toast.warning(
            `Exported ${result.filename} with ${result.warnings.length} warning${
              result.warnings.length === 1 ? "" : "s"
            }: ${result.warnings.join(" ")}`
          );
        } else {
          toast.success(`Exported ${result.filename}`);
        }
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

  // Project-row quick export uses the standard display-quality mode.
  const handleExportProjectById = async (id: string) => {
    try {
      const result = await exportProjectPackageById(id, "display");
      if (result) {
        triggerDownload(result.zip, result.filename);
        if (result.warnings.length > 0) {
          toast.warning(
            `Exported ${result.filename} with ${result.warnings.length} warning${
              result.warnings.length === 1 ? "" : "s"
            }: ${result.warnings.join(" ")}`
          );
        } else {
          toast.success(`Exported ${result.filename}`);
        }
      } else {
        toast.error(useAppStore.getState().error ?? "Export failed: the package could not be built.");
      }
    } catch (error) {
      toast.error(
        `Export failed: ${error instanceof Error ? error.message : "the package could not be built."}`
      );
    }
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
    <main className="app-shell">
      <AppRail
        leftPanel={visibleLeftPanel}
        onSelectLeftPanel={selectLeftPanel}
        isLibraryView={viewMode === "library"}
        onOpenLibrary={() => setViewMode("library")}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenHelp={() => setIsHelpOpen(true)}
        issueCount={placementWarnings.length}
        onSelectFirstIssue={selectFirstWarningObject}
      />
      <div className="app-main">
      <header className="topbar">
        <div className="topbar-left">
          <p className="app-name">Sightlines</p>
          <div className="brand-divider" aria-hidden="true" />
          <div className="project-switcher">
            <ProjectTitleInput title={project.title} onCommit={renameProject} />
            <ProjectPicker
              currentProjectId={project.id}
              listProjectSummaries={listProjectSummaries}
              onCreateProject={createProject}
              onDeleteProject={deleteProject}
              onExportProject={handleExportProjectById}
              onOpenProject={openProject}
              onRenameProject={renameProjectById}
            />
          </div>
        </div>

        <div className="view-tabs topbar-center">
          <UnderlineToggleGroup
            aria-label="Workspace view"
            className="view-tabs"
            orientation="horizontal"
            type="single"
            value={viewMode}
            onValueChange={(value) => {
              if (value === "plan" || value === "elevation" || value === "3d") {
                setViewMode(value);
              }
            }}
          >
            <UnderlineToggleGroupItem value="plan">
              <MapTrifoldIcon aria-hidden="true" size={16} />
              <span>Plan</span>
            </UnderlineToggleGroupItem>
            <UnderlineToggleGroupItem value="elevation">
              <PresentationIcon aria-hidden="true" size={16} />
              <span>Elevation</span>
            </UnderlineToggleGroupItem>
            <UnderlineToggleGroupItem value="3d">
              <CubeIcon aria-hidden="true" size={16} />
              <span>3D</span>
            </UnderlineToggleGroupItem>
          </UnderlineToggleGroup>
        </div>

        <div className="topbar-right" aria-label="Project actions">
          <Popover>
            <PopoverTrigger asChild>
              <StatusBadge state={saveState} />
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="storage-popover">
              <div className="storage-popover-heading">
                <FloppyDiskIcon aria-hidden="true" size={16} />
                <h3>Where your work is saved</h3>
              </div>
              <p className="storage-popover-body">{getStorageNoteCopy(storagePersistence)}</p>
              {storagePersistence === "denied" ? (
                <Button
                  className="storage-popover-retry"
                  size="sm"
                  variant="ghost"
                  onClick={retryStoragePersistence}
                >
                  Retry
                </Button>
              ) : null}
              <div className="storage-popover-footer">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleExportPackage("display")}
                >
                  Export a backup
                </Button>
                <Button size="sm" variant="outline" onClick={() => setIsSettingsOpen(true)}>
                  Storage settings
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <div className="toolbar-group">
            <Button
              className="icon-button"
              title="Undo"
              aria-label="Undo"
              disabled={undoStack.length === 0}
              size="icon"
              variant="ghost"
              onClick={() => void undo()}
            >
              <ArrowCounterClockwiseIcon aria-hidden="true" size={18} />
            </Button>
            <Button
              className="icon-button"
              title="Redo"
              aria-label="Redo"
              disabled={redoStack.length === 0}
              size="icon"
              variant="ghost"
              onClick={() => void redo()}
            >
              <ArrowClockwiseIcon aria-hidden="true" size={18} />
            </Button>
          </div>
          <div className="toolbar-divider" aria-hidden="true" />
          <Button
            className="icon-button"
            title="Import project (.sightlines or JSON)"
            aria-label="Import project (.sightlines or JSON)"
            size="icon"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadSimpleIcon aria-hidden="true" size={18} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="topbar-button"
                title="Export"
                aria-label="Export"
                aria-busy={isExportingPackage}
                disabled={isExportingPackage}
                size="default"
                variant="outline"
              >
                {isExportingPackage ? (
                  <CircleNotchIcon aria-hidden="true" className="animate-spin" size={18} />
                ) : (
                  <DownloadSimpleIcon aria-hidden="true" size={18} />
                )}
                <span>{isExportingPackage ? "Exporting…" : "Export"}</span>
                <CaretDownIcon aria-hidden="true" className="topbar-button-caret" size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>Export package (.sightlines)</DropdownMenuLabel>
              <DropdownMenuItem
                className="dropdown-menu-item-stacked"
                onSelect={() => void handleExportPackage("display")}
              >
                <PackageIcon aria-hidden="true" size={16} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span>Standard</span>
                  <span className="[font-size:var(--type-xs)] leading-snug text-muted-foreground">
                    Display-quality images. Recommended for sharing and backup.
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="dropdown-menu-item-stacked"
                onSelect={() => void handleExportPackage("originals")}
              >
                <ArchiveIcon aria-hidden="true" size={16} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span>With originals</span>
                  <span className="[font-size:var(--type-xs)] leading-snug text-muted-foreground">
                    Adds full-resolution files. Largest export; archival handoff.
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="dropdown-menu-item-stacked"
                onSelect={() => void handleExportPackage("metadata-only")}
              >
                <FileDashedIcon aria-hidden="true" size={16} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span>Without images</span>
                  <span className="[font-size:var(--type-xs)] leading-snug text-muted-foreground">
                    Checklist and layout only. Relinks images on machines that have them.
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={fileInputRef}
            aria-label="Import project (.sightlines or JSON)"
            className="visually-hidden"
            type="file"
            accept="application/json,.json,.sightlines,application/zip"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void handleImportFile(file);
              event.target.value = "";
            }}
          />
        </div>
      </header>

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
        <button
          type="button"
          className="inspector-toggle"
          title={visibleInspectorCollapsed ? "Show inspector" : "Hide inspector"}
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
            onConfirmDuplicateUploads={confirmDuplicateUploads}
            onDismissDuplicateUploads={dismissDuplicateUploads}
            onOpenImportWizard={() => {
              setImportDestination("checklist");
              setImportWizardOpen(true);
            }}
            onOpenArtworkLibrary={() => setLibraryPickerOpen(true)}
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
            onSelectWall={selectWall}
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
                      disabled={viewMode === "elevation" && !selectedWall}
                      onToolChange={armOpeningTool}
                    />
                    <InsertPicker
                      variant="compact"
                      activeTool={activeTool}
                      disabled={viewMode === "elevation" && !selectedWall}
                      onToolChange={armOpeningTool}
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
                selectedWallId={selectedWall?.id ?? null}
                snapToGrid={snapToGrid}
                viewport={planViewport}
                onViewportChange={setPlanViewport}
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
              />
            )
          ) : null}
          {viewMode === "elevation" ? (
            selectedWall ? (
              <Suspense fallback={<div className="skeleton-panel" />}>
                <ElevationView
                  allowOverlappingPlacement={allowOverlappingPlacement}
                  artworksById={artworksById}
                  centerlineMm={
                    selectedWall.defaultCenterlineHeightMm ??
                    project.defaultCenterlineHeightMm
                  }
                  centerlineVisible={showCenterline}
                  draggingArtworkId={draggingArtworkId}
                  getBlob={getAssetBlob}
                  gridPrecisionFloorMm={gridPrecisionFloorMm}
                  gridVisible={showGrid}
                  activeTool={activeTool}
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
                />
              </Suspense>
            ) : (
              <ElevationEmptyState hasRooms={project.floor.rooms.length > 0} />
            )
          ) : null}
          {viewMode === "library" ? (
            <ArtworkLibraryView
              artworks={libraryArtworks}
              project={project}
              getBlob={getAssetBlob}
              onAddToChecklist={addExistingArtworksToChecklist}
              onDeleteArtworks={(ids) => void deleteLibraryArtworks(ids)}
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
                setImportWizardOpen(true);
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
                selectedWallId={selectedWall?.id ?? null}
                onSelectWall={selectWall}
                onSelectObject={selectObject}
                onClearSelection={clearObjectSelection}
                actionsRef={threeDActionsRef}
              />
            </Suspense>
          ) : null}
        </section>

        {!visibleInspectorCollapsed ? (
        <aside className="inspector" aria-label="Inspector">
          <div className="inspector-zone">
            {labeledPlacementWarnings.length > 0 ? (
              <div className="warning-panel" role="status" aria-live="polite">
                <WarningIcon aria-hidden="true" size={18} />
                <div>
                  <h3>Placement needs review</h3>
                  <ul>
                    {labeledPlacementWarnings.map((warning) => (
                      // Subject leads so a list of warnings scans by object
                      // name; without the separator it fuses into the message
                      // ("…on this wall.Door").
                      <li key={warning.id}>
                        {warning.subject ? <span>{warning.subject} · </span> : null}
                        {warning.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            {!isMultiSelect &&
            (selectedArtwork ||
              selectedOpening ||
              selectedFloorBlockedZone ||
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
                        : selectedRoomPlacement
                          ? "Room"
                          : selectedFreestandingWall
                            ? "Partition"
                            : "Wall"}
                </span> : null}
              </div>
            ) : null}

            {isMultiSelect ? (
              // Multi-selection replaces the single-subject inspector chain.
              <SelectionInspector
                arrange={arrangeReadout}
                arrangeDisabledReason={arrangeDisabledReason}
                arrangeIgnoredNote={arrangeIgnoredNote}
                count={selectedObjectIds.length}
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
                      placement={placedWallObject}
                      wallLengthMm={placedWallObjectWall.lengthMm}
                      leftNeighborRightEdgeMm={wallPlacementNeighbors.leftNeighborRightEdgeMm}
                      rightNeighborLeftEdgeMm={wallPlacementNeighbors.rightNeighborLeftEdgeMm}
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
                      <p className="field-hint">Floor-placed in plan view.</p>
                      <FloorPlacementFields
                        floorObject={placedFloorArtwork}
                        unit={project.unit}
                        onCommitPosition={(xMm, yMm) =>
                          void updateFloorObject(placedFloorArtwork.id, { xMm, yMm })
                        }
                        onCommitSize={(widthMm, depthMm) =>
                          void updateFloorObject(placedFloorArtwork.id, { widthMm, depthMm })
                        }
                      />
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
                  void updateArtwork(selectedArtwork.id, { placementForm })
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
              onDelete={() => void removePlacement(selectedFloorBlockedZone.id)}
            />
          ) : selectedOpening ? (
            <OpeningInspector
              opening={selectedOpening}
              unit={project.unit}
              connectionCandidates={openingConnectionCandidates}
              onConnect={(partnerId) => void connectOpenings(selectedOpening.id, partnerId)}
              onDisconnect={() => void disconnectOpening(selectedOpening.id)}
              onCommitPosition={(xMm, yMm) =>
                void moveOpening(selectedOpening.id, xMm, yMm, allowOverlappingPlacement)
              }
              onCommitSize={(widthMm, heightMm) =>
                void resizeOpening(selectedOpening.id, widthMm, heightMm, allowOverlappingPlacement)
              }
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
              onViewFace={(face) =>
                viewFreestandingFace(faceWallId(selectedFreestandingWall.id, face))
              }
              onDelete={() => void deleteFreestandingWall(selectedFreestandingWall.id)}
            />
          ) : selectedWall ? (
            <WallInspector
              centerlineMm={project.defaultCenterlineHeightMm}
              changedWallNames={getWallNames(
                project,
                lastGeometryEdit?.changedWallIds ?? []
              )}
              dimensionLink={wallDimensionLink}
              lastGeometryEdit={lastGeometryEdit}
              onAddOpening={(kind) => void addOpening(selectedWall.id, kind)}
              onCommitHeight={(heightMm) =>
                selectedWallRoomPlacement
                  ? resizeRoomHeight(selectedWallRoomPlacement.roomId, heightMm)
                  : Promise.resolve()
              }
              onCommitLength={resizeSelectedWall}
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
          resetPreferences={resetPreferences}
          onExport={() => void handleExportPackage("display")}
          onImport={() => fileInputRef.current?.click()}
          onOpenHelp={() => { setIsSettingsOpen(false); setIsHelpOpen(true); }}
        />
      </Suspense>
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
    </main>
    </TooltipProvider>
  );
}

function ProjectTitleInput({
  title,
  onCommit
}: {
  title: string;
  onCommit: (title: string) => Promise<void>;
}) {
  const [value, setValue] = useState(title);

  useEffect(() => {
    setValue(title);
  }, [title]);

  const commit = () => {
    if (value.trim().length === 0) {
      setValue(title);
      return;
    }

    void onCommit(value);
  };

  return (
    <Input
      className="project-title"
      value={value}
      aria-label="Project title"
      size="title"
      // Sized to the text so the picker chevron sits right beside the title
      // instead of at the far end of a fixed-width field. The CSS clamp
      // still bounds it on both ends.
      style={{ width: `${Math.max(value.length, 8) + 2}ch` }}
      variant="title"
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.currentTarget.blur();
      }}
    />
  );
}

function getWallDimensionLink(
  project: Project,
  wallId: string
): WallDimensionLink | null {
  for (const placement of project.floor.rooms) {
    const pair = getOrthogonalQuadWallPair(placement.room, wallId);
    if (!pair) continue;

    return {
      pairedWallName: pair.pairedWall.name,
      roomName: placement.room.name
    };
  }

  return null;
}

function getWallNames(project: Project, wallIds: string[]): string[] {
  if (wallIds.length === 0) return [];

  const namesById = new Map(
    project.floor.rooms.flatMap((placement) =>
      placement.room.walls.map((wall) => [wall.id, wall.name])
    )
  );

  return wallIds.map((wallId) => namesById.get(wallId) ?? wallId);
}

// Turns raw bytes into a browser download. The only DOM-bound step in the
// package export path — the manifest/zip derivation is pure domain code.
function triggerDownload(data: Blob | Uint8Array, filename: string) {
  const blob =
    data instanceof Blob
      ? data
      : // Fresh copy: Blob wants a plain ArrayBuffer, and a fflate Uint8Array
        // may be a view into a larger pooled buffer.
        new Blob([data.slice()], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
