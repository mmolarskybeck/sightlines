import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  computeDraggedLengthMm,
  type Vector2
} from "../../domain/geometry/dragResize";
import { resizeWallPreservingAngles } from "../../domain/geometry/editRoom";
import { getFloorBounds } from "../../domain/geometry/walls";
import type { Project } from "../../domain/project";
import {
  getMajorGridIntervalMm,
  getMinorGridIntervalMm,
  getPixelsPerMm
} from "../../domain/units/precision";
import { useContainerSize } from "../hooks/useContainerSize";
import { GridOverlay } from "./GridOverlay";
import { RoomResizeHandles, type ResizeHandleTarget } from "./RoomResizeHandles";

const HANDLE_SCREEN_SIZE_PX = 16;

type DragState = {
  roomId: string;
  targetWallId: string;
  axis: Vector2;
  startLengthMm: number;
  startPointerMm: Vector2;
  previewLengthMm: number;
};

export function PlanView({
  gridVisible,
  onCommitWallLength,
  project,
  selectedWallId
}: {
  gridVisible: boolean;
  onCommitWallLength: (wallId: string, lengthMm: number) => Promise<void>;
  project: Project;
  selectedWallId: string | null;
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
  const minorGridMm = getMinorGridIntervalMm(project.unit, pixelsPerMm);
  const majorGridMm = getMajorGridIntervalMm(project.unit, minorGridMm);
  const handleSizeMm = pixelsPerMm > 0 ? HANDLE_SCREEN_SIZE_PX / pixelsPerMm : 0;

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

      const deltaMm: Vector2 = {
        xMm: pointerMm.xMm - current.startPointerMm.xMm,
        yMm: pointerMm.yMm - current.startPointerMm.yMm
      };
      const previewLengthMm = computeDraggedLengthMm(
        current.startLengthMm,
        deltaMm,
        current.axis
      );

      setDrag((state) => (state ? { ...state, previewLengthMm } : state));
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
      previewLengthMm: target.startLengthMm
    });
  }

  return (
    <div className="drawing-surface" aria-label="Plan view" ref={containerRef}>
      <svg className="plan-svg" ref={svgRef} viewBox={viewBox} role="img">
        <title>{project.title} plan</title>
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
        {displayedProject.floor.rooms.map((placement) => (
          <g key={placement.roomId}>
            <polygon
              className="room-fill"
              points={placement.room.vertices
                .map(
                  (vertex) =>
                    `${vertex.xMm + placement.offsetXMm},${vertex.yMm + placement.offsetYMm}`
                )
                .join(" ")}
            />
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
                unit={project.unit}
                onBeginDrag={beginDrag}
              />
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}

function getPlanViewPaddingMm(bounds: { width: number; height: number }): number {
  const largestDimensionMm = Math.max(bounds.width, bounds.height);

  return Math.max(900, largestDimensionMm * 0.14);
}
