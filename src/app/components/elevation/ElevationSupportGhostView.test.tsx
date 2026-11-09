// The wiring half of the floor-support ghosts: ElevationView has to collect the
// room's SUPPORT floor objects, hand them to the scene builder, draw the ghost
// they produce, stand a rider's cabinet at its own base height, and fold the
// support into the dimension neighbour pool at its full height — the block plus
// whatever rises off it. The components' own geometry is covered in
// ElevationMonitorGhost.test.tsx and the scene builder's in elevationScene.test.
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import { getWallsWithGeometry } from "../../../domain/geometry/walls";
import { FIT_VIEWPORT } from "../../../domain/viewport/viewport2d";
import type {
  Artwork,
  ArtworkFloorObject,
  ArtworkWallObject,
  SupportFloorObject
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

const MONITOR: Artwork = {
  id: "art-monitor",
  schemaVersion: 1,
  title: "Video",
  dimensions: { widthMm: 500, heightMm: 375, status: "known" },
  displayAs: "monitor",
  metadata: {}
};

const HUNG_WORK: Artwork = {
  id: "art-hung",
  schemaVersion: 1,
  title: "Print",
  dimensions: { widthMm: 400, heightMm: 400, status: "known" },
  metadata: {}
};

// A 150mm plinth with a 450mm bonnet over it: the bonnet out-tops the 375mm
// cabinet standing on it, so the volume in front of the wall is 600mm, not 525.
const BONNET_HEIGHT_MM = 450;
const PLINTH_HEIGHT_MM = 150;

// Places the cabinet (and, when asked, the plinth under it) just inside the
// sample room's first wall so their footprints project onto that wall.
function setup(
  options: {
    plinth?: boolean;
    bonnet?: boolean;
    wallObjects?: ArtworkWallObject[];
  } = {}
) {
  const project = createSampleProject();
  const wall = getWallsWithGeometry(project.floor.rooms[0]!.room)[0]!;
  const placement = project.floor.rooms[0]!;
  const midXMm = (wall.start.xMm + wall.end.xMm) / 2 + placement.offsetXMm;
  const midYMm = (wall.start.yMm + wall.end.yMm) / 2 + placement.offsetYMm;
  const floorObject: ArtworkFloorObject = {
    id: "fobj-monitor",
    kind: "artwork",
    artworkId: MONITOR.id,
    xMm: midXMm,
    yMm: midYMm,
    widthMm: 500,
    depthMm: 400,
    heightMm: 375,
    rotationDeg: 0,
    wallYMm: 1450,
    ...(options.plinth ? { baseHeightMm: PLINTH_HEIGHT_MM } : {})
  };
  const support: SupportFloorObject = {
    id: "fobj-plinth",
    kind: "support",
    supportKind: "plinth",
    xMm: midXMm,
    yMm: midYMm,
    widthMm: 900,
    depthMm: 900,
    rotationDeg: 0,
    heightMm: PLINTH_HEIGHT_MM,
    wallYMm: 0,
    ...(options.bonnet ? { bonnetHeightMm: BONNET_HEIGHT_MM } : {})
  };
  useAppStore.setState({
    project: {
      ...project,
      floorObjects: options.plinth ? [support, floorObject] : [floorObject],
      ...(options.wallObjects ? { wallObjects: options.wallObjects } : {})
    }
  });
  return { wall };
}

function renderView(
  wall: ReturnType<typeof getWallsWithGeometry>[number],
  props: { selectedObjectIds?: string[] } = {}
) {
  return render(
    <TooltipProvider>
      <ElevationView
        artworksById={
          new Map([
            [MONITOR.id, MONITOR],
            [HUNG_WORK.id, HUNG_WORK]
          ])
        }
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

describe("ElevationView — floor-support ghosts", () => {
  it("draws a bare-floor monitor's cabinet with no support ghost at all", () => {
    const { wall } = setup();
    const { container } = renderView(wall);

    const ghost = container.querySelector(".elevation-monitor-ghost")!;
    expect(ghost).not.toBeNull();
    expect(ghost.querySelector(".monitor-ghost-cabinet")).not.toBeNull();
    expect(container.querySelector(".elevation-support-ghost")).toBeNull();
  });

  it("draws the plinth as its own ghost, at its own wider span, with its bonnet", () => {
    const { wall } = setup({ plinth: true, bonnet: true });
    const { container } = renderView(wall);

    const support = container.querySelector(".elevation-support-ghost")!;
    const block = support.querySelector(".support-ghost-block")!;
    const bonnet = support.querySelector(".support-ghost-bonnet")!;
    const cabinet = container.querySelector(".monitor-ghost-cabinet")!;
    // The 900mm plinth draws at ITS span; the 500mm cabinet at its own.
    expect(Number(block.getAttribute("width"))).toBeCloseTo(900);
    expect(Number(block.getAttribute("height"))).toBeCloseTo(PLINTH_HEIGHT_MM);
    expect(Number(bonnet.getAttribute("width"))).toBeCloseTo(900);
    expect(Number(bonnet.getAttribute("height"))).toBeCloseTo(BONNET_HEIGHT_MM);
    expect(Number(cabinet.getAttribute("width"))).toBeCloseTo(500);
    // The cabinet stands ON the plinth: its top is the plinth's top plus its
    // own height, i.e. it is drawn PLINTH_HEIGHT_MM higher than the block's top.
    expect(Number(cabinet.getAttribute("y"))).toBeCloseTo(
      Number(block.getAttribute("y")) - 375
    );
  });

  it("bounds a vertical gap line at the BONNET's top when the bonnet out-tops the cabinet", () => {
    // A 150 plinth under a 450 bonnet is a 600mm volume. A work hung with its
    // bottom edge 1000mm up should measure 400mm down to the glass — not 475mm
    // to the cabinet's top, which is what ignoring the bonnet would print.
    const project = createSampleProject();
    const wall = getWallsWithGeometry(project.floor.rooms[0]!.room)[0]!;
    const hung: ArtworkWallObject = {
      id: "wobj-hung",
      kind: "artwork",
      artworkId: HUNG_WORK.id,
      wallId: wall.id,
      xMm: wall.lengthMm / 2,
      yMm: 1200,
      widthMm: 400,
      heightMm: 400
    };
    const { wall: sameWall } = setup({
      plinth: true,
      bonnet: true,
      wallObjects: [hung]
    });

    const { container } = renderView(sameWall, { selectedObjectIds: [hung.id] });
    const labels = Array.from(container.querySelectorAll(".dimension-label")).map(
      (label) => label.textContent
    );
    // yMm 1200 is the work's CENTRE, so its bottom edge is 1000.
    expect(labels).toContain("40 cm");
    expect(labels).not.toContain("47.5 cm");
  });
});
