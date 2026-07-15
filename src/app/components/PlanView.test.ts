import { describe, expect, it } from "vitest";
import { buildPlanScene } from "../../domain/scene2d/planScene";
import { createSampleProject } from "../../domain/sample/sampleProject";
import {
  buildPlanMeasureSources,
  clampFitExtent,
  getPartitionMovedAxes,
  canPlanMeasurementClaimPointer,
  getPlanMeasurementKeyActions,
  getPlanMeasurementNudgeDelta,
  planMeasurementCancelAction,
  shouldCancelMeasurementForViewportClaim
} from "./PlanView";

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
