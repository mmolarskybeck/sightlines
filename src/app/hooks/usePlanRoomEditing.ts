import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  computeEdgeSnappedLengthMm,
  getMovingWallEdgeWorldPointMm,
  proposeMovingEdgePointMm,
  type Vector2
} from "../../domain/geometry/dragResize";
import { unitLeftNormal } from "../../domain/geometry/vector";
import type { ResizeAnchor } from "../../domain/geometry/editRoom";
import { getRoomBounds, getWallGeometry } from "../../domain/geometry/walls";
import { projectPointToWall, type FloorWall } from "../../domain/geometry/planObjects";
import { canMoveRoomVertex, moveRoomWall } from "../../domain/geometry/reshapeRoom";
import {
  resolveSnap,
  type Guide,
  type SnapTarget
} from "../../domain/snapping/resolveSnap";
import type { Point } from "../../domain/geometry/polygon";
import type { Project } from "../../domain/project";
import { useDragGesture } from "./useDragGesture";
import type { ResizeHandleTarget } from "../components/plan/RoomResizeHandles";
import type {
  DragState,
  RectDrawState,
  RoomDragState,
  VertexDragState,
  WallDragState
} from "../components/plan/types";

// Reject rectangle drags below the smallest plausible room dimension.
const RECT_ROOM_MIN_SIZE_MM = 500;

// The room/structure editing controller lifted out of PlanView verbatim: the
// four reshape/resize pointer drags — wall resize (DragState), whole-room move
// (RoomDragState), reshape-mode vertex drag (VertexDragState), reshape-mode wall
// slide (WallDragState) — plus the rectangle-room create drag (RectDrawState),
// the pieces that arm each (beginDrag / beginRoomDrag / beginVertexDrag /
// beginWallDrag / beginRectDraw), the wall-split click, and the two bits of
// selection state these gestures own: the reshape-mode selected vertex (state +
// ref + its sync/reset effects) and the hovered wall id that links a wall edge
// to its slide handle.
//
// Same deferred-closure story as usePlanObjectMove / usePlanPartitionTool: the
// useDragGesture configs and the begin/handle functions read PlanView locals
// (toSvgMm, the snapping geometry, the commit callbacks, snapDrawPoint, …) that
// are declared far below the point this controller is created. PlanView passes
// them through a `getDeps` thunk invoked at event time, so every gesture reads
// the latest render's values without this hook having to sit below all of them —
// which in turn keeps the live drag states available up where
// planInteractionActive is assembled. reshapeRoomId comes in directly because
// the selected-vertex reset effect keys on it (a dependency-array participant).
// snapDrawPoint stays owned by PlanView (shared with the rectangle/polygon
// draws) and is threaded in through the thunk rather than moved.
export type PlanRoomEditingDeps = {
  toSvgMm: (clientX: number, clientY: number) => Vector2 | null;
  project: Project;
  floorWallsForTool: FloorWall[];
  gridSnapTargets: SnapTarget[];
  snapToGrid: boolean;
  snapThresholdMm: number;
  // Shared with the partition-draw and polygon-draw gestures, so it stays owned
  // by PlanView and is threaded in rather than moved.
  snapDrawPoint: (pointerMm: Vector2, prev: Vector2 | null, shiftKey: boolean) => Vector2;
  suppressNextToolClickRef: MutableRefObject<boolean>;
  drawRectActive: boolean;
  onCommitWallLength: (wallId: string, lengthMm: number, anchor?: ResizeAnchor) => Promise<void>;
  onMoveRoom: (roomId: string, offsetXMm: number, offsetYMm: number) => Promise<void>;
  onMoveRoomVertex: (roomId: string, vertexId: string, nextLocalMm: Point) => Promise<void>;
  onMoveRoomWall: (roomId: string, wallId: string, offsetMm: number) => Promise<void>;
  onSplitWall: (wallId: string, xAlongMm: number) => Promise<void>;
  onDrawRectChange?: (active: boolean) => void;
  onAddRectangleRoom?: (rect: {
    offsetXMm: number;
    offsetYMm: number;
    widthMm: number;
    depthMm: number;
  }) => void;
};

export function usePlanRoomEditing(options: {
  // Drives the selected-vertex reset effect (a dependency-array participant), so
  // it comes in directly rather than through the thunk.
  reshapeRoomId: string | null;
  getDeps: () => PlanRoomEditingDeps;
}) {
  const { reshapeRoomId, getDeps } = options;
  // The thunk is recreated each render (fresh closure over PlanView's locals);
  // route it through a ref so the deferred handlers always call the latest one.
  const getDepsRef = useRef(getDeps);
  getDepsRef.current = getDeps;

  // These handlers run after render, so later-declared geometry constants are initialized.
  const {
    drag,
    dragRef,
    beginDrag: startDrag
  } = useDragGesture<DragState>({
    onMove: (current, event) => {
      const { toSvgMm, snapToGrid, gridSnapTargets, snapThresholdMm } = getDepsRef.current();
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
      const { onCommitWallLength } = getDepsRef.current();
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
      const { toSvgMm, snapToGrid, gridSnapTargets, snapThresholdMm } = getDepsRef.current();
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
      const { onMoveRoom } = getDepsRef.current();
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

  // A plain vertex click still selects it for Delete/Backspace.
  const {
    drag: vertexDrag,
    dragRef: vertexDragRef,
    beginDrag: startVertexDrag
  } = useDragGesture<VertexDragState>({
    onMove: (current, event) => {
      const { toSvgMm, project, snapToGrid, gridSnapTargets, snapThresholdMm } =
        getDepsRef.current();
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
      const { onMoveRoomVertex } = getDepsRef.current();
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
      const { toSvgMm, project } = getDepsRef.current();
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
      const { onMoveRoomWall } = getDepsRef.current();
      // Invalid or sub-threshold releases revert by skipping the commit.
      if (Math.abs(current.previewOffsetMm) < 0.5 || !current.valid) return;

      void onMoveRoomWall?.(current.roomId, current.wallId, current.previewOffsetMm);
    }
  });
  // Links the hovered wall edge to its slide handle.
  const [hoveredWallId, setHoveredWallId] = useState<string | null>(null);
  // Pure grid snapping avoids Shift axis-lock degenerating the rectangle.
  // onRelease always disarms and commits only while the tool remains armed.
  const {
    drag: rectDraw,
    beginDrag: startRectDraw
  } = useDragGesture<RectDrawState>({
    onMove: (current, event) => {
      const { toSvgMm, snapDrawPoint } = getDepsRef.current();
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;
      const endMm = snapDrawPoint(pointerMm, null, event.shiftKey);
      return { ...current, endMm, invalid: rectDrawInvalid(current.startMm, endMm) };
    },
    onRelease: (current) => {
      const { drawRectActive, onDrawRectChange, onAddRectangleRoom } = getDepsRef.current();
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
  const [selectedVertexId, setSelectedVertexId] = useState<string | null>(null);
  const selectedVertexIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedVertexIdRef.current = selectedVertexId;
  }, [selectedVertexId]);
  useEffect(() => {
    // Prevent Delete from targeting a stale vertex after changing modes.
    setSelectedVertexId(null);
  }, [reshapeRoomId]);

  function beginDrag(
    roomId: string,
    target: ResizeHandleTarget,
    event: ReactPointerEvent<SVGRectElement>
  ) {
    const { toSvgMm, project } = getDepsRef.current();
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
    const { toSvgMm, project } = getDepsRef.current();
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
    const { toSvgMm, project } = getDepsRef.current();
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
    const { toSvgMm, floorWallsForTool, onSplitWall } = getDepsRef.current();
    if (!onSplitWall) return;
    const wall = floorWallsForTool.find((candidate) => candidate.id === wallId);
    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!wall || !pointerMm) return;

    const projection = projectPointToWall(pointerMm, wall);
    void onSplitWall(wallId, projection.xAlongMm);
  }

  function beginWallDrag(roomId: string, wallId: string, event: ReactPointerEvent<SVGElement>) {
    const { toSvgMm, project } = getDepsRef.current();
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

  // A rectangle whose either side is below the minimum reads as a stray click,
  // not a room. No room-containment check (unlike partitions): rooms may overlap
  // on creation, and this also lets the FIRST room be drawn on an empty floor.
  function rectDrawInvalid(startMm: Vector2, endMm: Vector2): boolean {
    return (
      Math.abs(endMm.xMm - startMm.xMm) < RECT_ROOM_MIN_SIZE_MM ||
      Math.abs(endMm.yMm - startMm.yMm) < RECT_ROOM_MIN_SIZE_MM
    );
  }

  // Begin a rectangle-room drag from the capture overlay (armed tool). Grid-snap
  // the first corner; prev=null keeps it a pure grid snap (see the machine note).
  function beginRectDraw(event: ReactPointerEvent<SVGRectElement>) {
    const { toSvgMm, snapDrawPoint, suppressNextToolClickRef } = getDepsRef.current();
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

  return {
    // Live drag states — each OR'd into PlanView's planInteractionActive
    // registry and consumed individually by displayedProject and the render
    // layers. Their refs feed the viewport hook's pinch-block guard.
    drag,
    dragRef,
    roomDrag,
    roomDragRef,
    vertexDrag,
    vertexDragRef,
    wallDrag,
    wallDragRef,
    rectDraw,
    // Selection state these gestures own.
    hoveredWallId,
    setHoveredWallId,
    selectedVertexId,
    selectedVertexIdRef,
    setSelectedVertexId,
    // Arming entry points wired into the structure/handle/overlay layers.
    beginDrag,
    beginRoomDrag,
    beginVertexDrag,
    beginWallDrag,
    beginRectDraw,
    handleSplitWallClick
  };
}
