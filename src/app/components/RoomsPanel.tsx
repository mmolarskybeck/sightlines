import { useState } from "react";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import {
  getRectangleRoomDimensions,
  getWallsWithGeometry
} from "../../domain/geometry/walls";
import type { Project } from "../../domain/project";
import { formatLength } from "../../domain/units/length";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../domain/units/unitSystem";
import { RoomDimensionFields } from "./RoomDimensionFields";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

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
  onDeleteRoom,
  onRenameRoom,
  onResizeWall,
  onSelectWall
}: {
  project: Project;
  selectedWallId: string | null;
  onAddRectangleRoom: () => void;
  onDeleteRoom: (roomId: string) => Promise<void>;
  onRenameRoom: (roomId: string, name: string) => Promise<void>;
  onResizeWall: (wallId: string, lengthMm: number) => Promise<void>;
  onSelectWall: (wallId: string) => void;
}) {
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [draftRoomName, setDraftRoomName] = useState("");
  const [confirmingDeleteRoomId, setConfirmingDeleteRoomId] = useState<string | null>(null);

  // Wall lengths read in the wall scope's unit (ft/m). RoomDimensionFields
  // below keeps project.unit — it derives its own scopes internally.
  const wallUnit = getScopeUnits(
    unitSystemFromDisplayUnit(project.unit),
    "wall"
  ).displayUnit;

  return (
    <section className="rooms-panel" aria-label="Rooms and walls">
      <div className="panel-heading">
        <h2>Rooms</h2>
        <div className="panel-heading-actions">
          <span>{pluralize(project.floor.rooms.length, "room")}</span>
          <Button
            aria-label="Add rectangular room"
            className="icon-button compact"
            size="icon-sm"
            title="Add rectangular room"
            variant="ghost"
            onClick={onAddRectangleRoom}
          >
            <PlusIcon aria-hidden="true" size={16} />
          </Button>
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
          const isEditing = editingRoomId === placement.roomId;
          const isConfirmingDelete = confirmingDeleteRoomId === placement.roomId;
          const draftIsValid = draftRoomName.trim().length > 0;

          const startRename = () => {
            setConfirmingDeleteRoomId(null);
            setEditingRoomId(placement.roomId);
            setDraftRoomName(placement.room.name);
          };

          const cancelRename = () => {
            setEditingRoomId(null);
            setDraftRoomName("");
          };

          const commitRename = () => {
            const nextName = draftRoomName.trim();
            if (nextName.length === 0) return;
            cancelRename();
            void onRenameRoom(placement.roomId, nextName);
          };

          return (
            <section className="room-group" key={placement.roomId}>
              <div className="room-heading">
                {isEditing ? (
                  <form
                    className="room-rename-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      commitRename();
                    }}
                  >
                    <Input
                      aria-label={`Rename ${placement.room.name}`}
                      autoFocus
                      size="compact"
                      value={draftRoomName}
                      onChange={(event) => setDraftRoomName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelRename();
                        }
                      }}
                    />
                    <Button
                      aria-label="Save room name"
                      className="icon-button compact"
                      disabled={!draftIsValid}
                      size="icon-sm"
                      title="Save room name"
                      type="submit"
                      variant="ghost"
                    >
                      <CheckIcon aria-hidden="true" size={14} />
                    </Button>
                    <Button
                      aria-label="Cancel rename"
                      className="icon-button compact"
                      size="icon-sm"
                      title="Cancel rename"
                      variant="ghost"
                      onClick={cancelRename}
                    >
                      <XIcon aria-hidden="true" size={14} />
                    </Button>
                  </form>
                ) : (
                  <>
                    <h3 title={placement.room.name}>{placement.room.name}</h3>
                    {isConfirmingDelete ? (
                      <div className="room-delete-confirmation">
                        <span>Delete?</span>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            setConfirmingDeleteRoomId(null);
                            void onDeleteRoom(placement.roomId);
                          }}
                        >
                          Delete
                        </Button>
                        <Button
                          aria-label="Cancel delete"
                          className="icon-button compact"
                          size="icon-sm"
                          title="Cancel delete"
                          variant="ghost"
                          onClick={() => setConfirmingDeleteRoomId(null)}
                        >
                          <XIcon aria-hidden="true" size={14} />
                        </Button>
                      </div>
                    ) : (
                      <div className="room-heading-actions">
                        <span>{pluralize(roomWalls.length, "wall")}</span>
                        <Button
                          aria-label={`Rename ${placement.room.name}`}
                          className="icon-button compact"
                          size="icon-sm"
                          title="Rename room"
                          variant="ghost"
                          onClick={startRename}
                        >
                          <PencilSimpleIcon aria-hidden="true" size={14} />
                        </Button>
                        <Button
                          aria-label={`Delete ${placement.room.name}`}
                          className="icon-button compact"
                          size="icon-sm"
                          title="Delete room"
                          variant="ghost"
                          onClick={() => {
                            setEditingRoomId(null);
                            setConfirmingDeleteRoomId(placement.roomId);
                          }}
                        >
                          <TrashIcon aria-hidden="true" size={14} />
                        </Button>
                      </div>
                    )}
                  </>
                )}
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
                  <Button
                    className={wall.id === selectedWallId ? "wall-row active" : "wall-row"}
                    data-active={wall.id === selectedWallId ? "true" : undefined}
                    key={wall.id}
                    variant="ghost"
                    onClick={() => onSelectWall(wall.id)}
                  >
                    <span>{wall.name}</span>
                    <strong>{formatLength(wall.lengthMm, { unit: wallUnit })}</strong>
                  </Button>
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
