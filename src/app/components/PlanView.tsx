import { getFloorBounds } from "../../domain/geometry/walls";
import type { Project } from "../../domain/project";
import {
  getMajorGridIntervalMm,
  getMinorGridIntervalMm,
  getPixelsPerMm
} from "../../domain/units/precision";
import { useContainerSize } from "../hooks/useContainerSize";
import { GridOverlay } from "./GridOverlay";

export function PlanView({
  gridVisible,
  project,
  selectedWallId
}: {
  gridVisible: boolean;
  project: Project;
  selectedWallId: string | null;
}) {
  const [containerRef, containerSize] = useContainerSize<HTMLDivElement>();
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

  return (
    <div className="drawing-surface" aria-label="Plan view" ref={containerRef}>
      <svg className="plan-svg" viewBox={viewBox} role="img">
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
        {project.floor.rooms.map((placement) => (
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
