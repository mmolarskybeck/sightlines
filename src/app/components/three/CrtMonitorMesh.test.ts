import { describe, expect, it } from "vitest";
import type { FloorObject3d } from "../../../domain/geometry/scene3d";
import { crtMonitorLayoutMm } from "./CrtMonitorMesh";

// The mesh layout is tested through its pure helper rather than by rendering
// R3F meshes — the same split SuspensionWires.test.ts takes. What the helper
// decides is all the arithmetic there is: the component spreads the numbers
// onto <boxGeometry> args and the shared pointerProps.

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

describe("crtMonitorLayoutMm", () => {
  it("stands a bare-floor cabinet on the floor and outlines the box itself", () => {
    const layout = crtMonitorLayoutMm(makeMonitor());

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

  it("lifts a cabinet standing on a pedestal by its baseHeightMm", () => {
    // Schema v8: the pedestal is its own floor object with its own mesh, and
    // all the cabinet knows is how high its bottom edge is.
    const layout = crtMonitorLayoutMm(makeMonitor({ baseHeightMm: 800 }));

    expect(layout.cabinetCenterYMm).toBe(800 + 375 / 2);
    expect(layout.outline.centerYMm).toBe(800 + 375 / 2);
  });

  it("wraps the CABINET only — the pedestal outlines itself when IT is selected", () => {
    const layout = crtMonitorLayoutMm(makeMonitor({ baseHeightMm: 800 }));

    expect(layout.outline.widthMm).toBe(500);
    expect(layout.outline.depthMm).toBe(400);
    expect(layout.outline.heightMm).toBe(375);
    expect(layout.outline.offsetXMm).toBe(0);
    expect(layout.outline.offsetZMm).toBe(0);
  });

  it("clamps a negative baseHeightMm to the floor rather than sinking the cabinet", () => {
    expect(crtMonitorLayoutMm(makeMonitor({ baseHeightMm: -50 })).cabinetCenterYMm).toBe(
      375 / 2
    );
  });
});
