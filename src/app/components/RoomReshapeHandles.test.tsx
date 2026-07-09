import type { ComponentProps } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPolygonRoomPlacement } from "../../domain/geometry/createRoom";
import type { RoomPlacement } from "../../domain/project";
import { RoomReshapeHandles } from "./RoomReshapeHandles";

afterEach(cleanup);

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

function renderHandles(overrides: Partial<ComponentProps<typeof RoomReshapeHandles>> = {}) {
  const props: ComponentProps<typeof RoomReshapeHandles> = {
    activeVertexId: null,
    handleSizeMm: 100,
    invalid: false,
    placement: lShape,
    selectedVertexId: null,
    onBeginVertexDrag: vi.fn(),
    onSplitWallClick: vi.fn(),
    ...overrides
  };
  return render(
    <svg>
      <RoomReshapeHandles {...props} />
    </svg>
  );
}

describe("RoomReshapeHandles", () => {
  it("renders no wall-body drag targets — edit-shape is corner/split only", () => {
    const { container } = renderHandles();
    expect(container.querySelectorAll(".room-reshape-wall-hit")).toHaveLength(0);
  });

  it("renders a split '+' per wall and a vertex handle per corner", () => {
    const { container } = renderHandles();

    const plusMarks = Array.from(container.querySelectorAll("text")).filter(
      (node) => node.textContent === "+"
    );
    expect(plusMarks).toHaveLength(lShape.room.walls.length);

    // Every split chip and every vertex handle carries a padded hit rect, so
    // the count is walls + vertices (equal for a closed loop).
    const hitTargets = container.querySelectorAll(".resize-handle.handle-hit");
    expect(hitTargets).toHaveLength(lShape.room.walls.length + lShape.room.vertices.length);
  });
});
