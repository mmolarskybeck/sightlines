import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  type Artwork,
  type Project,
  type WallObject
} from "../../domain/project";
import { createSampleProject } from "../../domain/sample/sampleProject";
import type { ArrangeSession, ViewMode } from "../store";
import { useArrangeNudgeShortcuts } from "./useArrangeNudgeShortcuts";

const artworkPlacement: WallObject = {
  id: "placement-art-1",
  kind: "artwork",
  artworkId: "art-1",
  wallId: "wall-north",
  xMm: 100,
  yMm: 200,
  widthMm: 300,
  heightMm: 400
};

const doorPlacement: WallObject = {
  id: "placement-door-1",
  kind: "door",
  blocksPlacement: true,
  wallId: "wall-north",
  xMm: 600,
  yMm: 1200,
  widthMm: 900,
  heightMm: 2100
};

function projectWith(wallObjects: WallObject[]): Project {
  return { ...createSampleProject(), wallObjects };
}

const cameraTravelListeners: ((event: KeyboardEvent) => void)[] = [];

function renderNudgeHarness({
  project = projectWith([artworkPlacement]),
  artworks = [],
  selectedObjectIds = [artworkPlacement.id],
  moveArtworkPlacement = vi.fn(async () => {}),
  arrangeSession = null,
  commitArrangeSession = vi.fn(),
  snapToGrid = false,
  gridPrecisionFloorMm = null,
  beginArrangeSession = vi.fn(),
  setArrangeSessionPreview = vi.fn(),
  viewMode = "elevation",
  moveOpening = vi.fn(async () => {}),
  moveWallObjectsGroup = vi.fn(async () => {})
}: {
  project?: Project;
  artworks?: Artwork[];
  selectedObjectIds?: string[];
  moveArtworkPlacement?: (
    wallObjectId: string,
    xMm: number,
    yMm: number,
    allowOverlap?: boolean
  ) => Promise<void>;
  arrangeSession?: ArrangeSession | null;
  commitArrangeSession?: (allowOverlap?: boolean) => void;
  snapToGrid?: boolean;
  gridPrecisionFloorMm?: number | null;
  beginArrangeSession?: (mode: ArrangeSession["mode"]) => void;
  setArrangeSessionPreview?: (moves: { id: string; xMm: number; yMm: number }[]) => void;
  viewMode?: ViewMode;
  moveOpening?: (
    wallObjectId: string,
    xMm: number,
    yMm: number,
    allowOverlap?: boolean
  ) => Promise<void>;
  moveWallObjectsGroup?: (
    moves: { id: string; xMm: number; yMm: number }[],
    allowOverlap?: boolean
  ) => Promise<void>;
} = {}) {
  const targetKeyDown = vi.fn((event: KeyboardEvent) => event.stopPropagation());
  // Stands in for ThreeDView's KeyboardTravel, which listens on window in the
  // BUBBLE phase and owns Arrow* + WASD. A claimed nudge must never reach it.
  const cameraTravelKeyDown = vi.fn();
  window.addEventListener("keydown", cameraTravelKeyDown);
  cameraTravelListeners.push(cameraTravelKeyDown);

  function Harness() {
    useArrangeNudgeShortcuts({
      project,
      artworks,
      viewMode,
      selectedObjectIds,
      draggingArtworkId: null,
      arrangeSession,
      allowOverlappingPlacement: false,
      snapToGrid,
      gridPrecisionFloorMm,
      beginArrangeSession,
      setArrangeSessionPreview,
      commitArrangeSession,
      moveArtworkPlacement,
      moveOpening,
      moveWallObjectsGroup
    });

    return (
      <>
        <button
          type="button"
          data-testid="topbar-button"
          onKeyDown={(event) => targetKeyDown(event.nativeEvent)}
        >
          Topbar button
        </button>
        <div
          role="separator"
          tabIndex={0}
          data-testid="splitter"
          onKeyDown={(event) => targetKeyDown(event.nativeEvent)}
        />
        <div data-owns-arrow-keys>
          <button
            type="button"
            data-testid="arrow-key-owner"
            onKeyDown={(event) => targetKeyDown(event.nativeEvent)}
          >
            Wall switcher
          </button>
        </div>
      </>
    );
  }

  return {
    moveArtworkPlacement,
    moveOpening,
    moveWallObjectsGroup,
    commitArrangeSession,
    beginArrangeSession,
    setArrangeSessionPreview,
    targetKeyDown,
    cameraTravelKeyDown,
    ...render(<Harness />)
  };
}

function arrowEvent(key: string): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
}

afterEach(() => {
  cleanup();
  for (const listener of cameraTravelListeners.splice(0)) {
    window.removeEventListener("keydown", listener);
  }
  vi.restoreAllMocks();
});

describe("useArrangeNudgeShortcuts focus handling", () => {
  it("nudges before a focused topbar control can trap arrow-key propagation", () => {
    const { getByTestId, moveArtworkPlacement, targetKeyDown } = renderNudgeHarness();
    const button = getByTestId("topbar-button");
    button.focus();

    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true
    });
    act(() => {
      button.dispatchEvent(event);
    });

    expect(moveArtworkPlacement).toHaveBeenCalledWith(
      artworkPlacement.id,
      artworkPlacement.xMm + 12.7,
      artworkPlacement.yMm,
      false
    );
    expect(event.defaultPrevented).toBe(true);
    expect(targetKeyDown).not.toHaveBeenCalled();
  });

  it("leaves arrow keys alone when a focused splitter owns them", () => {
    const { getByTestId, moveArtworkPlacement, targetKeyDown } = renderNudgeHarness();
    const splitter = getByTestId("splitter");
    splitter.focus();

    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true
    });
    act(() => {
      splitter.dispatchEvent(event);
    });

    expect(moveArtworkPlacement).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(targetKeyDown).toHaveBeenCalled();
  });

  it.each(["ArrowLeft", "ArrowRight"])(
    "leaves %s to a focused widget that declares arrow-key ownership",
    (key) => {
      const { getByTestId, moveArtworkPlacement, targetKeyDown } = renderNudgeHarness();
      const owner = getByTestId("arrow-key-owner");
      owner.focus();

      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true
      });
      act(() => {
        owner.dispatchEvent(event);
      });

      expect(moveArtworkPlacement).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      expect(targetKeyDown).toHaveBeenCalled();
    }
  );

  it("leaves Enter to a focused widget that declares arrow-key ownership", () => {
    const arrangeSession: ArrangeSession = {
      wallId: "wall-north",
      memberIds: [artworkPlacement.id],
      originalById: {
        [artworkPlacement.id]: { xMm: artworkPlacement.xMm, yMm: artworkPlacement.yMm }
      },
      previewById: {
        [artworkPlacement.id]: { xMm: artworkPlacement.xMm, yMm: artworkPlacement.yMm }
      },
      mode: "inset",
      insetAnchor: "both",
      insetBoundary: {
        left: { type: "wall", edgeMm: 0 },
        right: { type: "wall", edgeMm: 3000 }
      },
      evenZone: "wall",
      openZoneBoundsMm: { startMm: 0, endMm: 3000 }
    };
    const { getByTestId, commitArrangeSession, targetKeyDown } = renderNudgeHarness({
      arrangeSession
    });
    const owner = getByTestId("arrow-key-owner");
    owner.focus();

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true
    });
    act(() => {
      owner.dispatchEvent(event);
    });

    expect(commitArrangeSession).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(targetKeyDown).toHaveBeenCalled();
  });

  it("does not claim arrows when the selection has no nudge action", () => {
    const { getByTestId, moveArtworkPlacement, targetKeyDown } = renderNudgeHarness({
      project: projectWith([artworkPlacement, doorPlacement]),
      selectedObjectIds: [artworkPlacement.id, doorPlacement.id]
    });
    const button = getByTestId("topbar-button");

    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true
    });
    act(() => {
      button.dispatchEvent(event);
    });

    expect(moveArtworkPlacement).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(targetKeyDown).toHaveBeenCalled();
  });
});

describe("useArrangeNudgeShortcuts framed footprint geometry", () => {
  const framedArtwork = (
    id: string,
    framing: Pick<Artwork, "matWidthMm" | "frame">
  ): Artwork => ({
    id,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title: id,
    dimensions: { widthMm: 300, heightMm: 400, status: "known" },
    metadata: {},
    ...framing
  });

  it("uses a framed neighbor's outer edge when cleaning a single-work nudge", () => {
    const selected = { ...artworkPlacement, xMm: 1000 };
    const neighbor: WallObject = {
      ...artworkPlacement,
      id: "placement-art-2",
      artworkId: "art-2",
      xMm: 600,
      widthMm: 200
    };
    const project = projectWith([selected, neighbor]);
    const northEast = project.floor.rooms[0].room.vertices.find(
      (vertex) => vertex.id === "v-ne"
    )!;
    northEast.xMm = 3000;
    const { getByTestId, moveArtworkPlacement } = renderNudgeHarness({
      project,
      artworks: [framedArtwork("art-2", { matWidthMm: 75 })],
      snapToGrid: true,
      gridPrecisionFloorMm: 100
    });

    act(() => {
      getByTestId("topbar-button").dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true
        })
      );
    });

    // Neighbor outer right edge is 775mm (not the stored-image edge 700mm),
    // so the nearest clean 100mm gap lattice lands the center at 1125mm.
    expect(moveArtworkPlacement).toHaveBeenCalledWith(
      selected.id,
      1125,
      selected.yMm,
      false
    );
  });

  it("quantizes a selected group from its framed outer union", () => {
    const first: WallObject = { ...artworkPlacement, yMm: 240, xMm: 1000 };
    const second: WallObject = {
      ...artworkPlacement,
      id: "placement-art-2",
      artworkId: "art-2",
      yMm: 240,
      xMm: 1500
    };
    const { getByTestId, beginArrangeSession, setArrangeSessionPreview } =
      renderNudgeHarness({
        project: projectWith([first, second]),
        artworks: [
          framedArtwork("art-1", {
            matWidthMm: 50,
            frame: { widthMm: 25, finish: "black" }
          })
        ],
        selectedObjectIds: [first.id, second.id],
        snapToGrid: true,
        gridPrecisionFloorMm: 100
      });

    act(() => {
      getByTestId("topbar-button").dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          bubbles: true,
          cancelable: true
        })
      );
    });

    expect(beginArrangeSession).toHaveBeenCalledWith("inset");
    expect(setArrangeSessionPreview).toHaveBeenCalledWith([
      { id: first.id, xMm: first.xMm, yMm: 375 },
      { id: second.id, xMm: second.xMm, yMm: 375 }
    ]);
  });
});

describe("useArrangeNudgeShortcuts in the 3D view", () => {
  it("nudges a single selected wall artwork", () => {
    const { moveArtworkPlacement } = renderNudgeHarness({ viewMode: "3d" });

    const event = arrowEvent("ArrowRight");
    act(() => {
      document.body.dispatchEvent(event);
    });

    expect(moveArtworkPlacement).toHaveBeenCalledWith(
      artworkPlacement.id,
      artworkPlacement.xMm + 12.7,
      artworkPlacement.yMm,
      false
    );
    expect(event.defaultPrevented).toBe(true);
  });

  it("stops a claimed arrow before the 3D camera travel listener sees it", () => {
    const { cameraTravelKeyDown } = renderNudgeHarness({ viewMode: "3d" });

    act(() => {
      document.body.dispatchEvent(arrowEvent("ArrowUp"));
    });

    expect(cameraTravelKeyDown).not.toHaveBeenCalled();
  });

  it("leaves the arrow to camera travel when nothing is selected", () => {
    const { moveArtworkPlacement, cameraTravelKeyDown } = renderNudgeHarness({
      viewMode: "3d",
      selectedObjectIds: []
    });

    const event = arrowEvent("ArrowRight");
    act(() => {
      document.body.dispatchEvent(event);
    });

    expect(moveArtworkPlacement).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(cameraTravelKeyDown).toHaveBeenCalled();
  });

  it("leaves the arrow to camera travel for a multi-selection", () => {
    const second: WallObject = {
      ...artworkPlacement,
      id: "placement-art-2",
      artworkId: "art-2",
      xMm: 1500
    };
    const {
      beginArrangeSession,
      setArrangeSessionPreview,
      cameraTravelKeyDown
    } = renderNudgeHarness({
      viewMode: "3d",
      project: projectWith([artworkPlacement, second]),
      selectedObjectIds: [artworkPlacement.id, second.id]
    });

    const event = arrowEvent("ArrowRight");
    act(() => {
      document.body.dispatchEvent(event);
    });

    // The arrange session's preview only renders in elevation — in 3D the
    // press must reach the camera instead of silently moving works.
    expect(beginArrangeSession).not.toHaveBeenCalled();
    expect(setArrangeSessionPreview).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(cameraTravelKeyDown).toHaveBeenCalled();
  });

  it("leaves the arrow to camera travel for a lone selected opening", () => {
    const { moveOpening, cameraTravelKeyDown } = renderNudgeHarness({
      viewMode: "3d",
      project: projectWith([doorPlacement]),
      selectedObjectIds: [doorPlacement.id]
    });

    const event = arrowEvent("ArrowLeft");
    act(() => {
      document.body.dispatchEvent(event);
    });

    expect(moveOpening).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(cameraTravelKeyDown).toHaveBeenCalled();
  });

  it("skips clean-increment quantization in 3D (plain step nudge)", () => {
    const selected = { ...artworkPlacement, xMm: 1000 };
    const neighbor: WallObject = {
      ...artworkPlacement,
      id: "placement-art-2",
      artworkId: "art-2",
      xMm: 600,
      widthMm: 200
    };
    const project = projectWith([selected, neighbor]);
    const northEast = project.floor.rooms[0].room.vertices.find(
      (vertex) => vertex.id === "v-ne"
    )!;
    northEast.xMm = 3000;

    const inThreeD = renderNudgeHarness({
      viewMode: "3d",
      project,
      selectedObjectIds: [selected.id],
      snapToGrid: true,
      gridPrecisionFloorMm: 100
    });
    act(() => {
      document.body.dispatchEvent(arrowEvent("ArrowRight"));
    });

    // Elevation would quantize this to a clean 100mm gap lattice (see the
    // framed-footprint suite above); 3D takes the raw step.
    expect(inThreeD.moveArtworkPlacement).toHaveBeenCalledWith(
      selected.id,
      1100,
      selected.yMm,
      false
    );
  });

  it("leaves elevation behavior unchanged", () => {
    const { moveArtworkPlacement, cameraTravelKeyDown } = renderNudgeHarness({
      viewMode: "elevation"
    });

    const event = arrowEvent("ArrowUp");
    act(() => {
      document.body.dispatchEvent(event);
    });

    expect(moveArtworkPlacement).toHaveBeenCalledWith(
      artworkPlacement.id,
      artworkPlacement.xMm,
      artworkPlacement.yMm + 12.7,
      false
    );
    expect(event.defaultPrevented).toBe(true);
    expect(cameraTravelKeyDown).not.toHaveBeenCalled();
  });
});

// A shelf and the works standing on it are one rigid assembly on EVERY move
// path (chunk 3's rider rule). The keyboard path is the one where it would be
// easiest to regress silently: a lone shelf used to fall into the single
// non-artwork branch (moveOpening, leaving its works behind), and a
// multi-selection into the arrange session, which moves artwork members only.
describe("useArrangeNudgeShortcuts — shelf assemblies", () => {
  const shelf: WallObject = {
    id: "placement-shelf-1",
    kind: "shelf",
    wallId: "wall-north",
    xMm: 1000,
    // Slab centre 1180 with a 40mm thickness → top face at 1200.
    yMm: 1180,
    widthMm: 1200,
    heightMm: 40,
    depthMm: 300
  };
  // Bottom edge exactly on the shelf's top face, x-span inside it: a rider.
  const rider: WallObject = {
    id: "placement-rider-1",
    kind: "artwork",
    artworkId: "art-2",
    wallId: "wall-north",
    xMm: 900,
    yMm: 1200 + 200,
    widthMm: 300,
    heightMm: 400
  };
  // Same wall, well above the slab: hanging near a shelf is not standing on it.
  const bystander: WallObject = {
    id: "placement-bystander-1",
    kind: "artwork",
    artworkId: "art-3",
    wallId: "wall-north",
    xMm: 900,
    yMm: 2200,
    widthMm: 300,
    heightMm: 400
  };

  it("moves a selected shelf AND its riders in one batched commit", () => {
    const { moveWallObjectsGroup, moveOpening, setArrangeSessionPreview } =
      renderNudgeHarness({
        project: projectWith([shelf, rider, bystander]),
        selectedObjectIds: [shelf.id]
      });

    const event = arrowEvent("ArrowRight");
    act(() => {
      document.body.dispatchEvent(event);
    });

    expect(moveWallObjectsGroup).toHaveBeenCalledTimes(1);
    const [moves] = vi.mocked(moveWallObjectsGroup).mock.calls[0]!;
    expect(moves).toEqual([
      { id: shelf.id, xMm: shelf.xMm + 12.7, yMm: shelf.yMm },
      { id: rider.id, xMm: rider.xMm + 12.7, yMm: rider.yMm }
    ]);
    // Not the opening path (which would leave the works behind), and not the
    // arrange session (which would move the works and leave the slab).
    expect(moveOpening).not.toHaveBeenCalled();
    expect(setArrangeSessionPreview).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("carries the riders when the shelf is nudged as part of a multi-selection", () => {
    const { moveWallObjectsGroup, setArrangeSessionPreview } = renderNudgeHarness({
      project: projectWith([shelf, rider, bystander]),
      selectedObjectIds: [shelf.id, bystander.id]
    });

    act(() => {
      document.body.dispatchEvent(arrowEvent("ArrowUp"));
    });

    const [moves] = vi.mocked(moveWallObjectsGroup).mock.calls[0]!;
    expect(moves.map((move: { id: string }) => move.id)).toEqual([
      shelf.id,
      rider.id,
      bystander.id
    ]);
    // Every member takes the SAME delta — the assembly stays rigid.
    for (const move of moves) {
      const before = [shelf, rider, bystander].find((object) => object.id === move.id)!;
      expect(move.yMm).toBeCloseTo(before.yMm + 12.7);
      expect(move.xMm).toBeCloseTo(before.xMm);
    }
    expect(setArrangeSessionPreview).not.toHaveBeenCalled();
  });

  it("declines in 3D so the arrows keep flying the camera", () => {
    const { moveWallObjectsGroup, cameraTravelKeyDown } = renderNudgeHarness({
      viewMode: "3d",
      project: projectWith([shelf, rider]),
      selectedObjectIds: [shelf.id]
    });

    const event = arrowEvent("ArrowRight");
    act(() => {
      document.body.dispatchEvent(event);
    });

    expect(moveWallObjectsGroup).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(cameraTravelKeyDown).toHaveBeenCalled();
  });
});
