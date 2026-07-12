import {
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CornersOutIcon } from "@phosphor-icons/react/dist/csr/CornersOut";
import { CrosshairIcon } from "@phosphor-icons/react/dist/csr/Crosshair";
import { DoorIcon } from "@phosphor-icons/react/dist/csr/Door";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { GridFourIcon } from "@phosphor-icons/react/dist/csr/GridFour";
import { MagnetIcon } from "@phosphor-icons/react/dist/csr/Magnet";
import { MapTrifoldIcon } from "@phosphor-icons/react/dist/csr/MapTrifold";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PolygonIcon } from "@phosphor-icons/react/dist/csr/Polygon";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { PresentationIcon } from "@phosphor-icons/react/dist/csr/Presentation";
import { CubeIcon } from "@phosphor-icons/react/dist/csr/Cube";
import { RectangleDashedIcon } from "@phosphor-icons/react/dist/csr/RectangleDashed";
import { StackIcon } from "@phosphor-icons/react/dist/csr/Stack";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import {
  getPlacedRoomBounds,
  getRectangleRoomDimensions,
  getWallsWithGeometry,
  getOrthogonalQuadWallPair,
} from "../domain/geometry/walls";
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
  Project
} from "../domain/project";
import { faceWallId, parseFaceWallId } from "../domain/geometry/freestandingWalls";
import { IndexedDbAssetRepository } from "../domain/repositories/indexedDbAssetRepository";
import { formatLength } from "../domain/units/length";
import { getGridPrecisionFloorOptionsMm } from "../domain/units/precision";
import {
  displayUnitForSystem,
  unitSystemFromDisplayUnit,
  type UnitSystem
} from "../domain/units/unitSystem";
import { AppRail } from "./components/AppRail";
import { ArtworkInspector } from "./components/ArtworkInspector";
import { PanelResizeHandle } from "./components/PanelResizeHandle";
import { ChecklistPanel } from "./components/ChecklistPanel";
import { DeleteRoomDialog } from "./components/DeleteRoomDialog";
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
import { PartitionGlyph, RectangleRoomGlyph, WindowGlyph } from "./components/toolbarGlyphs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "./components/ui/tooltip";
import { ProjectPicker } from "./components/ProjectPicker";
import { RoomInspector } from "./components/RoomInspector";
import { RoomsPanel } from "./components/RoomsPanel";
import { SelectionInspector } from "./components/SelectionInspector";
import {
  chooseToolbarDensity,
  DEFAULT_TOOLBAR_FIT_BUFFER_PX,
  TOOLBAR_DENSITIES,
  type ToolbarDensity
} from "./toolbarDensity";
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
  DropdownMenuTrigger
} from "./components/ui/dropdown-menu";
import { Input } from "./components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "./components/ui/select";
import { Switch } from "./components/ui/switch";
import { Tabs } from "./components/ui/tabs";
import { UnderlineTabsList, UnderlineTabsTrigger } from "./components/ui/segmented";
import { Toggle } from "./components/ui/toggle";
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
  exportProjectJson,
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

const DataView = lazy(() =>
  import("./components/DataView").then((module) => ({ default: module.DataView }))
);
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

// A second, independent IndexedDbAssetRepository instance dedicated to
// reads (thumbnail lookups for the checklist). It talks to the same
// IndexedDB database as the one store.ts constructs for writes — the
// repository is a stateless wrapper around the browser API, not something
// that needs a single shared instance — so this avoids exporting store.ts's
// internals just to hand a `getBlob` down to one panel. getBlob is declared
// at module scope (not inside the component) so it's a stable function
// reference across renders, which keeps useAssetImageUrls from refetching
// on every App re-render.
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

function useResponsiveToolbarDensity(measurementKey: string) {
  const toolbarRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    let frameId: number | null = null;
    let disposed = false;

    const requiredGroupWidth = (group: HTMLElement) => {
      const style = window.getComputedStyle(group);
      const children = Array.from(group.children).filter(
        (child) => window.getComputedStyle(child).display !== "none"
      );
      const childrenWidth = children.reduce((total, child) => {
        const element = child as HTMLElement;
        const childStyle = window.getComputedStyle(element);
        return (
          total +
          element.getBoundingClientRect().width +
          (Number.parseFloat(childStyle.marginLeft) || 0) +
          (Number.parseFloat(childStyle.marginRight) || 0)
        );
      }, 0);
      const gap = Number.parseFloat(style.columnGap) || 0;
      return (
        childrenWidth +
        Math.max(0, children.length - 1) * gap +
        (Number.parseFloat(style.paddingLeft) || 0) +
        (Number.parseFloat(style.paddingRight) || 0)
      );
    };

    const requiredToolbarWidth = () => {
      const style = window.getComputedStyle(toolbar);
      const groups = Array.from(toolbar.children) as HTMLElement[];
      const gap = Number.parseFloat(style.columnGap) || 0;
      return (
        groups.reduce((total, group) => total + requiredGroupWidth(group), 0) +
        Math.max(0, groups.length - 1) * gap +
        (Number.parseFloat(style.paddingLeft) || 0) +
        (Number.parseFloat(style.paddingRight) || 0)
      );
    };

    const measure = () => {
      frameId = null;
      if (disposed || toolbar.clientWidth === 0) return;

      // Always try the richest layout first. Reading scrollWidth after each
      // density change forces the browser to evaluate that exact rendered
      // configuration, so panes, labels, fonts, and active view controls all
      // contribute to the breakpoint instead of relying on a guessed width.
      const requiredWidths = {} as Record<ToolbarDensity, number>;
      for (const density of TOOLBAR_DENSITIES) {
        toolbar.dataset.density = density;
        requiredWidths[density] = requiredToolbarWidth();
      }
      const nextDensity = chooseToolbarDensity(
        toolbar.clientWidth,
        requiredWidths,
        DEFAULT_TOOLBAR_FIT_BUFFER_PX
      );
      toolbar.dataset.density = nextDensity;
    };

    const scheduleMeasure = () => {
      if (frameId !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frameId);
      }
      if (typeof window.requestAnimationFrame === "function") {
        frameId = window.requestAnimationFrame(measure);
      } else {
        measure();
      }
    };

    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    observer?.observe(toolbar);
    void document.fonts?.ready.then(() => {
      if (!disposed) scheduleMeasure();
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      if (frameId !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [measurementKey]);

  return toolbarRef;
}

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
    listProjectSummaries,
    openProject,
    createProject,
    deleteProject,
    addArtworksFromFiles,
    importArtworkDrafts,
    confirmDuplicateUploads,
    dismissDuplicateUploads,
    removeArtworkFromChecklist,
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
  // Derived once per render from the selection union (source of truth) —
  // objectIdsOf/roomIdOf are pure lookups; getSelectedArtworkId/
  // getSelectedOpeningId additionally resolve against the live project (both
  // accept a null project for the pre-boot render). Kept under their old
  // mirror-field names so every read site and child prop below is unchanged.
  const selectedObjectIds = objectIdsOf(selection);
  const selectedRoomId = roomIdOf(selection);
  const selectedFreestandingWallId = freestandingWallIdOf(selection);
  const selectedArtworkId = getSelectedArtworkId(project, selection);
  const selectedOpeningId = getSelectedOpeningId(project, selection);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const threeDActionsRef = useRef<ThreeDViewActions | null>(null);
  const [importWizardOpen, setImportWizardOpen] = useState(false);
  const [draggingArtworkId, setDraggingArtworkId] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // The occupied room the Delete shortcut is asking to confirm about —
  // transient UI state like the armed tools (never in the store/undo). Empty
  // rooms skip this and delete immediately.
  const [confirmDeleteRoomId, setConfirmDeleteRoomId] = useState<string | null>(null);
  // The plan canvas's single armed-tool mode (door/window/blocked-zone
  // placement, polygon-room draw, room reshape, or partition draw) — a
  // discriminated union so the four are structurally mutually exclusive
  // instead of four separate useStates that each had to hand-disarm the
  // other three. Transient UI state, deliberately NOT in the store: same
  // reasoning as PlanView's other drag/marquee state (see the comment near
  // its former activeTool declaration), it must never enter undo history or
  // get persisted. Lives here (not in PlanView) now that the toolbar buttons
  // that arm it live in this component's view-toolbar strip. See
  // usePlanMode's own doc comment for how a future mode (doorway pairing)
  // slots into the union.
  const {
    mode: planMode,
    armOpeningTool,
    toggleDrawRect,
    toggleDrawRoom,
    toggleReshapeRoom,
    togglePartitionTool,
    disarm: disarmPlanMode
  } = usePlanMode(viewMode, selectedRoomId);
  // Legacy field names — every existing read site and child prop below
  // (PlanView, the view-toolbar buttons, RoomInspector's "Edit shape") keeps
  // reading these exact shapes, derived fresh each render from planMode.
  const activeTool = planMode.kind === "placeOpening" ? planMode.tool : null;
  const drawRectActive = planMode.kind === "drawRect";
  const drawRoomActive = planMode.kind === "drawRoom";
  const reshapeRoomId = planMode.kind === "reshapeRoom" ? planMode.roomId : null;
  const partitionToolActive = planMode.kind === "drawPartition";
  // PlanView's onDrawRoomChange/onPartitionToolChange props are raw boolean
  // setters (unlike the toggle handlers above, which flip regardless of
  // argument) — PlanView only ever calls them with `false`, to disarm its
  // own mode once a draw/placement completes or Escape is pressed. These
  // route that back to "idle" directly, and (for completeness, though never
  // observed) arm the mode via the same toggle used by the view-toolbar
  // button when called with `true` while it isn't already active.
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
  } = useViewPreferences();
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
    isCompactWorkspace && compactWorkspaceSide === "right" ? null : leftPanel;
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

  // The tool-disarm-on-view-change and reshape-follows-selection
  // effects that used to live here now live in usePlanMode itself (it takes
  // viewMode and selectedRoomId as arguments above).

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

  // The flat wall inventory (room order) that feeds the elevation chip's wall
  // switcher — the navigation that used to live in the right-panel wall list.
  const wallsForSwitcher = useMemo(
    () =>
      project
        ? project.floor.rooms.flatMap((placement) =>
            getWallsWithGeometry(placement.room).map((wall) => ({
              id: wall.id,
              name: wall.name,
              roomName: placement.room.name
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
  // The selected partition, resolved against the live project — a stale id
  // (undo/redo can orphan it) drops to null and the inspector falls through.
  const selectedFreestandingWall: FreestandingWall | null = selectedFreestandingWallId
    ? (project.floor.rooms
        .flatMap((placement) => placement.room.freestandingWalls)
        .find((wall) => wall.id === selectedFreestandingWallId) ?? null)
    : null;
  const selectedRoomDimensions = selectedRoomPlacement
    ? getRectangleRoomDimensions(selectedRoomPlacement.room)
    : null;
  // The room the delete-confirm dialog is asking about, resolved against the
  // live project — a stale id (undo/redo or deletion elsewhere) resolves to
  // null and the dialog simply closes.
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

  // A dangling selectedArtworkId (library record deleted out from under the
  // project) resolves to nothing here, so the inspector falls back to the
  // wall view below rather than rendering a dead end.
  const selectedArtwork: Artwork | null =
    (selectedArtworkId ? artworksById.get(selectedArtworkId) : undefined) ?? null;
  const placedWallObject: ArtworkWallObject | null = selectedArtwork
    ? (project.wallObjects.find(
        (wallObject): wallObject is ArtworkWallObject =>
          wallObject.kind === "artwork" && wallObject.artworkId === selectedArtwork.id
      ) ?? null)
    : null;
  // An artwork placed on the floor (dragged off a wall, or dropped straight
  // onto open floor) — ids/artworkId survive wall↔floor conversion, so the
  // same selectedArtworkId resolves here when it isn't on a wall.
  const placedFloorArtwork: ArtworkFloorObject | null = selectedArtwork
    ? (project.floorObjects.find(
        (floorObject): floorObject is ArtworkFloorObject =>
          floorObject.kind === "artwork" && floorObject.artworkId === selectedArtwork.id
      ) ?? null)
    : null;
  const isArtworkPlaced = placedWallObject !== null || placedFloorArtwork !== null;
  // The placement to remove when the artwork inspector's action fires —
  // whichever surface it currently lives on.
  const artworkPlacementId = placedWallObject?.id ?? placedFloorArtwork?.id ?? null;

  // The wall a wall-placed work hangs on (for its "Position on wall" section's
  // length + header) and the nearest artwork neighbours on each side — both
  // derived here from the live project so the section stays purely
  // presentational. Neighbours are artwork-kind wall objects only; openings and
  // blocked zones are not "works".
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
  // The Center button's target + label classification — unlike
  // wallPlacementNeighbors above, every wall object counts (openings
  // included), matching detectBoundary's own rule.
  const wallPlacementCenterTarget =
    placedWallObject && placedWallObjectWall
      ? getWallPlacementCenterTarget(
          placedWallObject,
          project.wallObjects,
          placedWallObjectWall.lengthMm
        )
      : { xMm: 0, boundaryKind: "wall" as const };

  // A dangling selectedOpeningId (the opening was just deleted) resolves to
  // nothing here too, the same fallback shape as selectedArtwork above.
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
                ? `${owner.room.name} — ${wallName ?? "Wall"}`
                : wallName ?? "Unknown wall",
              alignment
            };
          })
          // New candidates must at least sit on nearby, facing wall lines.
          // Keep an existing partner visible even after a room move makes it
          // fail angle/gap so the inspector can explain and disconnect it.
          .filter(
            (candidate) =>
              candidate.id === selectedOpening.connectsToObjectId ||
              candidate.alignment.status === "aligned" ||
              (candidate.alignment.reason !== "angle" && candidate.alignment.reason !== "gap")
          )
          .sort((a, b) => a.label.localeCompare(b.label))
      : [];
  // selectedOpeningId doubles as the slot for a floor-placed blocked zone
  // (no separate selection slot — ids are unique across both arrays), so a
  // selection that isn't a wall opening may resolve to a floor blocked zone.
  const selectedFloorBlockedZone: BlockedZoneFloorObject | null =
    selectedOpeningId && !selectedOpening
      ? (project.floorObjects.find(
          (floorObject): floorObject is BlockedZoneFloorObject =>
            floorObject.kind === "blocked-zone" && floorObject.id === selectedOpeningId
        ) ?? null)
      : null;

  // The multi-selection resolved against the live project — stale ids (undo/
  // redo or a document swap can orphan them) simply drop out here rather than
  // ever reaching an action. The arrange readout only exists when the whole
  // selection is 2+ wall objects on a single wall — the same guard the
  // arrange-session actions enforce, computed here so the inspector can show
  // the current spacing (or a hint) instead of failing on commit.
  const isMultiSelect = selectedObjectIds.length > 1;
  // Arranging operates on ARTWORKS only — a selected opening (door/window/
  // blocked zone) is architecture, never a member. So the readout, the panel's
  // eligibility, and the keyboard nudges all derive from artwork members;
  // openings in the selection are ignored rather than blocking arrangement.
  const selectedArtworkMembers = project.wallObjects.filter(
    (wallObject) =>
      wallObject.kind === "artwork" && selectedObjectIds.includes(wallObject.id)
  );
  // Single source of truth for the "can this selection be arranged" facts —
  // see arrangeEligibility.ts. beginArrangeSession enforces the same guard;
  // this is only the derived-state side (readout + disabled-reason copy).
  const arrangeEligibility = getArrangeEligibility(project, selectedObjectIds);
  const arrangeWall = arrangeEligibility.eligible
    ? (getProjectWalls(project).find(
        (wall) => wall.id === arrangeEligibility.wallId
      ) ?? null)
    : null;
  // A live session ties itself to the current selection (the store auto-
  // accepts on any selection/view change), so its previewById describes these
  // very members — override their committed positions with it before reading
  // the layout back, so the panel and its Apply/Cancel reflect the preview.
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

  // Why the arrange panel is disabled, named specifically — the static "select
  // two objects" line read as nonsense to a user who already had three objects
  // selected but only one work among them. Branch order mirrors the
  // arrangeEligibility guard above (floor members block first, then the works
  // count, then the single-wall rule) so the hint always names the actual
  // blocker. The strings themselves are UI copy, so they stay here rather
  // than in arrangeEligibility.ts.
  const arrangeDisabledReason = arrangeEligibility.eligible
    ? ""
    : arrangeEligibility.reason === "floorMember"
      ? "Arranging is for works hung on a wall — this selection includes floor-placed objects."
      : arrangeEligibility.reason === "noArtworks"
        ? "Arranging is for works only — doors, windows, and blocked zones stay where they are."
        : arrangeEligibility.reason === "singleArtwork"
          ? "Arranging is for works only — select at least two works on the same wall to arrange them."
          : "Select works on a single wall to arrange them — this selection spans more than one wall.";
  // When the selection IS arrangeable but also contains openings, arranging
  // silently ignores them (see selectedArtworkMembers above) — surface that
  // explicitly rather than let the curator wonder why a door didn't move.
  const arrangeIgnoredNote =
    arrangeWall && selectedObjectIds.length > selectedArtworkMembers.length
      ? "Only the works are arranged — doors, windows, and blocked zones stay put."
      : undefined;

  // Warnings carry a wallObjectId, but a raw id means nothing to a curator —
  // resolve it to the artwork's title, or the opening's human-readable kind
  // label ("Door"/"Window"/"Blocked zone", never a raw `kind` string), for
  // display.
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

  // The rail's Issues button jumps to the first warning's wall object so the
  // inspector reveals it — an artwork placement selects the placement itself
  // (not just the library artwork, so a stale multi-selection resolves back
  // to this one work), any other kind (door/window/blocked zone) selects the
  // opening.
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

  // Whether the inspector currently has anything to show — a resolved single
  // subject, a multi-selection, or a placement warning. Drives the contextual
  // "reopen inspector" tab that surfaces only when the panel is collapsed AND
  // there's something in it worth reopening for (a bare rail toggle is always
  // available, but this makes the hidden content discoverable in the moment).
  const hasInspectorContent =
    isMultiSelect ||
    selectedArtwork !== null ||
    selectedOpening !== null ||
    selectedFloorBlockedZone !== null ||
    selectedRoomPlacement !== null ||
    selectedFreestandingWall !== null ||
    selectedWall !== null ||
    labeledPlacementWarnings.length > 0;

  // The grid tracks are driven by CSS custom properties (see .workspace in
  // global.css) rather than an inline grid-template-columns, so the narrow-
  // viewport media query can still override to a single stacked column — an
  // inline template would win over the stylesheet and defeat requirement 7.
  const workspaceStyle = {
    "--left-panel-width": `${leftPanelWidth}px`,
    "--inspector-width": `${inspectorWidth}px`
  } as React.CSSProperties;
  const workspaceClassName = [
    "workspace",
    visibleLeftPanel ? null : "left-collapsed",
    visibleInspectorCollapsed ? "right-collapsed" : null
  ]
    .filter(Boolean)
    .join(" ");

  return (
    // One provider for every hover tooltip in the app (plan/elevation
    // placements), so they share a single warm-up delay and skip-delay window.
    <TooltipProvider delayDuration={400}>
    <main className="app-shell">
      <AppRail
        leftPanel={visibleLeftPanel}
        onSelectLeftPanel={selectLeftPanel}
        inspectorCollapsed={visibleInspectorCollapsed}
        onToggleInspector={handleInspectorToggle}
        isDataView={viewMode === "data"}
        onOpenDataView={() => setViewMode("data")}
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
              onOpenProject={openProject}
            />
          </div>
        </div>

        <Tabs
          className="view-tabs topbar-center"
          value={viewMode}
          onValueChange={(value) => {
            if (value === "plan" || value === "elevation" || value === "3d") {
              setViewMode(value);
            }
          }}
        >
          <UnderlineTabsList aria-label="Workspace view" className="view-tabs">
            <UnderlineTabsTrigger value="plan">
              <MapTrifoldIcon aria-hidden="true" size={16} />
              <span>Plan</span>
            </UnderlineTabsTrigger>
            <UnderlineTabsTrigger value="elevation">
              <PresentationIcon aria-hidden="true" size={16} />
              <span>Elevation</span>
            </UnderlineTabsTrigger>
            <UnderlineTabsTrigger value="3d">
              <CubeIcon aria-hidden="true" size={16} />
              <span>3D</span>
            </UnderlineTabsTrigger>
          </UnderlineTabsList>
        </Tabs>

        <div className="topbar-right" aria-label="Project actions">
          <StatusBadge state={saveState} />
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
            title="Import project JSON"
            aria-label="Import project JSON"
            size="icon"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadSimpleIcon aria-hidden="true" size={18} />
          </Button>
          <Button
            className="topbar-button"
            title="Export project JSON"
            aria-label="Export project JSON"
            size="default"
            variant="outline"
            onClick={() => downloadProject(project)}
          >
            <DownloadSimpleIcon aria-hidden="true" size={18} />
            <span>Export</span>
          </Button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then(importProjectJson);
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
          />
        ) : null}
        {visibleInspectorCollapsed && hasInspectorContent ? (
          <button
            type="button"
            className="inspector-reopen"
            title="Show inspector"
            aria-label="Show inspector"
            onClick={handleInspectorToggle}
          >
            <CaretLeftIcon aria-hidden="true" size={16} />
          </button>
        ) : null}
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
            onOpenImportWizard={() => setImportWizardOpen(true)}
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
          {viewMode !== "data" &&
          (viewMode !== "3d" || project.floor.rooms.length > 0) ? (
            <div className="view-toolbar" ref={toolbarRef}>
              <div className="view-tools-primary">
                {/* Draw leads: creating structure precedes decorating it, and
                    the plan workflow starts by drawing a room. Elevation drops
                    the whole Draw block, leaving Insert alone at the zone's
                    start in both views. */}
                {viewMode === "plan" ? (
                  <>
                    <DrawToolPicker
                      rectActive={drawRectActive}
                      onRectToggle={toggleDrawRect}
                      outlineActive={drawRoomActive}
                      onOutlineToggle={toggleDrawRoom}
                      partitionActive={partitionToolActive}
                      onPartitionToggle={togglePartitionTool}
                    />
                    <CompactDrawPicker
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
                    <InsertToolPicker
                      activeTool={activeTool}
                      disabled={viewMode === "elevation" && !selectedWall}
                      onToolChange={armOpeningTool}
                    />
                    <CompactInsertPicker
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
                onMoveRoomVertex={moveRoomVertex}
                onMoveRoomWall={moveRoomWall}
                onSplitWall={splitWall}
                onDeleteRoomVertex={deleteRoomVertex}
                partitionToolActive={partitionToolActive}
                onPartitionToolChange={setPartitionToolActive}
                onAddFreestandingWall={(start, end) =>
                  void addFreestandingWall(start, end)
                }
                selectedFreestandingWallId={selectedFreestandingWallId}
                onSelectFreestandingWall={selectFreestandingWall}
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
                project={project}
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
                onCommitWallLength={resizeWall}
                onMoveRoom={moveRoom}
                onPlaceArtwork={(artworkId, wallId, xMm, yMm) =>
                  void placeArtwork(artworkId, wallId, xMm, yMm, allowOverlappingPlacement)
                }
                onPlaceArtworkOnFloor={(artworkId, xMm, yMm) =>
                  void placeArtworkOnFloor(artworkId, xMm, yMm)
                }
                onPlaceOpeningFromPlan={placeOpeningFromPlan}
                onSelectArtwork={selectArtwork}
                onSelectOpening={selectOpening}
                onSelectRoom={selectRoom}
                onSelectWall={selectWall}
                onToolChange={armOpeningTool}
                selectedObjectIds={selectedObjectIds}
                onSelectObject={selectObject}
                onClearSelection={clearObjectSelection}
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
                  wallObjects={project.wallObjects}
                  walls={wallsForSwitcher}
                  onSelectWall={selectWall}
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
                  onSelectArtwork={selectArtwork}
                  onSelectOpening={selectOpening}
                  selectedObjectIds={selectedObjectIds}
                  onSelectObject={selectObject}
                  onClearSelection={clearObjectSelection}
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
          {viewMode === "data" ? (
            <Suspense fallback={<div className="skeleton-panel" />}>
              <DataView json={exportProjectJson(project)} />
            </Suspense>
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
                    ? selectedArtwork.title ?? "Untitled"
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
                <span>
                  {selectedArtwork
                    ? "Artwork"
                    : selectedOpening
                      ? "Opening"
                      : selectedFloorBlockedZone
                        ? "Floor object"
                        : selectedRoomPlacement
                          ? "Room"
                          : selectedFreestandingWall
                            ? "Partition"
                            : "Wall"}
                </span>
              </div>
            ) : null}

            {isMultiSelect ? (
              // A multi-selection replaces the whole single-subject chain —
              // the legacy inspector slots are already null (the store clears
              // them whenever more than one object is selected), so nothing
              // below could render meaningfully anyway.
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
                isPlaced={isArtworkPlaced}
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

          <div className="storage-note">
            <FloppyDiskIcon aria-hidden="true" size={16} />
            <span>{getStorageNoteCopy(storagePersistence)}</span>
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
          onImportDrafts={importArtworkDrafts}
          onImportImages={addArtworksFromFiles}
          onOpenChange={setImportWizardOpen}
        />
        <SettingsDialog
          open={isSettingsOpen}
          onOpenChange={setIsSettingsOpen}
          storageState={storagePersistence}
          onRetryStorage={retryStoragePersistence}
          resetPreferences={resetPreferences}
          onExport={() => project && downloadProject(project)}
          onImport={() => fileInputRef.current?.click()}
          onOpenHelp={() => { setIsSettingsOpen(false); setIsHelpOpen(true); }}
        />
      </Suspense>
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

// Shared descriptors for the insert tools, so the full segmented picker and
// the compact menu/trigger agree on every icon, label, resting hint, and
// keyboard accelerator. Icons are the two custom glyphs (window as a mullioned
// pane, partition as a solid wall bar) plus phosphor for the rest; the resting
// hint and the armed phrase feed the tooltips — unpressed reads "Insert a
// door — D", pressed reads "Placing a door — Esc cancels".
type InsertToolMeta = {
  key: string;
  label: string;
  hint: string;
  armed: string;
  kbd: string;
  icon: React.ReactNode;
};

const OPENING_TOOL_ORDER: OpeningKind[] = ["door", "window", "blocked-zone"];

const OPENING_TOOL_META: Record<OpeningKind, InsertToolMeta> = {
  door: {
    key: "door",
    label: "Door",
    hint: "Insert a door",
    armed: "Placing a door",
    kbd: "D",
    icon: <DoorIcon aria-hidden="true" size={16} />
  },
  window: {
    key: "window",
    label: "Window",
    hint: "Insert a window",
    armed: "Placing a window",
    kbd: "W",
    icon: <WindowGlyph aria-hidden="true" size={16} />
  },
  "blocked-zone": {
    key: "blocked-zone",
    label: "Blocked zone",
    hint: "Mark a blocked zone",
    armed: "Marking a blocked zone",
    kbd: "B",
    icon: <RectangleDashedIcon aria-hidden="true" size={16} />
  }
};

// The three Draw-cluster tools. Each armed phrase names its gesture verb (Drag…
// / Click…), so the deliberate per-tool gesture differences — drag corner to
// corner for the rectangle, click-to-place corners for the outline, drag for
// the partition — are self-documenting in the tooltip.
const RECT_ROOM_TOOL_META: InsertToolMeta = {
  key: "rect-room",
  label: "Rectangle room",
  hint: "Draw a rectangular room",
  armed: "Drag to draw a room",
  kbd: "R",
  icon: <RectangleRoomGlyph aria-hidden="true" size={16} />
};

const OUTLINE_ROOM_TOOL_META: InsertToolMeta = {
  key: "outline-room",
  label: "Room outline",
  hint: "Draw a room outline",
  armed: "Click to place corners",
  kbd: "⇧R",
  icon: <PolygonIcon aria-hidden="true" size={16} />
};

const PARTITION_TOOL_META: InsertToolMeta = {
  key: "partition",
  label: "Partition",
  hint: "Draw a free-standing partition",
  armed: "Drag to draw a partition",
  kbd: "P",
  icon: <PartitionGlyph aria-hidden="true" size={16} />
};

// The descriptor for whatever insert tool is armed, or null when idle — drives
// the compact trigger's icon/name swap and its armed tooltip.
function armedInsertMeta(activeTool: OpeningKind | null): InsertToolMeta | null {
  return activeTool ? OPENING_TOOL_META[activeTool] : null;
}

// The descriptor for whatever Draw tool is armed, or null when idle — the same
// role armedInsertMeta plays for the Insert cluster.
function armedDrawMeta(
  rectActive: boolean,
  outlineActive: boolean,
  partitionActive: boolean
): InsertToolMeta | null {
  if (rectActive) return RECT_ROOM_TOOL_META;
  if (outlineActive) return OUTLINE_ROOM_TOOL_META;
  if (partitionActive) return PARTITION_TOOL_META;
  return null;
}

// A segment as the generic cluster picker consumes it: a tool meta plus its
// live pressed state and click handler.
type ClusterSegment = InsertToolMeta & { pressed: boolean; onClick: () => void };
// A menu row for the compact cluster picker: a tool meta plus its live active
// state and select handler.
type ClusterTool = InsertToolMeta & { active: boolean; onSelect: () => void };

// The generic captioned segmented picker: a quiet caption followed by one
// joined soft group — a single surface fill holding a flush icon segment per
// tool, split by interior hairlines. Insert and Draw both render through
// this — the caption, the segment list, and the optional disabled context are
// all the callers supply. Toggle semantics match the old floating
// palette: the armed button reads pressed in petrol, clicking it again disarms,
// and the view's own Escape/click-to-place handling disarms via the caller's
// onClick. The caption is aria-hidden (the group's aria-label already carries
// it, so announcing the text too would double up); each button carries its own
// aria-label plus a styled Tooltip — with no visible per-tool text, the hover
// hint is the only sighted name these have, so it matters here.
function ToolClusterPicker({
  caption,
  segments,
  disabled = false,
  disabledReason
}: {
  caption: string;
  segments: ClusterSegment[];
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <div
      className="tool-cluster"
      role="group"
      aria-label={caption}
      aria-disabled={disabled || undefined}
    >
      <span className="tool-cluster-label" aria-hidden="true">
        {caption}
      </span>
      <div className="tool-cluster-segments">
        {segments.map((segment) => (
          // aria-disabled (not native disabled) keeps each segment focusable,
          // so keyboard/SR users still reach it and hear WHY it's off — the
          // reason rides the SAME styled Tooltip, firing on hover AND focus.
          // The click is a no-op while disabled; the fogged look ports to
          // [aria-disabled] in global.css. Pressed → the tooltip teaches the
          // exit ("Esc cancels"); resting → it echoes the accelerator ("— D").
          <Tooltip key={segment.key}>
            <TooltipTrigger asChild>
              <button
                aria-label={segment.label}
                aria-pressed={segment.pressed}
                aria-disabled={disabled || undefined}
                className="tool-cluster-segment"
                type="button"
                onClick={disabled ? undefined : segment.onClick}
              >
                {segment.icon}
              </button>
            </TooltipTrigger>
            <TooltipContent className="toolbar-tooltip" side="bottom">
              {disabled ? (
                disabledReason
              ) : segment.pressed ? (
                <>
                  {segment.armed}
                  <ToolbarTooltipKbd hint="Esc cancels" />
                </>
              ) : (
                <>
                  {segment.hint}
                  <ToolbarTooltipKbd hint={segment.kbd} />
                </>
              )}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

// The view-toolbar's Insert cluster: door/window/blocked-zone, identical
// membership in both 2D views (Insert decorates existing geometry; Draw creates
// new structure, so the partition tool now lives in the Draw cluster). A thin
// call site over ToolClusterPicker — planMode's discriminated union keeps every
// armed tool mutually exclusive.
function InsertToolPicker({
  activeTool,
  disabled,
  disabledReason = "Select a wall to place an opening",
  onToolChange
}: {
  activeTool: OpeningKind | null;
  disabled: boolean;
  disabledReason?: string;
  onToolChange: (tool: OpeningKind | null) => void;
}) {
  const segments: ClusterSegment[] = OPENING_TOOL_ORDER.map((kind) => ({
    ...OPENING_TOOL_META[kind],
    pressed: activeTool === kind,
    onClick: () => onToolChange(activeTool === kind ? null : kind)
  }));

  return (
    <ToolClusterPicker
      caption="Insert"
      segments={segments}
      disabled={disabled}
      disabledReason={disabledReason}
    />
  );
}

// The view-toolbar's Draw cluster: rectangle room, room outline, partition —
// the three tools that create new structure. Plan-only, never disabled. A thin
// call site over ToolClusterPicker.
function DrawToolPicker({
  rectActive,
  onRectToggle,
  outlineActive,
  onOutlineToggle,
  partitionActive,
  onPartitionToggle
}: {
  rectActive: boolean;
  onRectToggle: () => void;
  outlineActive: boolean;
  onOutlineToggle: () => void;
  partitionActive: boolean;
  onPartitionToggle: () => void;
}) {
  const segments: ClusterSegment[] = [
    { ...RECT_ROOM_TOOL_META, pressed: rectActive, onClick: onRectToggle },
    { ...OUTLINE_ROOM_TOOL_META, pressed: outlineActive, onClick: onOutlineToggle },
    { ...PARTITION_TOOL_META, pressed: partitionActive, onClick: onPartitionToggle }
  ];

  return <ToolClusterPicker caption="Draw" segments={segments} />;
}

// The generic compact replacement for a segmented cluster. It is shown by the
// canvas container query below the narrow breakpoint, so the desktop control
// can keep its direct-manipulation affordance without making the narrow
// toolbar carry a row of adjacent icon buttons. When a tool is armed the
// trigger stands in for it — the tool's glyph replaces the idle icon and its
// name replaces the caption — so identity survives the compact/tight tiers (at
// tight, the icon-only trigger, the swapped glyph alone carries it). Insert and
// Draw both render through this; the caller supplies the caption, the idle
// icon/tooltip, the menu rows, and which tool (if any) is armed.
function CompactClusterPicker({
  caption,
  idleIcon,
  idleTooltip,
  tools,
  armed,
  disabled = false,
  disabledReason
}: {
  caption: string;
  idleIcon: React.ReactNode;
  idleTooltip: string;
  tools: ClusterTool[];
  armed: InsertToolMeta | null;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const triggerButton = (
    <Button
      // Names both the control and the armed mode, so the swapped-in glyph is
      // never the only cue for SR users.
      aria-label={armed ? `${caption} — ${armed.label} armed` : caption}
      aria-disabled={disabled || undefined}
      className="compact-cluster-trigger"
      data-active={armed ? "true" : "false"}
      variant="outline"
    >
      {armed ? armed.icon : idleIcon}
      <span className="compact-cluster-label">{armed ? armed.label : caption}</span>
      <CaretDownIcon aria-hidden="true" className="compact-cluster-caret" size={14} />
    </Button>
  );

  // Disabled: render no menu at all (so the dropdown can never open), just the
  // fogged aria-disabled trigger under the styled reason Tooltip — reachable
  // on hover AND focus, replacing the old pointer-only wrapper-span/title hack.
  if (disabled) {
    return (
      <span className="compact-cluster-tools">
        <Tooltip>
          <TooltipTrigger asChild>{triggerButton}</TooltipTrigger>
          <TooltipContent className="toolbar-tooltip" side="bottom">
            {disabledReason}
          </TooltipContent>
        </Tooltip>
      </span>
    );
  }

  return (
    <span className="compact-cluster-tools">
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent className="toolbar-tooltip" side="bottom">
            {armed ? (
              <>
                {armed.armed}
                <ToolbarTooltipKbd hint="Esc cancels" />
              </>
            ) : (
              idleTooltip
            )}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="compact-cluster-menu">
          {tools.map((tool) => (
            <DropdownMenuItem
              key={tool.key}
              aria-checked={tool.active}
              className="compact-cluster-item"
              data-active={tool.active ? "true" : "false"}
              role="menuitemradio"
              onSelect={tool.onSelect}
            >
              {tool.icon}
              <span>{tool.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

// The compact Insert cluster: opening tools. A thin call site over
// CompactClusterPicker with a Plus idle trigger.
function CompactInsertPicker({
  activeTool,
  disabled,
  disabledReason = "Select a wall to place an opening",
  onToolChange
}: {
  activeTool: OpeningKind | null;
  disabled: boolean;
  disabledReason?: string;
  onToolChange: (tool: OpeningKind | null) => void;
}) {
  const tools: ClusterTool[] = OPENING_TOOL_ORDER.map((kind) => ({
    ...OPENING_TOOL_META[kind],
    active: activeTool === kind,
    onSelect: () => onToolChange(activeTool === kind ? null : kind)
  }));

  return (
    <CompactClusterPicker
      caption="Insert"
      idleIcon={<PlusIcon aria-hidden="true" size={16} />}
      idleTooltip="Insert an opening"
      tools={tools}
      armed={armedInsertMeta(activeTool)}
      disabled={disabled}
      disabledReason={disabledReason}
    />
  );
}

// The compact Draw cluster: rectangle room, room outline, partition. A thin
// call site over CompactClusterPicker with a PencilSimple idle trigger.
function CompactDrawPicker({
  rectActive,
  onRectToggle,
  outlineActive,
  onOutlineToggle,
  partitionActive,
  onPartitionToggle
}: {
  rectActive: boolean;
  onRectToggle: () => void;
  outlineActive: boolean;
  onOutlineToggle: () => void;
  partitionActive: boolean;
  onPartitionToggle: () => void;
}) {
  const tools: ClusterTool[] = [
    { ...RECT_ROOM_TOOL_META, active: rectActive, onSelect: onRectToggle },
    { ...OUTLINE_ROOM_TOOL_META, active: outlineActive, onSelect: onOutlineToggle },
    { ...PARTITION_TOOL_META, active: partitionActive, onSelect: onPartitionToggle }
  ];

  return (
    <CompactClusterPicker
      caption="Draw"
      idleIcon={<PencilSimpleIcon aria-hidden="true" size={16} />}
      idleTooltip="Draw a room or partition"
      tools={tools}
      armed={armedDrawMeta(rectActive, outlineActive, partitionActive)}
    />
  );
}

function ViewOptionButton({
  active,
  disabled,
  icon,
  label,
  labelPriority = false,
  title,
  kbd,
  onClick
}: {
  active: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  // Keeps this label through the trimmed density tier (see global.css). Used
  // for Overlap, whose glyph reads weakest of the view toggles.
  labelPriority?: boolean;
  title: string;
  // The single-key accelerator (useToolbarShortcuts), echoed as a dimmed
  // suffix in the tooltip so the hint teaches the key.
  kbd?: string;
  onClick: () => void;
}) {
  const toggle = (
    <Toggle
      // Kept the same string as the visible label below: on a narrow canvas
      // column the container query in global.css hides .view-option-label
      // and the button goes icon-only, so the accessible name must not
      // depend on the span's visibility (and must never diverge from it).
      aria-label={label}
      className="view-option-button"
      disabled={disabled}
      pressed={active}
      variant="default"
      onPressedChange={onClick}
    >
      {icon}
      <span
        className={
          labelPriority ? "view-option-label view-option-label-priority" : "view-option-label"
        }
      >
        {label}
      </span>
    </Toggle>
  );

  // toggleVariants applies `disabled:pointer-events-none`, so a disabled
  // Toggle never receives the hover that would open a Radix tooltip. A
  // wrapping span keeps receiving pointer events, so the disabled-state
  // title stays reachable on hover instead of silently going dark.
  if (disabled) return <span title={title}>{toggle}</span>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{toggle}</TooltipTrigger>
      <TooltipContent className="toolbar-tooltip" side="bottom">
        {title}
        {kbd ? <ToolbarTooltipKbd hint={kbd} /> : null}
      </TooltipContent>
    </Tooltip>
  );
}

// The dimmed, tabular key hint that trails a toolbar tooltip's phrase — e.g.
// "Show grid — G" or "Placing a door — Esc cancels". A quiet suffix span, not
// a heavy kbd chip; the "— " separator lives in CSS so callers pass only the
// hint text.
function ToolbarTooltipKbd({ hint }: { hint: string }) {
  return <span className="toolbar-tooltip-kbd">{hint}</span>;
}

function ThreeDCameraTools({
  actionsRef,
  canFocus
}: {
  actionsRef: { current: ThreeDViewActions | null };
  canFocus: boolean;
}) {
  const focusButton = (
    <Button
      className="view-option-button"
      disabled={!canFocus}
      variant="inspector"
      onClick={() => actionsRef.current?.focusSelection()}
    >
      <CrosshairIcon aria-hidden="true" size={16} />
      <span className="view-option-label">Focus selection</span>
    </Button>
  );

  return (
    <div className="three-camera-tools" role="group" aria-label="3D camera">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className="view-option-button"
            variant="inspector"
            onClick={() => actionsRef.current?.overview()}
          >
            <CornersOutIcon aria-hidden="true" size={16} />
            <span className="view-option-label">Overview</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent className="toolbar-tooltip" side="bottom">
          Frame the whole layout
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className="view-option-button"
            variant="inspector"
            onClick={() => actionsRef.current?.eyeLevel()}
          >
            <EyeIcon aria-hidden="true" size={16} />
            <span className="view-option-label">Eye level</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent className="toolbar-tooltip" side="bottom">
          View the selected wall at eye level
        </TooltipContent>
      </Tooltip>
      {canFocus ? (
        <Tooltip>
          <TooltipTrigger asChild>{focusButton}</TooltipTrigger>
          <TooltipContent className="toolbar-tooltip" side="bottom">
            Focus the selected room, wall, or artwork
          </TooltipContent>
        </Tooltip>
      ) : (
        // Disabled buttons drop pointer events, so the hint rides a span.
        <span title="Focus the selected room, wall, or artwork">{focusButton}</span>
      )}
    </div>
  );
}

function UnitSystemToggle({
  disabled,
  labels = { imperial: "ft", metric: "m" },
  system,
  onChange
}: {
  disabled: boolean;
  labels?: {
    imperial: string;
    metric: string;
  };
  system: UnitSystem;
  onChange: (system: UnitSystem) => void;
}) {
  // Re-clicking the already-active side is a no-op: it must never fire
  // onChange, or a legacy project stored as "in"/"cm" would get rewritten to
  // "ft"/"m" and land a redundant entry on the undo stack.
  const select = (next: UnitSystem) => {
    if (next === system) return;
    onChange(next);
  };

  // A traditional slide switch with the two unit systems as flanking words —
  // one small track, no label-inside-track nesting. The words are pointer
  // shortcuts to a specific side (routed through select(), so clicking the
  // already-active side stays inert); the switch itself is the single
  // accessible control, so the words stay out of the tab order and the
  // accessibility tree rather than announcing as three separate controls.
  return (
    <div
      className="unit-switch"
      data-system={system}
      role="group"
      aria-label={`Units: ${labels.imperial} / ${labels.metric}`}
    >
      <button
        aria-hidden="true"
        className="unit-switch-side"
        data-active={system === "imperial"}
        disabled={disabled}
        tabIndex={-1}
        type="button"
        onClick={() => select("imperial")}
      >
        {labels.imperial}
      </button>
      <Switch
        aria-labelledby="unit-system-label unit-system-value"
        checked={system === "metric"}
        className="unit-switch-control"
        disabled={disabled}
        onCheckedChange={(checked) => select(checked ? "metric" : "imperial")}
      >
        <span className="visually-hidden" id="unit-system-label">
          Units
        </span>
        <span className="visually-hidden" id="unit-system-value">
          {system === "metric" ? `Metric (${labels.metric})` : `Imperial (${labels.imperial})`}
        </span>
      </Switch>
      <button
        aria-hidden="true"
        className="unit-switch-side"
        data-active={system === "metric"}
        disabled={disabled}
        tabIndex={-1}
        type="button"
        onClick={() => select("metric")}
      >
        {labels.metric}
      </button>
    </div>
  );
}

function PrecisionSelect({
  disabled,
  floorMm,
  unit,
  onChange
}: {
  disabled: boolean;
  floorMm: number | null;
  unit: DisplayUnit;
  onChange: (floorMm: number | null) => void;
}) {
  // Options are a curated subset of the active unit family's own grid
  // interval table (domain/units/precision.ts), so a floor picked here is
  // guaranteed to line up with an actual grid step rather than an arbitrary
  // value. Always formatted with the family's "natural" unit (feet-and-
  // inches for imperial, cm for metric) regardless of the project's current
  // display unit, since the stored value is mm and clamps to the nearest
  // table entry if the project unit later changes.
  const labelUnit: DisplayUnit = unit === "in" ? "in" : unit === "ft" ? "ft" : "cm";
  const options = getGridPrecisionFloorOptionsMm(unit);

  return (
    <div className="unit-select">
      <span className="unit-select-label view-option-label-priority">Precision</span>
      <Select
        disabled={disabled}
        value={floorMm === null ? "auto" : String(floorMm)}
        onValueChange={(value) =>
          onChange(value === "auto" ? null : Number(value))
        }
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <SelectTrigger className="precision-select-trigger" aria-label="Grid precision">
              <SelectValue />
            </SelectTrigger>
          </TooltipTrigger>
          <TooltipContent className="toolbar-tooltip" side="bottom">
            Grid precision
          </TooltipContent>
        </Tooltip>
        <SelectContent>
          <SelectItem value="auto">Auto</SelectItem>
        {options.map((optionMm) => (
          <SelectItem key={optionMm} value={String(optionMm)}>
            {formatLength(optionMm, { unit: labelUnit })}
          </SelectItem>
        ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function StatusBadge({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  const label =
    state === "saving"
      ? "Saving"
      : state === "saved"
        ? "Saved"
        : state === "error"
          ? "Save issue"
          : "Idle";

  return (
    <span className={`status-badge ${state}`}>
      <span className="status-dot" aria-hidden="true" />
      <span className="status-badge-label">{label}</span>
    </span>
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

function downloadProject(project: Project) {
  const blob = new Blob([exportProjectJson(project)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
