import * as React from "react";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "./ui/dropdown-menu";
import { cn } from "./ui/utils";

// A flat, step-ordered wall inventory entry: perimeter walls and partition
// faces alike (the placeable-surface union), tagged with the room they belong
// to so the switcher can group by room and set the two kinds apart.
export type WallSwitcherEntry = {
  id: string;
  name: string;
  roomId: string;
  roomName: string;
  kind: "perimeter" | "partition-face";
};

// The trigger reuses the elevation chip's Select styling verbatim so the
// topbar look is unchanged when the picker became a dropdown menu.
const TRIGGER_CLASS =
  "select-trigger inline-flex h-9 w-full items-center justify-between gap-2 rounded-sm border border-input bg-background px-2.5 text-[var(--type-sm)] font-[var(--weight-medium)] text-foreground outline-none transition-[border-color,box-shadow,color] duration-150 ease-out hover:border-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-45 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground";

type RoomGroup = {
  roomId: string;
  roomName: string;
  walls: WallSwitcherEntry[];
};

// Preserve incoming (step) order while collecting each room's surfaces.
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

// One room's surfaces: an optional room label (multi-room only), the perimeter
// walls, then — only when the room has partitions — a separator, a muted
// "Partitions" section label, and the indented partition faces.
function RoomSurfaces({
  group,
  showRoomLabel
}: {
  group: RoomGroup;
  showRoomLabel: boolean;
}) {
  const perimeter = group.walls.filter((wall) => wall.kind === "perimeter");
  const faces = group.walls.filter((wall) => wall.kind === "partition-face");
  return (
    <>
      {showRoomLabel ? <DropdownMenuLabel>{group.roomName}</DropdownMenuLabel> : null}
      {perimeter.map((wall) => (
        <DropdownMenuRadioItem key={wall.id} value={wall.id}>
          {wall.name}
        </DropdownMenuRadioItem>
      ))}
      {faces.length > 0 ? (
        <>
          <DropdownMenuSeparator />
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
  // The current wall's room leads inline; every other room becomes a submenu.
  const currentGroup =
    groups.find((group) => group.roomId === current?.roomId) ?? groups[0] ?? null;
  const otherGroups = groups.filter((group) => group !== currentGroup);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Select wall" className={cn(TRIGGER_CLASS, "surface-label-select")}>
          <span className="surface-label-select-value">
            {multiRoom && current ? (
              <span className="surface-label-select-room">{current.roomName} · </span>
            ) : null}
            {current?.name ?? ""}
          </span>
          <CaretDownIcon aria-hidden="true" size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="wall-switcher-menu">
        <DropdownMenuRadioGroup value={currentWallId} onValueChange={onSelectWall}>
          {currentGroup ? (
            <RoomSurfaces group={currentGroup} showRoomLabel={multiRoom} />
          ) : null}
          {otherGroups.length > 0 ? <DropdownMenuSeparator /> : null}
          {otherGroups.map((group) => (
            <DropdownMenuSub key={group.roomId}>
              <DropdownMenuSubTrigger>{group.roomName}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <RoomSurfaces group={group} showRoomLabel={false} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
