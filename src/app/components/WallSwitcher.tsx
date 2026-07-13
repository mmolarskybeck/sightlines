import * as React from "react";
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
};

const TRIGGER_CLASS =
  "select-trigger inline-flex h-9 w-full items-center rounded-sm border border-input bg-background px-2.5 [font-size:var(--type-sm)] [font-weight:var(--weight-medium)] text-foreground outline-none transition-[border-color,box-shadow,color] duration-150 ease-out hover:border-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-45";

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

function ElevationItems({ group }: { group: RoomGroup }) {
  const perimeter = group.walls.filter((wall) => wall.kind === "perimeter");
  const faces = group.walls.filter((wall) => wall.kind === "partition-face");

  return (
    <>
      {perimeter.map((wall) => (
        <DropdownMenuRadioItem key={wall.id} value={wall.id}>
          {wall.name}
        </DropdownMenuRadioItem>
      ))}
      {faces.length > 0 ? (
        <>
          <div className="dropdown-menu-section-label">Partitions</div>
          {faces.map((wall) => (
            <DropdownMenuRadioItem
              key={wall.id}
              value={wall.id}
              className="dropdown-menu-item-indented"
            >
              {wall.name}
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
  onSelectWall
}: {
  walls: WallSwitcherEntry[];
  currentWallId: string;
  onSelectWall: (id: string) => void;
}) {
  const groups = groupByRoom(walls);
  const multiRoom = groups.length > 1;
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
            {multiRoom && current ? (
              <span className="surface-label-select-room">{current.roomName} · </span>
            ) : null}
            {current?.name ?? ""}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="wall-switcher-menu">
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
            <DropdownMenuLabel>
              <span>Elevations</span>
              {currentGroup ? (
                <span className="wall-switcher-elevation-room">{currentGroup.roomName}</span>
              ) : null}
            </DropdownMenuLabel>
            {currentGroup ? (
              <DropdownMenuRadioGroup value={currentWallId} onValueChange={onSelectWall}>
                <ElevationItems group={currentGroup} />
              </DropdownMenuRadioGroup>
            ) : null}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
