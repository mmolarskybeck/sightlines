import { describe, expect, it } from "vitest";
import type { FloorObject3d } from "../../../domain/geometry/scene3d";
import type { ResolvedFloorSupport } from "../../../domain/geometry/supportGlyphs";
import { crtMonitorLayoutMm } from "./CrtMonitorMesh";

// The mesh layout is tested through its pure helper rather than by rendering
// R3F meshes — the same split FloorObjectBox.test.ts and SuspensionWires.test.ts
// take. What the helper decides is all the arithmetic there is: the component
// spreads the numbers onto <boxGeometry> args and the shared pointerProps.

// A 500 x 400 x 375 cabinet unless a test says otherwise.
function makeMonitor(overrides: Partial<FloorObject3d> = {}): FloorObject3d {
  return {
    objectId: "floor-monitor",
    kind: "artwork",
    artworkId: "art-monitor",
    xMm: 3000,
    yMm: 1500,
    widthMm: 500,
    depthMm: 400,
    heightMm: 375,
    rotationDeg: 0,
    ...overrides
  };
}

// The monitor's own default: a pedestal sized to its cabinet, 800mm tall.
function monitorDefaultPedestal(
  overrides: Partial<ResolvedFloorSupport> = {}
): ResolvedFloorSupport {
  return {
    kind: "pedestal",
    widthMm: 500,
    depthMm: 400,
    heightMm: 800,
    source: "monitor-default",
    ...overrides
  };
}

describe("crtMonitorLayoutMm", () => {
  it("stands a bare-floor cabinet on the floor and outlines the box itself", () => {
    const layout = crtMonitorLayoutMm(makeMonitor());

    expect(layout.support).toBeNull();
    expect(layout.cabinetCenterYMm).toBe(375 / 2);
    expect(layout.outline).toEqual({
      widthMm: 500,
      heightMm: 375,
      depthMm: 400,
      centerYMm: 375 / 2,
      offsetXMm: 0,
      offsetZMm: 0
    });
  });

  it("LEGACY: the default pedestal lifts the cabinet and outlines cabinet + plinth", () => {
    const layout = crtMonitorLayoutMm(
      makeMonitor({ support: monitorDefaultPedestal() })
    );

    expect(layout.support!.supportCenterYMm).toBe(400);
    expect(layout.support!.supportWidthMm).toBe(500);
    expect(layout.support!.supportDepthMm).toBe(400);
    expect(layout.cabinetCenterYMm).toBe(800 + 375 / 2);
    // The pedestal is sized to the cabinet, so the union is the cabinet's own
    // footprint — exactly the box this drew before supports existed.
    expect(layout.outline).toEqual({
      widthMm: 500,
      heightMm: 800 + 375,
      depthMm: 400,
      centerYMm: (800 + 375) / 2,
      offsetXMm: 0,
      offsetZMm: 0
    });
  });

  it("emits no bonnet unless there is one", () => {
    expect(
      crtMonitorLayoutMm(makeMonitor({ support: monitorDefaultPedestal() })).support!
        .bonnet
    ).toBeUndefined();
    expect(crtMonitorLayoutMm(makeMonitor()).support).toBeNull();
  });

  it("rises a bonnet from the plinth's top face and measures the assembly to it", () => {
    const layout = crtMonitorLayoutMm(
      makeMonitor({
        support: monitorDefaultPedestal({
          kind: "plinth",
          widthMm: 900,
          depthMm: 700,
          heightMm: 150,
          bonnetHeightMm: 450,
          source: "explicit"
        })
      })
    );

    expect(layout.support!.bonnet).toEqual({ centerYMm: 150 + 450 / 2, heightMm: 450 });
    // The bonnet out-tops the 375 cabinet, so it is what the outline reaches.
    expect(layout.outline.heightMm).toBe(150 + 450);
    // Bonnet footprint = support footprint (USER DECISION 2026-09-17).
    expect(layout.support!.supportWidthMm).toBe(900);
    expect(layout.support!.supportDepthMm).toBe(700);
  });

  it("lets a LOCKED bonnet shorter than the cabinet leave the cabinet as the top", () => {
    const layout = crtMonitorLayoutMm(
      makeMonitor({
        support: monitorDefaultPedestal({
          heightMm: 150,
          bonnetHeightMm: 200,
          bonnetHeightLocked: true,
          source: "explicit"
        })
      })
    );

    expect(layout.outline.heightMm).toBe(150 + 375);
  });

  it("spans the outline across an OFFSET plinth instead of cropping it to the cabinet", () => {
    // The bug this pins: the outline used to be max(cabinet, support) sizes
    // centred on the cabinet, so an offset plinth stuck out of its own
    // selection box.
    const layout = crtMonitorLayoutMm(
      makeMonitor({
        support: monitorDefaultPedestal({
          kind: "plinth",
          widthMm: 900,
          depthMm: 700,
          heightMm: 150,
          offsetXMm: 100,
          offsetYMm: -50,
          source: "explicit"
        })
      })
    );

    // Cabinet spans -250..250 locally; the plinth spans 100-450..100+450 =
    // -350..550, so the union is 900 wide centred at +100.
    expect(layout.outline.widthMm).toBe(900);
    expect(layout.outline.offsetXMm).toBe(100);
    // Depth: cabinet -200..200, plinth -50-350..-50+350 = -400..300 → 700 @ -50.
    expect(layout.outline.depthMm).toBe(700);
    expect(layout.outline.offsetZMm).toBe(-50);
    // offsetYMm is the placement's DEPTH axis, which the yaw maps onto world
    // +z — so it arrives as the local z with no sign flip.
    expect(layout.support!.supportOffsetXMm).toBe(100);
    expect(layout.support!.supportOffsetZMm).toBe(-50);
  });

  it("IGNORES a stale baseHeightMm — a monitor never suspends", () => {
    const lifted = crtMonitorLayoutMm(
      makeMonitor({ baseHeightMm: 1800, support: monitorDefaultPedestal() })
    );
    const plain = crtMonitorLayoutMm(makeMonitor({ support: monitorDefaultPedestal() }));
    expect(lifted.cabinetCenterYMm).toBe(plain.cabinetCenterYMm);
  });
});
