// The wiring half of the supported-artwork ghost: ElevationView has to render
// it beside the monitor/suspended ghosts, gate it on the SAME "Ghosts" toggle,
// and fold it into the dimension neighbour pool at the ASSEMBLY's full height —
// the component's own geometry is covered in
// ElevationSupportedArtworkGhost.test.tsx.
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import { getWallsWithGeometry } from "../../../domain/geometry/walls";
import { FIT_VIEWPORT } from "../../../domain/viewport/viewport2d";
import type {
  Artwork,
  ArtworkFloorObject,
  ArtworkWallObject,
  FloorSupport
} from "../../../domain/project";
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

const initialStoreState = useAppStore.getState();

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAppStore.setState(initialStoreState, true);
});

const SCULPTURE: Artwork = {
  id: "art-sculpture",
  schemaVersion: 1,
  title: "Sculpture",
  dimensions: { widthMm: 400, heightMm: 400, status: "known" },
  metadata: {}
};

// A support totalling 1500mm off the floor (1100 pedestal + 400 work) unless a
// test says otherwise.
const PEDESTAL: FloorSupport = {
  kind: "pedestal",
  widthMm: 600,
  depthMm: 600,
  heightMm: 1100
};

// Places the sculpture just inside the sample room's first wall so its
// footprint projects onto that wall (the room point-in-polygon gate in
// ElevationView's floorGhostInputs, then the scene's own overlap test).
function setup(options: {
  support?: FloorSupport;
  wallObjects?: ArtworkWallObject[];
} = {}) {
  const project = createSampleProject();
  const wall = getWallsWithGeometry(project.floor.rooms[0]!.room)[0]!;
  const placement = project.floor.rooms[0]!;
  const midXMm =
    (wall.start.xMm + wall.end.xMm) / 2 + placement.offsetXMm;
  const midYMm = (wall.start.yMm + wall.end.yMm) / 2 + placement.offsetYMm;
  // A step into the room along the wall's inward normal — the sample room's
  // first wall runs along y, so stepping in y is enough to land inside it.
  const floorObject: ArtworkFloorObject = {
    id: "fobj-sculpture",
    kind: "artwork",
    artworkId: SCULPTURE.id,
    xMm: midXMm,
    yMm: midYMm,
    widthMm: 400,
    depthMm: 400,
    heightMm: 400,
    rotationDeg: 0,
    wallYMm: 1450,
    ...(options.support ? { support: options.support } : {})
  };
  useAppStore.setState({
    project: {
      ...project,
      floorObjects: [floorObject],
      ...(options.wallObjects ? { wallObjects: options.wallObjects } : {})
    }
  });
  return { wall, project };
}

function renderView(
  wall: ReturnType<typeof getWallsWithGeometry>[number],
  props: { ghostsVisible?: boolean; selectedObjectIds?: string[] } = {}
) {
  return render(
    <TooltipProvider>
      <ElevationView
        artworksById={new Map([[SCULPTURE.id, SCULPTURE]])}
        centerlineMm={createSampleProject().defaultCenterlineHeightMm}
        gridPrecisionFloorMm={null}
        gridVisible={false}
        snapToGrid={false}
        unit="cm"
        wallHeightMm={wall.heightMm}
        wallId={wall.id}
        wallLengthMm={wall.lengthMm}
        wallName={wall.name}
        viewport={FIT_VIEWPORT}
        onViewportChange={() => {}}
        {...props}
      />
    </TooltipProvider>
  );
}

describe("ElevationView — supported-artwork ghosts", () => {
  it("renders the ghost for a work standing on a pedestal in front of this wall", () => {
    const { wall } = setup({ support: PEDESTAL });
    const { container } = renderView(wall);

    const ghost = container.querySelector(".elevation-supported-artwork-ghost")!;
    expect(ghost).not.toBeNull();
    expect(ghost.querySelector(".supported-artwork-ghost-support")).not.toBeNull();
    expect(ghost.querySelector(".supported-artwork-ghost-work")).not.toBeNull();
  });

  it("draws nothing for the same work standing on the bare floor", () => {
    // Not "suspended, so no ghost": a floor-resting artwork has never ghosted
    // (the elevationScene DECISION), and adding supports must not change that.
    const { wall } = setup();
    const { container } = renderView(wall);
    expect(container.querySelector(".elevation-supported-artwork-ghost")).toBeNull();
  });

  it("rides the same Ghosts toggle as the monitor and suspended families", () => {
    const { wall } = setup({ support: PEDESTAL });
    const { container } = renderView(wall, { ghostsVisible: false });
    expect(container.querySelector(".elevation-supported-artwork-ghost")).toBeNull();
  });

  it("bounds a vertical gap line at the ASSEMBLY's top, not at the floor", () => {
    // A work hung with its bottom edge 2000mm up, over a 1500mm assembly
    // (1100 pedestal + 400 work): the gap below it should measure 500mm to the
    // top of the assembly, not 2000mm to the floor. This is what folding the
    // ghost into the dimension neighbour pool at total height buys.
    const project = createSampleProject();
    const wall = getWallsWithGeometry(project.floor.rooms[0]!.room)[0]!;
    const hung: ArtworkWallObject = {
      id: "wobj-hung",
      kind: "artwork",
      artworkId: SCULPTURE.id,
      wallId: wall.id,
      xMm: wall.lengthMm / 2,
      yMm: 2200,
      widthMm: 400,
      heightMm: 400
    };
    const { wall: sameWall } = setup({ support: PEDESTAL, wallObjects: [hung] });

    const { container } = renderView(sameWall, { selectedObjectIds: [hung.id] });
    const labels = Array.from(container.querySelectorAll(".dimension-label")).map(
      (label) => label.textContent
    );
    // yMm 2200 is the work's CENTRE, so its bottom edge is 2000.
    expect(labels).toContain("50 cm");
    expect(labels).not.toContain("200 cm");
  });
});
