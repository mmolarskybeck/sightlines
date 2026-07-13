import * as React from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import type { DisplayUnit } from "../../domain/project";
import { formatLength } from "../../domain/units/length";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from "./ui/dropdown-menu";
import { cn } from "./ui/utils";

// A flat, step-ordered wall inventory entry: perimeter walls and partition
// faces alike (the placeable-surface union), tagged with the room they belong
// to so the switcher can keep room navigation separate from elevation choice.
export type WallSwitcherEntry = {
  id: string;
  name: string;
  roomId: string;
  roomName: string;
  kind: "perimeter" | "partition-face";
  lengthMm: number;
  heightMm: number;
};

const TRIGGER_CLASS =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

type RoomGroup = {
  roomId: string;
  roomName: string;
  walls: WallSwitcherEntry[];
};

// Preserve incoming step order while collecting each room's elevations.
function groupByRoom(walls: WallSwitcherEntry[]): RoomGroup[] {
  const groups: RoomGroup[] = [];
  const byId = new Map<string, RoomGroup>();
  for (const wall of walls) {
    let group = byId.get(wall.roomId);
    if (!group) {
      group = { roomId: wall.roomId, roomName: wall.roomName, walls: [] };
      byId.set(wall.roomId, group);
      groups.push(group);
    }
    group.walls.push(wall);
  }
  return groups;
}

function formatElevationName(name: string) {
  const partitionFace = name.match(/^(.*) — side ([AB])$/i);
  return partitionFace ? `${partitionFace[1]} · Side ${partitionFace[2].toUpperCase()}` : name;
}

function formatElevationDimensions(wall: WallSwitcherEntry, unit: DisplayUnit) {
  return `${formatLength(wall.lengthMm, { unit })} × ${formatLength(wall.heightMm, { unit })}`;
}

function ElevationItems({ group, unit }: { group: RoomGroup; unit: DisplayUnit }) {
  const perimeter = group.walls.filter((wall) => wall.kind === "perimeter");
  const faces = group.walls.filter((wall) => wall.kind === "partition-face");

  return (
    <>
      {perimeter.map((wall) => (
        <DropdownMenuRadioItem key={wall.id} value={wall.id} className="wall-switcher-elevation-item">
          <span className="wall-switcher-elevation-name">{formatElevationName(wall.name)}</span>
          <span className="wall-switcher-elevation-dimensions">
            {formatElevationDimensions(wall, unit)}
          </span>
        </DropdownMenuRadioItem>
      ))}
      {faces.length > 0 ? (
        <>
          <div className="dropdown-menu-section-label">Partitions</div>
          {faces.map((wall) => (
            <DropdownMenuRadioItem
              key={wall.id}
              value={wall.id}
              className="wall-switcher-elevation-item wall-switcher-elevation-item-indented"
            >
              <span className="wall-switcher-elevation-name">{formatElevationName(wall.name)}</span>
              <span className="wall-switcher-elevation-dimensions">
                {formatElevationDimensions(wall, unit)}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </>
      ) : null}
    </>
  );
}

export function WallSwitcher({
  walls,
  currentWallId,
  onSelectWall,
  unit
}: {
  walls: WallSwitcherEntry[];
  currentWallId: string;
  onSelectWall: (id: string) => void;
  unit: DisplayUnit;
}) {
  const groups = groupByRoom(walls);
  const current = walls.find((wall) => wall.id === currentWallId);
  const currentGroup =
    groups.find((group) => group.roomId === current?.roomId) ?? groups[0] ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Select wall elevation"
          className={cn(TRIGGER_CLASS, "surface-label-select")}
        >
          <span className="surface-label-select-value">
            {current ? (
              <span className="surface-label-select-room">{current.roomName}</span>
            ) : null}
            <span className="surface-label-select-line">
              <span className="surface-label-select-wall">
                {current ? formatElevationName(current.name) : ""}
              </span>
              {current ? (
                <span className="surface-label-select-dimensions">
                  {formatElevationDimensions(current, unit)}
                </span>
              ) : null}
            </span>
          </span>
          <CaretDownIcon aria-hidden="true" size={12} className="surface-label-select-caret" />
        </button>
      </DropdownMenuTrigger>
      {/* The offsets re-anchor the menu to the chip's frame rather than the
          trigger inside it: -5 walks back the chip's 4px padding + 1px border
          so the columns align with the chip's leading edge, and 8 (plus the
          shared content's 4px translate) clears the chip's bottom entirely. */}
      <DropdownMenuContent
        align="start"
        alignOffset={-5}
        sideOffset={8}
        className="wall-switcher-menu"
      >
        <div className="wall-switcher-columns">
          <div className="wall-switcher-rooms">
            <DropdownMenuLabel>Rooms</DropdownMenuLabel>
            {groups.map((group) => {
              const isCurrentRoom = group.roomId === current?.roomId;
              return (
                <DropdownMenuItem
                  key={group.roomId}
                  className={cn(
                    "wall-switcher-room-item",
                    isCurrentRoom && "wall-switcher-room-item-current"
                  )}
                  aria-current={isCurrentRoom ? "true" : undefined}
                  onSelect={(event) => {
                    // Keep the two-column browser open while the right column
                    // updates to the selected room's elevations.
                    event.preventDefault();
                    const firstElevation = group.walls[0];
                    if (firstElevation && firstElevation.id !== currentWallId) {
                      onSelectWall(firstElevation.id);
                    }
                  }}
                >
                  <span className="wall-switcher-room-name">{group.roomName}</span>
                  <span className="wall-switcher-room-count">{group.walls.length}</span>
                </DropdownMenuItem>
              );
            })}
          </div>
          <div className="wall-switcher-elevations">
            <DropdownMenuLabel>Elevations</DropdownMenuLabel>
            {currentGroup ? (
              <DropdownMenuRadioGroup value={currentWallId} onValueChange={onSelectWall}>
                <ElevationItems group={currentGroup} unit={unit} />
              </DropdownMenuRadioGroup>
            ) : null}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
