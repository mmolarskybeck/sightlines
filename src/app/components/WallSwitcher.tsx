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
  const partitionFace = name.match(/^(.*?)(?:\s*[—,·]\s*)side\s+([AB])$/i);
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
  const roomsRef = React.useRef<HTMLDivElement>(null);
  const elevationsRef = React.useRef<HTMLDivElement>(null);
  const focusElevationAfterRoomChangeRef = React.useRef(false);
  const groups = groupByRoom(walls);
  const current = walls.find((wall) => wall.id === currentWallId);
  const currentGroup =
    groups.find((group) => group.roomId === current?.roomId) ?? groups[0] ?? null;
  const formattedCurrentName = current ? formatElevationName(current.name) : "";

  const focusColumnItem = (column: "rooms" | "elevations") => {
    const columnElement = column === "rooms" ? roomsRef.current : elevationsRef.current;
    if (!columnElement) return;

    const preferredSelector =
      column === "rooms"
        ? '.wall-switcher-room-item[aria-current="true"]'
        : '[role="menuitemradio"][data-state="checked"]';
    const fallbackSelector =
      column === "rooms"
        ? '[role="menuitem"]:not([data-disabled])'
        : '[role="menuitemradio"]:not([data-disabled])';
    const target =
      columnElement.querySelector<HTMLElement>(preferredSelector) ??
      columnElement.querySelector<HTMLElement>(fallbackSelector);
    target?.focus();
  };

  React.useEffect(() => {
    if (!focusElevationAfterRoomChangeRef.current) return;
    focusElevationAfterRoomChangeRef.current = false;
    focusColumnItem("elevations");
  }, [currentWallId]);

  const handleMenuKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    const target = event.target as HTMLElement;
    const currentColumn = target.closest<HTMLElement>("[data-wall-switcher-column]")?.dataset
      .wallSwitcherColumn;

    // Radix reserves horizontal arrows for submenus. This menu uses them to
    // cross its two peer columns instead, and owns both keys at the outer
    // edges so they cannot leak to canvas shortcuts behind the portal.
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "ArrowRight" && currentColumn === "rooms") {
      const focusedRoomId = target.closest<HTMLElement>("[data-room-id]")?.dataset.roomId;
      const focusedGroup = groups.find((group) => group.roomId === focusedRoomId);
      const firstElevation = focusedGroup?.walls[0];

      if (firstElevation && focusedRoomId !== current?.roomId) {
        // Crossing into a different room mirrors submenu navigation: reveal
        // that room's elevations, then place focus on its checked first row.
        focusElevationAfterRoomChangeRef.current = true;
        onSelectWall(firstElevation.id);
      } else {
        focusColumnItem("elevations");
      }
    } else if (event.key === "ArrowLeft" && currentColumn === "elevations") {
      focusColumnItem("rooms");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={
            current ? `Change wall: ${formattedCurrentName}, ${current.roomName}` : "Change wall"
          }
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
        data-owns-arrow-keys
        onKeyDownCapture={handleMenuKeyDownCapture}
      >
        <div className="wall-switcher-columns">
          <div
            ref={roomsRef}
            className="wall-switcher-rooms"
            data-wall-switcher-column="rooms"
          >
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
                  data-room-id={group.roomId}
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
          <div
            ref={elevationsRef}
            className="wall-switcher-elevations"
            data-wall-switcher-column="elevations"
          >
            <DropdownMenuLabel>Elevations</DropdownMenuLabel>
            {currentGroup ? (
              <DropdownMenuRadioGroup value={currentWallId} onValueChange={onSelectWall}>
                <ElevationItems group={currentGroup} unit={unit} />
              </DropdownMenuRadioGroup>
            ) : null}
          </div>
        </div>
      </DropdownMenuContent>
      <span className="visually-hidden" aria-live="polite" aria-atomic="true">
        {current ? `Now viewing ${formattedCurrentName} in ${current.roomName}` : ""}
      </span>
    </DropdownMenu>
  );
}
