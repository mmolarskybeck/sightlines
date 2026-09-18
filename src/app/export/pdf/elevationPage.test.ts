import { PDFDocument, type PDFPage } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { ArtworkFloorObject } from "../../../domain/project";
import type { ElevationScene } from "../../../domain/scene2d/elevationScene";
import {
  drawElevationMonitorGhost,
  drawElevationSupportGhost,
  drawElevationSuspendedArtworkGhost
} from "./elevationPage";
import type { ElevationTransform } from "./transforms";

// A pass-through transform: model-space mm map 1:1 to page points, so
// assertions can compare drawn coordinates directly against the ghost's own
// mm fields without re-deriving the fit math.
function identityTransform(): ElevationTransform {
  return {
    scalePtPerMm: 1,
    point: ({ xMm, yMm }) => ({ x: xMm, y: yMm })
  };
}

function suspendedGhost(
  overrides: Partial<ElevationScene["suspendedArtworkGhosts"][number]> = {}
): ElevationScene["suspendedArtworkGhosts"][number] {
  return {
    object: {} as ArtworkFloorObject,
    xMinMm: 100,
    xMaxMm: 900,
    baseHeightMm: 1200,
    heightMm: 800,
    ...overrides
  };
}

async function freshPage(): Promise<PDFPage> {
  const doc = await PDFDocument.create();
  return doc.addPage([1000, 1000]);
}

describe("drawElevationSuspendedArtworkGhost", () => {
  it("draws the floating board spanning baseHeightMm..baseHeightMm+heightMm, not the floor", async () => {
    const page = await freshPage();
    const rectSpy = vi.spyOn(page, "drawRectangle");

    drawElevationSuspendedArtworkGhost(page, identityTransform(), suspendedGhost(), 2700);

    expect(rectSpy).toHaveBeenCalledTimes(1);
    const rect = rectSpy.mock.calls[0]![0]!;
    // Model space here is wall-local y-up with the floor at 0 (see the floor
    // line drawn at yMm=0 in createDocumentPdf.ts) — the ghost's own
    // baseHeightMm is directly the rect's bottom edge, unlike the canvas
    // component's SVG-y-down space, which has to flip it.
    expect(rect.y).toBeCloseTo(1200);
    expect(rect.height).toBeCloseTo(800);
    expect(rect.x).toBeCloseTo(100);
    expect(rect.width).toBeCloseTo(800);
    expect(rect.borderDashArray).toBeDefined();
    // Dashed and lighter than a real artwork's solid COLORS.muted outline —
    // the "still subordinate" contract the boldening pass preserved.
    expect(rect.borderWidth).toBeLessThan(0.65);
  });

  it("draws two suspension wires from the board's top up to the wall's top edge", async () => {
    const page = await freshPage();
    const lineSpy = vi.spyOn(page, "drawLine");

    drawElevationSuspendedArtworkGhost(page, identityTransform(), suspendedGhost(), 2700);

    expect(lineSpy).toHaveBeenCalledTimes(2);
    for (const call of lineSpy.mock.calls) {
      const options = call[0]!;
      // Board top = baseHeightMm + heightMm = 2000; wall top = 2700.
      expect(options.start.y).toBeCloseTo(2000);
      expect(options.end.y).toBeCloseTo(2700);
      expect(options.start.x).toBeCloseTo(options.end.x);
    }
    // Wires inset from the projected span's edges (SUSPENSION_WIRE_INSET_MM =
    // 60, well under the span-fraction cap here), same two x positions.
    const xs = lineSpy.mock.calls.map((call) => call[0]!.start.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(160); // xMinMm 100 + 60
    expect(xs[1]).toBeCloseTo(840); // xMaxMm 900 - 60
  });

  it("suppresses the wires once the board's top reaches the wall's top edge", async () => {
    const page = await freshPage();
    const lineSpy = vi.spyOn(page, "drawLine");

    // baseHeightMm + heightMm = 2700 == wallHeightMm: no air left for a wire.
    drawElevationSuspendedArtworkGhost(
      page,
      identityTransform(),
      suspendedGhost({ baseHeightMm: 1900, heightMm: 800 }),
      2700
    );

    expect(lineSpy).not.toHaveBeenCalled();
  });
});

function supportGhost(
  overrides: Partial<ElevationScene["supportGhosts"][number]> = {}
): ElevationScene["supportGhosts"][number] {
  return {
    objectId: "support-1",
    xMinMm: 1000,
    xMaxMm: 1600,
    heightMm: 1100,
    supportKind: "pedestal",
    ...overrides
  };
}

describe("drawElevationSupportGhost", () => {
  it("stands the block on the floor line at the projected span", async () => {
    const page = await freshPage();
    const rectSpy = vi.spyOn(page, "drawRectangle");

    drawElevationSupportGhost(page, identityTransform(), supportGhost());

    // No bonnet: exactly one rect.
    expect(rectSpy).toHaveBeenCalledTimes(1);
    const block = rectSpy.mock.calls[0]![0]!;
    // Model space is wall-local y-UP with the floor at 0 (the caller draws the
    // floor line at yMm=0), so the block's bottom IS 0 — no flip to apply.
    expect(block.y).toBeCloseTo(0);
    expect(block.height).toBeCloseTo(1100);
    expect(block.x).toBeCloseTo(1000);
    expect(block.width).toBeCloseTo(600);
    expect(block.borderDashArray).toBeDefined();
    expect(block.borderWidth).toBeLessThan(0.65);
  });

  it("adds the bonnet from the top face at the support's own footprint", async () => {
    const page = await freshPage();
    const rectSpy = vi.spyOn(page, "drawRectangle");

    drawElevationSupportGhost(
      page,
      identityTransform(),
      supportGhost({ bonnetHeightMm: 475 })
    );

    expect(rectSpy).toHaveBeenCalledTimes(2);
    const bonnet = rectSpy.mock.calls[1]![0]!;
    expect(bonnet.y).toBeCloseTo(1100);
    expect(bonnet.height).toBeCloseTo(475);
    // Bonnet footprint = support footprint (USER DECISION 2026-09-17).
    expect(bonnet.x).toBeCloseTo(1000);
    expect(bonnet.width).toBeCloseTo(600);
    // Glass takes the finer wire-weight dash, subordinate to the volumes.
    expect(bonnet.borderWidth).toBeLessThan(0.6);
  });
});

function monitorGhost(
  overrides: Partial<ElevationScene["monitorGhosts"][number]> = {}
): ElevationScene["monitorGhosts"][number] {
  return {
    object: {} as ArtworkFloorObject,
    // A 500mm cabinet standing on the bare floor.
    xMinMm: 2750,
    xMaxMm: 3250,
    monitorHeightMm: 375,
    baseHeightMm: 0,
    ...overrides
  };
}

describe("drawElevationMonitorGhost", () => {
  it("draws the cabinet and its screen on the floor line, and no plinth", async () => {
    const page = await freshPage();
    const rectSpy = vi.spyOn(page, "drawRectangle");

    drawElevationMonitorGhost(page, identityTransform(), monitorGhost());

    // Cabinet + screen only — whatever it stands on is its own ghost now.
    expect(rectSpy).toHaveBeenCalledTimes(2);
    const cabinet = rectSpy.mock.calls[0]![0]!;
    // Model space is wall-local y-UP with the floor at 0.
    expect(cabinet.y).toBeCloseTo(0);
    expect(cabinet.height).toBeCloseTo(375);
    expect(cabinet.x).toBeCloseTo(2750);
    expect(cabinet.width).toBeCloseTo(500);
  });

  it("lifts a RIDER cabinet to its base height — the pedestal's top face", async () => {
    const page = await freshPage();
    const rectSpy = vi.spyOn(page, "drawRectangle");

    drawElevationMonitorGhost(
      page,
      identityTransform(),
      monitorGhost({ baseHeightMm: 800 })
    );

    const cabinet = rectSpy.mock.calls[0]![0]!;
    expect(cabinet.y).toBeCloseTo(800);
    expect(cabinet.height).toBeCloseTo(375);
    // The screen rides up with it.
    expect(Number(rectSpy.mock.calls[1]![0]!.y)).toBeGreaterThan(800);
  });
});
