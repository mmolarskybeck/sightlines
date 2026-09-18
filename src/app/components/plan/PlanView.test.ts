import { describe, expect, it } from "vitest";
import { getFloorObjectPlanRect, type FloorWall } from "../../../domain/geometry/planObjects";
import {
  CURRENT_ARTWORK_SCHEMA_VERSION,
  type Artwork,
  type ArtworkFloorObject
} from "../../../domain/project";
import type { PlanSceneFloorObject } from "../../../domain/scene2d/planScene";
import { buildPlanScene } from "../../../domain/scene2d/planScene";
import { createSampleProject } from "../../../domain/sample/sampleProject";
import type { PlanGroupMember } from "../../../domain/snapping/planGroupMove";
import { resolvePlanObjectNudge } from "../../../domain/snapping/planGroupMove";
import { buildPlanMeasureSources } from "../../../domain/measurement/planMeasurementGeometry";
import {
  canPlanMeasurementClaimPointer,
  getPlanMeasurementCreationKeyAction,
  getPlanMeasurementKeyActions,
  getPlanMeasurementNudgeDelta,
  planMeasurementCancelAction,
  shouldCancelMeasurementForViewportClaim
} from "../../hooks/planMeasurementPolicy";
import { clampFitExtent, getPartitionMovedAxes, rotateHandleRectAt } from "./PlanView";

// Same FloorWall builder shape as planGroupMove.test.ts (offset 0 baked in).
function makeWall(
  id: string,
  startMm: { xMm: number; yMm: number },
  endMm: { xMm: number; yMm: number }
): FloorWall {
  const dx = endMm.xMm - startMm.xMm;
  const dy = endMm.yMm - startMm.yMm;
  return {
    id,
    roomId: "room-1",
    name: id,
    startVertexId: `${id}-a`,
    endVertexId: `${id}-b`,
    heightMm: 3000,
    start: { id: `${id}-a`, ...startMm },
    end: { id: `${id}-b`, ...endMm },
    lengthMm: Math.hypot(dx, dy),
    angleRad: Math.atan2(dy, dx),
    startFloorMm: startMm,
    endFloorMm: endMm
  };
}

describe("Plan measurement candidates", () => {
  it("derives visible room vertices and bounded wall edges from the painted scene", () => {
    const scene = buildPlanScene(createSampleProject());
    const sources = buildPlanMeasureSources(scene);
    const north = scene.rooms[0]!.walls.find((wall) => wall.wallId === "wall-north")!;

    expect(sources.points).toContainEqual({
      id: `room:${scene.rooms[0]!.roomId}:vertex:0`,
      kind: "vertex",
      point: scene.rooms[0]!.polygonMm[0]
    });
    expect(sources.segments).toContainEqual({
      id: "wall:wall-north",
      kind: "edge",
      start: north.startMm,
      end: north.endMm
    });
  });

  it("uses the shared clean nudge increment and a 4x Shift step when snapToGrid is on", () => {
    expect(getPlanMeasurementNudgeDelta("ArrowUp", "cm", null, false, true, false)).toEqual({
      xMm: 0,
      yMm: -10
    });
    expect(getPlanMeasurementNudgeDelta("ArrowRight", "in", 25.4, true, true, false)).toEqual({
      xMm: 101.6,
      yMm: 0
    });
    expect(getPlanMeasurementNudgeDelta("Enter", "cm", null, false, true, false)).toBeNull();
  });

  it("honors Alt fine precision while snapToGrid is on, ignoring the precision floor", () => {
    expect(getPlanMeasurementNudgeDelta("ArrowRight", "cm", 25.4, false, true, true)).toEqual({
      xMm: 1,
      yMm: 0
    });
    expect(getPlanMeasurementNudgeDelta("ArrowUp", "in", null, false, true, true)).toEqual({
      xMm: 0,
      yMm: -1.5875
    });
  });

  it("falls back to plain raw deltas when snapToGrid is off, ignoring the precision floor", () => {
    expect(getPlanMeasurementNudgeDelta("ArrowRight", "cm", 25.4, false, false, false)).toEqual({
      xMm: 10,
      yMm: 0
    });
    expect(getPlanMeasurementNudgeDelta("ArrowDown", "in", 25.4, true, false, false)).toEqual({
      xMm: 0,
      yMm: 50.8
    });
    // Alt is meaningless off snapToGrid — the raw step is already the "unclean" default.
    expect(getPlanMeasurementNudgeDelta("ArrowLeft", "cm", null, false, false, true)).toEqual({
      xMm: -10,
      yMm: 0
    });
  });

  it("starts keyboard refinement, then confirms or cancels it locally", () => {
    const complete = {
      phase: "armed-complete",
      context: { kind: "plan" },
      start: { xMm: 100, yMm: 200 },
      end: { xMm: 300, yMm: 400 }
    } as const;
    expect(
      getPlanMeasurementKeyActions(complete, "start", "ArrowLeft", "cm", null, false, true, false)
    ).toEqual([
      { type: "begin-refinement", endpoint: "start" },
      { type: "preview-refinement", point: { xMm: 90, yMm: 200 } }
    ]);
    const refining = {
      ...complete,
      phase: "refining",
      endpoint: "start",
      original: complete.start
    } as const;
    expect(
      getPlanMeasurementKeyActions(refining, "start", "Enter", "cm", null, false, true, false)
    ).toEqual([{ type: "commit-refinement" }]);
    expect(
      getPlanMeasurementKeyActions(refining, "start", "Escape", "cm", null, false, true, false)
    ).toEqual([{ type: "cancel-refinement" }]);
  });

  it("drives keyboard-only creation: begin at origin, nudge preview (y-down), complete at preview", () => {
    const origin = { xMm: 1000, yMm: 2000 };
    const empty = { phase: "armed-empty", context: { kind: "plan" } } as const;
    // Enter from armed-empty begins at the supplied viewport-centre origin.
    expect(
      getPlanMeasurementCreationKeyAction(empty, "Enter", origin, "cm", null, false, true, false)
    ).toEqual({ type: "begin", point: origin });
    // Arrow keys do nothing until a measurement is in progress.
    expect(
      getPlanMeasurementCreationKeyAction(empty, "ArrowDown", origin, "cm", null, false, true, false)
    ).toBeNull();

    const drawing = {
      phase: "drawing",
      context: { kind: "plan" },
      start: origin,
      preview: origin
    } as const;
    // Plan y grows downward, so ArrowDown adds to y by the shared clean step.
    expect(
      getPlanMeasurementCreationKeyAction(drawing, "ArrowDown", origin, "cm", null, false, true, false)
    ).toEqual({ type: "preview", point: { xMm: 1000, yMm: 2010 } });
    // Enter completes at the current preview; the reducer rejects coincidence.
    expect(
      getPlanMeasurementCreationKeyAction(drawing, "Enter", origin, "cm", null, false, true, false)
    ).toEqual({ type: "complete", point: origin });
  });

  it("yields measurement ownership to right/middle click and Space-pan", () => {
    expect(canPlanMeasurementClaimPointer(0, false)).toBe(true);
    expect(canPlanMeasurementClaimPointer(1, false)).toBe(false);
    expect(canPlanMeasurementClaimPointer(2, false)).toBe(false);
    expect(canPlanMeasurementClaimPointer(0, true)).toBe(false);
    expect(shouldCancelMeasurementForViewportClaim("touch", true)).toBe(true);
    expect(shouldCancelMeasurementForViewportClaim("mouse", true)).toBe(false);
  });

  it("cancels drawing and restores refinement when a pointer is cancelled", () => {
    const drawing = {
      phase: "drawing",
      context: { kind: "plan" },
      start: { xMm: 0, yMm: 0 },
      preview: { xMm: 10, yMm: 10 }
    } as const;
    expect(planMeasurementCancelAction(drawing)).toEqual({ type: "clear" });
    expect(
      planMeasurementCancelAction({
        phase: "refining",
        context: { kind: "plan" },
        start: { xMm: 0, yMm: 0 },
        end: { xMm: 10, yMm: 10 },
        endpoint: "end",
        original: { xMm: 10, yMm: 10 }
      })
    ).toEqual({ type: "cancel-refinement" });
  });
});

describe("resolvePlanObjectNudge", () => {
  const horizontalWall = makeWall("wall-1", { xMm: 0, yMm: 0 }, { xMm: 4000, yMm: 0 });

  it("slides a single wall member along its own wall and commits a wall placement", () => {
    const members: PlanGroupMember[] = [
      {
        id: "obj-1",
        anchor: "wall",
        kind: "artwork",
        wall: horizontalWall,
        worldCenterMm: { xMm: 1000, yMm: 0 },
        widthMm: 300,
        depthMm: 100
      }
    ];

    expect(resolvePlanObjectNudge(members, { xMm: 200, yMm: 0 })).toEqual({
      kind: "single",
      objectId: "obj-1",
      placement: { anchor: "wall", wallId: "wall-1", xMm: 1200 }
    });
  });

  it("keeps a wall member on its wall for a perpendicular nudge (never falls off)", () => {
    const members: PlanGroupMember[] = [
      {
        id: "obj-1",
        anchor: "wall",
        kind: "artwork",
        wall: horizontalWall,
        worldCenterMm: { xMm: 1000, yMm: 0 },
        widthMm: 300,
        depthMm: 100
      }
    ];

    // A purely perpendicular delta projects to zero along-wall travel: the
    // object stays put on its wall rather than being re-captured or dropped.
    expect(resolvePlanObjectNudge(members, { xMm: 0, yMm: 300 })).toEqual({
      kind: "single",
      objectId: "obj-1",
      placement: { anchor: "wall", wallId: "wall-1", xMm: 1000 }
    });
  });

  it("translates a single floor member freely by the raw delta (snap bypassed)", () => {
    const members: PlanGroupMember[] = [
      {
        id: "floor-1",
        anchor: "floor",
        centerMm: { xMm: 1000, yMm: 500 },
        widthMm: 300,
        depthMm: 400,
        rotationDeg: 0
      }
    ];

    expect(resolvePlanObjectNudge(members, { xMm: 10, yMm: -10 })).toEqual({
      kind: "single",
      objectId: "floor-1",
      placement: { anchor: "floor", xMm: 1010, yMm: 490 }
    });
  });

  it("translates a multi-selection rigidly: wall members reproject, floor members slide", () => {
    const members: PlanGroupMember[] = [
      {
        id: "wall-obj",
        anchor: "wall",
        kind: "artwork",
        wall: horizontalWall,
        worldCenterMm: { xMm: 1000, yMm: 0 },
        widthMm: 300,
        depthMm: 100
      },
      {
        id: "floor-obj",
        anchor: "floor",
        centerMm: { xMm: 2000, yMm: 700 },
        widthMm: 300,
        depthMm: 400,
        rotationDeg: 0
      }
    ];

    expect(resolvePlanObjectNudge(members, { xMm: 50, yMm: 0 })).toEqual({
      kind: "group",
      moves: [
        { id: "wall-obj", xMm: 1050 },
        { id: "floor-obj", xMm: 2050, yMm: 700 }
      ]
    });
  });

  it("returns null when no live members resolve", () => {
    expect(resolvePlanObjectNudge([], { xMm: 10, yMm: 0 })).toBeNull();
  });
});

describe("whole-partition drag activation", () => {
  it("does not activate from click jitter below the pointer-travel threshold", () => {
    expect(
      getPartitionMovedAxes({ x: false, y: false }, { xMm: 4.9, yMm: -4.9 }, 5)
    ).toEqual({ x: false, y: false });
  });

  it("activates only the axes travelled by the pointer and keeps them latched", () => {
    expect(
      getPartitionMovedAxes({ x: false, y: false }, { xMm: 5.1, yMm: 0 }, 5)
    ).toEqual({ x: true, y: false });

    expect(
      getPartitionMovedAxes({ x: true, y: false }, { xMm: 0, yMm: -5.1 }, 5)
    ).toEqual({ x: true, y: true });
  });
});

// clampFitExtent backs PlanView's contentBounds derivation: it must never
// let the fit window narrow below MIN_PLAN_FIT_EXTENT_MM (9144mm, ~30ft) on
// either axis, regardless of how small (or empty) the floor is, while still
// deferring to the padded floor bounds once those already exceed the floor.
describe("clampFitExtent", () => {
  it("expands an empty floor (bounds around the origin) to exactly the minimum, centered at 0,0", () => {
    const bounds = { minX: 0, minY: 0, width: 0, height: 0 };
    const padding = 900; // getPlanViewPaddingMm's floor for a 0-size bounds

    const result = clampFitExtent(bounds, padding);

    expect(result.width).toBe(9144);
    expect(result.height).toBe(9144);
    expect(result.x).toBe(-9144 / 2);
    expect(result.y).toBe(-9144 / 2);
  });

  it("leaves a large floor's padded bounds unchanged", () => {
    const bounds = { minX: 1000, minY: 2000, width: 20000, height: 15000 };
    const padding = 2100; // 0.14 * 15000

    const result = clampFitExtent(bounds, padding);

    expect(result.x).toBeCloseTo(bounds.minX - padding);
    expect(result.y).toBeCloseTo(bounds.minY - padding);
    expect(result.width).toBeCloseTo(bounds.width + padding * 2);
    expect(result.height).toBeCloseTo(bounds.height + padding * 2);
  });

  it("expands a small room to the minimum while staying centered on the room's own center", () => {
    const bounds = { minX: 5000, minY: -3000, width: 1000, height: 1000 };
    const padding = 900;

    const result = clampFitExtent(bounds, padding);
    const centerX = bounds.minX + bounds.width / 2;
    const centerY = bounds.minY + bounds.height / 2;

    expect(result.width).toBe(9144);
    expect(result.height).toBe(9144);
    expect(result.x + result.width / 2).toBeCloseTo(centerX);
    expect(result.y + result.height / 2).toBeCloseTo(centerY);
  });
});

// rotateHandleRectAt is what the rotate handle hangs off. The bug it exists to
// prevent: a sculpture on a pedestal keeps the handle anchored to the WORK's
// rect, so the stem and chip are drawn inside the pedestal painted around it.
describe("rotateHandleRectAt", () => {
  function floorArtwork(
    support?: ArtworkFloorObject["support"],
    rotationDeg = 0
  ): ArtworkFloorObject {
    return {
      id: "fo-1",
      kind: "artwork",
      artworkId: "art-1",
      xMm: 1000,
      yMm: 2000,
      widthMm: 400,
      depthMm: 300,
      heightMm: 900,
      rotationDeg,
      wallYMm: 1450,
      ...(support ? { support } : {})
    };
  }

  function entry(object: ArtworkFloorObject): PlanSceneFloorObject {
    return { object, rect: getFloorObjectPlanRect(object) };
  }

  it("is the work's own rect at the given angle when nothing is under the work", () => {
    const object = floorArtwork();

    const rect = rotateHandleRectAt(entry(object), 45);

    expect(rect.centerXMm).toBeCloseTo(1000, 6);
    expect(rect.centerYMm).toBeCloseTo(2000, 6);
    expect(rect.widthMm).toBe(400);
    expect(rect.depthMm).toBe(300);
    expect(rect.angleDeg).toBe(45);
  });

  it("grows to the whole assembly's footprint for a work on a pedestal", () => {
    const object = floorArtwork({
      kind: "pedestal",
      widthMm: 600,
      depthMm: 500,
      heightMm: 1100
    });

    const rect = rotateHandleRectAt(entry(object), 0);

    // The pedestal contains the work (overhang off), so the union IS the
    // pedestal — wide enough that the handle clears it.
    expect(rect.widthMm).toBeCloseTo(600, 6);
    expect(rect.depthMm).toBeCloseTo(500, 6);
    expect(rect.centerXMm).toBeCloseTo(1000, 6);
    expect(rect.centerYMm).toBeCloseTo(2000, 6);
  });

  it("re-evaluates an offset support's union at the rotation it is asked for", () => {
    const object = floorArtwork({
      kind: "plinth",
      widthMm: 1200,
      depthMm: 400,
      heightMm: 150,
      offsetXMm: 300,
      overhangAllowed: true
    });

    const atZero = rotateHandleRectAt(entry(object), 0);
    const atNinety = rotateHandleRectAt(entry(object), 90);

    // Union at 0°: local x from -300 (plinth left edge) to 900 (plinth right
    // edge), i.e. the plinth alone — it overhangs the work on one side only.
    expect(atZero.widthMm).toBeCloseTo(1200, 6);
    expect(atZero.centerXMm).toBeCloseTo(1000 + 300, 6);
    expect(atZero.centerYMm).toBeCloseTo(2000, 6);
    // The offset lives in the placement's rotated local frame, so a preview
    // rotation moves the union's center — the same box, turned.
    expect(atNinety.widthMm).toBeCloseTo(1200, 6);
    expect(atNinety.angleDeg).toBe(90);
    expect(atNinety.centerXMm).toBeCloseTo(1000, 6);
    expect(atNinety.centerYMm).toBeCloseTo(2000 + 300, 6);
  });

  it("anchors to a box monitor's resolved default pedestal, whose footprint is the cabinet", () => {
    const object = floorArtwork();
    const artwork: Artwork = {
      id: "art-1",
      schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
      dimensions: { status: "unknown" },
      displayAs: "monitor",
      metadata: {}
    };

    const rect = rotateHandleRectAt({ ...entry(object), artwork }, 0);

    expect(rect.widthMm).toBeCloseTo(400, 6);
    expect(rect.depthMm).toBeCloseTo(300, 6);
  });
});
