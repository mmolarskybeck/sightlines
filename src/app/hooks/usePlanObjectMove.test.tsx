import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  getPlaceableFloorWalls,
  getWallObjectPlanRect,
  WALL_OBJECT_PLAN_DEPTH_MM
} from "../../domain/geometry/planObjects";
import type { Project, WallObject } from "../../domain/project";
import { createSampleProject } from "../../domain/sample/sampleProject";
import { usePlanObjectMove, type PlanObjectMoveDeps } from "./usePlanObjectMove";

// Pressing a shelf in PLAN drags the assembly: the slab plus the works standing
// on it, rigid, through the group-level planGroupMove entry and out through
// onCommitPlanMoveGroup. The failure this guards is the one that reads as a bug
// in the room rather than in the app — a shelf sliding to another wall while
// its works stay behind, or arriving with its works re-spaced.

function pointerEvent(type: string, props: Record<string, unknown> = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, props);
  return event;
}

function pressEvent(clientX: number, clientY: number): ReactPointerEvent<SVGGElement> {
  return {
    clientX,
    clientY,
    stopPropagation: () => {},
    preventDefault: () => {}
  } as unknown as ReactPointerEvent<SVGGElement>;
}

const shelf: WallObject = {
  id: "shelf-1",
  kind: "shelf",
  wallId: "wall-north",
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
  wallId: "wall-north",
  xMm: 1900,
  yMm: 1200 + 200,
  widthMm: 300,
  heightMm: 400
};

function projectWith(wallObjects: WallObject[]): Project {
  return { ...createSampleProject(), wallObjects, floorObjects: [] };
}

type Api = ReturnType<typeof usePlanObjectMove>;

function renderMove(project: Project, overrides: Partial<PlanObjectMoveDeps> = {}) {
  const holder: { api: Api | null } = { api: null };
  const onCommitPlanMove = vi.fn();
  const onCommitPlanMoveGroup = vi.fn();

  function Harness() {
    holder.api = usePlanObjectMove(() => ({
      // Client px map 1:1 onto floor mm.
      toSvgMm: (clientX, clientY) => ({ xMm: clientX, yMm: clientY }),
      project,
      floorWallsForTool: getPlaceableFloorWalls(project.floor),
      snappingWallObjects: project.wallObjects,
      floorObjectRoomIds: new Map(),
      // Generous, so the cross-wall test can actually capture the far wall.
      captureDistanceMm: 500,
      gridSnapTargets: [],
      snapToGrid: false,
      snapThresholdMm: 0.001,
      selectedObjectIds: [],
      suppressNextSelect: () => {},
      onCommitPlanMove,
      onCommitPlanMoveGroup,
      ...overrides
    }));
    return null;
  }

  const utils = render(<Harness />);
  return { holder, onCommitPlanMove, onCommitPlanMoveGroup, ...utils };
}

// The press params PlacedObjectsLayer builds for a wall object, off the same
// plan-rect helper.
function pressParams(project: Project, object: WallObject) {
  const wall = getPlaceableFloorWalls(project.floor).find(
    (candidate) => candidate.id === object.wallId
  )!;
  const depthMm = object.kind === "shelf" ? object.depthMm : WALL_OBJECT_PLAN_DEPTH_MM;
  const rect = getWallObjectPlanRect(wall, object, depthMm);
  return {
    objectId: object.id,
    kind: object.kind,
    startCenterMm: { xMm: rect.centerXMm, yMm: rect.centerYMm },
    movingSize: { widthMm: object.widthMm, heightMm: object.heightMm, depthMm },
    wallFootprintDepthMm: depthMm,
    rotationDeg: rect.angleDeg,
    currentPlacement: {
      anchor: "wall" as const,
      wallId: object.wallId,
      xMm: object.xMm
    },
    initialPlanRect: rect
  };
}

function drag(
  api: Api,
  project: Project,
  object: WallObject,
  deltaMm: { xMm: number; yMm: number }
) {
  const params = pressParams(project, object);
  const fromXMm = params.startCenterMm.xMm;
  const fromYMm = params.startCenterMm.yMm;
  act(() => {
    api.beginObjectDrag(params, pressEvent(fromXMm, fromYMm));
  });
  act(() => {
    window.dispatchEvent(
      pointerEvent("pointermove", {
        clientX: fromXMm + deltaMm.xMm,
        clientY: fromYMm + deltaMm.yMm
      })
    );
  });
  act(() => {
    window.dispatchEvent(
      pointerEvent("pointerup", {
        clientX: fromXMm + deltaMm.xMm,
        clientY: fromYMm + deltaMm.yMm
      })
    );
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("usePlanObjectMove — shelf assemblies", () => {
  it("turns a shelf press into a group move over the shelf and its riders", () => {
    const project = projectWith([shelf, rider]);
    const { holder, onCommitPlanMove, onCommitPlanMoveGroup } = renderMove(project);

    // Along wall-north, which runs +x from the origin.
    drag(holder.api!, project, shelf, { xMm: 600, yMm: 0 });

    expect(onCommitPlanMove).not.toHaveBeenCalled();
    expect(onCommitPlanMoveGroup).toHaveBeenCalledTimes(1);
    const [moves] = onCommitPlanMoveGroup.mock.calls[0]!;
    expect(moves.map((move: { id: string }) => move.id).sort()).toEqual([
      rider.id,
      shelf.id
    ]);
    const byId = new Map(moves.map((move: { id: string }) => [move.id, move]));
    const shelfMove = byId.get(shelf.id) as { xMm: number; wallId?: string };
    const riderMove = byId.get(rider.id) as { xMm: number; wallId?: string };
    expect(shelfMove.xMm).toBeCloseTo(shelf.xMm + 600, 1);
    // Rigid: the rider keeps its exact along-wall offset from the slab.
    expect(riderMove.xMm - shelfMove.xMm).toBeCloseTo(rider.xMm - shelf.xMm, 1);
    // Nobody left their wall.
    expect(shelfMove.wallId).toBeUndefined();
    expect(riderMove.wallId).toBeUndefined();
  });

  it("re-anchors the whole assembly onto another wall, offsets intact", () => {
    const project = projectWith([shelf, rider]);
    const { holder, onCommitPlanMoveGroup } = renderMove(project);

    // The sample room is 28ft × 18ft: drag from the north wall down the room to
    // within capture distance of the east wall (x ≈ 8534).
    drag(holder.api!, project, shelf, { xMm: 6500, yMm: 2500 });

    const [moves] = onCommitPlanMoveGroup.mock.calls[0]!;
    const byId = new Map(moves.map((move: { id: string }) => [move.id, move]));
    const shelfMove = byId.get(shelf.id) as { xMm: number; wallId?: string };
    const riderMove = byId.get(rider.id) as { xMm: number; wallId?: string };

    expect(shelfMove.wallId).toBe("wall-east");
    // The rider crossed WITH the slab — this is the whole point of the rigid
    // assembly, and the thing per-member re-anchoring used to get wrong.
    expect(riderMove.wallId).toBe("wall-east");
    expect(riderMove.xMm - shelfMove.xMm).toBeCloseTo(rider.xMm - shelf.xMm, 1);
  });

  it("leaves a lone wall object on the single-object path", () => {
    const loneWork: WallObject = { ...rider, id: "lone-1", yMm: 2000 };
    const project = projectWith([loneWork]);
    const { holder, onCommitPlanMove, onCommitPlanMoveGroup } = renderMove(project);

    drag(holder.api!, project, loneWork, { xMm: 300, yMm: 0 });

    expect(onCommitPlanMoveGroup).not.toHaveBeenCalled();
    expect(onCommitPlanMove).toHaveBeenCalledTimes(1);
  });
});
