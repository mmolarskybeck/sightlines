import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import {
  computeEdgeSnappedLengthMm,
  getMovingWallEdgeWorldPointMm,
  proposeMovingEdgePointMm,
  type Vector2
} from "../../domain/geometry/dragResize";
import { unitLeftNormal } from "../../domain/geometry/vector";
import type { ResizeAnchor } from "../../domain/geometry/editRoom";
import { applyPlanPreview, type PlanPreview } from "../../domain/geometry/planPreview";
import {
  getFloorBounds,
  getPlacedRoomBounds,
  getRoomBounds,
  getWallGeometry
} from "../../domain/geometry/walls";
import {
  getFloorWalls,
  getWallObjectPlanRect,
  projectPointToWall,
  WALL_OBJECT_PLAN_DEPTH_MM,
  type PlanRect
} from "../../domain/geometry/planObjects";
import {
  buildPlanScene,
  getPlanSceneObjectIdsIntersectingRect,
  svgPolygonPoints
} from "../../domain/scene2d/planScene";
import { getArtworkOuterDimensionsMm, withArtworkFootprintFromMap } from "../../domain/framing";
import { getDefaultOpeningSizeMm, type OpeningKind } from "../../domain/placement/createOpening";
import {
  effectiveFloorDepthMm,
  effectivePlacementForm,
  type PlacementForm
} from "../../domain/placement/artworkForm";
import {
  getEffectivePlacementSizeMm,
  PLACEHOLDER_ARTWORK_HEIGHT_MM,
  PLACEHOLDER_ARTWORK_WIDTH_MM
} from "../../domain/placement/placeArtwork";
import {
  DEFAULT_FLOOR_OBJECT_DEPTH_MM,
  type Artwork,
  type FreestandingWall,
  type ReferenceMeasurement,
  type WallObject
} from "../../domain/project";
import {
  DEFAULT_FREESTANDING_THICKNESS_MM,
  parseFaceWallId,
  roomIdContainingPoint,
  type FloorPartition
} from "../../domain/geometry/freestandingWalls";
import { isPointInPolygon, isSimplePolygon, segmentsIntersect, type Point } from "../../domain/geometry/polygon";
import {
  canCloseOnWall,
  snapDrawPointToRooms,
  type DrawRoomSnap
} from "../../domain/geometry/drawSnapping";
import { canMoveRoomVertex, moveRoomWall } from "../../domain/geometry/reshapeRoom";
import { getGridSnapTargets } from "../../domain/snapping/gridSnapTargets";
import {
  getPartitionDrawSnapTargets,
  getPartitionMoveSnapTargets
} from "../../domain/snapping/partitionSnapTargets";
import {
  getPartitionDimensionChains,
  partitionAxisForWorldAxis,
  type ChainSegment,
  type PartitionDimensionChains
} from "../../domain/geometry/partitionSpacing";
import {
  floatPolicyForKind,
  resolvePlanPlacement,
  WALL_CAPTURE_PX,
  type FloatPolicy,
  type PlanPlacement,
  type ResolvedPlacement
} from "../../domain/snapping/planSnapTargets";
import {
  getPlanGroupCenterMm,
  resolvePlanGroupMemberMove,
  type PlanGroupMember
} from "../../domain/snapping/planGroupMove";
import { resolveSnap, type Guide, type SnapTarget, type SnapTargetIds } from "../../domain/snapping/resolveSnap";
import {
  buildMeasurePointCandidates,
  constrainMeasurePointToAxis,
  resolveMeasurePoint,
  type MeasureCandidateSources,
  type MeasurePoint
} from "../../domain/measurement/measurement";
import {
  getMajorGridIntervalMm,
  getMinorGridIntervalMm
} from "../../domain/units/precision";
import {
  FIT_VIEWPORT,
  getEffectiveZoom,
  getViewBox2D,
  PLAN_ZOOM_LIMITS,
  ZOOM_STEP,
  type Viewport2D
} from "../../domain/viewport/viewport2d";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../domain/units/unitSystem";
import { getNudgeStepMm } from "../hooks/nudgeStep";
import { isEditableTarget } from "../hooks/isEditableTarget";
import { useArtworkAspect } from "../hooks/useArtworkAspect";
import { useAssetImageUrls } from "../hooks/useAssetImageUrls";
import { useContainerSize } from "../hooks/useContainerSize";
import { useDisarmOnEscape } from "../hooks/useDisarmOnEscape";
import { useDragGesture } from "../hooks/useDragGesture";
import { useSelectSuppression } from "../hooks/useSelectSuppression";
import { useSvgViewportGestures } from "../hooks/useSvgViewportGestures";
import { useAppStore } from "../store";
import { ARTWORK_DRAG_MIME } from "./ChecklistPanel";
import {
  consumeArtworkDragSession,
  peekArtworkDragSession,
  subscribeArtworkTouchDrag
} from "./artworkDragSession";
import { GridOverlay } from "./GridOverlay";
import { marqueeRectMm, type MarqueeState } from "./marqueeRect";
import { type ResizeHandleTarget } from "./RoomResizeHandles";
import { ViewportZoomControls } from "./ViewportZoomControls";
import { MeasurementOverlay } from "./MeasurementOverlay";
import {
  MEASURE_DRAG_SLOP_PX,
  type MeasurementToolAction,
  type MeasurementToolState
} from "../hooks/useMeasurementTool";
import {
  getMeasurementCreationKeyAction,
  isMeasurementCreationArrowKey
} from "../hooks/measurementCreationKey";
import { PlanStructureLayer } from "./plan/PlanStructureLayer";
import { PlacedObjectsLayer } from "./plan/PlacedObjectsLayer";
import { PlanHandlesLayer } from "./plan/PlanHandlesLayer";
import { PlanOverlaysLayer } from "./plan/PlanOverlaysLayer";
import { PartitionDimensionLines } from "./plan/PartitionDimensionLines";
import type {
  DragState,
  DrawState,
  DropGhostState,
  ObjectDragState,
  PartitionDragState,
  PartitionDuplicateGhostState,
  PartitionDrawState,
  RectDrawState,
  RoomDragState,
  ToolGhostState,
  VertexDragState,
  WallDragState
} from "./plan/types";

// Selected-room resize handle size in screen pixels.
const SELECTED_HANDLE_PX = 10;
const SNAP_THRESHOLD_PX = 10;
// Keep thin wall objects visible when zoomed out.
const MIN_WALL_OBJECT_DEPTH_PX = 9;
// Minimum invisible hit target for plan objects.
const MIN_OBJECT_HIT_PX = 20;
// Polygon close-target radius in screen pixels.
const CLOSE_HANDLE_PX = 12;
// Ignore points that would create a zero-length wall.
const MIN_DRAW_SPACING_MM = 10;
const DRAW_EPS = 1e-6;
// Minimum partition centerline length in floor millimeters.
const PARTITION_MIN_LENGTH_MM = 100;
// Reject rectangle drags below the smallest plausible room dimension.
const RECT_ROOM_MIN_SIZE_MM = 500;
// Prevent fit-view from over-zooming sparse plans (~30 ft minimum extent).
const MIN_PLAN_FIT_EXTENT_MM = 9144;

function midpointOf(a: Point, b: Point): Point {
  return { xMm: (a.xMm + b.xMm) / 2, yMm: (a.yMm + b.yMm) / 2 };
}

function liftPartitionChains(
  chains: PartitionDimensionChains,
  offset: Vector2
): PartitionDimensionChains {
  const liftSegment = (segment: ChainSegment): ChainSegment => ({
    ...segment,
    aMm: { xMm: segment.aMm.xMm + offset.xMm, yMm: segment.aMm.yMm + offset.yMm },
    bMm: { xMm: segment.bMm.xMm + offset.xMm, yMm: segment.bMm.yMm + offset.yMm }
  });
  return {
    normal: chains.normal.map(liftSegment),
    span: chains.span.map(liftSegment)
  };
}

function planRectMeasureGeometry(rect: PlanRect, id: string): MeasureCandidateSources {
  const angle = (rect.angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const local = [
    [-rect.widthMm / 2, -rect.depthMm / 2],
    [rect.widthMm / 2, -rect.depthMm / 2],
    [rect.widthMm / 2, rect.depthMm / 2],
    [-rect.widthMm / 2, rect.depthMm / 2]
  ] as const;
  const corners = local.map(([x, y]) => ({
    xMm: rect.centerXMm + x * cos - y * sin,
    yMm: rect.centerYMm + x * sin + y * cos
  }));
  return {
    points: [
      ...corners.map((point, index) => ({ id: `${id}:corner:${index}`, kind: "vertex" as const, point })),
      { id: `${id}:center`, kind: "center", point: { xMm: rect.centerXMm, yMm: rect.centerYMm } }
    ],
    segments: corners.map((point, index) => ({
      id: `${id}:edge:${index}`,
      kind: "edge" as const,
      start: point,
      end: corners[(index + 1) % corners.length]
    }))
  };
}

export function buildPlanMeasureSources(
  scene: ReturnType<typeof buildPlanScene>
): MeasureCandidateSources {
  const points: NonNullable<MeasureCandidateSources["points"]>[number][] = [];
  const segments: NonNullable<MeasureCandidateSources["segments"]>[number][] = [];
  for (const room of scene.rooms) {
    room.polygonMm.forEach((point, index) =>
      points.push({ id: `room:${room.roomId}:vertex:${index}`, kind: "vertex", point })
    );
    room.walls.forEach((wall) =>
      segments.push({
        id: `wall:${wall.wallId}`,
        kind: "edge",
        start: wall.startMm,
        end: wall.endMm
      })
    );
  }
  const rects = [
    ...scene.partitions.map((entry) => ({ id: `partition:${entry.partition.wallId}`, rect: entry.rect })),
    ...scene.wallObjects.map((entry) => ({ id: `wall-object:${entry.object.id}`, rect: entry.renderedRect })),
    ...scene.floorObjects.map((entry) => ({ id: `floor-object:${entry.object.id}`, rect: entry.rect }))
  ];
  for (const entry of rects) {
    const geometry = planRectMeasureGeometry(entry.rect, entry.id);
    points.push(...(geometry.points ?? []));
    segments.push(...(geometry.segments ?? []));
  }
  return { points, segments };
}

export function getPlanMeasurementNudgeDelta(
  key: string,
  unit: import("../../domain/project").DisplayUnit,
  gridPrecisionFloorMm: number | null,
  shiftKey: boolean,
  snapToGrid: boolean,
  altKey: boolean
): MeasurePoint | null {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return null;
  const stepMm = getNudgeStepMm({ unit, snapToGrid, gridPrecisionFloorMm, shiftKey, altKey });
  return {
    xMm: key === "ArrowRight" ? stepMm : key === "ArrowLeft" ? -stepMm : 0,
    // Plan floor coordinates share SVG's downward-positive y axis.
    yMm: key === "ArrowDown" ? stepMm : key === "ArrowUp" ? -stepMm : 0
  };
}

export function getPlanMeasurementKeyActions(
  state: MeasurementToolState,
  endpoint: "start" | "end",
  key: string,
  unit: import("../../domain/project").DisplayUnit,
  gridPrecisionFloorMm: number | null,
  shiftKey: boolean,
  snapToGrid: boolean,
  altKey: boolean
): MeasurementToolAction[] {
  if (key === "Enter" && state.phase === "refining") return [{ type: "commit-refinement" }];
  if (key === "Escape" && state.phase === "refining") return [{ type: "cancel-refinement" }];
  const delta = getPlanMeasurementNudgeDelta(key, unit, gridPrecisionFloorMm, shiftKey, snapToGrid, altKey);
  if (!delta || (state.phase !== "armed-complete" && state.phase !== "refining")) return [];
  const current = state[endpoint];
  return [
    ...(state.phase === "armed-complete"
      ? ([{ type: "begin-refinement", endpoint }] satisfies MeasurementToolAction[])
      : []),
    {
      type: "preview-refinement",
      point: { xMm: current.xMm + delta.xMm, yMm: current.yMm + delta.yMm }
    }
  ];
}

// Keyboard-only creation: Enter begins at `origin` (the view supplies the
// visible-viewport centre), arrows nudge the live preview by the shared canvas
// step, Enter completes. Keyboard-moved points intentionally skip snap
// resolution so an arrow nudge is never yanked to a snap target — the same
// predictability trade the ⌘-bypass makes for the pointer path.
export function getPlanMeasurementCreationKeyAction(
  state: MeasurementToolState,
  key: string,
  origin: MeasurePoint,
  unit: import("../../domain/project").DisplayUnit,
  gridPrecisionFloorMm: number | null,
  shiftKey: boolean,
  snapToGrid: boolean,
  altKey: boolean
): MeasurementToolAction | null {
  return getMeasurementCreationKeyAction(state, key, {
    origin,
    delta: getPlanMeasurementNudgeDelta(key, unit, gridPrecisionFloorMm, shiftKey, snapToGrid, altKey)
  });
}

export function canPlanMeasurementClaimPointer(button: number, spaceHeld: boolean): boolean {
  return button === 0 && !spaceHeld;
}

export function planMeasurementCancelAction(
  state: MeasurementToolState
): MeasurementToolAction | null {
  if (state.phase === "refining") return { type: "cancel-refinement" };
  if (state.phase === "drawing") return { type: "clear" };
  return null;
}

export function shouldCancelMeasurementForViewportClaim(
  pointerType: string,
  hasMeasurementGesture: boolean
): boolean {
  return pointerType === "touch" && hasMeasurementGesture;
}

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
  onMeasurementAction
}: {
  // Controlled door/window/blocked-zone insertion tool.
  activeTool: OpeningKind | null;
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
  // Wall moves omit yMm; floor moves include their new center.
  onCommitPlanMoveGroup?: (moves: { id: string; xMm: number; yMm?: number }[]) => void;
  onPlaceArtwork?: (artworkId: string, wallId: string, xMm: number, yMm: number) => void;
  onPlaceArtworkOnFloor?: (artworkId: string, xMm: number, yMm: number) => void;
  // IDs are placements, never artwork-library records.
  onMarqueeSelect?: (ids: string[], additive: boolean) => void;
  onToolChange: (tool: OpeningKind | null) => void;
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
}) {
  const [containerRef, containerSize] = useContainerSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
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
  // These handlers run after render, so later-declared geometry constants are initialized.
  const {
    drag,
    dragRef,
    beginDrag: startDrag
  } = useDragGesture<DragState>({
    onMove: (current, event) => {
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;

      // Snap the moving edge, not the pointer, to preserve the grab offset.
      const proposedEdgeMm = proposeMovingEdgePointMm(
        current.edgeStartMm,
        current.startPointerMm,
        pointerMm
      );

      // Only the wall's movement axis can snap.
      let snappedEdgeMm = proposedEdgeMm;
      let snapTargetId: string | undefined;
      let activeGuides: Guide[] = [];

      if (snapToGrid) {
        const isXAxis = Math.abs(current.axis.xMm) >= Math.abs(current.axis.yMm);
        const dragAxis = isXAxis ? "x" : "y";
        const relevantTargets: SnapTarget[] = gridSnapTargets.filter(
          (target) => target.axis === dragAxis
        );
        const snapResult = resolveSnap(proposedEdgeMm, relevantTargets, {
          thresholdMm: snapThresholdMm,
          // Store hysteresis only on the active axis.
          previousSnapTargetIds:
            dragAxis === "x"
              ? { x: current.previousSnapTargetId }
              : { y: current.previousSnapTargetId }
        });

        snappedEdgeMm = snapResult.point;
        snapTargetId = snapResult.snapTargetIds[dragAxis];
        activeGuides = snapResult.activeGuides;
      }

      const previewLengthMm = computeEdgeSnappedLengthMm(
        current.startLengthMm,
        current.edgeStartMm,
        snappedEdgeMm,
        current.axis,
        current.anchor
      );

      return { ...current, previewLengthMm, previousSnapTargetId: snapTargetId, activeGuides };
    },
    onRelease: (current) => {
      if (Math.abs(current.previewLengthMm - current.startLengthMm) < 0.5) return;
      void onCommitWallLength(current.targetWallId, current.previewLengthMm, current.anchor);
    }
  });
  // Whole-room drag uses the selected floor polygon as its move affordance.
  const {
    drag: roomDrag,
    dragRef: roomDragRef,
    beginDrag: startRoomDrag
  } = useDragGesture<RoomDragState>({
    onMove: (current, event) => {
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;

      const deltaMm: Vector2 = {
        xMm: pointerMm.xMm - current.startPointerMm.xMm,
        yMm: pointerMm.yMm - current.startPointerMm.yMm
      };
      const proposedMinCornerMm: Vector2 = {
        xMm: current.startMinCornerMm.xMm + deltaMm.xMm,
        yMm: current.startMinCornerMm.yMm + deltaMm.yMm
      };

      let snappedMinCornerMm = proposedMinCornerMm;
      let snapTargetIds = current.previousSnapTargetIds;
      let activeGuides: Guide[] = [];
      if (snapToGrid) {
        // gridSnapTargets are already all kind:"grid" — resolveSnap resolves
        // both axes independently against them in one call, the same idiom
        // objectDrag's group-drag branch uses for its box-center snap.
        const snap = resolveSnap(proposedMinCornerMm, gridSnapTargets, {
          thresholdMm: snapThresholdMm,
          previousSnapTargetIds: current.previousSnapTargetIds
        });
        snappedMinCornerMm = snap.point;
        snapTargetIds = snap.snapTargetIds;
        activeGuides = snap.activeGuides;
      }

      const cornerDeltaMm: Vector2 = {
        xMm: snappedMinCornerMm.xMm - current.startMinCornerMm.xMm,
        yMm: snappedMinCornerMm.yMm - current.startMinCornerMm.yMm
      };

      return {
        ...current,
        previewOffsetMm: {
          xMm: current.startOffsetMm.xMm + cornerDeltaMm.xMm,
          yMm: current.startOffsetMm.yMm + cornerDeltaMm.yMm
        },
        previousSnapTargetIds: snapTargetIds,
        activeGuides
      };
    },
    onRelease: (current) => {
      // Sub-threshold release is a click, not a move — must not commit (and
      // so land a phantom undo entry), same guard as the object/group drags.
      const movedMm = Math.hypot(
        current.previewOffsetMm.xMm - current.startOffsetMm.xMm,
        current.previewOffsetMm.yMm - current.startOffsetMm.yMm
      );
      if (movedMm < 0.5) return;

      void onMoveRoom?.(current.roomId, current.previewOffsetMm.xMm, current.previewOffsetMm.yMm);
    }
  });
  // A move of an existing placed object (single or group), and the HTML5 drop
  // preview for a checklist artwork. Both flow through resolvePlanPlacement,
  // so preview and commit can never disagree. Same deferred-closure note as
  // `drag`/`roomDrag` above: onMove/onRelease reference floorWallsForTool/
  // project/gridSnapTargets/snapThresholdMm/snapToGrid/captureDistanceMm/
  // onCommitPlanMove/onCommitPlanMoveGroup/suppressNextSelect, all declared
  // further down this component body.
  const {
    drag: objectDrag,
    dragRef: objectDragRef,
    beginDrag: startObjectDrag
  } = useDragGesture<ObjectDragState>({
    onMove: (current, event) => {
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;

      // Group drag: rigid translation, no per-object re-anchoring. Snap the
      // whole group's box center to the grid (grid tier only), then apply the
      // snapped delta to every member — wall members reproject onto their own
      // wall, floor members translate.
      if (current.members && current.startGroupCenterMm) {
        const rawDeltaMm: Vector2 = {
          xMm: pointerMm.xMm - current.startPointerMm.xMm,
          yMm: pointerMm.yMm - current.startPointerMm.yMm
        };
        const proposedGroupCenterMm: Vector2 = {
          xMm: current.startGroupCenterMm.xMm + rawDeltaMm.xMm,
          yMm: current.startGroupCenterMm.yMm + rawDeltaMm.yMm
        };

        let snappedGroupCenterMm = proposedGroupCenterMm;
        let snapTargetIds = current.previousSnapTargetIds;
        let activeGuides: Guide[] = [];
        if (snapToGrid) {
          // gridSnapTargets are already all kind:"grid" — no filtering needed.
          const snap = resolveSnap(proposedGroupCenterMm, gridSnapTargets, {
            thresholdMm: snapThresholdMm,
            previousSnapTargetIds: current.previousSnapTargetIds
          });
          snappedGroupCenterMm = snap.point;
          snapTargetIds = snap.snapTargetIds;
          activeGuides = snap.activeGuides;
        }

        const deltaMm: Vector2 = {
          xMm: snappedGroupCenterMm.xMm - current.startGroupCenterMm.xMm,
          yMm: snappedGroupCenterMm.yMm - current.startGroupCenterMm.yMm
        };
        const previewRectById = new Map<string, PlanRect>(
          current.members.map((member) => [
            member.id,
            resolvePlanGroupMemberMove(member, deltaMm).rect
          ])
        );

        return {
          ...current,
          previewGroupCenterMm: snappedGroupCenterMm,
          previewRectById,
          previousSnapTargetIds: snapTargetIds,
          activeGuides
        };
      }

      // Preserve the grab offset by moving the center by pointer delta.
      const proposedCenterMm: Vector2 = {
        xMm: current.startCenterMm.xMm + (pointerMm.xMm - current.startPointerMm.xMm),
        yMm: current.startCenterMm.yMm + (pointerMm.yMm - current.startPointerMm.yMm)
      };

      const result = resolvePlanPlacement(proposedCenterMm, {
        walls: floorWallsForTool,
        // Do not snap to the moving object's old position.
        wallObjects: snappingWallObjects.filter((object) => object.id !== current.objectId),
        movingSize: current.movingSize,
        wallFootprintWidthMm: current.wallFootprintWidthMm,
        movingKind: current.kind,
        floatPolicy: current.floatPolicy,
        // Keep wall-capture hysteresis across pointer moves.
        currentAnchorWallId: current.currentAnchorWallId,
        captureDistanceMm,
        gridTargets: gridSnapTargets,
        snapToGrid,
        thresholdMm: snapThresholdMm,
        previousSnapTargetIds: current.previousSnapTargetIds,
        rotationDeg: current.rotationDeg
      });

      return {
        ...current,
        previewPlanRect: result.planRect,
        previewPlacement: result.placement,
        currentAnchorWallId:
          result.placement.anchor === "wall" ? result.placement.wallId : null,
        previousSnapTargetIds: result.snapTargetIds,
        activeGuides: result.activeGuides
      };
    },
    onRelease: (current) => {
      // Commit a group move once; sub-threshold releases remain clicks.
      if (current.members && current.startGroupCenterMm && current.previewGroupCenterMm) {
        const deltaMm: Vector2 = {
          xMm: current.previewGroupCenterMm.xMm - current.startGroupCenterMm.xMm,
          yMm: current.previewGroupCenterMm.yMm - current.startGroupCenterMm.yMm
        };
        if (Math.hypot(deltaMm.xMm, deltaMm.yMm) < 0.5) return;

        // Prevent the trailing click from collapsing the multi-selection.
        suppressNextSelect();
        const moves = current.members.map(
          (member) => resolvePlanGroupMemberMove(member, deltaMm).commit
        );
        onCommitPlanMoveGroup?.(moves);
        return;
      }

      // Sub-threshold releases remain clicks and create no undo entry.
      const movedMm = Math.hypot(
        current.previewPlanRect.centerXMm - current.startCenterMm.xMm,
        current.previewPlanRect.centerYMm - current.startCenterMm.yMm
      );
      if (movedMm < 0.5) return;

      // Invalid wall-only drops keep the original placement.
      if (current.previewPlacement.anchor === "none") return;

      onCommitPlanMove?.(current.objectId, current.previewPlacement);
    }
  });
  const [dropGhost, setDropGhost] = useState<DropGhostState | null>(null);
  const dropSnapTargetIdsRef = useRef<SnapTargetIds | undefined>(undefined);
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
  const [partitionDuplicateGhost, setPartitionDuplicateGhost] =
    useState<PartitionDuplicateGhostState | null>(null);
  const partitionDuplicateSnapIdsRef = useRef<SnapTargetIds | undefined>(undefined);
  const toolSnapTargetIdsRef = useRef<SnapTargetIds | undefined>(undefined);
  // Prevent a gesture's trailing native click from placing another object.
  const suppressNextToolClickRef = useRef(false);

  // Ref lets keyboard handlers read current points without resubscribing.
  const [draw, setDraw] = useState<DrawState | null>(null);
  const drawRef = useRef<DrawState | null>(null);
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  // A plain vertex click still selects it for Delete/Backspace.
  const {
    drag: vertexDrag,
    dragRef: vertexDragRef,
    beginDrag: startVertexDrag
  } = useDragGesture<VertexDragState>({
    onMove: (current, event) => {
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;

      const placement = project.floor.rooms.find(
        (candidate) => candidate.roomId === current.roomId
      );
      if (!placement) return null;

      const deltaMm: Vector2 = {
        xMm: pointerMm.xMm - current.startPointerMm.xMm,
        yMm: pointerMm.yMm - current.startPointerMm.yMm
      };
      const proposedLocalMm: Vector2 = {
        xMm: current.startLocalMm.xMm + deltaMm.xMm,
        yMm: current.startLocalMm.yMm + deltaMm.yMm
      };

      let snappedLocalMm = proposedLocalMm;
      let snapTargetIds = current.previousSnapTargetIds;
      let activeGuides: Guide[] = [];
      if (snapToGrid) {
        // Snap in floor space, then convert back to room-local coordinates.
        const proposedFloorMm: Vector2 = {
          xMm: proposedLocalMm.xMm + placement.offsetXMm,
          yMm: proposedLocalMm.yMm + placement.offsetYMm
        };
        const snap = resolveSnap(proposedFloorMm, gridSnapTargets, {
          thresholdMm: snapThresholdMm,
          previousSnapTargetIds: current.previousSnapTargetIds
        });
        snappedLocalMm = {
          xMm: snap.point.xMm - placement.offsetXMm,
          yMm: snap.point.yMm - placement.offsetYMm
        };
        snapTargetIds = snap.snapTargetIds;
        activeGuides = snap.activeGuides;
      }

      const valid = canMoveRoomVertex(placement.room, current.vertexId, snappedLocalMm);

      return {
        ...current,
        previewLocalMm: snappedLocalMm,
        valid,
        previousSnapTargetIds: snapTargetIds,
        activeGuides
      };
    },
    onRelease: (current) => {
      const movedMm = Math.hypot(
        current.previewLocalMm.xMm - current.startLocalMm.xMm,
        current.previewLocalMm.yMm - current.startLocalMm.yMm
      );
      // Invalid or sub-threshold releases revert by skipping the commit.
      if (movedMm < 0.5 || !current.valid) return;

      void onMoveRoomVertex?.(current.roomId, current.vertexId, current.previewLocalMm);
    }
  });
  // Slide a selected non-rectangle wall along its perpendicular.
  const {
    drag: wallDrag,
    dragRef: wallDragRef,
    beginDrag: startWallDrag
  } = useDragGesture<WallDragState>({
    onMove: (current, event) => {
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;

      const deltaMm: Vector2 = {
        xMm: pointerMm.xMm - current.startPointerMm.xMm,
        yMm: pointerMm.yMm - current.startPointerMm.yMm
      };
      // Project diagonal pointer movement onto the wall normal.
      const offsetMm = deltaMm.xMm * current.normal.xMm + deltaMm.yMm * current.normal.yMm;

      // Validate previews with the domain operation without mutating the store.
      let valid = true;
      try {
        moveRoomWall(project, current.roomId, current.wallId, offsetMm);
      } catch {
        valid = false;
      }

      return { ...current, previewOffsetMm: offsetMm, valid };
    },
    onRelease: (current) => {
      // Invalid or sub-threshold releases revert by skipping the commit.
      if (Math.abs(current.previewOffsetMm) < 0.5 || !current.valid) return;

      void onMoveRoomWall?.(current.roomId, current.wallId, current.previewOffsetMm);
    }
  });
  // Links the hovered wall edge to its slide handle.
  const [hoveredWallId, setHoveredWallId] = useState<string | null>(null);
  // Escape disarms the tool; onRelease gates the commit because useDragGesture
  // has no imperative cancel. Its inert listeners remain until pointerup.
  const {
    drag: partitionDraw,
    dragRef: partitionDrawRef,
    beginDrag: startPartitionDraw
  } = useDragGesture<PartitionDrawState>({
    onMove: (current, event) => {
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;
      const endMm = snapPartitionDrawPoint(pointerMm, current.startMm, event.shiftKey);
      return { ...current, endMm, invalid: partitionDrawInvalid(current.startMm, endMm) };
    },
    onRelease: (current) => {
      onPartitionToolChange?.(false);
      if (!current.endMm || current.invalid || !partitionToolActive) return;
      onAddFreestandingWall?.(current.startMm, current.endMm);
    }
  });
  // Pure grid snapping avoids Shift axis-lock degenerating the rectangle.
  // onRelease always disarms and commits only while the tool remains armed.
  const {
    drag: rectDraw,
    dragRef: rectDrawRef,
    beginDrag: startRectDraw
  } = useDragGesture<RectDrawState>({
    onMove: (current, event) => {
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;
      const endMm = snapDrawPoint(pointerMm, null, event.shiftKey);
      return { ...current, endMm, invalid: rectDrawInvalid(current.startMm, endMm) };
    },
    onRelease: (current) => {
      onDrawRectChange?.(false);
      if (!current.endMm || current.invalid || !drawRectActive) return;
      onAddRectangleRoom?.({
        offsetXMm: Math.min(current.startMm.xMm, current.endMm.xMm),
        offsetYMm: Math.min(current.startMm.yMm, current.endMm.yMm),
        widthMm: Math.abs(current.endMm.xMm - current.startMm.xMm),
        depthMm: Math.abs(current.endMm.yMm - current.startMm.yMm)
      });
    }
  });
  // Partition edit drag supports whole-body moves and endpoint changes.
  const {
    drag: partitionDrag,
    dragRef: partitionDragRef,
    beginDrag: startPartitionDrag
  } = useDragGesture<PartitionDragState>({
    onMove: (current, event) => {
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;
      const deltaMm = {
        xMm: pointerMm.xMm - current.startPointerMm.xMm,
        yMm: pointerMm.yMm - current.startPointerMm.yMm
      };

      if (current.mode === "move") {
        // Only raw pointer travel can activate an axis; snaps cannot create a move.
        const latchThresholdMm = snapThresholdMm / 2;
        const movedAxes = getPartitionMovedAxes(current.movedAxes, deltaMm, latchThresholdMm);
        if (!movedAxes.x && !movedAxes.y) {
          return { ...current, movedAxes };
        }

        // Snap the midpoint; wall-aware targets outrank grid and work with grid off.
        const origMid = {
          xMm: (current.startFloorMm.xMm + current.endFloorMm.xMm) / 2,
          yMm: (current.startFloorMm.yMm + current.endFloorMm.yMm) / 2
        };
        const proposedMid = { xMm: origMid.xMm + deltaMm.xMm, yMm: origMid.yMm + deltaMm.yMm };

        const placement = project.floor.rooms.find((candidate) =>
          candidate.room.freestandingWalls.some((wall) => wall.id === current.wallId)
        );
        const partition = placement?.room.freestandingWalls.find(
          (wall) => wall.id === current.wallId
        );
        const partitionTargets: SnapTarget[] =
          placement && partition
            ? getPartitionMoveSnapTargets({
                room: placement.room,
                placementOffsetMm: { xMm: placement.offsetXMm, yMm: placement.offsetYMm },
                partition,
                proposedMidFloorMm: proposedMid,
                incrementMm: minorGridMm
              })
            : [];

        const snap = resolveSnap(
          proposedMid,
          [...partitionTargets, ...(snapToGrid ? gridSnapTargets : [])],
          { thresholdMm: snapThresholdMm, previousSnapTargetIds: current.previousSnapTargetIds }
        );
        const appliedDelta = {
          xMm: snap.point.xMm - origMid.xMm,
          yMm: snap.point.yMm - origMid.yMm
        };
        // Clip guides to the room bounds with a small overhang.
        const guidePadMm = 200;
        const roomBox = placement ? getPlacedRoomBounds(placement) : null;
        const activeGuides = roomBox
          ? snap.activeGuides.map((guide) => ({
              ...guide,
              extentMm:
                guide.axis === "x"
                  ? { startMm: roomBox.minY - guidePadMm, endMm: roomBox.maxY + guidePadMm }
                  : { startMm: roomBox.minX - guidePadMm, endMm: roomBox.maxX + guidePadMm }
            }))
          : snap.activeGuides;
        return {
          ...current,
          previewStartFloorMm: {
            xMm: current.startFloorMm.xMm + appliedDelta.xMm,
            yMm: current.startFloorMm.yMm + appliedDelta.yMm
          },
          previewEndFloorMm: {
            xMm: current.endFloorMm.xMm + appliedDelta.xMm,
            yMm: current.endFloorMm.yMm + appliedDelta.yMm
          },
          activeGuides,
          movedAxes,
          previousSnapTargetIds: snap.snapTargetIds
        };
      }

      // Endpoint precedence: Shift axis-lock > other wall faces > grid.
      const anchor = current.mode === "start" ? current.endFloorMm : current.startFloorMm;
      const kissWalls = floorWallsForTool.filter((wall) => {
        const parsed = parseFaceWallId(wall.id);
        return parsed === null || parsed.freestandingWallId !== current.wallId;
      });
      const kiss = snapDrawPointToRooms(pointerMm, kissWalls, snapThresholdMm);
      let moved: Vector2 = kiss
        ? { xMm: kiss.pointMm.xMm, yMm: kiss.pointMm.yMm }
        : snapDrawPoint({ xMm: pointerMm.xMm, yMm: pointerMm.yMm }, anchor, false);
      if (event.shiftKey) {
        const dx = Math.abs(pointerMm.xMm - anchor.xMm);
        const dy = Math.abs(pointerMm.yMm - anchor.yMm);
        moved =
          dx >= dy ? { xMm: moved.xMm, yMm: anchor.yMm } : { xMm: anchor.xMm, yMm: moved.yMm };
      }
      return current.mode === "start"
        ? { ...current, previewStartFloorMm: moved, activeGuides: [], previousSnapTargetIds: undefined }
        : { ...current, previewEndFloorMm: moved, activeGuides: [], previousSnapTargetIds: undefined };
    },
    onRelease: (current) => {
      if (current.mode === "move") {
        if (!current.movedAxes.x && !current.movedAxes.y) return;
        const delta = {
          xMm: current.previewStartFloorMm.xMm - current.startFloorMm.xMm,
          yMm: current.previewStartFloorMm.yMm - current.startFloorMm.yMm
        };
        if (Math.hypot(delta.xMm, delta.yMm) < 0.5) return;
        onMoveFreestandingWall?.(current.wallId, delta);
        return;
      }
      const next =
        current.mode === "start" ? current.previewStartFloorMm : current.previewEndFloorMm;
      const original = current.mode === "start" ? current.startFloorMm : current.endFloorMm;
      if (Math.hypot(next.xMm - original.xMm, next.yMm - original.yMm) < 0.5) return;
      onMoveFreestandingWallEndpoint?.(current.wallId, current.mode, next);
    }
  });

  const [selectedVertexId, setSelectedVertexId] = useState<string | null>(null);
  const selectedVertexIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedVertexIdRef.current = selectedVertexId;
  }, [selectedVertexId]);
  useEffect(() => {
    // Prevent Delete from targeting a stale vertex after changing modes.
    setSelectedVertexId(null);
  }, [reshapeRoomId]);

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
  const planInteractionActive = Boolean(
    drag ||
      objectDrag ||
      roomDrag ||
      vertexDrag ||
      wallDrag ||
      partitionDrag ||
      partitionDraw ||
      rectDraw ||
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
      wallResize: drag
        ? { wallId: drag.targetWallId, lengthMm: drag.previewLengthMm, anchor: drag.anchor }
        : undefined,
      roomMove: roomDrag
        ? {
            roomId: roomDrag.roomId,
            offsetXMm: roomDrag.previewOffsetMm.xMm,
            offsetYMm: roomDrag.previewOffsetMm.yMm
          }
        : undefined,
      vertexMove: vertexDrag
        ? {
            roomId: vertexDrag.roomId,
            vertexId: vertexDrag.vertexId,
            xMm: vertexDrag.previewLocalMm.xMm,
            yMm: vertexDrag.previewLocalMm.yMm
          }
        : undefined,
      wallSlide: wallDrag
        ? { roomId: wallDrag.roomId, wallId: wallDrag.wallId, offsetMm: wallDrag.previewOffsetMm }
        : undefined
    };
    return applyPlanPreview(project, preview);
  }, [project, drag, roomDrag, vertexDrag, wallDrag]);

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
        dragRef.current ||
          roomDragRef.current ||
          objectDragRef.current ||
          vertexDragRef.current ||
          wallDragRef.current
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
  const { isSpaceDown, panning, zoomAtCenter, canZoomIn, canZoomOut, beginTouchPan } = gestures;
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
      activeTool === "blocked-zone"
        ? floorWallsForTool
        : floorWallsForTool.filter((wall) => parseFaceWallId(wall.id) === null),
    [floorWallsForTool, activeTool]
  );

  const movingSize = useMemo(() => {
    if (!activeTool) return null;
    const { widthMm, heightMm } = getDefaultOpeningSizeMm(activeTool);
    const depthMm =
      activeTool === "blocked-zone" ? DEFAULT_FLOOR_OBJECT_DEPTH_MM : WALL_OBJECT_PLAN_DEPTH_MM;
    return { widthMm, heightMm, depthMm };
  }, [activeTool]);

  const captureDistanceMm = pixelsPerMm > 0 ? WALL_CAPTURE_PX / pixelsPerMm : 0;
  const wallObjectMinDepthMm =
    pixelsPerMm > 0 ? MIN_WALL_OBJECT_DEPTH_PX / pixelsPerMm : 0;
  const objectHitMinMm = pixelsPerMm > 0 ? MIN_OBJECT_HIT_PX / pixelsPerMm : 0;

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
  const previousMeasureTargetIdRef = useRef<string | undefined>(undefined);
  const [snappedMeasurementEndpoint, setSnappedMeasurementEndpoint] = useState<"a" | "b" | null>(null);
  const measureGestureRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    startedDrawing: boolean;
    refining: boolean;
  } | null>(null);

  function resolvePlanMeasurePoint(
    proposed: MeasurePoint,
    event: Pick<ReactPointerEvent<SVGSVGElement>, "shiftKey" | "metaKey" | "ctrlKey">
  ): MeasurePoint {
    const anchor =
      measurementState?.phase === "drawing"
        ? measurementState.start
        : measurementState?.phase === "refining"
          ? measurementState[measurementState.endpoint === "start" ? "end" : "start"]
          : null;
    const constrained = event.shiftKey && anchor
      ? constrainMeasurePointToAxis(anchor, proposed)
      : proposed;
    if (event.metaKey || event.ctrlKey) {
      previousMeasureTargetIdRef.current = undefined;
      return constrained;
    }
    const points = [...(measureSources.points ?? [])];
    if (gridVisible && snapToGrid && minorGridMm > 0) {
      points.push({
        id: `grid:${Math.round(constrained.xMm / minorGridMm)}:${Math.round(constrained.yMm / minorGridMm)}`,
        kind: "grid",
        point: {
          xMm: Math.round(constrained.xMm / minorGridMm) * minorGridMm,
          yMm: Math.round(constrained.yMm / minorGridMm) * minorGridMm
        }
      });
    }
    const resolved = resolveMeasurePoint(
      constrained,
      buildMeasurePointCandidates(constrained, { points, segments: measureSources.segments }),
      {
        thresholdMm: snapThresholdMm,
        previousTargetId: previousMeasureTargetIdRef.current
      }
    );
    previousMeasureTargetIdRef.current = resolved.target?.id;
    const activeEndpoint =
      measurementState?.phase === "refining"
        ? measurementState.endpoint === "start" ? "a" : "b"
        : measurementState?.phase === "drawing"
          ? "b"
          : "a";
    setSnappedMeasurementEndpoint(resolved.snapped ? activeEndpoint : null);
    return resolved.point;
  }

  function handleMeasurePointerDownCapture(event: ReactPointerEvent<SVGSVGElement>): boolean {
    if (!measurementActive || !measurementState || !onMeasurementAction) return false;
    if (!canPlanMeasurementClaimPointer(event.button, isSpaceDown)) return false;
    const target = event.target as Element | null;
    const endpoint = target?.closest(".measurement-endpoint")?.getAttribute("data-endpoint");
    if (endpoint === "a" || endpoint === "b") {
      onMeasurementAction({
        type: "begin-refinement",
        endpoint: endpoint === "a" ? "start" : "end"
      });
      measureGestureRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        startedDrawing: false,
        refining: true
      };
    } else if (target?.closest(".measurement-overlay")) {
      // A measurement owns clicks on its body. It is already selected, so the
      // only required action is preventing a new endpoint from being placed.
      event.stopPropagation();
      return true;
    } else {
      const proposed = toSvgMm(event.clientX, event.clientY);
      if (!proposed) return true;
      const point = resolvePlanMeasurePoint(proposed, event);
      const startedDrawing = measurementState.phase !== "drawing";
      if (startedDrawing) onMeasurementAction({ type: "begin", point });
      measureGestureRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        startedDrawing,
        refining: false
      };
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handleMeasurePointerMove(event: ReactPointerEvent<SVGSVGElement>): boolean {
    if (!measurementActive || !measurementState || !onMeasurementAction) return false;
    if (measurementState.phase !== "drawing" && measurementState.phase !== "refining") return true;
    const proposed = toSvgMm(event.clientX, event.clientY);
    if (!proposed) return true;
    const point = resolvePlanMeasurePoint(proposed, event);
    onMeasurementAction({
      type: measurementState.phase === "refining" ? "preview-refinement" : "preview",
      point
    });
    return true;
  }

  function handleMeasurePointerUpCapture(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = measureGestureRef.current;
    if (!measurementActive || !measurementState || !onMeasurementAction || !gesture) return;
    if (gesture.pointerId !== event.pointerId) return;
    const proposed = toSvgMm(event.clientX, event.clientY);
    if (gesture.refining) {
      if (proposed) onMeasurementAction({ type: "preview-refinement", point: resolvePlanMeasurePoint(proposed, event) });
      onMeasurementAction({ type: "commit-refinement" });
    } else if (proposed) {
      const travelled = Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY);
      // The second click completes regardless of slop. A first press completes
      // only when it was a genuine drag; jitter stays in click-click drawing.
      if (!gesture.startedDrawing || travelled > MEASURE_DRAG_SLOP_PX) {
        onMeasurementAction({ type: "complete", point: resolvePlanMeasurePoint(proposed, event) });
      }
    }
    measureGestureRef.current = null;
    previousMeasureTargetIdRef.current = undefined;
    event.preventDefault();
    // Touch must reach the viewport hook's window listener so its pointer
    // bookkeeping is released; no underlying edit began because pointerdown
    // was already captured by Measure.
    if (event.pointerType !== "touch") event.stopPropagation();
  }

  function cancelMeasurePointerGesture() {
    const action = measurementState ? planMeasurementCancelAction(measurementState) : null;
    if (action) onMeasurementAction?.(action);
    measureGestureRef.current = null;
    previousMeasureTargetIdRef.current = undefined;
    setSnappedMeasurementEndpoint(null);
  }

  function handleMeasurePointerCancelCapture(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = measureGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    cancelMeasurePointerGesture();
    event.preventDefault();
    if (event.pointerType !== "touch") event.stopPropagation();
  }

  // Interaction-only geometry: snapping measures framed artwork edges without
  // changing persisted data or the selection geometry owned by a later phase.
  const snappingWallObjects = useMemo(
    () =>
      project.wallObjects.map((object) => withArtworkFootprintFromMap(object, artworksById)),
    [project.wallObjects, artworksById]
  );

  // Build complete gap/solid chains in room-local space, then lift them once
  // for the plan overlay. A valid draw preview participates too, so its live
  // feedback uses the exact geometry that will be committed.
  const partitionChainsFloor = useMemo<{
    chains: PartitionDimensionChains;
    partition: FreestandingWall;
  } | null>(() => {
    const rooms = project.floor.rooms;

    // Resolves the room a not-yet-committed partition segment sits in (by its
    // midpoint) and hand-builds the synthetic FreestandingWall the chain
    // functions need — shared by the draw preview and the duplicate-ghost
    // preview below, the two cases where there's no committed wall yet to read
    // a room id off of. `overrides` carries fields a caller wants copied from a
    // source wall instead of defaulted off the destination room.
    function previewPartitionChains(
      startFloorMm: Point,
      endFloorMm: Point,
      thicknessMm: number,
      id: string,
      overrides: Partial<Pick<FreestandingWall, "heightMm" | "defaultCenterlineHeightMm">> = {}
    ): { chains: PartitionDimensionChains; partition: FreestandingWall } | null {
      const roomId = roomIdContainingPoint(project, midpointOf(startFloorMm, endFloorMm));
      const placement = roomId ? rooms.find((candidate) => candidate.roomId === roomId) ?? null : null;
      if (!placement) return null;
      const offset = { xMm: placement.offsetXMm, yMm: placement.offsetYMm };
      const partition: FreestandingWall = {
        id,
        roomId: placement.roomId,
        name: "Partition preview",
        startXMm: startFloorMm.xMm - offset.xMm,
        startYMm: startFloorMm.yMm - offset.yMm,
        endXMm: endFloorMm.xMm - offset.xMm,
        endYMm: endFloorMm.yMm - offset.yMm,
        thicknessMm,
        heightMm: overrides.heightMm ?? placement.room.heightMm,
        ...(overrides.defaultCenterlineHeightMm !== undefined
          ? { defaultCenterlineHeightMm: overrides.defaultCenterlineHeightMm }
          : {})
      };
      return {
        chains: liftPartitionChains(getPartitionDimensionChains(placement.room, partition), offset),
        partition
      };
    }

    if (partitionDraw?.endMm && !partitionDraw.invalid) {
      const result = previewPartitionChains(
        partitionDraw.startMm,
        partitionDraw.endMm,
        DEFAULT_FREESTANDING_THICKNESS_MM,
        "partition-draw-preview"
      );
      if (result) return result;
    }

    if (partitionDuplicateGhost && !partitionDuplicateGhost.invalid) {
      const source = rooms
        .flatMap((candidate) => candidate.room.freestandingWalls)
        .find((wall) => wall.id === duplicatePartitionSourceWallId);
      if (source) {
        const result = previewPartitionChains(
          partitionDuplicateGhost.startMm,
          partitionDuplicateGhost.endMm,
          source.thicknessMm,
          "partition-duplicate-preview",
          { heightMm: source.heightMm, defaultCenterlineHeightMm: source.defaultCenterlineHeightMm }
        );
        if (result) return result;
      }
    }

    // The selected/dragged case keeps its room fixed to the committed wall's
    // own placement rather than re-resolving by midpoint — an in-flight drag
    // can pass outside the room polygon mid-gesture (near a boundary), and the
    // dimension chain should keep reading against the room it actually belongs
    // to, not flicker off when that happens.
    const activeWallId = partitionDrag?.wallId ?? selectedFreestandingWallId;
    if (!activeWallId) return null;

    const placement = rooms.find((candidate) =>
      candidate.room.freestandingWalls.some((wall) => wall.id === activeWallId)
    );
    const committed = placement?.room.freestandingWalls.find((wall) => wall.id === activeWallId);
    if (!placement || !committed) return null;

    const offset = { xMm: placement.offsetXMm, yMm: placement.offsetYMm };
    const partition =
      partitionDrag && partitionDrag.wallId === activeWallId
        ? {
            ...committed,
            startXMm: partitionDrag.previewStartFloorMm.xMm - offset.xMm,
            startYMm: partitionDrag.previewStartFloorMm.yMm - offset.yMm,
            endXMm: partitionDrag.previewEndFloorMm.xMm - offset.xMm,
            endYMm: partitionDrag.previewEndFloorMm.yMm - offset.yMm
          }
        : committed;

    return {
      chains: liftPartitionChains(getPartitionDimensionChains(placement.room, partition), offset),
      partition
    };
  }, [
    duplicatePartitionSourceWallId,
    partitionDraw,
    partitionDrag,
    partitionDuplicateGhost,
    selectedFreestandingWallId,
    project.floor.rooms
  ]);

  function disarmTool() {
    onToolChange(null);
  }

  // Reset ghost and snap hysteresis whenever the controlled tool changes.
  useEffect(() => {
    setToolGhost(null);
    toolSnapTargetIdsRef.current = undefined;
  }, [activeTool]);

  useDisarmOnEscape(activeTool, disarmTool);

  function handleToolPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!activeTool || !movingSize || drag || roomDrag) return;

    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    const result = resolvePlanPlacement(pointerMm, {
      walls: openingToolWalls,
      wallObjects: snappingWallObjects,
      movingSize,
      movingKind: activeTool,
      floatPolicy: activeTool === "blocked-zone" ? "float" : "capture-any",
      currentAnchorWallId: null,
      captureDistanceMm,
      gridTargets: gridSnapTargets,
      snapToGrid,
      thresholdMm: snapThresholdMm,
      previousSnapTargetIds: toolSnapTargetIdsRef.current
    });

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

  useEffect(() => {
    setPartitionDuplicateGhost(null);
    partitionDuplicateSnapIdsRef.current = undefined;
  }, [duplicatePartitionSourceWallId]);

  useDisarmOnEscape(duplicatePartitionSourceWallId, () => onDuplicatePartitionChange?.(false));

  function handlePartitionDuplicateMove(event: ReactPointerEvent<SVGRectElement>) {
    if (!duplicatePartitionSourceWallId) return;
    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!pointerMm) return;
    const sourcePlacement = project.floor.rooms.find((candidate) =>
      candidate.room.freestandingWalls.some((wall) => wall.id === duplicatePartitionSourceWallId)
    );
    const source = sourcePlacement?.room.freestandingWalls.find(
      (wall) => wall.id === duplicatePartitionSourceWallId
    );
    if (!source) return;

    const roomId = roomIdContainingPoint(project, pointerMm);
    const destination = roomId
      ? project.floor.rooms.find((candidate) => candidate.roomId === roomId) ?? null
      : null;
    const targets: SnapTarget[] = [
      ...(destination
        ? getPartitionMoveSnapTargets({
            room: destination.room,
            placementOffsetMm: {
              xMm: destination.offsetXMm,
              yMm: destination.offsetYMm
            },
            partition: { ...source, id: "partition-duplicate-preview" },
            proposedMidFloorMm: pointerMm,
            incrementMm: minorGridMm
          })
        : []),
      ...(snapToGrid ? gridSnapTargets : [])
    ];
    const snap = resolveSnap(pointerMm, targets, {
      thresholdMm: snapThresholdMm,
      previousSnapTargetIds: partitionDuplicateSnapIdsRef.current
    });
    partitionDuplicateSnapIdsRef.current = snap.snapTargetIds;
    const halfDx = (source.endXMm - source.startXMm) / 2;
    const halfDy = (source.endYMm - source.startYMm) / 2;
    setPartitionDuplicateGhost({
      startMm: { xMm: snap.point.xMm - halfDx, yMm: snap.point.yMm - halfDy },
      endMm: { xMm: snap.point.xMm + halfDx, yMm: snap.point.yMm + halfDy },
      thicknessMm: source.thicknessMm,
      invalid: roomIdContainingPoint(project, snap.point) === null,
      activeGuides: snap.activeGuides
    });
  }

  function handlePartitionDuplicateClick(event: ReactMouseEvent<SVGRectElement>) {
    event.stopPropagation();
    if (!duplicatePartitionSourceWallId || !partitionDuplicateGhost || partitionDuplicateGhost.invalid) {
      return;
    }
    const center = midpointOf(partitionDuplicateGhost.startMm, partitionDuplicateGhost.endMm);
    onDuplicateFreestandingWall?.(duplicatePartitionSourceWallId, center);
    onDuplicatePartitionChange?.(false);
  }

  // Arming starts fresh; disarming discards uncommitted points.
  useEffect(() => {
    setDraw(
      drawRoomActive
        ? { points: [], cursorMm: null, invalid: false, closing: false, snap: null }
        : null
    );
  }, [drawRoomActive]);

  // Enter closes, Backspace removes a point, and Escape cancels.
  useEffect(() => {
    if (!drawRoomActive) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onDrawRoomChange?.(false);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        attemptCloseDraw();
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        setDraw((state) =>
          state
            ? { ...state, points: state.points.slice(0, -1), invalid: false, closing: false, snap: null }
            : state
        );
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawRoomActive]);

  // In reshape mode, Escape exits and Delete/Backspace merges at the selected vertex.
  useEffect(() => {
    if (!reshapeRoomId) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onReshapeRoomChange?.(null);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        const vertexId = selectedVertexIdRef.current;
        if (!vertexId || !onDeleteRoomVertex || !reshapeRoomId) return;
        event.preventDefault();
        setSelectedVertexId(null);
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

  // Partition drawing uses the same absolute grid as other tools, augmented
  // by room-relative clean-inset families so dimensions stay round even when
  // the room origin or perimeter is off the floor lattice.
  function snapPartitionDrawPoint(
    pointerMm: Vector2,
    prev: Vector2 | null,
    shiftKey: boolean
  ): Vector2 {
    let result = pointerMm;
    if (snapToGrid) {
      const roomId = roomIdContainingPoint(project, pointerMm);
      const placement = roomId
        ? project.floor.rooms.find((candidate) => candidate.roomId === roomId) ?? null
        : null;
      const targets: SnapTarget[] = [
        ...(placement ? getPartitionDrawSnapTargets(placement, pointerMm, minorGridMm) : []),
        ...gridSnapTargets
      ];
      if (prev) {
        targets.push(
          { id: "partition-draw-prev-x", kind: "grid", axis: "x", point: { xMm: prev.xMm, yMm: 0 } },
          { id: "partition-draw-prev-y", kind: "grid", axis: "y", point: { xMm: 0, yMm: prev.yMm } }
        );
      }
      result = resolveSnap(pointerMm, targets, { thresholdMm: snapThresholdMm }).point;
    }
    if (shiftKey && prev) {
      const dx = Math.abs(pointerMm.xMm - prev.xMm);
      const dy = Math.abs(pointerMm.yMm - prev.yMm);
      result =
        dx >= dy ? { xMm: result.xMm, yMm: prev.yMm } : { xMm: prev.xMm, yMm: result.yMm };
    }
    return result;
  }

  // Existing-room snapping outranks grid; Shift axis-lock applies afterward.
  function snapDrawCandidate(
    pointerMm: Vector2,
    prev: Vector2 | null,
    shiftKey: boolean
  ): { point: Vector2; snap: DrawRoomSnap | null } {
    const snap = snapDrawPointToRooms(pointerMm, floorWallsForTool, snapThresholdMm);
    if (!snap) {
      return { point: snapDrawPoint(pointerMm, prev, shiftKey), snap: null };
    }
    let point: Vector2 = { xMm: snap.pointMm.xMm, yMm: snap.pointMm.yMm };
    if (shiftKey && prev) {
      const dx = Math.abs(pointerMm.xMm - prev.xMm);
      const dy = Math.abs(pointerMm.yMm - prev.yMm);
      point =
        dx >= dy ? { xMm: point.xMm, yMm: prev.yMm } : { xMm: prev.xMm, yMm: point.yMm };
    }
    return { point, snap };
  }

  // Close on a shared wall only when the resulting polygon remains simple.
  function drawCloseOnWall(points: Vector2[], candidate: Vector2, snap: DrawRoomSnap | null): boolean {
    if (!snap || points.length < 3) return false;
    const wall = floorWallsForTool.find((candidateWall) => candidateWall.id === snap.wallId);
    if (!wall) return false;
    if (!canCloseOnWall(points, candidate, wall)) return false;
    if (drawSegmentInvalid(points, candidate)) return false;
    return isSimplePolygon([...points, candidate]);
  }

  // The adjacent segment may share its endpoint but may not backtrack collinearly.
  function drawSegmentInvalid(points: Vector2[], candidate: Vector2): boolean {
    const n = points.length;
    if (n === 0) return false;
    const last = points[n - 1];
    for (let i = 0; i < n - 1; i += 1) {
      const s1 = points[i];
      const s2 = points[i + 1];
      if (i === n - 2) {
        const crossV =
          (s1.xMm - last.xMm) * (candidate.yMm - last.yMm) -
          (s1.yMm - last.yMm) * (candidate.xMm - last.xMm);
        const dot =
          (s1.xMm - last.xMm) * (candidate.xMm - last.xMm) +
          (s1.yMm - last.yMm) * (candidate.yMm - last.yMm);
        if (Math.abs(crossV) <= DRAW_EPS && dot > DRAW_EPS) return true;
      } else if (segmentsIntersect(last, candidate, s1, s2)) {
        return true;
      }
    }
    return false;
  }

  function closeRadiusMm(): number {
    return pixelsPerMm > 0 ? CLOSE_HANDLE_PX / pixelsPerMm : 0;
  }

  function isWithinClose(points: Vector2[], pointerMm: Vector2): boolean {
    if (points.length < 3) return false;
    return (
      Math.hypot(pointerMm.xMm - points[0].xMm, pointerMm.yMm - points[0].yMm) <=
      closeRadiusMm()
    );
  }

  function attemptCloseDraw() {
    const current = drawRef.current;
    if (!current || current.points.length < 3) return;
    if (!isSimplePolygon(current.points)) {
      setDraw((state) => (state ? { ...state, invalid: true } : state));
      return;
    }
    onAddPolygonRoom?.(current.points.map((point) => ({ xMm: point.xMm, yMm: point.yMm })));
    onDrawRoomChange?.(false);
  }

  function handleDrawPointerMove(event: ReactPointerEvent<SVGRectElement>) {
    const current = drawRef.current;
    if (!current) return;
    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    if (isWithinClose(current.points, pointerMm)) {
      setDraw((state) =>
        state
          ? { ...state, cursorMm: state.points[0], invalid: false, closing: true, snap: null }
          : state
      );
      return;
    }

    const prev = current.points.at(-1) ?? null;
    const { point: candidate, snap } = snapDrawCandidate(pointerMm, prev, event.shiftKey);
    // Preview a shared-wall close with the same affordance as the first vertex.
    const willClose = drawCloseOnWall(current.points, candidate, snap);
    const invalid = !willClose && drawSegmentInvalid(current.points, candidate);
    setDraw((state) =>
      state ? { ...state, cursorMm: candidate, invalid, closing: willClose, snap } : state
    );
  }

  function handleDrawClick(event: ReactMouseEvent<SVGRectElement>) {
    // Prevent the SVG background/tool handler from also running.
    event.stopPropagation();
    // Swallow the trailing click from a space/middle-button pan.
    if (suppressNextToolClickRef.current) {
      suppressNextToolClickRef.current = false;
      return;
    }
    const current = drawRef.current;
    if (!current) return;
    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    if (isWithinClose(current.points, pointerMm)) {
      attemptCloseDraw();
      return;
    }

    const prev = current.points.at(-1) ?? null;
    const { point: candidate, snap } = snapDrawCandidate(pointerMm, prev, event.shiftKey);
    // Shared-wall close precedes minimum spacing so a nearby close still completes.
    if (drawCloseOnWall(current.points, candidate, snap)) {
      const closedPoints = [...current.points, candidate];
      onAddPolygonRoom?.(closedPoints.map((point) => ({ xMm: point.xMm, yMm: point.yMm })));
      onDrawRoomChange?.(false);
      return;
    }
    if (
      prev &&
      Math.hypot(candidate.xMm - prev.xMm, candidate.yMm - prev.yMm) < MIN_DRAW_SPACING_MM
    ) {
      return;
    }
    if (drawSegmentInvalid(current.points, candidate)) {
      setDraw((state) => (state ? { ...state, invalid: true } : state));
      return;
    }
    setDraw((state) =>
      state
        ? {
            points: [...state.points, candidate],
            cursorMm: candidate,
            invalid: false,
            closing: false,
            snap
          }
        : state
    );
  }

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
    if (drag) return;
    // Object clicks stop propagation; an unarmed background click clears selection.
    if (!activeTool) {
      onClearSelection?.();
      return;
    }
    if (!movingSize || !onPlaceOpeningFromPlan) return;

    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    const result = resolvePlanPlacement(pointerMm, {
      walls: openingToolWalls,
      wallObjects: snappingWallObjects,
      movingSize,
      movingKind: activeTool,
      floatPolicy: activeTool === "blocked-zone" ? "float" : "capture-any",
      currentAnchorWallId: null,
      captureDistanceMm,
      gridTargets: gridSnapTargets,
      snapToGrid,
      thresholdMm: snapThresholdMm,
      previousSnapTargetIds: toolSnapTargetIdsRef.current
    });

    // Tool policies make "none" unreachable; this narrows the store call type.
    if (result.placement.anchor === "none") return;

    const kind = activeTool;
    // Placement tools are single-shot.
    disarmTool();
    void onPlaceOpeningFromPlan(kind, result.placement);
  }

  function beginDrag(
    roomId: string,
    target: ResizeHandleTarget,
    event: ReactPointerEvent<SVGRectElement>
  ) {
    const startPointerMm = toSvgMm(event.clientX, event.clientY);
    if (!startPointerMm) return;

    startDrag({
      roomId,
      targetWallId: target.targetWallId,
      axis: target.axis,
      anchor: target.anchor,
      startLengthMm: target.startLengthMm,
      startPointerMm,
      edgeStartMm: getMovingWallEdgeWorldPointMm(project, target.targetWallId, target.anchor),
      previewLengthMm: target.startLengthMm,
      previousSnapTargetId: undefined,
      activeGuides: []
    });
  }

  function beginRoomDrag(roomId: string, event: ReactPointerEvent<SVGPolygonElement>) {
    const placement = project.floor.rooms.find((candidate) => candidate.roomId === roomId);
    if (!placement) return;

    const startPointerMm = toSvgMm(event.clientX, event.clientY);
    if (!startPointerMm) return;

    const bounds = getRoomBounds(placement.room);
    const startOffsetMm: Vector2 = { xMm: placement.offsetXMm, yMm: placement.offsetYMm };

    startRoomDrag({
      roomId,
      startPointerMm,
      startOffsetMm,
      startMinCornerMm: {
        xMm: bounds.minX + startOffsetMm.xMm,
        yMm: bounds.minY + startOffsetMm.yMm
      },
      previewOffsetMm: startOffsetMm,
      previousSnapTargetIds: undefined,
      activeGuides: []
    });
  }

  function beginVertexDrag(
    roomId: string,
    vertexId: string,
    event: ReactPointerEvent<SVGRectElement>
  ) {
    event.stopPropagation();
    const placement = project.floor.rooms.find((candidate) => candidate.roomId === roomId);
    const vertex = placement?.room.vertices.find((candidate) => candidate.id === vertexId);
    if (!placement || !vertex) return;

    const startPointerMm = toSvgMm(event.clientX, event.clientY);
    if (!startPointerMm) return;

    // A plain click (no drag) still "selects" the vertex, for the
    // Delete/Backspace merge shortcut below.
    setSelectedVertexId(vertexId);
    startVertexDrag({
      roomId,
      vertexId,
      startPointerMm,
      startLocalMm: { xMm: vertex.xMm, yMm: vertex.yMm },
      previewLocalMm: { xMm: vertex.xMm, yMm: vertex.yMm },
      valid: true,
      previousSnapTargetIds: undefined,
      activeGuides: []
    });
  }

  // Splits at the CLICKED point along the wall (projected/clamped onto it),
  // not always the midpoint the "+" handle visually sits on — per the spec,
  // clicked position is preferred when it differs from the handle's own
  // position. Uses the committed project's wall geometry (floorWallsForTool):
  // a split is a single click, never in flight during a vertex drag.
  function handleSplitWallClick(wallId: string, event: ReactMouseEvent<SVGElement>) {
    if (!onSplitWall) return;
    const wall = floorWallsForTool.find((candidate) => candidate.id === wallId);
    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!wall || !pointerMm) return;

    const projection = projectPointToWall(pointerMm, wall);
    void onSplitWall(wallId, projection.xAlongMm);
  }

  function beginWallDrag(roomId: string, wallId: string, event: ReactPointerEvent<SVGElement>) {
    event.stopPropagation();
    const placement = project.floor.rooms.find((candidate) => candidate.roomId === roomId);
    const wall = placement?.room.walls.find((candidate) => candidate.id === wallId);
    if (!placement || !wall) return;

    const startPointerMm = toSvgMm(event.clientX, event.clientY);
    if (!startPointerMm) return;

    const geometry = getWallGeometry(placement.room, wall);
    if (geometry.lengthMm === 0) return;
    // Left-normal of the wall's start→end axis — the exact convention
    // moveRoomWall itself uses, so a positive previewOffsetMm here previews
    // precisely the direction the domain op will commit.
    const normal: Vector2 = unitLeftNormal(geometry.start, geometry.end);

    startWallDrag({
      roomId,
      wallId,
      startPointerMm,
      normal,
      previewOffsetMm: 0,
      valid: true
    });
  }

  function partitionDrawInvalid(startMm: Vector2, endMm: Vector2): boolean {
    const lengthMm = Math.hypot(endMm.xMm - startMm.xMm, endMm.yMm - startMm.yMm);
    if (lengthMm < PARTITION_MIN_LENGTH_MM) return true;
    const midpoint = {
      xMm: (startMm.xMm + endMm.xMm) / 2,
      yMm: (startMm.yMm + endMm.yMm) / 2
    };
    return roomIdContainingPoint(project, midpoint) === null;
  }

  // A rectangle whose either side is below the minimum reads as a stray click,
  // not a room. No room-containment check (unlike partitions): rooms may overlap
  // on creation, and this also lets the FIRST room be drawn on an empty floor.
  function rectDrawInvalid(startMm: Vector2, endMm: Vector2): boolean {
    return (
      Math.abs(endMm.xMm - startMm.xMm) < RECT_ROOM_MIN_SIZE_MM ||
      Math.abs(endMm.yMm - startMm.yMm) < RECT_ROOM_MIN_SIZE_MM
    );
  }

  // Begin a partition centerline drag from the capture overlay (armed tool).
  function beginPartitionDraw(event: ReactPointerEvent<SVGRectElement>) {
    event.stopPropagation();
    if (suppressNextToolClickRef.current) {
      suppressNextToolClickRef.current = false;
      return;
    }
    const startMm = toSvgMm(event.clientX, event.clientY);
    if (!startMm) return;
    const snapped = snapPartitionDrawPoint(startMm, null, event.shiftKey);
    startPartitionDraw({ startMm: snapped, endMm: null, invalid: true });
  }

  // Begin a rectangle-room drag from the capture overlay (armed tool). Grid-snap
  // the first corner; prev=null keeps it a pure grid snap (see the machine note).
  function beginRectDraw(event: ReactPointerEvent<SVGRectElement>) {
    event.stopPropagation();
    if (suppressNextToolClickRef.current) {
      suppressNextToolClickRef.current = false;
      return;
    }
    const startMm = toSvgMm(event.clientX, event.clientY);
    if (!startMm) return;
    const snapped = snapDrawPoint(startMm, null, event.shiftKey);
    startRectDraw({ startMm: snapped, endMm: null, invalid: true });
  }

  // Begin a partition edit drag: whole-body move, or one endpoint re-drag.
  function beginPartitionDrag(
    partition: FloorPartition,
    mode: "move" | "start" | "end",
    event: ReactPointerEvent<SVGElement>
  ) {
    event.stopPropagation();
    const startPointerMm = toSvgMm(event.clientX, event.clientY);
    if (!startPointerMm) return;
    onSelectFreestandingWall?.(partition.wallId);
    startPartitionDrag({
      wallId: partition.wallId,
      mode,
      startPointerMm,
      startFloorMm: partition.startMm,
      endFloorMm: partition.endMm,
      previewStartFloorMm: partition.startMm,
      previewEndFloorMm: partition.endMm,
      activeGuides: [],
      movedAxes: { x: false, y: false },
      previousSnapTargetIds: undefined
    });
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
    if (drag || objectDrag || dropGhost || roomDrag) return;

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

  // The float policy for a moving placed object. For every kind but artwork it's
  // kind-only; an artwork's depends on its effective form (a floor work moves
  // floor-only, a wall work rejects off the wall), so we resolve the object's
  // artworkId (wall or floor object) and read the form. An unresolved artwork
  // falls back to the wall-only default (floatPolicyForKind's own fallback).
  function floatPolicyForMovingObject(kind: WallObject["kind"], objectId: string): FloatPolicy {
    if (kind !== "artwork") return floatPolicyForKind(kind);
    const placed =
      project.wallObjects.find((object) => object.id === objectId) ??
      project.floorObjects.find((object) => object.id === objectId);
    const artworkId = placed?.kind === "artwork" ? placed.artworkId : null;
    return floatPolicyForKind("artwork", artworkFormFor(artworkId));
  }

  function beginObjectDrag(
    params: {
      objectId: string;
      kind: WallObject["kind"];
      startCenterMm: Vector2;
      movingSize: { widthMm: number; heightMm: number; depthMm: number };
      wallFootprintWidthMm?: number;
      rotationDeg: number;
      currentPlacement: PlanPlacement;
      initialPlanRect: PlanRect;
    },
    event: ReactPointerEvent<SVGGElement>
  ) {
    const startPointerMm = toSvgMm(event.clientX, event.clientY);
    if (!startPointerMm) return;

    // Group drag: the pressed object is part of a multi-selection. Resolve live
    // members from BOTH wall objects (world center via getWallObjectPlanRect —
    // stale ids or objects whose wall vanished drop out) and floor objects.
    if (selectedObjectIds.includes(params.objectId) && selectedObjectIds.length > 1) {
      const wallsById = new Map(floorWallsForTool.map((wall) => [wall.id, wall]));
      const members: PlanGroupMember[] = [];

      for (const object of project.wallObjects) {
        if (!selectedObjectIds.includes(object.id)) continue;
        const wall = wallsById.get(object.wallId);
        if (!wall) continue;
        const rest = getWallObjectPlanRect(wall, object);
        members.push({
          id: object.id,
          anchor: "wall",
          wall,
          worldCenterMm: { xMm: rest.centerXMm, yMm: rest.centerYMm },
          widthMm: object.widthMm,
          depthMm: WALL_OBJECT_PLAN_DEPTH_MM
        });
      }
      for (const object of project.floorObjects) {
        if (!selectedObjectIds.includes(object.id)) continue;
        members.push({
          id: object.id,
          anchor: "floor",
          centerMm: { xMm: object.xMm, yMm: object.yMm },
          widthMm: object.widthMm,
          depthMm: object.depthMm,
          rotationDeg: object.rotationDeg
        });
      }

      if (members.length > 1) {
        const groupCenterMm = getPlanGroupCenterMm(members);
        const previewRectById = new Map<string, PlanRect>(
          members.map((member) => [
            member.id,
            resolvePlanGroupMemberMove(member, { xMm: 0, yMm: 0 }).rect
          ])
        );
        startObjectDrag({
          objectId: params.objectId,
          kind: params.kind,
          floatPolicy: floatPolicyForMovingObject(params.kind, params.objectId),
          movingSize: params.movingSize,
          wallFootprintWidthMm: params.wallFootprintWidthMm,
          rotationDeg: params.rotationDeg,
          startPointerMm,
          startCenterMm: params.startCenterMm,
          currentAnchorWallId: null,
          previewPlanRect: params.initialPlanRect,
          previewPlacement: params.currentPlacement,
          previousSnapTargetIds: undefined,
          activeGuides: [],
          members,
          startGroupCenterMm: groupCenterMm,
          previewGroupCenterMm: groupCenterMm,
          previewRectById
        });
        return;
      }
    }

    startObjectDrag({
      objectId: params.objectId,
      kind: params.kind,
      floatPolicy: floatPolicyForMovingObject(params.kind, params.objectId),
      movingSize: params.movingSize,
      wallFootprintWidthMm: params.wallFootprintWidthMm,
      rotationDeg: params.rotationDeg,
      startPointerMm,
      startCenterMm: params.startCenterMm,
      currentAnchorWallId:
        params.currentPlacement.anchor === "wall" ? params.currentPlacement.wallId : null,
      previewPlanRect: params.initialPlanRect,
      previewPlacement: params.currentPlacement,
      previousSnapTargetIds: undefined,
      activeGuides: []
    });
  }

  // The dragged artwork's image aspect, so a partial/unknown-dimension work's
  // drop preview is sized at its true proportions (matching what placeArtwork
  // bakes) instead of the raw placeholder box. Only the currently-dragged
  // artwork is loaded, keyed off draggingArtworkId's asset.
  const draggingArtworkAspect = useArtworkAspect(
    draggingArtworkId ? artworksById?.get(draggingArtworkId)?.assetId : undefined
  );

  // The effective footprint of an artwork being dragged from the checklist:
  // its real size if we know which one (draggingArtworkId), otherwise the same
  // placeholder placement itself falls back to. depthMm feeds a floor-drop
  // preview; it's ignored for a wall drop.
  function effectiveArtworkDims(artworkId: string | null): {
    widthMm: number;
    heightMm: number;
    depthMm: number;
    wallFootprintWidthMm?: number;
  } {
    const artwork = artworkId ? artworksById?.get(artworkId) : undefined;
    if (artwork) {
      // The aspect only applies to the artwork we actually loaded it for.
      const aspect = artworkId === draggingArtworkId ? draggingArtworkAspect : undefined;
      const { widthMm, heightMm } = getEffectivePlacementSizeMm(artwork.dimensions, aspect);
      // Framing is WALL-ONLY geometry (docs/framing-dimension-contract.md §3,
      // Phase 6b): a floor work gets NO outer width, by construction rather than
      // by the floor stage happening to ignore one. An outer width leaking into
      // a floor drop would also reach effectiveFloorDepthMm's width fallback and
      // put the frame band on the depth axis, which it has no relationship to.
      const wallFootprintWidthMm =
        effectivePlacementForm(artwork) === "wall"
          ? getArtworkOuterDimensionsMm(widthMm, heightMm, artwork.matWidthMm, artwork.frame)
              .widthMm
          : undefined;
      return {
        widthMm,
        heightMm,
        wallFootprintWidthMm,
        // Floor footprint depth for a floor-work drop — shared with the store
        // commit and 3D via effectiveFloorDepthMm; ignored for a wall drop.
        depthMm: effectiveFloorDepthMm(artwork.dimensions)
      };
    }
    return {
      widthMm: PLACEHOLDER_ARTWORK_WIDTH_MM,
      heightMm: PLACEHOLDER_ARTWORK_HEIGHT_MM,
      depthMm: DEFAULT_FLOOR_OBJECT_DEPTH_MM
    };
  }

  // The effective placement form of the artwork under a drag — governs whether
  // the drop captures a wall (wall work) or lands on the floor (floor work). An
  // unresolved id (placeholder drag before the payload is known) reads as a wall
  // work, the conservative default (matches floatPolicyForKind's own fallback).
  function artworkFormFor(artworkId: string | null): PlacementForm {
    const artwork = artworkId ? artworksById?.get(artworkId) : undefined;
    return artwork ? effectivePlacementForm(artwork) : "wall";
  }

  function resolveArtworkDrop(
    pointerMm: Vector2,
    dims: ReturnType<typeof effectiveArtworkDims>,
    // ⌘/Ctrl (mouse) or an explicit request bypasses snapping/quantization:
    // kill the grid tier and drop the neighbor threshold to zero so the point
    // lands exactly under the pointer. Touch drags pass false — they have no
    // modifier and read best fully snapped.
    bypassSnap: boolean,
    // The dragged work's effective form: a wall work rejects off every wall
    // (resolves to `{ anchor: "none" }`), a floor work goes straight to the
    // floor stage and never captures a wall (floor-only).
    form: PlacementForm
  ) {
    return resolvePlanPlacement(pointerMm, {
      walls: floorWallsForTool,
      wallObjects: snappingWallObjects,
      movingSize: dims,
      wallFootprintWidthMm: dims.wallFootprintWidthMm,
      movingKind: "artwork",
      floatPolicy: floatPolicyForKind("artwork", form),
      currentAnchorWallId: null,
      captureDistanceMm,
      gridTargets: gridSnapTargets,
      snapToGrid: bypassSnap ? false : snapToGrid,
      thresholdMm: bypassSnap ? 0 : snapThresholdMm,
      previousSnapTargetIds: dropSnapTargetIdsRef.current
    });
  }

  // Shared by the HTML5 dragover handler and the touch-drag subscription: given
  // client coordinates and the artwork being dragged, resolve the placement and
  // paint the drop ghost. Assumes the caller has already gated on an active
  // drag; it always draws (the drop target is known to be under the pointer).
  function updateArtworkDropGhost(
    clientX: number,
    clientY: number,
    artworkId: string | null,
    bypassSnap: boolean
  ) {
    const pointerMm = toSvgMm(clientX, clientY);
    if (!pointerMm) return;

    const result = resolveArtworkDrop(
      pointerMm,
      effectiveArtworkDims(artworkId),
      bypassSnap,
      artworkFormFor(artworkId)
    );
    dropSnapTargetIdsRef.current = result.snapTargetIds;
    setDropGhost({
      planRect: result.planRect,
      placement: result.placement,
      activeGuides: result.activeGuides
    });
  }

  function clearArtworkDropGhost() {
    setDropGhost(null);
    dropSnapTargetIdsRef.current = undefined;
  }

  // Shared by the HTML5 drop handler and the touch-drag subscription: commit
  // the placement. Caller has already resolved and validated the artworkId.
  function completeArtworkDrop(
    clientX: number,
    clientY: number,
    artworkId: string,
    bypassSnap: boolean
  ) {
    const pointerMm = toSvgMm(clientX, clientY);
    if (!pointerMm) return;

    const placement = resolveArtworkDrop(
      pointerMm,
      effectiveArtworkDims(artworkId),
      bypassSnap,
      artworkFormFor(artworkId)
    ).placement;
    // A floor work lands on the floor (floor-only policy always resolves a floor
    // center) via the store's placeArtworkOnFloor path.
    if (placement.anchor === "floor") {
      onPlaceArtworkOnFloor?.(artworkId, placement.xMm, placement.yMm);
      return;
    }
    // A wall work is wall-only: only a wall capture commits. `anchor: "none"`
    // (no wall in range) is a rejected drop — a no-op, matching the danger ghost
    // the user saw.
    if (placement.anchor !== "wall") return;
    const wall = floorWallsForTool.find((candidate) => candidate.id === placement.wallId);
    // A wall-dropped artwork hangs at the wall's centerline (its own default,
    // or the project default) — plan view chooses no y itself.
    const yMm = wall?.defaultCenterlineHeightMm ?? project.defaultCenterlineHeightMm;
    onPlaceArtwork?.(artworkId, placement.wallId, placement.xMm, yMm);
  }

  function handleArtworkDragOver(event: ReactDragEvent<HTMLDivElement>) {
    // iPadOS Safari hides custom MIME types during dragover/drop, so fall back
    // to the app-level drag state (draggingArtworkId), and further to the
    // module-level drag session for when WebKit's event ordering leaves that
    // state already cleared by the time dragover/drop fires.
    if (
      !event.dataTransfer.types.includes(ARTWORK_DRAG_MIME) &&
      !draggingArtworkId &&
      !peekArtworkDragSession()
    )
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    updateArtworkDropGhost(
      event.clientX,
      event.clientY,
      draggingArtworkId,
      event.metaKey || event.ctrlKey
    );
  }

  function handleArtworkDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    // Only clear when the pointer actually leaves the surface, not when it
    // crosses between child elements (which also fire dragleave).
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    clearArtworkDropGhost();
  }

  function handleArtworkDrop(event: ReactDragEvent<HTMLDivElement>) {
    const artworkId =
      event.dataTransfer.getData(ARTWORK_DRAG_MIME) || draggingArtworkId || peekArtworkDragSession();
    consumeArtworkDragSession();
    clearArtworkDropGhost();
    if (!artworkId) return;
    if (!artworksById?.get(artworkId)) return;
    event.preventDefault();
    completeArtworkDrop(event.clientX, event.clientY, artworkId, event.metaKey || event.ctrlKey);
  }

  // The touch/pen drag path (iOS/iPadOS, where HTML5 DnD is unavailable/
  // unreliable) reaches the drop target through the module-level session rather
  // than DOM drag events. The handlers close over live state/props, so route
  // them through a ref refreshed each render and subscribe once — re-running the
  // subscription on every render would churn the shared listener Set.
  const touchDropRef = useRef({
    updateGhost: updateArtworkDropGhost,
    complete: completeArtworkDrop,
    clearGhost: clearArtworkDropGhost,
    isValidArtwork: (id: string) => Boolean(artworksById?.get(id))
  });
  touchDropRef.current = {
    updateGhost: updateArtworkDropGhost,
    complete: completeArtworkDrop,
    clearGhost: clearArtworkDropGhost,
    isValidArtwork: (id: string) => Boolean(artworksById?.get(id))
  };

  useEffect(() => {
    return subscribeArtworkTouchDrag((dragEvent) => {
      const container = containerRef.current;
      const handlers = touchDropRef.current;
      if (!container) return;
      if (dragEvent.type === "cancel") {
        handlers.clearGhost();
        return;
      }
      const rect = container.getBoundingClientRect();
      const inside =
        dragEvent.clientX >= rect.left &&
        dragEvent.clientX <= rect.right &&
        dragEvent.clientY >= rect.top &&
        dragEvent.clientY <= rect.bottom;
      if (dragEvent.type === "move") {
        // Touch has no modifier keys, so never bypass snapping.
        if (inside) handlers.updateGhost(dragEvent.clientX, dragEvent.clientY, dragEvent.artworkId, false);
        else handlers.clearGhost();
        return;
      }
      // drop: always clear the ghost; place only if it landed inside and the id
      // still resolves to a known artwork (mirrors the HTML5 drop guard).
      handlers.clearGhost();
      if (inside && handlers.isValidArtwork(dragEvent.artworkId)) {
        handlers.complete(dragEvent.clientX, dragEvent.clientY, dragEvent.artworkId, false);
      }
    });
    // containerRef is stable; the effect subscribes once for the component's life.
  }, [containerRef]);

  // Pan cursor affordance: grabbing while a pan drag is live, grab while space
  // is merely held ready. Otherwise the surface keeps its default/tool cursor.
  const surfaceClassName = panning
    ? "drawing-surface is-panning"
    : isSpaceDown
      ? "drawing-surface is-pan-ready"
      : "drawing-surface";
  const visibleMeasurement =
    measurementActive && measurementState && measurementState.phase !== "armed-empty"
      ? measurementState
      : null;

  function handleMeasurementEndpointKeyDown(
    endpoint: "a" | "b",
    event: ReactKeyboardEvent<SVGCircleElement>
  ) {
    if (!measurementState || !onMeasurementAction) return;
    const actions = getPlanMeasurementKeyActions(
      measurementState,
      endpoint === "a" ? "start" : "end",
      event.key,
      project.unit,
      gridPrecisionFloorMm,
      event.shiftKey,
      snapToGrid,
      event.altKey
    );
    if (actions.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    actions.forEach(onMeasurementAction);
  }

  // Keyboard-only creation lives on the SVG itself. It must ignore keys that
  // bubble up from a focused child (the measurement handles own their own
  // arrow/Enter refinement), and it never touches Escape — App.tsx owns that.
  function handleMeasureSurfaceKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (!measurementActive || !measurementState || !onMeasurementAction) return;
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && !isMeasurementCreationArrowKey(event.key)) return;
    const origin: MeasurePoint = {
      xMm: viewBoxBounds.x + viewBoxBounds.width / 2,
      yMm: viewBoxBounds.y + viewBoxBounds.height / 2
    };
    const action = getPlanMeasurementCreationKeyAction(
      measurementState,
      event.key,
      origin,
      project.unit,
      gridPrecisionFloorMm,
      event.shiftKey,
      snapToGrid,
      event.altKey
    );
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    const completing = action.type === "complete";
    onMeasurementAction(action);
    // After a keyboard completion the "b" handle becomes focusable; move focus
    // onto it so refinement is immediately reachable. Deferred a frame so the
    // re-rendered, now-tabbable handle exists before we focus it.
    if (completing) {
      requestAnimationFrame(() => {
        const handle = svgRef.current?.querySelector<SVGCircleElement>(
          '.measurement-endpoint[data-endpoint="b"] .measurement-handle-hit'
        );
        handle?.focus();
      });
    }
  }

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
          activeTool || drawRoomActive || partitionToolActive || drawRectActive || measurementActive
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
          reshapeRoomId={reshapeRoomId}
          selectedWallId={selectedWallId}
          hoveredWallId={hoveredWallId}
          selectedFreestandingWallId={selectedFreestandingWallId}
          activeTool={activeTool}
          drawRoomActive={drawRoomActive}
          drawRectActive={drawRectActive}
          partitionToolActive={partitionToolActive}
          partitionDrag={partitionDrag}
          suppressNextToolClickRef={suppressNextToolClickRef}
          setHoveredWallId={setHoveredWallId}
          onSelectWall={onSelectWall}
          onSelectRoom={onSelectRoom}
          onReshapeRoomChange={onReshapeRoomChange}
          onSelectFreestandingWall={onSelectFreestandingWall}
          beginRoomDrag={beginRoomDrag}
          beginPartitionDrag={beginPartitionDrag}
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
              partitionDrag && partitionDrag.mode === "move"
                ? partitionDrag.movedAxes
                : { x: true, y: true }
            }
            handleSizeMm={handleSizeMm}
            unit={wallUnit}
          />
        ) : null}
        {/* Placed objects: opening-connection glyphs, wall-anchored object
            rects, and floor-placed object rects. Reads the live objectDrag
            preview + selection ids; tooltipsDisabled is derived here from the
            in-flight gesture/armed-tool state this component owns. */}
        <PlacedObjectsLayer
          openingConnections={planScene.openingConnections}
          wallObjects={planScene.wallObjects}
          floorObjects={planScene.floorObjects}
          pixelsPerMm={pixelsPerMm}
          objectDrag={objectDrag}
          tooltipsDisabled={Boolean(
            drag ||
              objectDrag ||
              dropGhost ||
              activeTool ||
              roomDrag ||
              drawRoomActive ||
              drawRectActive ||
              vertexDrag ||
              measurementActive
          )}
          artworksById={artworksById}
          thumbnailUrlsByAssetId={thumbnailUrlsByAssetId}
          unit={project.unit}
          wallObjectMinDepthMm={wallObjectMinDepthMm}
          objectHitMinMm={objectHitMinMm}
          selectedArtworkId={selectedArtworkId}
          selectedOpeningId={selectedOpeningId}
          selectedObjectIds={selectedObjectIds}
          consumeSelectSuppression={consumeSelectSuppression}
          beginObjectDrag={beginObjectDrag}
          onSelectObject={onSelectObject}
          onSelectArtwork={onSelectArtwork}
          onSelectOpening={onSelectOpening}
        />
        {referenceMeasurements
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
          hoveredWallId={hoveredWallId}
          selectedVertexId={selectedVertexId}
          drag={drag}
          vertexDrag={vertexDrag}
          wallDrag={wallDrag}
          partitionDrag={partitionDrag}
          beginDrag={beginDrag}
          beginWallDrag={beginWallDrag}
          beginVertexDrag={beginVertexDrag}
          handleSplitWallClick={handleSplitWallClick}
          beginPartitionDrag={beginPartitionDrag}
        />
        {/* Gestural overlays: the polygon-room draw preview + capture rect, the
            partition- and rectangle-draw previews, the armed-tool/drop ghosts,
            the snap guides, and the in-progress marquee. activeGuides picks the
            single live gesture's guides in the same precedence as before. */}
        <PlanOverlaysLayer
          drawRoomActive={drawRoomActive}
          draw={draw}
          partitionToolActive={partitionToolActive}
          partitionDraw={partitionDraw}
          partitionDuplicateActive={Boolean(duplicatePartitionSourceWallId)}
          partitionDuplicateGhost={partitionDuplicateGhost}
          drawRectActive={drawRectActive}
          rectDraw={rectDraw}
          toolGhost={toolGhost}
          dropGhost={dropGhost}
          marquee={marquee}
          activeGuides={
            objectDrag?.activeGuides ??
            dropGhost?.activeGuides ??
            drag?.activeGuides ??
            roomDrag?.activeGuides ??
            partitionDrag?.activeGuides ??
            partitionDuplicateGhost?.activeGuides ??
            toolGhost?.activeGuides ??
            []
          }
          activeTool={activeTool}
          viewBox={viewBoxBounds}
          handleSizeMm={handleSizeMm}
          wallUnit={wallUnit}
          wallObjectMinDepthMm={wallObjectMinDepthMm}
          floorWalls={floorWallsForTool}
          handleDrawClick={handleDrawClick}
          handleDrawPointerMove={handleDrawPointerMove}
          beginPartitionDraw={beginPartitionDraw}
          handlePartitionDuplicateMove={handlePartitionDuplicateMove}
          handlePartitionDuplicateClick={handlePartitionDuplicateClick}
          beginRectDraw={beginRectDraw}
        />
        {visibleMeasurement ? (
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

// Whole-partition moves latch each axis from pointer travel, never from the
// potentially larger correction introduced by snapping. Exported for the
// focused interaction regression tests alongside clampFitExtent below.
export function getPartitionMovedAxes(
  current: { x: boolean; y: boolean },
  pointerDeltaMm: Vector2,
  thresholdMm: number
): { x: boolean; y: boolean } {
  return {
    x: current.x || Math.abs(pointerDeltaMm.xMm) > thresholdMm,
    y: current.y || Math.abs(pointerDeltaMm.yMm) > thresholdMm
  };
}

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
