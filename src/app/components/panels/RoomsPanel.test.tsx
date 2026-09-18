import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPolygonRoomPlacement,
  createRectangularRoomPlacement
} from "../../../domain/geometry/createRoom";
import type { Project, RoomPlacement } from "../../../domain/project";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import { TooltipProvider } from "../ui/tooltip";
import { RoomsPanel } from "./RoomsPanel";

afterEach(cleanup);

// A quadrilateral drawn as a polygon: four walls named "Wall 1"…"Wall 4", so
// the compass is available without the rectangle constructor's head start.
const QUADRILATERAL: RoomPlacement = createPolygonRoomPlacement({
  roomId: "room-quad",
  name: "Gallery 1",
  heightMm: 3000,
  pointsFloorMm: [
    { xMm: 0, yMm: 0 },
    { xMm: 6000, yMm: 0 },
    { xMm: 6000, yMm: 4000 },
    { xMm: 0, yMm: 4000 }
  ]
});

// Five walls: nothing to map North/East/South/West onto.
const PENTAGON: RoomPlacement = createPolygonRoomPlacement({
  roomId: "room-pent",
  name: "Gallery 2",
  heightMm: 3000,
  pointsFloorMm: [
    { xMm: 0, yMm: 0 },
    { xMm: 6000, yMm: 0 },
    { xMm: 6000, yMm: 4000 },
    { xMm: 3000, yMm: 6000 },
    { xMm: 0, yMm: 4000 }
  ]
});

const WITH_PARTITION: RoomPlacement = (() => {
  const placement = createRectangularRoomPlacement({
    roomId: "room-part",
    name: "Gallery 3",
    widthMm: 6000,
    depthMm: 4000,
    heightMm: 3000,
    offsetXMm: 0,
    offsetYMm: 0
  });
  return {
    ...placement,
    room: {
      ...placement.room,
      freestandingWalls: [
        {
          id: "room-part-partition-1",
          roomId: "room-part",
          name: "Partition 1",
          startXMm: 1000,
          startYMm: 2000,
          endXMm: 5000,
          endYMm: 2000,
          heightMm: 3000,
          thicknessMm: 100
        }
      ]
    }
  };
})();

function renderPanel(rooms: RoomPlacement[]) {
  const project: Project = { ...createSampleProject(), floor: { rooms } };
  const onRenameWall = vi.fn();
  const onSetNorthWall = vi.fn();
  const view = render(
    <TooltipProvider>
      <RoomsPanel
        project={project}
        selectedWallId={null}
        onAddRectangleRoom={vi.fn()}
        onDeleteRoom={vi.fn()}
        onRenameRoom={vi.fn()}
        onRenameWall={onRenameWall}
        onResizeWall={vi.fn()}
        onSelectWall={vi.fn()}
        onSetNorthWall={onSetNorthWall}
      />
    </TooltipProvider>
  );
  return { ...view, onRenameWall, onSetNorthWall };
}

describe("RoomsPanel wall rename", () => {
  it("commits a trimmed name from the inline field", () => {
    const { onRenameWall } = renderPanel([QUADRILATERAL]);

    fireEvent.click(screen.getByRole("button", { name: "Rename Wall 1" }));
    const field = screen.getByRole("textbox", { name: "Rename Wall 1" });
    fireEvent.change(field, { target: { value: "  Entrance wall  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save wall name" }));

    expect(onRenameWall).toHaveBeenCalledWith(QUADRILATERAL.room.walls[0]!.id, "Entrance wall");
  });

  it("cancels on Escape without committing, and puts the row back", () => {
    const { onRenameWall } = renderPanel([QUADRILATERAL]);

    fireEvent.click(screen.getByRole("button", { name: "Rename Wall 1" }));
    const field = screen.getByRole("textbox", { name: "Rename Wall 1" });
    fireEvent.change(field, { target: { value: "Entrance wall" } });
    fireEvent.keyDown(field, { key: "Escape" });

    expect(onRenameWall).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Rename Wall 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename Wall 1" })).toBeInTheDocument();
  });
});

describe("RoomsPanel Use as North wall", () => {
  it("offers the compass on every wall of a four-wall room", () => {
    const { onSetNorthWall } = renderPanel([QUADRILATERAL]);

    fireEvent.click(screen.getByRole("button", { name: "Use Wall 2 as North wall" }));

    expect(onSetNorthWall).toHaveBeenCalledWith("room-quad", QUADRILATERAL.room.walls[1]!.id);
  });

  it("hides it for a room with five walls", () => {
    renderPanel([PENTAGON]);

    expect(screen.getAllByRole("button", { name: /^Rename Wall/ })).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /as North wall$/ })).not.toBeInTheDocument();
  });

  // Partition faces are derived walls: they navigate like a wall row but own
  // neither a stored name nor a place in the compass.
  it("gives a partition face neither rename nor the compass", () => {
    const { container } = renderPanel([WITH_PARTITION]);
    const wallList = container.querySelector(".wall-list") as HTMLElement;

    expect(within(wallList).getByText("Partition 1 · Side A")).toBeInTheDocument();
    // Four perimeter walls carry the pair of actions; the two faces carry none.
    expect(within(wallList).getAllByRole("button", { name: /^Rename / })).toHaveLength(4);
    expect(within(wallList).getAllByRole("button", { name: /as North wall$/ })).toHaveLength(4);
  });
});
