import { createRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRectangularRoomPlacement } from "../../../domain/geometry/createRoom";
import { buildPlanScene } from "../../../domain/scene2d/planScene";
import { CURRENT_SCHEMA_VERSION, type Project } from "../../../domain/project";
import { PlanStructureLayer } from "./PlanStructureLayer";

afterEach(cleanup);

// Two abutting rooms: the alcove's east wall and the main room's west wall are
// coincident over the alcove's depth.
function mainRoom(withPartition: boolean) {
  const placement = createRectangularRoomPlacement({
    roomId: "main",
    name: "Main",
    widthMm: 4000,
    depthMm: 3000,
    heightMm: 2500,
    offsetXMm: 0,
    offsetYMm: 0
  });
  if (!withPartition) return placement;
  return {
    ...placement,
    room: {
      ...placement.room,
      freestandingWalls: [
        {
          id: "main-partition-1",
          roomId: "main",
          name: "Partition 1",
          startXMm: 1000,
          startYMm: 1500,
          endXMm: 3000,
          endYMm: 1500,
          heightMm: 2500,
          thicknessMm: 100
        }
      ]
    }
  };
}

function twoRoomScene(withPartition = false) {
  const project: Project = {
    id: "p",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title: "Abutting",
    unit: "m",
    defaultWallHeightMm: 2500,
    defaultCenterlineHeightMm: 1450,
    checklistArtworkIds: [],
    wallObjects: [],
    floorObjects: [],
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    floor: {
      rooms: [
        mainRoom(withPartition),
        createRectangularRoomPlacement({
          roomId: "alcove",
          name: "Alcove",
          widthMm: 2000,
          depthMm: 1200,
          heightMm: 2500,
          offsetXMm: -2000,
          offsetYMm: 0
        })
      ]
    }
  };
  return buildPlanScene(project, { artworksById: new Map() });
}

function renderLayer({ withPartition = false } = {}) {
  const scene = twoRoomScene(withPartition);
  const { container } = render(
    <svg>
      <PlanStructureLayer
        rooms={scene.rooms}
        partitions={scene.partitions}
        selectedRoomId={null}
        reshapeRoomId={null}
        selectedWallId={null}
        hoveredWallId={null}
        selectedFreestandingWallId={null}
        activeTool={null}
        drawRoomActive={false}
        drawRectActive={false}
        partitionToolActive={false}
        partitionDrag={null}
        suppressNextToolClickRef={createRef<boolean>() as never}
        setHoveredWallId={vi.fn()}
        beginRoomDrag={vi.fn()}
        beginPartitionDrag={vi.fn()}
      />
    </svg>
  );
  return container;
}

describe("PlanStructureLayer hit ordering", () => {
  // SVG has no z-index: paint order alone decides which element receives a
  // pointer. A room's hit polygon covers its own interior, so a wall's hit
  // stroke painted BEFORE it lost the inner half of its 14px band — and where
  // two rooms abut, the neighbour's polygon covered the other half too, leaving
  // a shared wall with no clickable pixels at all (no pointer cursor, no way to
  // select it, and no way to restore it once open).
  it("paints every wall-hit stroke after every room-hit polygon", () => {
    const container = renderLayer();

    const nodes = Array.from(container.querySelectorAll(".room-hit, .wall-hit"));
    expect(nodes.length).toBeGreaterThan(0);

    const isRoomHit = (el: Element) => el.classList.contains("room-hit");
    const lastPolygon = nodes.reduce(
      (last, el, index) => (isRoomHit(el) ? index : last),
      -1
    );
    const firstWallHit = nodes.findIndex((el) => el.classList.contains("wall-hit"));

    expect(lastPolygon).toBeGreaterThanOrEqual(0);
    expect(firstWallHit).toBeGreaterThanOrEqual(0);
    expect(firstWallHit).toBeGreaterThan(lastPolygon);
  });

  it("keeps a hit stroke for every wall of every room", () => {
    const container = renderLayer();

    // 4 walls per room, two rooms.
    expect(container.querySelectorAll(".wall-hit")).toHaveLength(8);
    expect(container.querySelectorAll(".wall-line")).toHaveLength(8);
    expect(container.querySelectorAll(".room-hit")).toHaveLength(2);
  });

  it("still paints partition slabs after the wall-hit strokes", () => {
    // A partition slab must keep winning its own clicks over any wall band it
    // crosses — moving the hit strokes later must not have overtaken it.
    const container = renderLayer({ withPartition: true });

    const slab = container.querySelector("rect");
    const lastWallHit = Array.from(container.querySelectorAll(".wall-hit")).at(-1);
    expect(slab).not.toBeNull();
    expect(lastWallHit).toBeDefined();

    // DOCUMENT_POSITION_FOLLOWING === 4: the slab comes after the last hit.
    expect(
      lastWallHit!.compareDocumentPosition(slab!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

describe("PlanStructureLayer partition fixture sanity", () => {
  it("actually renders a partition slab, so the ordering test is not vacuous", () => {
    expect(renderLayer({ withPartition: true }).querySelectorAll("rect")).toHaveLength(1);
    expect(renderLayer().querySelectorAll("rect")).toHaveLength(0);
  });
});
