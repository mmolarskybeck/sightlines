import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { type Vector2 } from "../../../domain/geometry/dragResize";
import { applyPlanPreview, type PlanPreview } from "../../../domain/geometry/planPreview";
import { getFloorBounds } from "../../../domain/geometry/walls";
import {
  getFloorWalls,
  getWallObjectPlanRect,
  WALL_OBJECT_PLAN_DEPTH_MM,
  type PlanRect
} from "../../../domain/geometry/planObjects";
import {
  buildPlanScene,
  getPlanSceneObjectIdsIntersectingRect,
  svgPolygonPoints
} from "../../../domain/scene2d/planScene";
import { withArtworkFootprintFromMap } from "../../../domain/framing";
import { type InsertToolKind } from "../../../domain/placement/createOpening";
import { getDefaultInsertToolSizeMm } from "../../../domain/placement/createWallText";
import {
  DEFAULT_FLOOR_CASE_DEPTH_MM,
  DEFAULT_FLOOR_OBJECT_DEPTH_MM,
  DEFAULT_WALL_CASE_DEPTH_MM,
  DEFAULT_WALL_CASE_HEIGHT_MM,
  DEFAULT_WALL_CASE_WIDTH_MM,
  type Artwork,
  type ReferenceMeasurement
} from "../../../domain/project";
import {
  parseFaceWallId,
  roomIdContainingPoint
} from "../../../domain/geometry/freestandingWalls";
import { computePartitionChainsFloor } from "../../../domain/geometry/partitionChains";
import { isPointInPolygon, type Point } from "../../../domain/geometry/polygon";
import { getGridSnapTargets } from "../../../domain/snapping/gridSnapTargets";
import { partitionAxisForWorldAxis } from "../../../domain/geometry/partitionSpacing";
import {
  resolvePlanPlacement,
  WALL_CAPTURE_PX,
  type FloatPolicy,
  type PlanPlacement,
  type ResolvedPlacement
} from "../../../domain/snapping/planSnapTargets";
import {
  resolvePlanObjectNudge,
  type PlanGroupMember
} from "../../../domain/snapping/planGroupMove";
import { resolveSnap, type Guide, type SnapTarget, type SnapTargetIds } from "../../../domain/snapping/resolveSnap";
import { buildPlanMeasureSources } from "../../../domain/measurement/planMeasurementGeometry";
import {
  getMajorGridIntervalMm,
  getMinorGridIntervalMm
} from "../../../domain/units/precision";
import {
  FIT_VIEWPORT,
  getEffectiveZoom,
  getViewBox2D,
  PLAN_ZOOM_LIMITS,
  ZOOM_STEP,
  type Viewport2D
} from "../../../domain/viewport/viewport2d";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../../domain/units/unitSystem";
import { isEditableTarget } from "../../hooks/isEditableTarget";
import { useAssetImageUrls } from "../../hooks/useAssetImageUrls";
import { useContainerSize } from "../../hooks/useContainerSize";
import { useDisarmOnEscape } from "../../hooks/useDisarmOnEscape";
import { useDragGesture } from "../../hooks/useDragGesture";
import { useSelectSuppression } from "../../hooks/useSelectSuppression";
import { useSvgViewportGestures } from "../../hooks/useSvgViewportGestures";
import { useAppStore } from "../../store";
import { GridOverlay } from "../shared/GridOverlay";
import { marqueeRectMm, type MarqueeState } from "../shared/marqueeRect";
import { ViewportZoomControls } from "../shared/ViewportZoomControls";
import { MeasurementOverlay } from "../measurement/MeasurementOverlay";
import {
  type MeasurementToolAction,
  type MeasurementToolState
} from "../../hooks/useMeasurementTool";
import {
  getPlanMeasurementNudgeDelta,
  shouldCancelMeasurementForViewportClaim
} from "../../hooks/planMeasurementPolicy";
import { usePlanMeasurementGesture } from "../../hooks/usePlanMeasurementGesture";
import { usePlanArtworkDrop } from "../../hooks/usePlanArtworkDrop";
import { usePlanDrawRoomTool } from "../../hooks/usePlanDrawRoomTool";
import { usePlanObjectMove } from "../../hooks/usePlanObjectMove";
import { usePlanRoomEditing } from "../../hooks/usePlanRoomEditing";
import { getPartitionMovedAxes, usePlanPartitionTool } from "../../hooks/usePlanPartitionTool";
import { PlanStructureLayer } from "./PlanStructureLayer";
import { PlacedObjectsLayer } from "./PlacedObjectsLayer";
import { PlanHandlesLayer } from "./PlanHandlesLayer";
import { PlanOverlaysLayer } from "./PlanOverlaysLayer";
import { PartitionDimensionLines } from "./PartitionDimensionLines";
import { PlanGapDimensionLines } from "./PlanGapDimensionLines";
import {
  computePlanGapLines,
  type PlanGapLine
} from "../../../domain/dimensions/planDimensions";
import type { ToolGhostState } from "./types";

// Selected-room resize handle size in screen pixels.
const SELECTED_HANDLE_PX = 10;
const SNAP_THRESHOLD_PX = 10;
// Keep thin wall objects visible when zoomed out.
const MIN_WALL_OBJECT_DEPTH_PX = 9;
// Minimum invisible hit target for plan objects.
const MIN_OBJECT_HIT_PX = 20;
// Prevent fit-view from over-zooming sparse plans (~30 ft minimum extent).
const MIN_PLAN_FIT_EXTENT_MM = 9144;

// Stable fallback avoids retriggering useAssetImageUrls.
const NO_OP_GET_BLOB: (key: string) => Promise<Blob> = () =>
  Promise.reject(new Error("PlanView: no getBlob provided"));

const EMPTY_REFERENCE_MEASUREMENTS: ReferenceMeasurement[] = [];

export function PlanView({
  activeTool,
  drawRoomActive = false,
  onDrawRoomChange,
  onAddPolygonRoom,
  reshapeRoomId = null,
  onReshapeRoomChange,
  drawRectActive = false,
  onDrawRectChange,
  onAddRectangleRoom,
  partitionToolActive = false,
  onPartitionToolChange,
  onAddFreestandingWall,
  duplicatePartitionSourceWallId = null,
  onDuplicatePartitionChange,
  onDuplicateFreestandingWall,
  selectedFreestandingWallId = null,
  onMoveFreestandingWall,
  onMoveFreestandingWallEndpoint,
  artworksById,
  draggingArtworkId = null,
  getBlob,
  gridPrecisionFloorMm,
  gridVisible,
  onCommitPlanMove,
  onCommitPlanMoveGroup,
  onPlaceArtwork,
  onPlaceArtworkOnFloor,
  onMarqueeSelect,
  onToolChange,
  selectedArtworkId,
  selectedOpeningId,
  selectedObjectIds = [],
  selectedRoomId = null,
  selectedWallId,
  snapToGrid,
  viewport,
  onViewportChange,
  measurementActive = false,
  measurementState,
  onMeasurementAction,
  exportMode = false,
  onSvgElementChange
}: {
  // Controlled door/window/blocked-zone insertion tool.
  activeTool: InsertToolKind | null;
  // App owns the mode; transient polygon points and snapping stay local.
  drawRoomActive?: boolean;
  onDrawRoomChange?: (active: boolean) => void;
  onAddPolygonRoom?: (pointsFloorMm: Point[]) => void;
  // Room whose reshape handles are active.
  reshapeRoomId?: string | null;
  onReshapeRoomChange?: (roomId: string | null) => void;
  // Controlled rectangle-room mode; local drag state disarms after commit/cancel.
  drawRectActive?: boolean;
  onDrawRectChange?: (active: boolean) => void;
  // Rectangle origin is its minimum corner; dimensions are absolute.
  onAddRectangleRoom?: (rect: {
    offsetXMm: number;
    offsetYMm: number;
    widthMm: number;
    depthMm: number;
  }) => void;
  // Controlled partition drawing; existing partitions remain editable when disarmed.
  partitionToolActive?: boolean;
  onPartitionToolChange?: (active: boolean) => void;
  onAddFreestandingWall?: (startFloorMm: Point, endFloorMm: Point) => void;
  duplicatePartitionSourceWallId?: string | null;
  onDuplicatePartitionChange?: (active: boolean) => void;
  onDuplicateFreestandingWall?: (wallId: string, centerFloorMm: Point) => void;
  selectedFreestandingWallId?: string | null;
  onMoveFreestandingWall?: (wallId: string, deltaFloorMm: Point) => void;
  onMoveFreestandingWallEndpoint?: (
    wallId: string,
    end: "start" | "end",
    nextFloorMm: Point
  ) => void;
  artworksById?: Map<string, Artwork>;
  // Needed because HTML5 dragover cannot read the artwork payload.
  draggingArtworkId?: string | null;
  getBlob?: (key: string) => Promise<Blob>;
  gridPrecisionFloorMm: number | null;
  gridVisible: boolean;
  // Atomically handles same-wall moves, re-anchoring, and wall/floor conversion.
  onCommitPlanMove?: (objectId: string, placement: PlanPlacement) => void;
  // Wall moves omit yMm; floor moves include their new center. A wallId marks a
  // wall member re-anchored onto a different wall (artwork dragged onto another
  // wall); absent, the member stays on its own wall.
  onCommitPlanMoveGroup?: (
    moves: { id: string; xMm: number; yMm?: number; wallId?: string }[]
  ) => void;
  onPlaceArtwork?: (artworkId: string, wallId: string, xMm: number, yMm: number) => void;
  onPlaceArtworkOnFloor?: (artworkId: string, xMm: number, yMm: number) => void;
  // IDs are placements, never artwork-library records.
  onMarqueeSelect?: (ids: string[], additive: boolean) => void;
  onToolChange: (tool: InsertToolKind | null) => void;
  selectedArtworkId?: string | null;
  selectedOpeningId?: string | null;
  selectedObjectIds?: string[];
  selectedRoomId?: string | null;
  selectedWallId: string | null;
  snapToGrid: boolean;
  viewport: Viewport2D;
  onViewportChange: (v: Viewport2D) => void;
  measurementActive?: boolean;
  measurementState?: MeasurementToolState;
  onMeasurementAction?: Dispatch<MeasurementToolAction>;
  // Snapshot rendering mode (docs/export-spec.md §10.2): suppresses hover/
  // selection chrome, ghosts, snap guides, marquee, opening-connection
  // glyphs, and temporary/reference measurements, while keeping structure,
  // placed objects, and dimension lines (partition clearances, wall length
  // labels) exactly as displayed. Strictly additive — default false changes
  // nothing.
  exportMode?: boolean;
  onSvgElementChange?: (element: SVGSVGElement | null) => void;
}) {
  const [containerRef, containerSize] = useContainerSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    onSvgElementChange?.(svgRef.current);
  }, [onSvgElementChange]);
  // Store-owned actions are read here; App-owned compositions remain props.
  const project = useAppStore((state) => state.project)!;
  const onMoveRoomVertex = useAppStore((state) => state.moveRoomVertex);
  const onMoveRoomWall = useAppStore((state) => state.moveRoomWall);
  const onSplitWall = useAppStore((state) => state.splitWall);
  const onDeleteRoomVertex = useAppStore((state) => state.deleteRoomVertex);
  const onSelectFreestandingWall = useAppStore((state) => state.selectFreestandingWall);
  const onCommitWallLength = useAppStore((state) => state.resizeWall);
  const onMoveRoom = useAppStore((state) => state.moveRoom);
  const onPlaceOpeningFromPlan = useAppStore((state) => state.placeOpeningFromPlan);
  const onPlaceCaseFromPlan = useAppStore((state) => state.placeCaseFromPlan);
  const onSelectArtwork = useAppStore((state) => state.selectArtwork);
  const onSelectOpening = useAppStore((state) => state.selectOpening);
  const onSelectRoom = useAppStore((state) => state.selectRoom);
  const onSelectWall = useAppStore((state) => state.selectWall);
  const onSelectObject = useAppStore((state) => state.selectObject);
  const selection = useAppStore((state) => state.selection);
  const referenceMeasurements = useAppStore(
    (state) => state.project?.referenceMeasurements ?? EMPTY_REFERENCE_MEASUREMENTS
  );
  const onSelectMeasurement = useAppStore((state) => state.selectMeasurement);
  const onUpdateReferenceMeasurement = useAppStore((state) => state.updateReferenceMeasurement);
  const onClearSelection = useAppStore((state) => state.clearObjectSelection);
  // The room/structure editing controller: the wall-resize / whole-room /
  // reshape-vertex / wall-slide pointer drags, the rectangle-room create drag,
  // the wall-split click, and the selected-vertex + hovered-wall state these
  // gestures own. Created here (not below its dependencies) so its live drag
  // states are available where planInteractionActive is assembled; the deps
  // thunk defers reading PlanView locals (toSvgMm, the snapping geometry,
  // snapDrawPoint, the commit callbacks, …) until event time, exactly as the raw
  // useDragGesture configs used to close over them.
  const roomEditing = usePlanRoomEditing({
    reshapeRoomId,
    getDeps: () => ({
      toSvgMm,
      project,
      floorWallsForTool,
      gridSnapTargets,
      snapToGrid,
      snapThresholdMm,
      snapDrawPoint,
      suppressNextToolClickRef,
      drawRectActive,
      onCommitWallLength,
      onMoveRoom,
      onMoveRoomVertex,
      onMoveRoomWall,
      onSplitWall,
      onDrawRectChange,
      onAddRectangleRoom
    })
  });
  // The object-movement controller: the pointer drag of an existing placed
  // object (single or whole multi-selection), plus beginObjectDrag and its
  // float-policy resolver. Created here (not below its dependencies) so
  // objectMove.active is available where planInteractionActive is assembled;
  // the deps thunk defers reading PlanView locals (toSvgMm, the snapping
  // geometry, the commit callbacks, …) until event time, exactly as the raw
  // useDragGesture config used to close over them.
  const objectMove = usePlanObjectMove(() => ({
    toSvgMm,
    project,
    floorWallsForTool,
    snappingWallObjects,
    floorObjectRoomIds,
    captureDistanceMm,
    gridSnapTargets,
    snapToGrid,
    snapThresholdMm,
    selectedObjectIds,
    artworkFormFor,
    suppressNextSelect,
    onCommitPlanMove,
    onCommitPlanMoveGroup
  }));
  // Rubber-band selection on the plan background.
  const {
    drag: marquee,
    dragRef: marqueeRef,
    beginDrag: startMarquee
  } = useDragGesture<MarqueeState>({
    onMove: (current, event) => {
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;
      return { ...current, currentMm: pointerMm };
    },
    onRelease: (current, event) => {
      const rect = marqueeRectMm(current);
      // The trailing SVG click handles sub-threshold background clicks.
      const draggedMm = Math.hypot(rect.maxXMm - rect.minXMm, rect.maxYMm - rect.minYMm);
      if (draggedMm < snapThresholdMm) return;

      // Suppress the trailing SVG click or it would clear the new selection.
      suppressNextToolClickRef.current = true;
      window.setTimeout(() => {
        suppressNextToolClickRef.current = false;
      }, 0);
      onMarqueeSelect?.(idsIntersectingMarquee(rect), event.shiftKey);
    }
  });

  // Plan tooltips use thumbnail-tier images.
  const placedArtworkAssetIds = [
    ...project.wallObjects.map((object) =>
      object.kind === "artwork" ? artworksById?.get(object.artworkId)?.assetId : undefined
    ),
    ...project.floorObjects.map((object) =>
      object.kind === "artwork" ? artworksById?.get(object.artworkId)?.assetId : undefined
    )
  ];
  const thumbnailUrlsByAssetId = useAssetImageUrls(
    placedArtworkAssetIds,
    getBlob ?? NO_OP_GET_BLOB
  );
  const [toolGhost, setToolGhost] = useState<ToolGhostState | null>(null);
  const toolSnapTargetIdsRef = useRef<SnapTargetIds | undefined>(undefined);
  // Prevent a gesture's trailing native click from placing another object.
  const suppressNextToolClickRef = useRef(false);

  // The partition (free-standing wall) workflow controller: the armed-tool draw
  // gesture, the edit drag (whole-body + endpoint), and the duplicate-ghost
  // placement cycle, plus the pieces that arm each. Created here (not below its
  // dependencies) so partition.active is available where planInteractionActive
  // is assembled; the deps thunk defers reading PlanView locals (toSvgMm, the
  // snapping geometry, the commit callbacks, …) until event time, and
  // snapDrawPoint is threaded in because the rectangle/polygon draws share it.
  const partition = usePlanPartitionTool({
    duplicatePartitionSourceWallId,
    onDuplicatePartitionChange,
    getDeps: () => ({
      toSvgMm,
      project,
      floorWallsForTool,
      gridSnapTargets,
      snapToGrid,
      snapThresholdMm,
      minorGridMm,
      handleSizeMm,
      suppressNextToolClickRef,
      snapDrawPoint,
      partitionToolActive,
      onPartitionToolChange,
      onAddFreestandingWall,
      onMoveFreestandingWall,
      onMoveFreestandingWallEndpoint,
      onDuplicateFreestandingWall,
      onSelectFreestandingWall
    })
  });
  const bounds = getFloorBounds(project.floor);
  const padding = getPlanViewPaddingMm(bounds);
  // All px/mm thresholds derive from the current zoomed viewBox.
  const contentBounds = clampFitExtent(bounds, padding);
  const { viewBox: viewBoxBounds, pixelsPerMm } = getViewBox2D(
    viewport,
    contentBounds,
    containerSize
  );
  const viewBox = `${viewBoxBounds.x} ${viewBoxBounds.y} ${viewBoxBounds.width} ${viewBoxBounds.height}`;
  const minorGridMm = getMinorGridIntervalMm(project.unit, pixelsPerMm, {
    // Keep whole-floor grids coarser than the shared default.
    targetMinorPx: 12,
    minIntervalMm: gridPrecisionFloorMm
  });
  const majorGridMm = getMajorGridIntervalMm(project.unit, minorGridMm);
  // Resize labels use the wall scope's unit.
  const wallUnit = getScopeUnits(
    unitSystemFromDisplayUnit(project.unit),
    "wall"
  ).displayUnit;
  const handleSizeMm = pixelsPerMm > 0 ? SELECTED_HANDLE_PX / pixelsPerMm : 0;
  const snapThresholdMm = pixelsPerMm > 0 ? SNAP_THRESHOLD_PX / pixelsPerMm : 0;
  const gridSnapTargets = getGridSnapTargets(minorGridMm, {
    minXMm: viewBoxBounds.x,
    maxXMm: viewBoxBounds.x + viewBoxBounds.width,
    minYMm: viewBoxBounds.y,
    maxYMm: viewBoxBounds.y + viewBoxBounds.height
  });

  // Single source of truth for "is any plan gesture or tool armed right now."
  // New drag states and tool modes must be added HERE (and nowhere else) —
  // every consumer below derives from this one predicate, so a mode that
  // forgets to register itself fails closed (blocks the nudge) instead of
  // silently letting arrow keys steal focus from an in-flight interaction.
  // A gesture lifted into a controller hook (e.g. usePlanObjectMove) keeps this
  // contract by exposing a boolean `active` and OR-ing it in below: the hook
  // owns its live drag states, but registration stays centralized right here.
  const planInteractionActive = Boolean(
    roomEditing.drag ||
      objectMove.active ||
      roomEditing.roomDrag ||
      roomEditing.vertexDrag ||
      roomEditing.wallDrag ||
      partition.active ||
      roomEditing.rectDraw ||
      duplicatePartitionSourceWallId ||
      activeTool ||
      drawRoomActive ||
      drawRectActive ||
      partitionToolActive ||
      reshapeRoomId ||
      measurementActive
  );

  // A selected partition is keyboard-placeable just like a selected measurement
  // endpoint. Keyboard motion intentionally bypasses snap resolution so every
  // press has a predictable delta and creates one normal partition edit.
  useEffect(() => {
    if (!selectedFreestandingWallId || planInteractionActive) {
      return;
    }
    const wallId = selectedFreestandingWallId;

    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if (
        event.target instanceof Element &&
        event.target.closest("[data-owns-arrow-keys]") !== null
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey) return;
      const delta = getPlanMeasurementNudgeDelta(
        event.key,
        project.unit,
        gridPrecisionFloorMm,
        event.shiftKey,
        snapToGrid,
        event.altKey
      );
      if (!delta) return;
      event.preventDefault();
      onMoveFreestandingWall?.(wallId, delta);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    gridPrecisionFloorMm,
    onMoveFreestandingWall,
    planInteractionActive,
    project.unit,
    selectedFreestandingWallId,
    snapToGrid
  ]);

  // The project to render during a drag — one PlanPreview layer per live
  // gesture (wall resize, room move, reshape-mode vertex drag, reshape-mode
  // wall slide), composed by the domain layer in the same order this view
  // used to hand-splice them. See planPreview.ts for the fallback/validity
  // semantics of each layer. useMemo (keyed on the committed project plus
  // every drag state, all of which are null/reference-stable when their
  // gesture isn't live) preserves the pre-refactor guarantee that rendering
  // with nothing in flight yields the exact `project` reference, not a copy.
  const displayedProject = useMemo(() => {
    const preview: PlanPreview = {
      wallResize: roomEditing.drag
        ? {
            wallId: roomEditing.drag.targetWallId,
            lengthMm: roomEditing.drag.previewLengthMm,
            anchor: roomEditing.drag.anchor
          }
        : undefined,
      roomMove: roomEditing.roomDrag
        ? {
            roomId: roomEditing.roomDrag.roomId,
            offsetXMm: roomEditing.roomDrag.previewOffsetMm.xMm,
            offsetYMm: roomEditing.roomDrag.previewOffsetMm.yMm
          }
        : undefined,
      vertexMove: roomEditing.vertexDrag
        ? {
            roomId: roomEditing.vertexDrag.roomId,
            vertexId: roomEditing.vertexDrag.vertexId,
            xMm: roomEditing.vertexDrag.previewLocalMm.xMm,
            yMm: roomEditing.vertexDrag.previewLocalMm.yMm
          }
        : undefined,
      wallSlide: roomEditing.wallDrag
        ? {
            roomId: roomEditing.wallDrag.roomId,
            wallId: roomEditing.wallDrag.wallId,
            offsetMm: roomEditing.wallDrag.previewOffsetMm
          }
        : undefined
    };
    return applyPlanPreview(project, preview);
  }, [project, roomEditing.drag, roomEditing.roomDrag, roomEditing.vertexDrag, roomEditing.wallDrag]);

  // The shared 2D viewport gesture engine (pan / zoom / pinch / wheel /
  // keyboard), formerly a ~350-line copy inline here and in ElevationView. It
  // works EXCLUSIVELY in SVG userspace (y-down) — plan floor coordinates are
  // already y-down, so there is no flip anywhere. A single finger's pan-start is
  // delegated back to this view's bubble-phase background handler (beginMarquee
  // → beginTouchPan), and the post-gesture trailing-click suppression stays
  // view-owned (armSuppressNextToolClick), reproduced via onGestureEnd.
  const gestures = useSvgViewportGestures({
    svgRef,
    viewport,
    onViewportChange,
    contentBounds,
    containerSize,
    zoomLimits: PLAN_ZOOM_LIMITS,
    // A 2nd finger landing over ANY in-flight single-finger edit (wall resize,
    // room move, or object/group move) blocks rather than starting a pinch —
    // defer to that edit (preserves the old capture guard).
    isPinchBlocked: () =>
      Boolean(
        roomEditing.dragRef.current ||
          roomEditing.roomDragRef.current ||
          objectMove.objectDragRef.current ||
          roomEditing.vertexDragRef.current ||
          roomEditing.wallDragRef.current
      ),
    onGestureEnd: (info) => {
      // A space/middle mouse-pan always fires a trailing `click` on the svg; a
      // real touch pan/pinch (moved past slop, so !isTap) does too. Both must
      // arm the suppression so that click can't clear the selection or place a
      // tool. A stationary touch tap (isTap) leaves the flag be, so its native
      // click still selects/places/clears exactly as today.
      if (info.kind === "mouse-pan" || !info.isTap) armSuppressNextToolClick();
    }
  });
  const { isSpaceDown, panning, zoomAtCenter, canZoomIn, canZoomOut, beginTouchPan, beginMousePan } =
    gestures;
  // The hook's toSvgPoint is byte-identical to the old local toSvgMm; alias it
  // so every existing call site stays untouched.
  const toSvgMm = gestures.toSvgPoint;

  // The arm+auto-reset idiom for the trailing-click suppression flag: a real
  // pan/pinch/marquee release fires a trailing `click` on the svg, and this
  // marks the very next handleSvgClick to be swallowed. The setTimeout(0) is
  // the safety net for a release that lands where no click follows (pointer
  // left the svg mid-gesture).
  function armSuppressNextToolClick() {
    suppressNextToolClickRef.current = true;
    window.setTimeout(() => {
      suppressNextToolClickRef.current = false;
    }, 0);
  }

  // Only the committed project's walls matter for tool placement — a tool
  // can't be armed mid wall-resize-drag anyway (see the drag guard in the
  // pointer/click handlers below), so there's no live-preview geometry to
  // reconcile here the way displayedProject does for rendering.
  const floorWallsForTool = useMemo(() => getFloorWalls(project.floor), [project.floor]);
  // The door/window armed tools capture the nearest wall at any distance, so
  // their candidate set excludes partition faces — openings on partitions are
  // disallowed in v1 (spec §6.1). Blocked zones ARE allowed on faces, so they
  // keep the full set. Object drags/group moves keep faces regardless.
  const openingToolWalls = useMemo(
    () =>
      // Only doors/windows are barred from partition faces (spec §6.1); blocked
      // zones AND wall text may sit on either face.
      activeTool === "door" || activeTool === "window"
        ? floorWallsForTool.filter((wall) => parseFaceWallId(wall.id) === null)
        : floorWallsForTool,
    [floorWallsForTool, activeTool]
  );

  const movingSize = useMemo(() => {
    if (!activeTool) return null;
    const { widthMm, heightMm } = getDefaultInsertToolSizeMm(activeTool);
    // Floor-footprinted tools (blocked zone, and the case's open-floor default)
    // carry their own front-back depth; wall openings use the thin plan depth.
    const depthMm =
      activeTool === "blocked-zone"
        ? DEFAULT_FLOOR_OBJECT_DEPTH_MM
        : activeTool === "case"
          ? DEFAULT_FLOOR_CASE_DEPTH_MM
          : WALL_OBJECT_PLAN_DEPTH_MM;
    return { widthMm, heightMm, depthMm };
  }, [activeTool]);

  // The wall-case footprint the armed case ghost switches to once the pointer
  // captures a wall — narrower than the open-floor default and protruding by the
  // case's wall depth, so the preview matches what a wall case will actually be.
  const caseWallToolSize = useMemo(
    () => ({
      widthMm: DEFAULT_WALL_CASE_WIDTH_MM,
      heightMm: DEFAULT_WALL_CASE_HEIGHT_MM,
      depthMm: DEFAULT_WALL_CASE_DEPTH_MM
    }),
    []
  );

  const captureDistanceMm = pixelsPerMm > 0 ? WALL_CAPTURE_PX / pixelsPerMm : 0;
  const wallObjectMinDepthMm =
    pixelsPerMm > 0 ? MIN_WALL_OBJECT_DEPTH_PX / pixelsPerMm : 0;
  const objectHitMinMm = pixelsPerMm > 0 ? MIN_OBJECT_HIT_PX / pixelsPerMm : 0;

  // A selected placed object (or a whole multi-selection) is keyboard-nudgeable
  // in plan, just like a selected partition or measurement endpoint. A selected
  // freestanding wall is owned by the partition effect above, which wins
  // outright — this effect stands down whenever one is selected, so the two can
  // never both claim a single press (pointer selection treats them as separate
  // modes; keeping partition the deterministic winner covers the case a stale
  // object id lingers alongside a partition selection). Keyboard motion bypasses
  // snap resolution so every press is a predictable delta and lands one store
  // commit (per-press undo entries): a single object goes through
  // onCommitPlanMove, a multi-selection through onCommitPlanMoveGroup, mirroring
  // the pointer object-drag split. Both derive each member's new spot from
  // resolvePlanGroupMemberMove, so keyboard nudges and pointer group drags share
  // one geometry — a wall member reprojects along its OWN wall (a perpendicular
  // arrow slides it along the wall and never re-captures onto another wall or
  // falls off it), a floor member translates freely.
  useEffect(() => {
    if (
      selectedFreestandingWallId ||
      selectedObjectIds.length === 0 ||
      planInteractionActive
    ) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if (
        event.target instanceof Element &&
        event.target.closest("[data-owns-arrow-keys]") !== null
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey) return;
      const delta = getPlanMeasurementNudgeDelta(
        event.key,
        project.unit,
        gridPrecisionFloorMm,
        event.shiftKey,
        snapToGrid,
        event.altKey
      );
      if (!delta) return;

      // Resolve the live members of the selection in the exact shape the pointer
      // drag builds: a wall object whose wall vanished drops out, a floor object
      // carries its own center. Stale ids simply don't resolve.
      const selectedSet = new Set(selectedObjectIds);
      const wallsById = new Map(floorWallsForTool.map((wall) => [wall.id, wall]));
      const members: PlanGroupMember[] = [];
      for (const object of project.wallObjects) {
        if (!selectedSet.has(object.id)) continue;
        const wall = wallsById.get(object.wallId);
        if (!wall) continue;
        const rest = getWallObjectPlanRect(wall, object);
        members.push({
          id: object.id,
          anchor: "wall",
          kind: object.kind,
          wall,
          worldCenterMm: { xMm: rest.centerXMm, yMm: rest.centerYMm },
          widthMm: object.widthMm,
          depthMm: WALL_OBJECT_PLAN_DEPTH_MM
        });
      }
      for (const object of project.floorObjects) {
        if (!selectedSet.has(object.id)) continue;
        members.push({
          id: object.id,
          anchor: "floor",
          centerMm: { xMm: object.xMm, yMm: object.yMm },
          widthMm: object.widthMm,
          depthMm: object.depthMm,
          rotationDeg: object.rotationDeg
        });
      }
      const nudge = resolvePlanObjectNudge(members, delta);
      if (!nudge) return;

      event.preventDefault();
      if (nudge.kind === "single") {
        onCommitPlanMove?.(nudge.objectId, nudge.placement);
      } else {
        onCommitPlanMoveGroup?.(nudge.moves);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    floorWallsForTool,
    gridPrecisionFloorMm,
    onCommitPlanMove,
    onCommitPlanMoveGroup,
    planInteractionActive,
    project.floorObjects,
    project.unit,
    project.wallObjects,
    selectedFreestandingWallId,
    selectedObjectIds,
    snapToGrid
  ]);

  // Shared with exports; displayedProject includes geometry drag previews.
  const planScene = useMemo(
    () =>
      buildPlanScene(displayedProject, {
        artworksById,
        minWallObjectDepthMm: wallObjectMinDepthMm
      }),
    [displayedProject, artworksById, wallObjectMinDepthMm]
  );
  const measureSources = useMemo(() => buildPlanMeasureSources(planScene), [planScene]);
  const {
    measureGestureRef,
    snappedMeasurementEndpoint,
    visibleMeasurement,
    handleMeasurePointerDownCapture,
    handleMeasurePointerMove,
    handleMeasurePointerUpCapture,
    handleMeasurePointerCancelCapture,
    cancelMeasurePointerGesture,
    handleMeasurementEndpointKeyDown,
    handleMeasureSurfaceKeyDown
  } = usePlanMeasurementGesture({
    measurementActive,
    measurementState,
    onMeasurementAction,
    measureSources,
    toSvgMm,
    isSpaceDown,
    gridVisible,
    snapToGrid,
    minorGridMm,
    snapThresholdMm,
    unit: project.unit,
    gridPrecisionFloorMm,
    viewBoxBounds,
    svgRef
  });

  // Interaction-only geometry: snapping measures framed artwork edges without
  // changing persisted data or the selection geometry owned by a later phase.
  const snappingWallObjects = useMemo(
    () =>
      project.wallObjects.map((object) => withArtworkFootprintFromMap(object, artworksById)),
    [project.wallObjects, artworksById]
  );

  // Room membership per floor object, for floorAlign filtering (Phase 4):
  // resolvePlanPlacement's alignment targets only want floor objects sharing
  // the moving object's room, so every call site can filter by comparing this
  // map's value to the proposed center's own roomIdContainingPoint result.
  const floorObjectRoomIds = useMemo(
    () =>
      new Map(
        project.floorObjects.map((object) => [
          object.id,
          roomIdContainingPoint(project, { xMm: object.xMm, yMm: object.yMm })
        ])
      ),
    [project]
  );

  // Artwork HTML5 drag/drop + touch-drop from the checklist: the drop ghost,
  // its snap hysteresis, and the DOM handlers the container div wires up.
  // artworkFormFor is reused by floatPolicyForMovingObject below.
  const {
    dropGhost,
    artworkFormFor,
    handleArtworkDragOver,
    handleArtworkDragLeave,
    handleArtworkDrop
  } = usePlanArtworkDrop({
    artworksById,
    draggingArtworkId,
    containerRef,
    toSvgMm,
    project,
    floorWallsForTool,
    snappingWallObjects,
    floorObjectRoomIds,
    captureDistanceMm,
    gridSnapTargets,
    snapToGrid,
    snapThresholdMm,
    onPlaceArtwork,
    onPlaceArtworkOnFloor
  });

  // Build complete gap/solid chains in room-local space, then lift them once
  // for the plan overlay. A valid draw preview participates too, so its live
  // feedback uses the exact geometry that will be committed.
  const partitionChainsFloor = useMemo(
    () =>
      computePartitionChainsFloor({
        project,
        partitionDraw: partition.partitionDraw,
        partitionDuplicateGhost: partition.partitionDuplicateGhost,
        duplicatePartitionSourceWallId,
        partitionDrag: partition.partitionDrag,
        selectedFreestandingWallId
      }),
    [
      duplicatePartitionSourceWallId,
      partition.partitionDraw,
      partition.partitionDrag,
      partition.partitionDuplicateGhost,
      selectedFreestandingWallId,
      project.floor.rooms
    ]
  );

  // Selection-driven plan dimension lines (the top-down twin of elevation's
  // GroupDimensionLines): floor-object clearances to same-room neighbors and
  // room walls, plus a wall-hung object's along-wall clearances. Static
  // (committed) geometry only — the mount hides these during any active gesture
  // rather than tracking a live preview, matching how dims read the rest scene.
  const planGapLines = useMemo<PlanGapLine[]>(
    () =>
      computePlanGapLines({
        exportMode,
        selectedObjectIds,
        planScene,
        floorObjectRoomIds,
        floorWallsForTool
      }),
    [exportMode, selectedObjectIds, planScene, floorObjectRoomIds, floorWallsForTool]
  );

  function disarmTool() {
    onToolChange(null);
  }

  // Reset ghost and snap hysteresis whenever the controlled tool changes.
  useEffect(() => {
    setToolGhost(null);
    toolSnapTargetIdsRef.current = undefined;
  }, [activeTool]);

  useDisarmOnEscape(activeTool, disarmTool);

  // Resolve the armed insert tool's placement under the pointer. The case tool
  // is the one kind whose footprint depends on the resolved anchor: its default
  // ghost is the open-floor footprint, but once it captures a wall we re-resolve
  // with the (narrower, protruding) wall-case footprint so the preview matches
  // what placeCaseFromPlan will actually create. Every other tool is single-pass.
  function resolveToolPlacement(pointerMm: Vector2, size: typeof movingSize) {
    if (!activeTool || !size) return null;
    const roomId = roomIdContainingPoint(project, pointerMm);
    const options = {
      walls: openingToolWalls,
      wallObjects: snappingWallObjects,
      movingKind: activeTool,
      // Blocked zones and cases float (wall capture only within capture
      // distance, open floor otherwise); doors/windows/wall text always
      // capture the nearest wall.
      floatPolicy: (activeTool === "blocked-zone" || activeTool === "case"
        ? "float"
        : "capture-any") as FloatPolicy,
      currentAnchorWallId: null,
      captureDistanceMm,
      gridTargets: gridSnapTargets,
      snapToGrid,
      thresholdMm: snapThresholdMm,
      previousSnapTargetIds: toolSnapTargetIdsRef.current,
      // Not yet placed — nothing to exclude, just filter to the room under the
      // pointer.
      floorAlign: {
        roomId,
        floorObjects: project.floorObjects.filter(
          (object) => floorObjectRoomIds.get(object.id) === roomId
        )
      }
    };
    const first = resolvePlanPlacement(pointerMm, { ...options, movingSize: size });
    if (activeTool === "case" && first.placement.anchor === "wall") {
      return resolvePlanPlacement(pointerMm, { ...options, movingSize: caseWallToolSize });
    }
    return first;
  }

  function handleToolPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!activeTool || !movingSize || roomEditing.drag || roomEditing.roomDrag) return;

    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    const result = resolveToolPlacement(pointerMm, movingSize);
    if (!result) return;

    toolSnapTargetIdsRef.current = result.snapTargetIds;
    setToolGhost({
      planRect: result.planRect,
      placement: result.placement,
      activeGuides: result.activeGuides
    });
  }

  function handleToolPointerLeave() {
    setToolGhost(null);
  }

  // In reshape mode, Escape exits and Delete/Backspace merges at the selected vertex.
  useEffect(() => {
    if (!reshapeRoomId) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onReshapeRoomChange?.(null);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        const vertexId = roomEditing.selectedVertexIdRef.current;
        if (!vertexId || !onDeleteRoomVertex || !reshapeRoomId) return;
        event.preventDefault();
        roomEditing.setSelectedVertexId(null);
        void onDeleteRoomVertex(reshapeRoomId, vertexId);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reshapeRoomId, onReshapeRoomChange, onDeleteRoomVertex]);

  useDisarmOnEscape(partitionToolActive, () => onPartitionToolChange?.(false));

  // The release gate skips an in-flight rectangle after Escape.
  useDisarmOnEscape(drawRectActive, () => onDrawRectChange?.(false));

  // Snap to grid/previous axes; Shift forces an exact horizontal or vertical segment.
  function snapDrawPoint(pointerMm: Vector2, prev: Vector2 | null, shiftKey: boolean): Vector2 {
    let result: Vector2 = pointerMm;
    if (snapToGrid) {
      const targets: SnapTarget[] = [...gridSnapTargets];
      if (prev) {
        targets.push(
          { id: "draw-prev-x", kind: "grid", axis: "x", point: { xMm: prev.xMm, yMm: 0 } },
          { id: "draw-prev-y", kind: "grid", axis: "y", point: { xMm: 0, yMm: prev.yMm } }
        );
      }
      result = resolveSnap(pointerMm, targets, { thresholdMm: snapThresholdMm }).point;
    }
    if (shiftKey && prev) {
      const dx = Math.abs(pointerMm.xMm - prev.xMm);
      const dy = Math.abs(pointerMm.yMm - prev.yMm);
      // Keep the snapped major axis and lock the minor axis.
      result =
        dx >= dy ? { xMm: result.xMm, yMm: prev.yMm } : { xMm: prev.xMm, yMm: result.yMm };
    }
    return result;
  }

  // Polygon-room draw gesture: transient point list, arming/keyboard effects,
  // and the pointer/click handlers the capture overlay wires up.
  const { draw, handleDrawPointerMove, handleDrawClick } = usePlanDrawRoomTool({
    drawRoomActive,
    toSvgMm,
    floorWallsForTool,
    snapThresholdMm,
    pixelsPerMm,
    snapDrawPoint,
    suppressNextToolClickRef,
    onAddPolygonRoom,
    onDrawRoomChange
  });

  // Capture the gesture origin before child handlers stop propagation.
  function handleSvgPointerDownCapture(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerType !== "touch") {
      event.currentTarget.focus({ preventScroll: true });
    }

    // Pan/pinch gets first refusal. In particular the first touch is recorded
    // before Measure sees it, so a second touch can promote the gesture to a
    // pinch; that promotion cancels any one-finger measurement in flight.
    if (gestures.handlePointerDownCapture(event)) {
      if (
        shouldCancelMeasurementForViewportClaim(
          event.pointerType,
          measureGestureRef.current !== null
        )
      ) {
        cancelMeasurePointerGesture();
      }
      return;
    }

    // Measure then owns ordinary primary-button presses before geometry,
    // selection, and marquee can interpret them.
    if (handleMeasurePointerDownCapture(event)) return;

    const target = event.target as Element | null;
    // Exclude ghosts so placement clicks commit. Reassign per gesture to clear
    // flags left unconsumed by child clicks that stopped propagation.
    suppressNextToolClickRef.current = Boolean(
      target?.closest(".resize-handle, .plan-object:not(.is-ghost)")
    );
  }

  function handleSvgClick(event: ReactMouseEvent<SVGSVGElement>) {
    if (measurementActive) return;
    if (suppressNextToolClickRef.current) {
      suppressNextToolClickRef.current = false;
      return;
    }
    if (roomEditing.drag) return;
    // Object clicks stop propagation; an unarmed background click clears selection.
    if (!activeTool) {
      onClearSelection?.();
      return;
    }
    if (!movingSize || !onPlaceOpeningFromPlan) return;

    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    const result = resolveToolPlacement(pointerMm, movingSize);
    if (!result) return;

    // Tool policies make "none" unreachable; this narrows the store call type.
    if (result.placement.anchor === "none") return;

    const kind = activeTool;
    // Placement tools are single-shot.
    disarmTool();
    // One armed case tool routes to its own store action, which decides
    // wall-case vs floor-case from the resolved anchor (capture-any).
    if (kind === "case") {
      void onPlaceCaseFromPlan(result.placement);
      return;
    }
    void onPlaceOpeningFromPlan(kind, result.placement);
  }

  // The browser fires a `click` on the grabbed element right after a drag's
  // pointerup. For a single object that click merely re-selects it (today's
  // behavior, harmless); after a real GROUP drag the same click would call
  // onSelectObject non-additively and collapse the whole multi-selection to
  // Select suppression: when a pointer release triggers a trailing click that
  // must not collapse a multi-selection (group drags, marquee selection, etc.),
  // mark it here so the click handler can skip the selection.
  const { suppressNextSelect, consumeSelectSuppression, suppressNextSelectRef } =
    useSelectSuppression();

  // Placement ids whose rendered plan rects intersect the marquee. No object
  // drag can be in flight during a marquee, so the static scene is authoritative.
  function idsIntersectingMarquee(marqueeRect: {
    minXMm: number;
    maxXMm: number;
    minYMm: number;
    maxYMm: number;
  }): string[] {
    return getPlanSceneObjectIdsIntersectingRect(planScene, marqueeRect);
  }

  function beginMarquee(event: ReactPointerEvent<SVGSVGElement>) {
    // Touch: a finger on true background pans the canvas instead of marqueeing
    // (the marquee is a mouse-only gesture on tablets). A pinch's 2nd finger was
    // already claimed (stopPropagation) in the capture handler, so it never
    // reaches here; beginTouchPan self-guards (exactly one pointer, no live
    // pinch), and the hook decides tap-vs-pan on release. Returns unconditionally
    // for touch so a finger never falls through into the marquee path below.
    if (event.pointerType === "touch") {
      beginTouchPan(event.clientX, event.clientY);
      return;
    }

    // ⌘/Ctrl + primary-button background drag pans the canvas — the modifier-
    // click sibling of Space/middle-mouse pan, which the user asked for. This
    // deliberately claims the gesture away from the replace-marquee it would
    // otherwise start (that marquee is redundant: a plain background drag
    // already does it, and a plain click still clears). ⌘/Ctrl on an OBJECT
    // press stays the precision/additive-select modifier — those never reach
    // here (they stopPropagation). Shift-background-drag stays the additive
    // marquee. On macOS a Ctrl-click is button 2 / contextmenu, so it never
    // matches button 0; ctrlKey serves Windows/Linux. onGestureEnd arms
    // suppressNextToolClick for the trailing click this pan fires, so a
    // stationary ⌘-press is a zero-move pan that leaves the selection intact.
    if ((event.metaKey || event.ctrlKey) && event.button === 0) {
      beginMousePan(event.clientX, event.clientY);
      event.preventDefault();
      return;
    }

    // Only true background reaches here: PlanObject and the resize handles
    // stopPropagation in their own pointerdown. (This is a separate mechanism
    // from onPointerDownCapture, which fires in the capture phase to flag a
    // click as started-on-an-object — that handler stays untouched.)
    //
    // Bail when a tool is armed: a marquee drag would fight click-to-place.
    // Stay inert until App wires the multi-select handlers (same gate as
    // elevation). Never start over an in-flight gesture. Draw mode owns the
    // whole surface via its capture overlay, so a marquee must not start there.
    if (activeTool || drawRoomActive || partitionToolActive || drawRectActive) return;
    if (!onMarqueeSelect && !onClearSelection) return;
    if (roomEditing.drag || objectMove.objectDrag || dropGhost || roomEditing.roomDrag) return;

    const startMm = toSvgMm(event.clientX, event.clientY);
    if (!startMm) return;

    // Suppress the browser's default press-drag semantics for this gesture:
    // without this, dragging across the svg selects its text nodes (the
    // <title>), and the NEXT marquee that starts inside that stale selection
    // becomes a native drag of the selected text — Chrome then fires
    // pointercancel and kills the gesture mid-flight.
    event.preventDefault();
    startMarquee({ startMm, currentMm: startMm });
  }

  // Pan cursor affordance: grabbing while a pan drag is live, grab while space
  // is merely held ready. Otherwise the surface keeps its default/tool cursor.
  const surfaceClassName = panning
    ? "drawing-surface is-panning"
    : isSpaceDown
      ? "drawing-surface is-pan-ready"
      : "drawing-surface";

  return (
    <div
      className={surfaceClassName}
      aria-label="Plan view"
      ref={containerRef}
      onDragLeave={handleArtworkDragLeave}
      onDragOver={handleArtworkDragOver}
      onDrop={handleArtworkDrop}
    >
      <ViewportZoomControls
        zoom={getEffectiveZoom(viewport)}
        isFit={viewport.mode === "fit"}
        canZoomIn={canZoomIn}
        canZoomOut={canZoomOut}
        onZoomIn={() => zoomAtCenter(ZOOM_STEP)}
        onZoomOut={() => zoomAtCenter(1 / ZOOM_STEP)}
        onFit={() => onViewportChange(FIT_VIEWPORT)}
      />
      <svg
        className={
          !exportMode &&
          (activeTool || drawRoomActive || partitionToolActive || drawRectActive || measurementActive)
            ? "plan-svg tool-armed"
            : "plan-svg"
        }
        ref={svgRef}
        viewBox={viewBox}
        role="img"
        tabIndex={0}
        onKeyDown={handleMeasureSurfaceKeyDown}
        onClick={handleSvgClick}
        onClickCapture={(event) => {
          if (!measurementActive) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={beginMarquee}
        onPointerDownCapture={handleSvgPointerDownCapture}
        onPointerUpCapture={handleMeasurePointerUpCapture}
        onPointerCancelCapture={handleMeasurePointerCancelCapture}
        onPointerLeave={handleToolPointerLeave}
        onPointerMove={(event) => {
          if (!handleMeasurePointerMove(event)) handleToolPointerMove(event);
        }}
      >
        <title>{project.title} plan</title>
        {/* Room interiors render below the grid (the grid must stay visible
            on the room's "paper"), walls and handles above it. */}
        {planScene.rooms.map((room) => (
          <polygon
            className="room-fill"
            key={room.roomId}
            points={svgPolygonPoints(room.polygonMm)}
          />
        ))}
        {gridVisible ? (
          <GridOverlay
            id="plan-grid"
            height={viewBoxBounds.height}
            majorSpacingMm={majorGridMm}
            minorSpacingMm={minorGridMm}
            width={viewBoxBounds.width}
            x={viewBoxBounds.x}
            y={viewBoxBounds.y}
          />
        ) : null}
        {/* Room walls (+ hover/hit strokes), the per-room hit polygons, and
            the partition slabs — the static structure the user clicks to
            select rooms/walls/partitions. Render-only; every handler stays
            defined in this component and is threaded through. */}
        <PlanStructureLayer
          rooms={planScene.rooms}
          partitions={planScene.partitions}
          selectedRoomId={selectedRoomId}
          reshapeRoomId={exportMode ? null : reshapeRoomId}
          selectedWallId={exportMode ? null : selectedWallId}
          hoveredWallId={exportMode ? null : roomEditing.hoveredWallId}
          selectedFreestandingWallId={exportMode ? null : selectedFreestandingWallId}
          activeTool={activeTool}
          drawRoomActive={drawRoomActive}
          drawRectActive={drawRectActive}
          partitionToolActive={partitionToolActive}
          partitionDrag={partition.partitionDrag}
          suppressNextToolClickRef={suppressNextToolClickRef}
          setHoveredWallId={roomEditing.setHoveredWallId}
          onSelectWall={onSelectWall}
          onSelectRoom={onSelectRoom}
          onReshapeRoomChange={onReshapeRoomChange}
          onSelectFreestandingWall={onSelectFreestandingWall}
          beginRoomDrag={roomEditing.beginRoomDrag}
          beginPartitionDrag={partition.beginPartitionDrag}
        />
        {/* Live partition clearance dimension lines — shown while a partition
            is selected or being dragged; render-only, muted drafting ink. */}
        {partitionChainsFloor ? (
          <PartitionDimensionLines
            chains={partitionChainsFloor.chains}
            partition={partitionChainsFloor.partition}
            visibleWorldAxes={
              // At rest (no drag) or during an endpoint re-drag, show all four
              // gaps. During a MOVE drag show only the latched axes — both false
              // until the first threshold crossing, so nothing shows until the
              // partition has actually travelled.
              partition.partitionDrag && partition.partitionDrag.mode === "move"
                ? partition.partitionDrag.movedAxes
                : { x: true, y: true }
            }
            handleSizeMm={handleSizeMm}
            unit={wallUnit}
          />
        ) : null}
        {/* Selection-driven object dimension lines (floor-object clearances +
            wall-hung along-wall clearances). Hidden during any active gesture —
            they read the committed rest scene, not a live drag preview — the
            same suppression set the placed-object tooltips use. */}
        {!exportMode &&
        !roomEditing.drag &&
        !objectMove.objectDrag &&
        !dropGhost &&
        !activeTool &&
        !roomEditing.roomDrag &&
        !drawRoomActive &&
        !drawRectActive &&
        !roomEditing.vertexDrag &&
        !measurementActive ? (
          <PlanGapDimensionLines
            gaps={planGapLines}
            handleSizeMm={handleSizeMm}
            unit={wallUnit}
          />
        ) : null}
        {/* Placed objects: opening-connection glyphs, wall-anchored object
            rects, and floor-placed object rects. Reads the live objectDrag
            preview + selection ids; tooltipsDisabled is derived here from the
            in-flight gesture/armed-tool state this component owns. */}
        <PlacedObjectsLayer
          openingConnections={exportMode ? [] : planScene.openingConnections}
          wallObjects={planScene.wallObjects}
          floorObjects={planScene.floorObjects}
          pixelsPerMm={pixelsPerMm}
          objectDrag={objectMove.objectDrag}
          tooltipsDisabled={
            exportMode ||
            Boolean(
              roomEditing.drag ||
                objectMove.objectDrag ||
                dropGhost ||
                activeTool ||
                roomEditing.roomDrag ||
                drawRoomActive ||
                drawRectActive ||
                roomEditing.vertexDrag ||
                measurementActive
            )
          }
          artworksById={artworksById}
          thumbnailUrlsByAssetId={thumbnailUrlsByAssetId}
          unit={project.unit}
          wallObjectMinDepthMm={wallObjectMinDepthMm}
          objectHitMinMm={objectHitMinMm}
          selectedArtworkId={exportMode ? null : selectedArtworkId}
          selectedOpeningId={exportMode ? null : selectedOpeningId}
          selectedObjectIds={exportMode ? [] : selectedObjectIds}
          consumeSelectSuppression={consumeSelectSuppression}
          beginObjectDrag={objectMove.beginObjectDrag}
          onSelectObject={onSelectObject}
          onSelectArtwork={onSelectArtwork}
          onSelectOpening={onSelectOpening}
        />
        {!exportMode &&
          referenceMeasurements
            .filter((item) => item.kind === "plan" && item.visible)
            .map((item) => {
            const selected = selection.kind === "measurement" && selection.measurementId === item.id;
            return (
              <MeasurementOverlay
                key={item.id}
                a={item.start}
                b={item.end}
                unit={project.unit}
                pixelsPerMm={pixelsPerMm}
                reference
                locked={item.locked}
                selected={selected}
                onBodyPointerDown={() => onSelectMeasurement(item.id)}
                onEndpointKeyDown={(endpoint, event) => {
                  if (item.locked || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
                  event.preventDefault();
                  const delta = getPlanMeasurementNudgeDelta(
                    event.key,
                    project.unit,
                    gridPrecisionFloorMm,
                    event.shiftKey,
                    snapToGrid,
                    event.altKey
                  );
                  if (!delta) return;
                  const point = endpoint === "a" ? item.start : item.end;
                  const next = {
                    xMm: point.xMm + delta.xMm,
                    yMm: point.yMm + delta.yMm
                  };
                  void onUpdateReferenceMeasurement(item.id, endpoint === "a" ? { start: next } : { end: next });
                }}
              />
            );
          })}
        {/* Selection decorations: the selected room's wash/outline/handle set
            + live length labels, then the selected partition's face labels and
            endpoint handles. Both paint above placed objects, at rest nothing.
            committedRooms is the pre-drag baseline the reshape diff measures. */}
        <PlanHandlesLayer
          rooms={planScene.rooms}
          partitions={planScene.partitions}
          committedRooms={project.floor.rooms}
          selectedRoomId={selectedRoomId}
          selectedFreestandingWallId={selectedFreestandingWallId}
          reshapeRoomId={reshapeRoomId}
          handleSizeMm={handleSizeMm}
          wallUnit={wallUnit}
          hoveredWallId={roomEditing.hoveredWallId}
          selectedVertexId={roomEditing.selectedVertexId}
          drag={roomEditing.drag}
          vertexDrag={roomEditing.vertexDrag}
          wallDrag={roomEditing.wallDrag}
          partitionDrag={partition.partitionDrag}
          beginDrag={roomEditing.beginDrag}
          beginWallDrag={roomEditing.beginWallDrag}
          beginVertexDrag={roomEditing.beginVertexDrag}
          handleSplitWallClick={roomEditing.handleSplitWallClick}
          beginPartitionDrag={partition.beginPartitionDrag}
          exportMode={exportMode}
        />
        {/* Gestural overlays: the polygon-room draw preview + capture rect, the
            partition- and rectangle-draw previews, the armed-tool/drop ghosts,
            the snap guides, and the in-progress marquee. activeGuides picks the
            single live gesture's guides in the same precedence as before. */}
        {exportMode ? null : (
          <PlanOverlaysLayer
            drawRoomActive={drawRoomActive}
            draw={draw}
            partitionToolActive={partitionToolActive}
            partitionDraw={partition.partitionDraw}
            partitionDuplicateActive={Boolean(duplicatePartitionSourceWallId)}
            partitionDuplicateGhost={partition.partitionDuplicateGhost}
            drawRectActive={drawRectActive}
            rectDraw={roomEditing.rectDraw}
            toolGhost={toolGhost}
            dropGhost={dropGhost}
            marquee={marquee}
            activeGuides={
              objectMove.objectDrag?.activeGuides ??
              dropGhost?.activeGuides ??
              roomEditing.drag?.activeGuides ??
              roomEditing.roomDrag?.activeGuides ??
              partition.partitionDrag?.activeGuides ??
              partition.partitionDuplicateGhost?.activeGuides ??
              toolGhost?.activeGuides ??
              []
            }
            activeTool={activeTool}
            viewBox={viewBoxBounds}
            handleSizeMm={handleSizeMm}
            pixelsPerMm={pixelsPerMm}
            wallUnit={wallUnit}
            wallObjectMinDepthMm={wallObjectMinDepthMm}
            floorWalls={floorWallsForTool}
            handleDrawClick={handleDrawClick}
            handleDrawPointerMove={handleDrawPointerMove}
            beginPartitionDraw={partition.beginPartitionDraw}
            handlePartitionDuplicateMove={partition.handlePartitionDuplicateMove}
            handlePartitionDuplicateClick={partition.handlePartitionDuplicateClick}
            beginRectDraw={roomEditing.beginRectDraw}
          />
        )}
        {!exportMode && visibleMeasurement ? (
          <MeasurementOverlay
            a={visibleMeasurement.start}
            b={
              visibleMeasurement.phase === "drawing"
                ? visibleMeasurement.preview
                : visibleMeasurement.end
            }
            pixelsPerMm={pixelsPerMm}
            selected={visibleMeasurement.phase !== "drawing"}
            snappedEndpoint={snappedMeasurementEndpoint}
            unit={project.unit}
            onEndpointKeyDown={handleMeasurementEndpointKeyDown}
          />
        ) : null}
      </svg>
    </div>
  );
}

function getPlanViewPaddingMm(bounds: { width: number; height: number }): number {
  const largestDimensionMm = Math.max(bounds.width, bounds.height);

  return Math.max(900, largestDimensionMm * 0.14);
}

// getPartitionMovedAxes now lives with the partition controller
// (usePlanPartitionTool); re-exported here so PlanView.test.ts's import from
// "./PlanView" keeps resolving unchanged.
export { getPartitionMovedAxes };

// The padded floor bounds, expanded (never shrunk) so neither axis is
// narrower than MIN_PLAN_FIT_EXTENT_MM — grown symmetrically around the
// floor bounds' own center, which is the origin for an empty floor (see
// getFloorBounds). Exported only for unit testing; not a shared utility.
export function clampFitExtent(
  bounds: { minX: number; minY: number; width: number; height: number },
  padding: number
): { x: number; y: number; width: number; height: number } {
  const rawWidth = bounds.width + padding * 2;
  const rawHeight = bounds.height + padding * 2;
  const width = Math.max(MIN_PLAN_FIT_EXTENT_MM, rawWidth);
  const height = Math.max(MIN_PLAN_FIT_EXTENT_MM, rawHeight);
  const centerX = bounds.minX + bounds.width / 2;
  const centerY = bounds.minY + bounds.height / 2;

  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height
  };
}
