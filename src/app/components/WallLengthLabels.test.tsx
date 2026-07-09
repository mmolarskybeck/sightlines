import type { ComponentProps } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createPolygonRoomPlacement } from "../../domain/geometry/createRoom";
import { getPlacedRoomBounds } from "../../domain/geometry/walls";
import type { RoomPlacement } from "../../domain/project";
import { WallLengthLabels } from "./WallLengthLabels";

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

function renderLabels(overrides: Partial<ComponentProps<typeof WallLengthLabels>> = {}) {
  const props: ComponentProps<typeof WallLengthLabels> = {
    changedWallIds: [],
    handleSizeMm: 100,
    invalid: false,
    placement: lShape,
    unit: "cm",
    ...overrides
  };
  const utils = render(
    <svg>
      <WallLengthLabels {...props} />
    </svg>
  );
  return { props, ...utils };
}

function labels(container: HTMLElement): SVGTextElement[] {
  return Array.from(container.querySelectorAll<SVGTextElement>(".resize-handle-label"));
}

describe("WallLengthLabels", () => {
  it("renders one label per changed wall and none elsewhere", () => {
    const [a, b] = [lShape.room.walls[0].id, lShape.room.walls[1].id];
    const { container } = renderLabels({ changedWallIds: [a, b] });
    expect(labels(container)).toHaveLength(2);
  });

  it("labels read as unsigned lengths of their own wall", () => {
    // wall[0] runs (0,0)→(6000,0): 6000mm reads as 600 cm, no sign prefix.
    const { container } = renderLabels({ changedWallIds: [lShape.room.walls[0].id] });
    expect(labels(container)[0].textContent).toBe("600 cm");
  });

  it("places the label outside the room bounds (outward probe sanity)", () => {
    // wall[0] is the top edge, so its outward side is above the room: the
    // label's y must sit outside the placed bounds.
    const { container } = renderLabels({ changedWallIds: [lShape.room.walls[0].id] });
    const label = labels(container)[0];
    const bounds = getPlacedRoomBounds(lShape);
    expect(Number(label.getAttribute("y"))).toBeLessThan(bounds.minY);
  });

  it("tints labels with the danger token while the drag is invalid", () => {
    const { container } = renderLabels({
      changedWallIds: [lShape.room.walls[0].id],
      invalid: true
    });
    expect(labels(container)[0].style.fill).toBe("var(--danger)");
  });

  it("renders nothing for an empty changed set or non-positive handle size", () => {
    expect(labels(renderLabels().container)).toHaveLength(0);
    cleanup();
    expect(
      labels(
        renderLabels({ changedWallIds: [lShape.room.walls[0].id], handleSizeMm: 0 }).container
      )
    ).toHaveLength(0);
  });
});
