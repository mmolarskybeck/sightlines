import { type ReactElement, useState } from "react";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CompassIcon } from "@phosphor-icons/react/dist/csr/Compass";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { COMPASS_WALL_NAMES } from "../../../domain/geometry/createRoom";
import { getFreestandingFaces } from "../../../domain/geometry/freestandingWalls";
import {
  getRectangleRoomDimensions,
  getWallsWithGeometry
} from "../../../domain/geometry/walls";
import type { Project } from "../../../domain/project";
import { formatLength } from "../../../domain/units/length";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../../domain/units/unitSystem";
import { RoomDimensionFields } from "../inspectors/RoomDimensionFields";
import { pluralize } from "../shared/pluralize";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

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
  onRenameWall,
  onResizeWall,
  onSelectWall,
  onSetNorthWall
}: {
  project: Project;
  selectedWallId: string | null;
  onAddRectangleRoom: () => void;
  onDeleteRoom: (roomId: string) => Promise<void>;
  onRenameRoom: (roomId: string, name: string) => Promise<void>;
  onRenameWall: (wallId: string, name: string) => Promise<void>;
  onResizeWall: (wallId: string, lengthMm: number) => Promise<void>;
  onSelectWall: (wallId: string) => void;
  onSetNorthWall: (roomId: string, wallId: string) => void;
}) {
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editingWallId, setEditingWallId] = useState<string | null>(null);
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
          <IconTooltip label="Add rectangle room">
            <Button
              aria-label="Add rectangle room"
              className="icon-button compact"
              size="icon-sm"
              variant="ghost"
              onClick={onAddRectangleRoom}
            >
              <PlusIcon aria-hidden="true" size={16} />
            </Button>
          </IconTooltip>
        </div>
      </div>

      <nav className="room-list" aria-label="Rooms and walls">
        {project.floor.rooms.length === 0 ? (
          <p className="empty-copy">
            No rooms yet. Draw one, or skip straight to the checklist.
          </p>
        ) : null}
        {project.floor.rooms.map((placement) => {
          const roomWalls = getWallsWithGeometry(placement.room);
          const rectangleDimensions = getRectangleRoomDimensions(placement.room);
          const isEditing = editingRoomId === placement.roomId;
          const isConfirmingDelete = confirmingDeleteRoomId === placement.roomId;
          // The compass only makes sense on a quadrilateral: four walls, four
          // names. Any other room gets the rename affordance alone.
          const canSetNorth = placement.room.walls.length === COMPASS_WALL_NAMES.length;

          const startRename = () => {
            setConfirmingDeleteRoomId(null);
            setEditingWallId(null);
            setEditingRoomId(placement.roomId);
          };

          return (
            <section className="room-group" key={placement.roomId}>
              <div className="room-heading">
                {isEditing ? (
                  <InlineRename
                    cancelLabel="Cancel rename"
                    className="room-rename-form"
                    inputLabel={`Rename ${placement.room.name}`}
                    saveLabel="Save room name"
                    value={placement.room.name}
                    onCancel={() => setEditingRoomId(null)}
                    onCommit={(name) => {
                      setEditingRoomId(null);
                      void onRenameRoom(placement.roomId, name);
                    }}
                  />
                ) : (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <h3>{placement.room.name}</h3>
                      </TooltipTrigger>
                      <TooltipContent className="toolbar-tooltip" side="bottom">
                        {placement.room.name}
                      </TooltipContent>
                    </Tooltip>
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
                        <IconTooltip label="Cancel">
                          <Button
                            aria-label="Cancel delete"
                            className="icon-button compact"
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => setConfirmingDeleteRoomId(null)}
                          >
                            <XIcon aria-hidden="true" size={14} />
                          </Button>
                        </IconTooltip>
                      </div>
                    ) : (
                      <div className="room-heading-actions">
                        <span>{pluralize(roomWalls.length, "wall")}</span>
                        <IconTooltip label="Rename room">
                          <Button
                            aria-label={`Rename ${placement.room.name}`}
                            className="icon-button compact"
                            size="icon-sm"
                            variant="ghost"
                            onClick={startRename}
                          >
                            <PencilSimpleIcon aria-hidden="true" size={14} />
                          </Button>
                        </IconTooltip>
                        <IconTooltip label="Delete room">
                          <Button
                            aria-label={`Delete ${placement.room.name}`}
                            className="icon-button compact"
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingRoomId(null);
                              setConfirmingDeleteRoomId(placement.roomId);
                            }}
                          >
                            <TrashIcon aria-hidden="true" size={14} />
                          </Button>
                        </IconTooltip>
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
                {roomWalls.map((wall) =>
                  editingWallId === wall.id ? (
                    <InlineRename
                      cancelLabel="Cancel wall rename"
                      className="wall-rename-form"
                      inputLabel={`Rename ${wall.name}`}
                      key={wall.id}
                      saveLabel="Save wall name"
                      value={wall.name}
                      onCancel={() => setEditingWallId(null)}
                      onCommit={(name) => {
                        setEditingWallId(null);
                        void onRenameWall(wall.id, name);
                      }}
                    />
                  ) : (
                    // The row keeps its whole-row navigate gesture, so the two
                    // per-wall actions sit beside it rather than inside it —
                    // a button cannot contain buttons.
                    <div className="wall-row-item" key={wall.id}>
                      <Button
                        className={[
                          "wall-row",
                          wall.id === selectedWallId ? "active" : "",
                          wall.isOpenSide ? "is-open" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        data-active={wall.id === selectedWallId ? "true" : undefined}
                        data-open={wall.isOpenSide ? "true" : undefined}
                        variant="ghost"
                        onClick={() => onSelectWall(wall.id)}
                      >
                        <span>{wall.name}</span>
                        {/* The always-visible statement that this side is open —
                            the plan draws nothing at rest, so this row is where the
                            state is unambiguous. */}
                        {wall.isOpenSide ? <span className="wall-row-tag">Open</span> : null}
                        {/* Length stays: an open edge is still a real dimension,
                            and it is still editable in the inspector. */}
                        <strong>{formatLength(wall.lengthMm, { unit: wallUnit })}</strong>
                      </Button>
                      <div className="wall-row-actions">
                        <IconTooltip label="Rename wall">
                          <Button
                            aria-label={`Rename ${wall.name}`}
                            className="icon-button compact"
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingRoomId(null);
                              setConfirmingDeleteRoomId(null);
                              setEditingWallId(wall.id);
                            }}
                          >
                            <PencilSimpleIcon aria-hidden="true" size={14} />
                          </Button>
                        </IconTooltip>
                        {canSetNorth ? (
                          <IconTooltip label="Use as North wall">
                            <Button
                              aria-label={`Use ${wall.name} as North wall`}
                              className="icon-button compact"
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => onSetNorthWall(placement.roomId, wall.id)}
                            >
                              <CompassIcon aria-hidden="true" size={14} />
                            </Button>
                          </IconTooltip>
                        ) : null}
                      </div>
                    </div>
                  )
                )}
                {/* Partition faces are just walls to getProjectWalls, so each
                    face row navigates to its elevation via onSelectWall — the
                    same contract as a perimeter wall row. Their names are
                    derived from the partition, so neither rename nor the
                    compass applies here. */}
                {getFreestandingFaces(placement.room).map((face) => (
                  <Button
                    className={face.id === selectedWallId ? "wall-row active" : "wall-row"}
                    data-active={face.id === selectedWallId ? "true" : undefined}
                    key={face.id}
                    variant="ghost"
                    onClick={() => onSelectWall(face.id)}
                  >
                    <span>{face.name}</span>
                    <strong>{formatLength(face.lengthMm, { unit: wallUnit })}</strong>
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

// The pencil → field → check/cancel exchange, shared by the room heading and
// the wall rows. The draft lives here so the parent only tracks WHICH thing is
// being renamed: remounting on a new subject is what resets the field, which is
// the same keying discipline the inspector's Details block needs.
function InlineRename({
  cancelLabel,
  className,
  inputLabel,
  saveLabel,
  value,
  onCancel,
  onCommit
}: {
  cancelLabel: string;
  className: string;
  inputLabel: string;
  saveLabel: string;
  value: string;
  onCancel: () => void;
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const draftIsValid = draft.trim().length > 0;

  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        if (!draftIsValid) return;
        onCommit(draft.trim());
      }}
    >
      <Input
        aria-label={inputLabel}
        autoFocus
        size="compact"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <IconTooltip disabled={!draftIsValid} label="Save name">
        <Button
          aria-label={saveLabel}
          className="icon-button compact"
          disabled={!draftIsValid}
          size="icon-sm"
          type="submit"
          variant="ghost"
        >
          <CheckIcon aria-hidden="true" size={14} />
        </Button>
      </IconTooltip>
      <IconTooltip label="Cancel">
        <Button
          aria-label={cancelLabel}
          className="icon-button compact"
          size="icon-sm"
          variant="ghost"
          onClick={onCancel}
        >
          <XIcon aria-hidden="true" size={14} />
        </Button>
      </IconTooltip>
    </form>
  );
}

function IconTooltip({
  children,
  disabled = false,
  label
}: {
  children: ReactElement;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? <span className="inline-flex">{children}</span> : children}
      </TooltipTrigger>
      <TooltipContent className="toolbar-tooltip" side="bottom">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
