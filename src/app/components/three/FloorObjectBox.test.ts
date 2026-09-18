import { describe, expect, it } from "vitest";
import type { FloorObject3d } from "../../../domain/geometry/scene3d";
import type { ResolvedFloorSupport } from "../../../domain/geometry/supportGlyphs";
import { floorSupportLayoutMm } from "./FloorObjectBox";

// The mesh layout is tested through its pure helper rather than by rendering
// R3F meshes — the same split SuspensionWires.test.ts takes for the lift and
// the wire plan. What the helper decides is all the arithmetic there is: what
// the component does with it is spread the numbers onto <boxGeometry> args and
// the shared pointerProps.

// A 400 x 400 x 375 sculpture unless a test says otherwise.
function makeObject(overrides: Partial<FloorObject3d> = {}): FloorObject3d {
  return {
    objectId: "fobj-1",
    kind: "artwork",
    artworkId: "art-1",
    xMm: 2000,
    yMm: 1500,
    widthMm: 400,
    depthMm: 400,
    heightMm: 375,
    rotationDeg: 0,
    ...overrides
  };
}

function pedestal(overrides: Partial<ResolvedFloorSupport> = {}): ResolvedFloorSupport {
  return {
    kind: "pedestal",
    widthMm: 600,
    depthMm: 600,
    heightMm: 1100,
    source: "explicit",
    ...overrides
  };
}

describe("floorSupportLayoutMm", () => {
  it("returns null for a work standing on the bare floor", () => {
    // The pre-support behavior has to stay reachable bit for bit: null is what
    // sends the component down its original suspendedCenterYMm path.
    expect(floorSupportLayoutMm(makeObject())).toBeNull();
  });

  it("puts the work's bottom edge on the support's top face", () => {
    const layout = floorSupportLayoutMm(makeObject({ support: pedestal() }))!;

    expect(layout.supportCenterYMm).toBe(550);
    expect(layout.supportHeightMm).toBe(1100);
    // 1100 (the support) + half the work's 375. Read the other way: the work's
    // BOTTOM is at 1100, which is what "stands on" means.
    expect(layout.workCenterYMm).toBe(1100 + 375 / 2);
  });

  it("IGNORES a stale baseHeightMm — a support and suspension are exclusive states", () => {
    // A work suspended first and stood on a plinth later can still carry a
    // suspension height. Honouring it would float the sculpture above its own
    // pedestal, which is the trap FloorObjectBase.baseHeightMm's note warns of.
    const lifted = floorSupportLayoutMm(
      makeObject({ baseHeightMm: 1800, support: pedestal() })
    )!;
    const plain = floorSupportLayoutMm(makeObject({ support: pedestal() }))!;
    expect(lifted.workCenterYMm).toBe(plain.workCenterYMm);
  });

  it("carries the support's own footprint and its local offset, not the work's size", () => {
    const layout = floorSupportLayoutMm(
      makeObject({
        support: pedestal({ widthMm: 900, depthMm: 700, offsetXMm: 50, offsetYMm: -30 })
      })
    )!;

    expect(layout.supportWidthMm).toBe(900);
    expect(layout.supportDepthMm).toBe(700);
    // offsetYMm is the placement's DEPTH axis, which the yaw maps onto world
    // +z — so it arrives as the local z with no sign flip.
    expect(layout.supportOffsetXMm).toBe(50);
    expect(layout.supportOffsetZMm).toBe(-30);
  });

  it("treats absent offsets as centred", () => {
    const layout = floorSupportLayoutMm(makeObject({ support: pedestal() }))!;
    expect(layout.supportOffsetXMm).toBe(0);
    expect(layout.supportOffsetZMm).toBe(0);
  });

  it("emits no bonnet unless there is one, and rises it from the support's top", () => {
    expect(floorSupportLayoutMm(makeObject({ support: pedestal() }))!.bonnet).toBeUndefined();

    const layout = floorSupportLayoutMm(
      makeObject({ support: pedestal({ bonnetHeightMm: 450 }) })
    )!;
    expect(layout.bonnet).toEqual({ centerYMm: 1100 + 450 / 2, heightMm: 450 });
  });

  it("wraps the selection outline around the whole assembly — support included", () => {
    const layout = floorSupportLayoutMm(makeObject({ support: pedestal() }))!;

    // A 600 pedestal under a 400 work: the union is the pedestal, and the
    // outline has to be the installation's box, not the sculpture's.
    expect(layout.assemblyWidthMm).toBe(600);
    expect(layout.assemblyDepthMm).toBe(600);
    expect(layout.assemblyHeightMm).toBe(1100 + 375);
    expect(layout.assemblyCenterYMm).toBe((1100 + 375) / 2);
    // Concentric here, because the support is centred on the work.
    expect(layout.assemblyOffsetXMm).toBe(0);
    expect(layout.assemblyOffsetZMm).toBe(0);
  });

  it("grows the assembly to cover an OVERHANGING work and shifts its center", () => {
    // Overhang on: the support may be smaller than the work and pushed to one
    // side, so the union is genuinely wider than either box.
    const layout = floorSupportLayoutMm(
      makeObject({
        support: pedestal({
          widthMm: 300,
          depthMm: 300,
          offsetXMm: 200,
          overhangAllowed: true
        })
      })
    )!;

    // Work spans -200..200 locally; support spans 200-150..200+150 = 50..350.
    expect(layout.assemblyWidthMm).toBe(550);
    expect(layout.assemblyOffsetXMm).toBe(75);
    // Depth is untouched by an x-axis overhang.
    expect(layout.assemblyDepthMm).toBe(400);
  });

  it("measures the assembly to the TALLER of work and bonnet", () => {
    // A derived bonnet is always taller than its work…
    expect(
      floorSupportLayoutMm(makeObject({ support: pedestal({ bonnetHeightMm: 450 }) }))!
        .assemblyHeightMm
    ).toBe(1100 + 450);
    // …while a LOCKED one may be shorter, and then the work is the top (USER
    // DECISION 2026-09-17: the normaliser warns rather than growing the glass).
    expect(
      floorSupportLayoutMm(
        makeObject({
          heightMm: 900,
          support: pedestal({ bonnetHeightMm: 300, bonnetHeightLocked: true })
        })
      )!.assemblyHeightMm
    ).toBe(1100 + 900);
  });
});
