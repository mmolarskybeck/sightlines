// The wiring half of the box-monitor ghost: ElevationView has to hand the
// scene's SUPPORT span and bonnet through to the component, and fold the
// monitor into the dimension neighbour pool at the ASSEMBLY's full height —
// plinth plus whatever rises off it. The component's own geometry is covered in
// ElevationMonitorGhost.test.tsx.
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

// A 150mm plinth under the cabinet with a 450mm bonnet over it: the bonnet
// out-tops the 375mm cabinet, so the assembly is 600mm, not 525mm.
const BONNETED_PLINTH: FloorSupport = {
  kind: "plinth",
  widthMm: 900,
  depthMm: 900,
  heightMm: 150,
  bonnetHeightMm: 450
};

// Places the cabinet just inside the sample room's first wall so its footprint
// projects onto that wall — the same setup ElevationSupportedGhostView uses.
function setup(
  options: { support?: FloorSupport; wallObjects?: ArtworkWallObject[] } = {}
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
    ...(options.support ? { support: options.support } : {})
  };
  useAppStore.setState({
    project: {
      ...project,
      floorObjects: [floorObject],
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

describe("ElevationView — box-monitor ghosts", () => {
  it("LEGACY: a default-pedestal monitor draws plinth and cabinet, no bonnet", () => {
    const { wall } = setup();
    const { container } = renderView(wall);

    const ghost = container.querySelector(".elevation-monitor-ghost")!;
    expect(ghost).not.toBeNull();
    expect(ghost.querySelector(".monitor-ghost-pedestal")).not.toBeNull();
    expect(ghost.querySelector(".monitor-ghost-cabinet")).not.toBeNull();
    expect(ghost.querySelector(".monitor-ghost-bonnet")).toBeNull();
  });

  it("draws the bonnet, and the plinth at its own wider span", () => {
    const { wall } = setup({ support: BONNETED_PLINTH });
    const { container } = renderView(wall);

    const ghost = container.querySelector(".elevation-monitor-ghost")!;
    const pedestal = ghost.querySelector(".monitor-ghost-pedestal")!;
    const cabinet = ghost.querySelector(".monitor-ghost-cabinet")!;
    const bonnet = ghost.querySelector(".monitor-ghost-bonnet")!;
    // The 900mm plinth is drawn at ITS span; the 500mm cabinet at its own.
    expect(Number(pedestal.getAttribute("width"))).toBeCloseTo(900);
    expect(Number(cabinet.getAttribute("width"))).toBeCloseTo(500);
    expect(Number(bonnet.getAttribute("width"))).toBeCloseTo(900);
    expect(Number(bonnet.getAttribute("height"))).toBeCloseTo(450);
  });

  it("bounds a vertical gap line at the BONNET's top when the bonnet out-tops the cabinet", () => {
    // 150 plinth + a 450 bonnet over a 375 cabinet = a 600mm assembly. A work
    // hung with its bottom edge 1000mm up should measure 400mm down to the
    // glass — not 475mm to the cabinet's top, which is what ignoring the bonnet
    // in the neighbour pool would print.
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
      support: BONNETED_PLINTH,
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
