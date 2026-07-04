import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  computeEdgeSnappedLengthMm,
  getMovingWallEdgeWorldPointMm,
  proposeMovingEdgePointMm,
  type Vector2
} from "../../domain/geometry/dragResize";
import { resizeWallPreservingAngles } from "../../domain/geometry/editRoom";
import { getFloorBounds } from "../../domain/geometry/walls";
import type { Project } from "../../domain/project";
import { getGridSnapTargets } from "../../domain/snapping/gridSnapTargets";
import { resolveSnap, type Guide, type SnapTarget } from "../../domain/snapping/resolveSnap";
import {
  getMajorGridIntervalMm,
  getMinorGridIntervalMm,
  getPixelsPerMm
} from "../../domain/units/precision";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../domain/units/unitSystem";
import { useContainerSize } from "../hooks/useContainerSize";
import { GridOverlay } from "./GridOverlay";
import { RoomResizeHandles, type ResizeHandleTarget } from "./RoomResizeHandles";

const HANDLE_SCREEN_SIZE_PX = 16;
const SNAP_THRESHOLD_PX = 10;

type DragState = {
  roomId: string;
  targetWallId: string;
  axis: Vector2;
  startLengthMm: number;
  startPointerMm: Vector2;
  // The wall's own moving edge (its endVertexId, in floor coordinates) at
  // drag start — snapping targets this point, not the pointer, so wherever
  // inside the handle the user grabbed never leaks into the committed
  // length. See getMovingWallEdgeWorldPointMm.
  edgeStartMm: Vector2;
  previewLengthMm: number;
  previousSnapTargetId?: string;
  activeGuides: Guide[];
};

export function PlanView({
  gridPrecisionFloorMm,
  gridVisible,
  onCommitWallLength,
  project,
  selectedWallId,
  snapToGrid
}: {
  gridPrecisionFloorMm: number | null;
  gridVisible: boolean;
  onCommitWallLength: (wallId: string, lengthMm: number) => Promise<void>;
  project: Project;
  selectedWallId: string | null;
  snapToGrid: boolean;
}) {
  const [containerRef, containerSize] = useContainerSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const bounds = getFloorBounds(project.floor);
  const padding = getPlanViewPaddingMm(bounds);
  const viewBoxBounds = {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2
  };
  const viewBox = `${viewBoxBounds.x} ${viewBoxBounds.y} ${viewBoxBounds.width} ${viewBoxBounds.height}`;
  const pixelsPerMm = getPixelsPerMm(containerSize, viewBoxBounds);
  const minorGridMm = getMinorGridIntervalMm(project.unit, pixelsPerMm, {
    minIntervalMm: gridPrecisionFloorMm
  });
  const majorGridMm = getMajorGridIntervalMm(project.unit, minorGridMm);
  // Grid intervals above stay on project.unit (family-based). The resize
  // handle labels show a wall length, so they read in the wall scope's unit.
  const wallUnit = getScopeUnits(
    unitSystemFromDisplayUnit(project.unit),
    "wall"
  ).displayUnit;
  const handleSizeMm = pixelsPerMm > 0 ? HANDLE_SCREEN_SIZE_PX / pixelsPerMm : 0;
  const snapThresholdMm = pixelsPerMm > 0 ? SNAP_THRESHOLD_PX / pixelsPerMm : 0;
  // Minor grid dot radius in mm, sized to a constant ~1.1px on screen.
  const dotRadiusMm = pixelsPerMm > 0 ? 1.1 / pixelsPerMm : undefined;
  const gridSnapTargets = getGridSnapTargets(minorGridMm, {
    minXMm: viewBoxBounds.x,
    maxXMm: viewBoxBounds.x + viewBoxBounds.width,
    minYMm: viewBoxBounds.y,
    maxYMm: viewBoxBounds.y + viewBoxBounds.height
  });

  const displayedProject =
    drag !== null
      ? resizeWallPreservingAngles(project, drag.targetWallId, drag.previewLengthMm).project
      : project;

  useEffect(() => {
    if (!drag) return;

    function toSvgMm(clientX: number, clientY: number): Vector2 | null {
      const svg = svgRef.current;
      if (!svg) return null;

      const point = svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;

      const transformed = point.matrixTransform(ctm.inverse());
      return { xMm: transformed.x, yMm: transformed.y };
    }

    function onPointerMove(event: PointerEvent) {
      const current = dragRef.current;
      if (!current) return;

      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return;

      // Snap the wall's moving edge, not the raw pointer — the handle can be
      // grabbed anywhere within its 16px hit target, and that grab offset
      // must not leak into the committed length even when the pointer lands
      // exactly on a grid line.
      const proposedEdgeMm = proposeMovingEdgePointMm(
        current.edgeStartMm,
        current.startPointerMm,
        pointerMm
      );

      // A handle only ever moves along its target wall's own axis, so only
      // grid lines perpendicular to that axis are relevant — snapping the
      // other coordinate would be meaningless for this drag and could
      // trigger on incidental hand-tremor alignment.
      let snappedEdgeMm = proposedEdgeMm;
      let snapTargetId: string | undefined;
      let activeGuides: Guide[] = [];

      if (snapToGrid) {
        const isXAxis = Math.abs(current.axis.xMm) >= Math.abs(current.axis.yMm);
        const relevantTargets: SnapTarget[] = gridSnapTargets.filter(
          (target) => target.axis === (isXAxis ? "x" : "y")
        );
        const snapResult = resolveSnap(proposedEdgeMm, relevantTargets, {
          thresholdMm: snapThresholdMm,
          previousSnapTargetId: current.previousSnapTargetId
        });

        snappedEdgeMm = snapResult.point;
        snapTargetId = snapResult.snapTargetId;
        activeGuides = snapResult.activeGuides;
      }

      const previewLengthMm = computeEdgeSnappedLengthMm(
        current.startLengthMm,
        current.edgeStartMm,
        snappedEdgeMm,
        current.axis
      );

      setDrag((state) =>
        state
          ? { ...state, previewLengthMm, previousSnapTargetId: snapTargetId, activeGuides }
          : state
      );
    }

    function onPointerUp() {
      const current = dragRef.current;
      setDrag(null);
      if (!current) return;

      if (Math.abs(current.previewLengthMm - current.startLengthMm) < 0.5) return;
      void onCommitWallLength(current.targetWallId, current.previewLengthMm);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
    // Subscribed once per drag gesture (keyed on whether a drag is active,
    // not on every in-flight preview update) — onPointerMove/onPointerUp
    // read the latest state via dragRef rather than closing over `drag`.
    // gridSnapTargets/snapToGrid/snapThresholdMm are captured by closure
    // here too: they derive from the committed project's bounds and grid
    // interval, which can't change mid-drag (the live preview never
    // rewrites viewBoxBounds), so they're safe to leave out of the deps
    // rather than resubscribing on every render.
  }, [drag !== null, onCommitWallLength]);

  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  function beginDrag(
    roomId: string,
    target: ResizeHandleTarget,
    event: ReactPointerEvent<SVGRectElement>
  ) {
    const svg = svgRef.current;
    if (!svg) return;

    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;

    const startPointerMm = point.matrixTransform(ctm.inverse());

    setDrag({
      roomId,
      targetWallId: target.targetWallId,
      axis: target.axis,
      startLengthMm: target.startLengthMm,
      startPointerMm: { xMm: startPointerMm.x, yMm: startPointerMm.y },
      edgeStartMm: getMovingWallEdgeWorldPointMm(project, target.targetWallId),
      previewLengthMm: target.startLengthMm,
      previousSnapTargetId: undefined,
      activeGuides: []
    });
  }

  return (
    <div className="drawing-surface" aria-label="Plan view" ref={containerRef}>
      <svg className="plan-svg" ref={svgRef} viewBox={viewBox} role="img">
        <title>{project.title} plan</title>
        {/* Room interiors render below the grid (the grid must stay visible
            on the room's "paper"), walls and handles above it. */}
        {displayedProject.floor.rooms.map((placement) => (
          <polygon
            className="room-fill"
            key={placement.roomId}
            points={placement.room.vertices
              .map(
                (vertex) =>
                  `${vertex.xMm + placement.offsetXMm},${vertex.yMm + placement.offsetYMm}`
              )
              .join(" ")}
          />
        ))}
        {gridVisible ? (
          <GridOverlay
            id="plan-grid"
            dotRadiusMm={dotRadiusMm}
            height={viewBoxBounds.height}
            majorSpacingMm={majorGridMm}
            minorSpacingMm={minorGridMm}
            width={viewBoxBounds.width}
            x={viewBoxBounds.x}
            y={viewBoxBounds.y}
          />
        ) : null}
        {displayedProject.floor.rooms.map((placement) => (
          <g key={placement.roomId}>
            {placement.room.walls.map((wall) => {
              const start = placement.room.vertices.find(
                (vertex) => vertex.id === wall.startVertexId
              );
              const end = placement.room.vertices.find(
                (vertex) => vertex.id === wall.endVertexId
              );
              if (!start || !end) return null;

              return (
                <line
                  className={
                    wall.id === selectedWallId ? "wall-line active" : "wall-line"
                  }
                  key={wall.id}
                  x1={start.xMm + placement.offsetXMm}
                  y1={start.yMm + placement.offsetYMm}
                  x2={end.xMm + placement.offsetXMm}
                  y2={end.yMm + placement.offsetYMm}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {handleSizeMm > 0 ? (
              <RoomResizeHandles
                activeDrag={
                  drag && drag.roomId === placement.roomId
                    ? { targetWallId: drag.targetWallId, previewLengthMm: drag.previewLengthMm }
                    : null
                }
                handleSizeMm={handleSizeMm}
                placement={placement}
                unit={wallUnit}
                onBeginDrag={beginDrag}
              />
            ) : null}
          </g>
        ))}
        {drag?.activeGuides.map((guide) => (
          <line
            className="snap-guide"
            key={guide.id}
            x1={guide.axis === "x" ? guide.positionMm : viewBoxBounds.x}
            y1={guide.axis === "y" ? guide.positionMm : viewBoxBounds.y}
            x2={guide.axis === "x" ? guide.positionMm : viewBoxBounds.x + viewBoxBounds.width}
            y2={
              guide.axis === "y" ? guide.positionMm : viewBoxBounds.y + viewBoxBounds.height
            }
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  );
}

function getPlanViewPaddingMm(bounds: { width: number; height: number }): number {
  const largestDimensionMm = Math.max(bounds.width, bounds.height);

  return Math.max(900, largestDimensionMm * 0.14);
}
