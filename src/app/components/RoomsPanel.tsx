import { Plus } from "lucide-react";
import {
  getRectangleRoomDimensions,
  getWallsWithGeometry
} from "../../domain/geometry/walls";
import type { Project } from "../../domain/project";
import { formatLength } from "../../domain/units/length";
import { RoomDimensionFields } from "./RoomDimensionFields";

// The left workspace pane when the rail's Rooms & Walls selector is active —
// the room/wall inventory that used to live atop the right panel. Same idioms
// as the checklist panel: a flat white column with a hairline toward the
// canvas. Purely a navigator: selecting a wall drives the right inspector and
// the elevation view; the rectangle Width/Depth fields and per-wall lengths
// commit through the same store actions the panel already received.
export function RoomsPanel({
  project,
  selectedWallId,
  onAddRectangleRoom,
  onResizeWall,
  onSelectWall
}: {
  project: Project;
  selectedWallId: string | null;
  onAddRectangleRoom: () => void;
  onResizeWall: (wallId: string, lengthMm: number) => Promise<void>;
  onSelectWall: (wallId: string) => void;
}) {
  return (
    <section className="rooms-panel" aria-label="Rooms and walls">
      <div className="panel-heading">
        <h2>Rooms</h2>
        <div className="panel-heading-actions">
          <span>{pluralize(project.floor.rooms.length, "room")}</span>
          <button
            aria-label="Add rectangular room"
            className="icon-button compact"
            title="Add rectangular room"
            type="button"
            onClick={onAddRectangleRoom}
          >
            <Plus aria-hidden="true" size={16} />
          </button>
        </div>
      </div>

      <nav className="room-list" aria-label="Rooms and walls">
        {project.floor.rooms.length === 0 ? (
          <p className="empty-copy">
            No rooms yet — draw one, or skip straight to the checklist.
          </p>
        ) : null}
        {project.floor.rooms.map((placement) => {
          const roomWalls = getWallsWithGeometry(placement.room);
          const rectangleDimensions = getRectangleRoomDimensions(placement.room);

          return (
            <section className="room-group" key={placement.roomId}>
              <div className="room-heading">
                <h3>{placement.room.name}</h3>
                <span>{pluralize(roomWalls.length, "wall")}</span>
              </div>
              {rectangleDimensions ? (
                <RoomDimensionFields
                  depthMm={rectangleDimensions.depthMm}
                  unit={project.unit}
                  widthMm={rectangleDimensions.widthMm}
                  onCommitDepth={(lengthMm) =>
                    onResizeWall(rectangleDimensions.depthWallId, lengthMm)
                  }
                  onCommitWidth={(lengthMm) =>
                    onResizeWall(rectangleDimensions.widthWallId, lengthMm)
                  }
                />
              ) : null}
              <div className="wall-list">
                {roomWalls.map((wall) => (
                  <button
                    className={wall.id === selectedWallId ? "wall-row active" : "wall-row"}
                    key={wall.id}
                    type="button"
                    onClick={() => onSelectWall(wall.id)}
                  >
                    <span>{wall.name}</span>
                    <strong>{formatLength(wall.lengthMm, { unit: project.unit })}</strong>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </nav>
    </section>
  );
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
