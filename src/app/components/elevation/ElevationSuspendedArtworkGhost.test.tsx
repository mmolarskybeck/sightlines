// Covers the elevation ghost for a SUSPENDED floor artwork — a board hung from
// ceiling wires, angled to the wall, hovering above the floor. Three things are
// load-bearing and none of them are visible from the scene builder alone:
// the ghost floats (it does not stand on the floor line like the floor-case
// ghost), it is inert (the board belongs to no wall, so clicking it must not
// select anything), and it obeys the same room gate the case ghosts do, so a
// board in a NEIGHBOURING room never ghosts through the wall between them.
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import { getWallsWithGeometry } from "../../../domain/geometry/walls";
import { FIT_VIEWPORT } from "../../../domain/viewport/viewport2d";
import type { ArtworkFloorObject, Project } from "../../../domain/project";
import { useAppStore } from "../../store";
import { TooltipProvider } from "../ui/tooltip";
import { ElevationView } from "./ElevationView";

class MockResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: 1000, height: 600 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
  }
  unobserve() {}
  disconnect() {}
}

class MockPointerEvent extends MouseEvent {
  readonly isPrimary: boolean;
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.isPrimary = init.isPrimary ?? true;
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
  }
}

const initialStoreState = useAppStore.getState();

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("PointerEvent", MockPointerEvent);
  // Identity client→SVG-userspace mapping (same trick as
  // ElevationCaseWallTextDimensions.test.tsx): a pointerdown that falls through
  // the ghost reaches the canvas marquee, which needs these to exist.
  (SVGSVGElement.prototype as unknown as { createSVGPoint: () => unknown }).createSVGPoint = () => ({
    x: 0,
    y: 0,
    matrixTransform() {
      return { x: (this as { x: number }).x, y: (this as { y: number }).y };
    }
  });
  (SVGSVGElement.prototype as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({
    inverse: () => ({})
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAppStore.setState(initialStoreState, true);
});

// A thin MDF board, 2400 × 40 in plan, 1800 tall, bottom edge 900 above the
// floor — the projection-surface the feature exists for.
function board(overrides: Partial<ArtworkFloorObject> = {}): ArtworkFloorObject {
  return {
    id: "floor-board",
    kind: "artwork",
    artworkId: "art-board",
    xMm: 3000,
    yMm: 1500, // inside the sample room, in front of the north wall
    widthMm: 2400,
    depthMm: 40,
    rotationDeg: 0,
    heightMm: 1800,
    wallYMm: 1450,
    baseHeightMm: 900,
    ...overrides
  };
}

// A second room placed NORTH of the sample room (negative y), so a floor object
// inside it sits behind the sample room's north wall — the exact geometry the
// room gate exists to reject.
function withNeighbourRoom(project: Project): Project {
  const neighbourId = "room-neighbour";
  return {
    ...project,
    floor: {
      ...project.floor,
      rooms: [
        ...project.floor.rooms,
        {
          roomId: neighbourId,
          offsetXMm: 0,
          offsetYMm: -6000,
          rotationDeg: 0,
          room: {
            id: neighbourId,
            name: "Neighbour",
            heightMm: 3000,
            freestandingWalls: [],
            vertices: [
              { id: "n-nw", xMm: 0, yMm: 0 },
              { id: "n-ne", xMm: 8000, yMm: 0 },
              { id: "n-se", xMm: 8000, yMm: 5000 },
              { id: "n-sw", xMm: 0, yMm: 5000 }
            ],
            walls: [
              {
                id: "n-wall-north",
                roomId: neighbourId,
                name: "North",
                startVertexId: "n-nw",
                endVertexId: "n-ne",
                heightMm: 3000
              },
              {
                id: "n-wall-east",
                roomId: neighbourId,
                name: "East",
                startVertexId: "n-ne",
                endVertexId: "n-se",
                heightMm: 3000
              },
              {
                id: "n-wall-south",
                roomId: neighbourId,
                name: "South",
                startVertexId: "n-se",
                endVertexId: "n-sw",
                heightMm: 3000
              },
              {
                id: "n-wall-west",
                roomId: neighbourId,
                name: "West",
                startVertexId: "n-sw",
                endVertexId: "n-nw",
                heightMm: 3000
              }
            ]
          }
        }
      ]
    }
  };
}

function setup(project: Project) {
  useAppStore.setState({ project });
  const wall = getWallsWithGeometry(project.floor.rooms[0]!.room)[0]!;
  const view = render(
    <TooltipProvider>
      <ElevationView
        centerlineMm={project.defaultCenterlineHeightMm}
        gridPrecisionFloorMm={null}
        gridVisible={false}
        snapToGrid={false}
        unit="ft"
        wallHeightMm={wall.heightMm}
        wallId={wall.id}
        wallLengthMm={wall.lengthMm}
        wallName={wall.name}
        viewport={FIT_VIEWPORT}
        onViewportChange={() => {}}
      />
    </TooltipProvider>
  );
  return { ...view, wall };
}

describe("suspended floor artwork ghosts in elevation", () => {
  it("floats the board between baseHeightMm and its top, with suspension wires above it", () => {
    const project = { ...createSampleProject(), floorObjects: [board()] };
    const { container, wall } = setup(project);

    const ghost = container.querySelector(".elevation-suspended-artwork-ghost")!;
    expect(ghost).toBeTruthy();

    const rect = ghost.querySelector(".suspended-artwork-ghost-board")!;
    // SVG y is down from the wall top: the board's TOP (900 + 1800 = 2700 above
    // the floor) maps to wallHeightMm − 2700, and the box is heightMm tall —
    // i.e. it stops well short of the floor line rather than reaching it.
    expect(Number(rect.getAttribute("y"))).toBeCloseTo(wall.heightMm - 2700, 3);
    expect(Number(rect.getAttribute("height"))).toBe(1800);
    expect(Number(rect.getAttribute("x"))).toBeCloseTo(1800, 3); // 3000 ± 1200
    expect(Number(rect.getAttribute("width"))).toBeCloseTo(2400, 3);

    // Two wires, each running from the wall top (y=0) down to the board's top.
    const wires = ghost.querySelectorAll(".suspended-artwork-ghost-wire");
    expect(wires).toHaveLength(2);
    for (const wire of wires) {
      expect(Number(wire.getAttribute("y1"))).toBe(0);
      expect(Number(wire.getAttribute("y2"))).toBeCloseTo(wall.heightMm - 2700, 3);
    }
  });

  it("is inert — clicking the ghost selects nothing", () => {
    const selectObject = vi.fn();
    const project = { ...createSampleProject(), floorObjects: [board()] };
    useAppStore.setState({ selectObject });
    const { container } = setup(project);

    const rect = container.querySelector(".suspended-artwork-ghost-board")!;
    fireEvent.click(rect);
    fireEvent.pointerDown(rect, { pointerId: 1, pointerType: "mouse", button: 0 });

    // The board belongs to no wall: it carries no handler of its own (and the
    // stylesheet makes it pointer-events: none on top of that), so the click
    // falls through to the canvas exactly like a click on empty wall.
    expect(selectObject).not.toHaveBeenCalled();
  });

  it("does not ghost a board standing in a neighbouring room", () => {
    const project = withNeighbourRoom(createSampleProject());
    // Floor y −4500 → inside the neighbour room (which spans −6000..−1000),
    // behind the sample room's north wall. Its along-wall projection overlaps
    // the wall extent, so only the room gate can keep it out.
    const withBoard = { ...project, floorObjects: [board({ yMm: -4500 })] };
    const { container } = setup(withBoard);

    expect(container.querySelector(".elevation-suspended-artwork-ghost")).toBeNull();
  });

  it("does not ghost a floor-resting artwork (no baseHeightMm)", () => {
    const project = {
      ...createSampleProject(),
      floorObjects: [board({ baseHeightMm: undefined })]
    };
    const { container } = setup(project);

    expect(container.querySelector(".elevation-suspended-artwork-ghost")).toBeNull();
  });
});
