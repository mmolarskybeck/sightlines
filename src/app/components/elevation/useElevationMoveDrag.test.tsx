import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { WallObject } from "../../../domain/project";
import { useElevationMoveDrag, type ElevationMoveDragInput } from "./useElevationMoveDrag";

// Shelves on the elevation canvas: a shelf and the works standing on it move as
// ONE body on every path, and a work dragged near a shelf's top face settles
// onto it. Both are geometry the domain owns (shelfRiders.ts / the "shelf-top"
// snap target); what these assert is that this hook actually REACHES that
// geometry — the failure mode is a slab sliding out from under its works, or a
// work that snaps to the centerline while hovering over a shelf.

// jsdom has no PointerEvent constructor; window pointer events are synthesized
// as plain Events carrying the fields the handlers read (the same approach
// useDragGesture.test.tsx uses).
function pointerEvent(type: string, props: Record<string, unknown> = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, props);
  return event;
}

function pressEvent(
  clientX: number,
  clientY: number,
  props: Record<string, unknown> = {}
): ReactPointerEvent<SVGGElement> {
  return {
    clientX,
    clientY,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    stopPropagation: () => {},
    preventDefault: () => {},
    ...props
  } as unknown as ReactPointerEvent<SVGGElement>;
}

const WALL_ID = "wall-north";

const shelf: WallObject = {
  id: "shelf-1",
  kind: "shelf",
  wallId: WALL_ID,
  xMm: 2000,
  // Slab centre 1180 with a 40mm thickness → top face at 1200.
  yMm: 1180,
  widthMm: 1200,
  heightMm: 40,
  depthMm: 300
};

// Bottom edge exactly on the slab's top face, x-span inside it: a rider.
const rider: WallObject = {
  id: "rider-1",
  kind: "artwork",
  artworkId: "art-1",
  wallId: WALL_ID,
  xMm: 1900,
  yMm: 1200 + 200,
  widthMm: 300,
  heightMm: 400
};

// Same wall, hanging well above the slab: near a shelf is not on it.
const hungWork: WallObject = {
  id: "hung-1",
  kind: "artwork",
  artworkId: "art-2",
  wallId: WALL_ID,
  xMm: 3500,
  yMm: 2000,
  widthMm: 400,
  heightMm: 400
};

type Api = ReturnType<typeof useElevationMoveDrag>;

function renderMoveDrag(overrides: Partial<ElevationMoveDragInput> = {}) {
  const holder: { api: Api | null } = { api: null };
  const onMoveWallObjects = vi.fn();
  const onMovePlacement = vi.fn();
  const onMoveOpening = vi.fn();

  function Harness() {
    holder.api = useElevationMoveDrag({
      // Client px map 1:1 onto wall-local mm, so a 500px drag is a 500mm move.
      toWallLocalMm: (clientX, clientY) => ({ xMm: clientX, yMm: clientY }),
      wallId: WALL_ID,
      wallObjectsOnThisWall: [shelf, rider, hungWork],
      withResolvedArtworkFootprint: (object) => object,
      partitionNeighborShims: [],
      allowOverlappingPlacement: true,
      centerlineMm: 1500,
      wallLengthMm: 6000,
      wallHeightMm: 3000,
      minorGridMm: 100,
      snapToGrid: false,
      // Effectively off: these tests are about WHICH objects move, so a snap
      // capture would only obscure the deltas. The snap wiring has its own test
      // below, which raises the threshold deliberately.
      snapThresholdMm: 0.001,
      barrierBreakMm: 0,
      selectedObjectIds: [],
      onMovePlacement,
      onMoveOpening,
      onMoveWallObjects,
      suppressNextSelect: () => {},
      canvasToolArmed: false,
      dropGhost: null,
      beginTouchPan: () => {},
      beginMousePan: () => {},
      handlePointerDownCapture: () => false,
      measurementActive: false,
      measurementGestureRef: { current: null },
      cancelMeasurementPointerGesture: () => {},
      handleMeasurementPointerDown: () => false,
      ...overrides
    });
    return null;
  }

  const utils = render(<Harness />);
  return { holder, onMoveWallObjects, onMovePlacement, onMoveOpening, ...utils };
}

// One complete drag: press on `object` at (x, y), move by (dxMm, dyMm), release.
function drag(
  api: Api,
  object: WallObject,
  fromMm: { xMm: number; yMm: number },
  deltaMm: { xMm: number; yMm: number }
) {
  act(() => {
    api.beginMoveDrag(object, pressEvent(fromMm.xMm, fromMm.yMm));
  });
  act(() => {
    window.dispatchEvent(
      pointerEvent("pointermove", {
        clientX: fromMm.xMm + deltaMm.xMm,
        clientY: fromMm.yMm + deltaMm.yMm
      })
    );
  });
  act(() => {
    window.dispatchEvent(
      pointerEvent("pointerup", {
        clientX: fromMm.xMm + deltaMm.xMm,
        clientY: fromMm.yMm + deltaMm.yMm
      })
    );
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useElevationMoveDrag — shelf riders", () => {
  it("carries a pressed shelf's riders in one commit, with no selection at all", () => {
    const { holder, onMoveWallObjects, onMoveOpening } = renderMoveDrag();

    drag(holder.api!, shelf, { xMm: 2000, yMm: 1180 }, { xMm: 400, yMm: 0 });

    // ONE commit — one undo entry — carrying both objects.
    expect(onMoveWallObjects).toHaveBeenCalledTimes(1);
    const [moves] = onMoveWallObjects.mock.calls[0]!;
    expect(moves.map((move: { id: string }) => move.id).sort()).toEqual([
      rider.id,
      shelf.id
    ]);
    // Rigid: the works keep their exact offset from the slab.
    const byId = new Map(moves.map((move: { id: string }) => [move.id, move]));
    const shelfMove = byId.get(shelf.id) as { xMm: number; yMm: number };
    const riderMove = byId.get(rider.id) as { xMm: number; yMm: number };
    expect(riderMove.xMm - shelfMove.xMm).toBeCloseTo(rider.xMm - shelf.xMm);
    expect(riderMove.yMm - shelfMove.yMm).toBeCloseTo(rider.yMm - shelf.yMm);
    expect(shelfMove.xMm).toBeCloseTo(shelf.xMm + 400);
    // NOT the single-object opening path, which would leave the works behind.
    expect(onMoveOpening).not.toHaveBeenCalled();
  });

  it("unions the riders into a multi-selection that contains the shelf", () => {
    const { holder, onMoveWallObjects } = renderMoveDrag({
      selectedObjectIds: [shelf.id, hungWork.id]
    });

    drag(holder.api!, shelf, { xMm: 2000, yMm: 1180 }, { xMm: 300, yMm: 0 });

    const [moves] = onMoveWallObjects.mock.calls[0]!;
    expect(moves.map((move: { id: string }) => move.id).sort()).toEqual([
      hungWork.id,
      rider.id,
      shelf.id
    ]);
  });

  it("leaves a work hanging above the shelf behind when the shelf moves", () => {
    const { holder, onMoveWallObjects } = renderMoveDrag();

    drag(holder.api!, shelf, { xMm: 2000, yMm: 1180 }, { xMm: 300, yMm: 0 });

    const [moves] = onMoveWallObjects.mock.calls[0]!;
    expect(moves.map((move: { id: string }) => move.id)).not.toContain(hungWork.id);
  });
});

describe("useElevationMoveDrag — shelf-top snapping", () => {
  it("settles a dragged work's bottom edge onto a shelf it overlaps", () => {
    const { holder } = renderMoveDrag({ snapThresholdMm: 60 });

    // A 400mm-tall work whose centre is proposed 30mm below where standing on
    // the slab would put it (top face 1200 + half height = 1400).
    const resolution = holder.api!.resolveElevationPlacement(
      { xMm: 2000, yMm: 1370 },
      { widthMm: 300, heightMm: 400 },
      [shelf],
      "artwork",
      ["artwork"],
      undefined,
      false,
      new Set()
    );

    expect(resolution.point.yMm).toBeCloseTo(1400);
    expect(resolution.snapTargetIds.y).toBe(`shelf-top:${shelf.id}`);
  });

  it("offers no shelf target to a work that does not overlap the slab", () => {
    const { holder } = renderMoveDrag({ snapThresholdMm: 60 });

    // Same height, but 3m along the wall — clear of the shelf's x-span.
    const resolution = holder.api!.resolveElevationPlacement(
      { xMm: 5000, yMm: 1370 },
      { widthMm: 300, heightMm: 400 },
      [shelf],
      "artwork",
      ["artwork"],
      undefined,
      false,
      new Set()
    );

    expect(resolution.snapTargetIds.y).not.toBe(`shelf-top:${shelf.id}`);
  });
});
