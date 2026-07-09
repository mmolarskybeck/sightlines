import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sample/sampleProject";
import { getGridSnapTargets } from "../snapping/gridSnapTargets";
import { resolveSnap } from "../snapping/resolveSnap";
import { feetToMm } from "../units/length";
import {
  computeDraggedLengthMm,
  computeEdgeSnappedLengthMm,
  getMovingWallEdgeWorldPointMm,
  proposeMovingEdgePointMm,
  type Vector2
} from "./dragResize";
import { resizeWallPreservingAngles } from "./editRoom";
import { getWallsWithGeometry } from "./walls";

describe("computeDraggedLengthMm", () => {
  it("adds the axis-projected delta to the starting length", () => {
    const result = computeDraggedLengthMm(
      3000,
      { xMm: 500, yMm: 0 },
      { xMm: 1, yMm: 0 }
    );

    expect(result).toBeCloseTo(3500);
  });

  it("works for a vertical (depth) axis the same way as horizontal", () => {
    const result = computeDraggedLengthMm(
      2000,
      { xMm: 0, yMm: -300 },
      { xMm: 0, yMm: 1 }
    );

    expect(result).toBeCloseTo(1700);
  });

  it("clamps to the minimum drag length instead of going to zero or negative", () => {
    const result = computeDraggedLengthMm(
      500,
      { xMm: -10_000, yMm: 0 },
      { xMm: 1, yMm: 0 }
    );

    expect(result).toBe(152.4);
  });

  it("flips sign for an end-anchored resize: moving with the axis shortens the wall", () => {
    // The moving vertex is the start, and the axis points start→end, so a
    // positive-axis drag pulls the start toward the end and shrinks the wall.
    const result = computeDraggedLengthMm(
      3000,
      { xMm: 500, yMm: 0 },
      { xMm: 1, yMm: 0 },
      "end"
    );

    expect(result).toBeCloseTo(2500);
  });

  it("lengthens an end-anchored wall when the start vertex moves against the axis", () => {
    const result = computeDraggedLengthMm(
      3000,
      { xMm: -500, yMm: 0 },
      { xMm: 1, yMm: 0 },
      "end"
    );

    expect(result).toBeCloseTo(3500);
  });

  it("still clamps an end-anchored resize to the minimum drag length", () => {
    const result = computeDraggedLengthMm(
      500,
      { xMm: 10_000, yMm: 0 },
      { xMm: 1, yMm: 0 },
      "end"
    );

    expect(result).toBe(152.4);
  });
});

describe("getMovingWallEdgeWorldPointMm", () => {
  it("returns the resized wall's end vertex in floor coordinates", () => {
    const project = createSampleProject();

    expect(getMovingWallEdgeWorldPointMm(project, "wall-north")).toEqual({
      xMm: feetToMm(28),
      yMm: 0
    });
  });

  it("adds the room placement's offset for a room not anchored at the floor origin", () => {
    const project = createSampleProject();
    project.floor.rooms[0].offsetXMm = feetToMm(10);
    project.floor.rooms[0].offsetYMm = feetToMm(5);

    expect(getMovingWallEdgeWorldPointMm(project, "wall-north")).toEqual({
      xMm: feetToMm(38),
      yMm: feetToMm(5)
    });
  });

  it("returns the resized wall's START vertex for an end-anchored resize", () => {
    const project = createSampleProject();
    project.floor.rooms[0].offsetXMm = feetToMm(10);
    project.floor.rooms[0].offsetYMm = feetToMm(5);

    // wall-north runs v-nw (0,0) → v-ne (28',0); anchoring the end pins v-ne
    // and moves v-nw, so the start vertex (plus placement offset) is the point.
    expect(getMovingWallEdgeWorldPointMm(project, "wall-north", "end")).toEqual({
      xMm: feetToMm(10),
      yMm: feetToMm(5)
    });
  });

  it("throws for a wall id that doesn't exist", () => {
    const project = createSampleProject();

    expect(() => getMovingWallEdgeWorldPointMm(project, "wall-missing")).toThrow(
      /Wall not found/
    );
  });
});

describe("proposeMovingEdgePointMm", () => {
  it("translates the edge start by the pointer's raw movement, independent of grab offset", () => {
    const edgeStartMm: Vector2 = { xMm: feetToMm(28), yMm: 0 };
    // The pointer can start anywhere inside the handle's hit target — not on
    // the edge itself — and the proposed edge point should still move by
    // exactly the pointer's own delta.
    const pointerStartMm: Vector2 = { xMm: edgeStartMm.xMm + 220, yMm: edgeStartMm.yMm - 340 };
    const pointerNowMm: Vector2 = { xMm: pointerStartMm.xMm + 500, yMm: pointerStartMm.yMm - 40 };

    const proposedEdgeMm = proposeMovingEdgePointMm(edgeStartMm, pointerStartMm, pointerNowMm);

    expect(proposedEdgeMm).toEqual({ xMm: edgeStartMm.xMm + 500, yMm: edgeStartMm.yMm - 40 });
  });
});

describe("computeEdgeSnappedLengthMm", () => {
  it("matches the raw pointer-delta length math when nothing snaps (snap-to-grid disabled)", () => {
    const axis: Vector2 = { xMm: 1, yMm: 0 };
    const startLengthMm = feetToMm(28);
    const edgeStartMm: Vector2 = { xMm: feetToMm(28), yMm: 0 };
    const pointerStartMm: Vector2 = { xMm: edgeStartMm.xMm + 300, yMm: edgeStartMm.yMm - 150 };
    const pointerNowMm: Vector2 = { xMm: pointerStartMm.xMm + 500, yMm: pointerStartMm.yMm };

    const proposedEdgeMm = proposeMovingEdgePointMm(edgeStartMm, pointerStartMm, pointerNowMm);
    const previewLengthMm = computeEdgeSnappedLengthMm(
      startLengthMm,
      edgeStartMm,
      proposedEdgeMm,
      axis
    );

    const rawDeltaMm: Vector2 = {
      xMm: pointerNowMm.xMm - pointerStartMm.xMm,
      yMm: pointerNowMm.yMm - pointerStartMm.yMm
    };
    const legacyLengthMm = computeDraggedLengthMm(startLengthMm, rawDeltaMm, axis);

    expect(previewLengthMm).toBeCloseTo(legacyLengthMm);
    expect(previewLengthMm).toBeCloseTo(startLengthMm + 500);
  });

  it("flips sign for an end-anchored drag: the snapped edge moving with the axis shortens the wall", () => {
    const axis: Vector2 = { xMm: 1, yMm: 0 };
    const startLengthMm = feetToMm(28);
    const edgeStartMm: Vector2 = { xMm: 0, yMm: 0 };
    const snappedEdgeMm: Vector2 = { xMm: 500, yMm: 0 };

    const previewLengthMm = computeEdgeSnappedLengthMm(
      startLengthMm,
      edgeStartMm,
      snappedEdgeMm,
      axis,
      "end"
    );

    expect(previewLengthMm).toBeCloseTo(startLengthMm - 500);
  });
});

describe("edge-snapped resize drag (grab-offset regression)", () => {
  it("commits a round length when a handle grabbed off-center is dragged near a grid line", () => {
    const project = createSampleProject();
    const wallId = "wall-north";
    const axis: Vector2 = { xMm: 1, yMm: 0 };
    const startLengthMm = feetToMm(28);
    const edgeStartMm = getMovingWallEdgeWorldPointMm(project, wallId);

    // Simulate grabbing the handle well off the wall's true moving edge —
    // RoomResizeHandles places the handle on the paired wall's midpoint,
    // not on this wall's own end vertex — rather than exactly on it. Before
    // the fix, this offset landed in the committed length verbatim.
    const grabOffsetMm: Vector2 = { xMm: 220, yMm: -340 };
    const pointerStartMm: Vector2 = {
      xMm: edgeStartMm.xMm + grabOffsetMm.xMm,
      yMm: edgeStartMm.yMm + grabOffsetMm.yMm
    };

    // Drag so the edge would land a few mm short of the 15' grid line —
    // close enough to be inside the snap threshold, not exactly on it.
    const targetEdgeXMm = feetToMm(15);
    const nearMissMm = 6;
    const pointerNowMm: Vector2 = {
      xMm: pointerStartMm.xMm + (targetEdgeXMm - nearMissMm - edgeStartMm.xMm),
      yMm: pointerStartMm.yMm
    };

    const proposedEdgeMm = proposeMovingEdgePointMm(edgeStartMm, pointerStartMm, pointerNowMm);
    expect(proposedEdgeMm.xMm).toBeCloseTo(targetEdgeXMm - nearMissMm);

    const gridTargets = getGridSnapTargets(feetToMm(1), {
      minXMm: 0,
      maxXMm: feetToMm(28),
      minYMm: -feetToMm(5),
      maxYMm: feetToMm(5)
    }).filter((target) => target.axis === "x");

    const snapResult = resolveSnap(proposedEdgeMm, gridTargets, { thresholdMm: 20 });
    expect(snapResult.point.xMm).toBeCloseTo(targetEdgeXMm);

    const previewLengthMm = computeEdgeSnappedLengthMm(
      startLengthMm,
      edgeStartMm,
      snapResult.point,
      axis
    );

    expect(previewLengthMm).toBeCloseTo(targetEdgeXMm);

    const result = resizeWallPreservingAngles(project, wallId, previewLengthMm);
    const resizedNorthWall = getWallsWithGeometry(result.project.floor.rooms[0].room).find(
      (wall) => wall.id === wallId
    );

    expect(resizedNorthWall?.end.xMm).toBeCloseTo(feetToMm(15));
    expect(resizedNorthWall?.lengthMm).toBeCloseTo(feetToMm(15));
  });
});
