import type { ComponentProps } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPolygonRoomPlacement } from "../../domain/geometry/createRoom";
import type { RoomPlacement } from "../../domain/project";
import { WallSlideHandles } from "./WallSlideHandles";

afterEach(cleanup);

// L-shaped room: six walls, every one long enough to host a chip at the
// handle size used below.
const lShape: RoomPlacement = createPolygonRoomPlacement({
  roomId: "room-1",
  name: "L Room",
  heightMm: 2400,
  pointsFloorMm: [
    { xMm: 0, yMm: 0 },
    { xMm: 6000, yMm: 0 },
    { xMm: 6000, yMm: 3000 },
    { xMm: 3000, yMm: 3000 },
    { xMm: 3000, yMm: 6000 },
    { xMm: 0, yMm: 6000 }
  ]
});

// A room with one deliberately short (400mm) wall — the notch riser — that
// falls below the crowded-wall threshold at the handle size used below, while
// its five neighbours stay long enough to host chips.
const shortWallRoom: RoomPlacement = createPolygonRoomPlacement({
  roomId: "room-2",
  name: "Notched Room",
  heightMm: 2400,
  pointsFloorMm: [
    { xMm: 0, yMm: 0 },
    { xMm: 6000, yMm: 0 },
    { xMm: 6000, yMm: 3000 },
    { xMm: 3000, yMm: 3000 },
    { xMm: 3000, yMm: 3400 },
    { xMm: 0, yMm: 3400 }
  ]
});

function renderHandles(overrides: Partial<ComponentProps<typeof WallSlideHandles>> = {}) {
  const props: ComponentProps<typeof WallSlideHandles> = {
    activeDrag: null,
    // 100mm handle → 840mm crowded-wall threshold (paddedSizeMm * 3).
    handleSizeMm: 100,
    highlightedWallId: null,
    placement: lShape,
    unit: "cm",
    onBeginWallDrag: vi.fn(),
    ...overrides
  };
  const utils = render(
    <svg>
      <WallSlideHandles {...props} />
    </svg>
  );
  return { props, ...utils };
}

// Count chips by their padded hit rect (one per rendered chip).
function chipCount(container: HTMLElement): number {
  return container.querySelectorAll(".resize-handle.handle-hit").length;
}

describe("WallSlideHandles", () => {
  it("renders one chip per wall for an L-shaped room", () => {
    const { container } = renderHandles();
    expect(lShape.room.walls).toHaveLength(6);
    expect(chipCount(container)).toBe(6);
  });

  it("hides the chip for a wall too short to host it cleanly", () => {
    const { container } = renderHandles({ placement: shortWallRoom });
    // Six walls, but the 400mm riser is below the crowded threshold.
    expect(shortWallRoom.room.walls).toHaveLength(6);
    expect(chipCount(container)).toBe(5);
  });

  it("labels an active drag with the outward-signed offset, not the raw left-normal one", () => {
    // The fixture's input winding has positive signed area, so creation keeps
    // it: wall[0] runs (0,0)→(6000,0) with the room below it (+y). Its left
    // normal (+y) points INTO the room, so moveRoomWall's raw +500 is a
    // shrink — the label must re-sign it: inward reads "-", outward "+".
    const draggedWallId = lShape.room.walls[0].id;
    const shrink = renderHandles({
      activeDrag: { wallId: draggedWallId, offsetMm: 500, valid: true }
    });
    expect(shrink.container.querySelector(".resize-handle-label")?.textContent).toBe("-50 cm");
    cleanup();

    const grow = renderHandles({
      activeDrag: { wallId: draggedWallId, offsetMm: -500, valid: true }
    });
    expect(grow.container.querySelector(".resize-handle-label")?.textContent).toBe("+50 cm");
  });

  it("tints the dragged chip with the danger token while the slide is invalid", () => {
    const draggedWallId = lShape.room.walls[0].id;
    const { container } = renderHandles({
      activeDrag: { wallId: draggedWallId, offsetMm: 500, valid: false }
    });
    const tinted = Array.from(container.querySelectorAll<SVGRectElement>(".resize-handle")).filter(
      (rect) => rect.style.fill === "var(--danger)"
    );
    expect(tinted.length).toBeGreaterThan(0);
  });

  it("renders nothing when handleSizeMm is non-positive", () => {
    const { container } = renderHandles({ handleSizeMm: 0 });
    expect(chipCount(container)).toBe(0);
  });
});
