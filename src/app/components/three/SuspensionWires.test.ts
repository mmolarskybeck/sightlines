import { describe, expect, it } from "vitest";
import { MathUtils, Object3D } from "three";
import type { FloorObject3d } from "../../../domain/geometry/scene3d";
import { mmToWorld } from "./coordinates";
import {
  planSuspensionWires,
  suspendedCenterYMm,
  SUSPENSION_WIRE_INSET_MM
} from "./SuspensionWires";

// A 2400 x 18 board (the motivating case: thin MDF hung on wires) unless a
// test says otherwise. `suspensionAnchorHeightMm` is the containing room's
// wall height, which deriveScene3d resolves — see scene3d.test.ts for that half.
function makeObject(overrides: Partial<FloorObject3d> = {}): FloorObject3d {
  return {
    objectId: "fobj-1",
    kind: "artwork",
    artworkId: "art-1",
    xMm: 2000,
    yMm: 1500,
    widthMm: 2400,
    depthMm: 18,
    heightMm: 1350,
    rotationDeg: 0,
    ...overrides
  };
}

describe("suspendedCenterYMm — the lift", () => {
  it("puts a floor-resting object's center at exactly half its height", () => {
    // The pre-suspension behavior, bit for bit: every existing floor object
    // flows through this, so absence must not perturb it at all.
    expect(suspendedCenterYMm(makeObject({ heightMm: 1350 }))).toBe(675);
  });

  it("treats an explicit 0 base height the same as an absent one", () => {
    expect(suspendedCenterYMm(makeObject({ baseHeightMm: 0 }))).toBe(
      suspendedCenterYMm(makeObject())
    );
  });

  it("measures the base height as a BOTTOM edge, not a center", () => {
    // A 1350-tall board hung with its underside 900 above the floor occupies
    // 900..2250, so its center is at 1575 — NOT at 900 (which is what treating
    // the field as a hang-height center, i.e. as wallYMm, would produce).
    const object = makeObject({ baseHeightMm: 900, heightMm: 1350 });
    expect(suspendedCenterYMm(object)).toBe(1575);
    expect(suspendedCenterYMm(object) - object.heightMm / 2).toBe(900);
  });
});

describe("planSuspensionWires — when wires exist at all", () => {
  it("draws none for a floor-resting object", () => {
    expect(planSuspensionWires(makeObject())).toBeNull();
    expect(planSuspensionWires(makeObject({ baseHeightMm: 0 }))).toBeNull();
  });

  it("draws none when no room could be resolved to hang from", () => {
    // Suspended, but out on the bare void between rooms: no anchor height, and
    // inventing one is exactly what must not happen.
    expect(
      planSuspensionWires(makeObject({ baseHeightMm: 900 }))
    ).toBeNull();
  });

  it("draws none when the board's top already reaches the wall height", () => {
    const flush = makeObject({
      baseHeightMm: 1150,
      heightMm: 1350,
      suspensionAnchorHeightMm: 2500
    });
    expect(planSuspensionWires(flush)).toBeNull();
    // And when it passes it, rather than drawing an inverted line downward.
    expect(
      planSuspensionWires({ ...flush, baseHeightMm: 1400 })
    ).toBeNull();
  });

  it("draws none for a blocked zone or a display case, however it is stored", () => {
    const suspended = { baseHeightMm: 900, suspensionAnchorHeightMm: 2500 };
    expect(
      planSuspensionWires(makeObject({ kind: "blocked-zone", ...suspended }))
    ).toBeNull();
    expect(
      planSuspensionWires(makeObject({ kind: "case", ...suspended }))
    ).toBeNull();
  });

  it("spans the gap from the board's top face to the anchor", () => {
    const plan = planSuspensionWires(
      makeObject({ baseHeightMm: 900, heightMm: 1350, suspensionAnchorHeightMm: 2500 })
    );
    // 2500 - (900 + 1350): measured from the TOP of the board, not its center.
    expect(plan?.riseMm).toBe(250);
  });
});

describe("planSuspensionWires — attachment points", () => {
  it("attaches four wires, inset from each top corner", () => {
    const plan = planSuspensionWires(
      makeObject({
        widthMm: 2400,
        depthMm: 600,
        baseHeightMm: 900,
        suspensionAnchorHeightMm: 3000
      })
    );
    const x = 1200 - SUSPENSION_WIRE_INSET_MM;
    const z = 300 - SUSPENSION_WIRE_INSET_MM;
    expect(plan?.anchorsMm).toEqual([
      { xMm: -x, zMm: -z },
      { xMm: x, zMm: -z },
      { xMm: x, zMm: z },
      { xMm: -x, zMm: z }
    ]);
  });

  it("caps the inset per axis so a thin board's wires never invert", () => {
    // 18mm MDF: a flat 60mm inset would push the front wires 51mm BEHIND the
    // back face. The cap keeps every anchor inside its own half-extent.
    const plan = planSuspensionWires(
      makeObject({
        widthMm: 2400,
        depthMm: 18,
        baseHeightMm: 900,
        suspensionAnchorHeightMm: 3000
      })
    );
    for (const anchor of plan!.anchorsMm) {
      expect(Math.abs(anchor.zMm)).toBeLessThanOrEqual(9);
      expect(Math.abs(anchor.zMm)).toBeGreaterThan(0);
      expect(Math.abs(anchor.xMm)).toBeLessThan(1200);
    }
    // Both signs survive: the two sides of the board are still distinguishable.
    expect(new Set(plan!.anchorsMm.map((a) => Math.sign(a.zMm)))).toEqual(
      new Set([-1, 1])
    );
  });
});

describe("suspension wire anchors under rotation", () => {
  // The anchors are object-local because the render layer hangs the wires
  // inside the box's own yawed group (FloorObjectBox). This reproduces that
  // group — position from suspendedCenterYMm, yaw from the single documented
  // plan->three mapping (plan rotation is CCW in plan x/y; plan y maps to world
  // +z, which flips handedness, hence the negation) — and checks where the
  // attachment points actually land in world space.
  function worldAnchors(object: FloorObject3d) {
    const plan = planSuspensionWires(object)!;
    const group = new Object3D();
    group.position.set(
      mmToWorld(object.xMm),
      mmToWorld(suspendedCenterYMm(object)),
      mmToWorld(object.yMm)
    );
    group.rotation.set(0, -MathUtils.degToRad(object.rotationDeg), 0);
    return plan.anchorsMm.map(({ xMm, zMm }) => {
      const point = new Object3D();
      point.position.set(mmToWorld(xMm), mmToWorld(object.heightMm / 2), mmToWorld(zMm));
      group.add(point);
      group.updateMatrixWorld(true);
      return point.getWorldPosition(point.position.clone());
    });
  }

  const board = makeObject({
    xMm: 2000,
    yMm: 1500,
    widthMm: 2400,
    depthMm: 600,
    heightMm: 1350,
    baseHeightMm: 900,
    suspensionAnchorHeightMm: 3000
  });

  it("hangs unrotated wires off the board's own corners", () => {
    const anchors = worldAnchors(board);
    const halfSpanXMm = 1200 - SUSPENSION_WIRE_INSET_MM;
    // Width runs along world x while the board is unrotated.
    expect(anchors[0].x).toBeCloseTo(mmToWorld(2000 - halfSpanXMm), 9);
    expect(anchors[1].x).toBeCloseTo(mmToWorld(2000 + halfSpanXMm), 9);
    // Every wire attaches at the board's TOP face (900 + 1350).
    for (const anchor of anchors) expect(anchor.y).toBeCloseTo(mmToWorld(2250), 9);
  });

  it("swings the attachment points with the board's yaw", () => {
    const anchors = worldAnchors({ ...board, rotationDeg: 90 });
    const halfSpanXMm = 1200 - SUSPENSION_WIRE_INSET_MM;
    const halfSpanZMm = 300 - SUSPENSION_WIRE_INSET_MM;
    // At 90° the width now runs along floor-space y (world z) and the depth
    // along world x — the wires followed the board rather than staying axis
    // aligned. Plan-space CCW maps to world -y yaw, so plan-local +x goes to
    // world +z here.
    expect(anchors[0].x).toBeCloseTo(mmToWorld(2000 + halfSpanZMm), 9);
    expect(anchors[0].z).toBeCloseTo(mmToWorld(1500 - halfSpanXMm), 9);
    expect(anchors[1].x).toBeCloseTo(mmToWorld(2000 + halfSpanZMm), 9);
    expect(anchors[1].z).toBeCloseTo(mmToWorld(1500 + halfSpanXMm), 9);
    // The rig still spans the board's full width, just on the other axis.
    expect(Math.abs(anchors[0].z - anchors[1].z)).toBeCloseTo(
      mmToWorld(halfSpanXMm * 2),
      9
    );
  });
});
