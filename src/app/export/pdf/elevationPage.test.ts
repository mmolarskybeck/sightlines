import { PDFDocument, type PDFPage } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { ArtworkFloorObject } from "../../../domain/project";
import type { ElevationScene } from "../../../domain/scene2d/elevationScene";
import {
  drawElevationMonitorGhost,
  drawElevationSupportedArtworkGhost,
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

function supportedGhost(
  overrides: Partial<ElevationScene["supportedArtworkGhosts"][number]> = {}
): ElevationScene["supportedArtworkGhosts"][number] {
  return {
    kind: "supported-artwork",
    objectId: "fobj-1",
    xMinMm: 1000,
    xMaxMm: 1600,
    supportHeightMm: 1100,
    workHeightMm: 400,
    workXMinMm: 1100,
    workXMaxMm: 1500,
    supportXMinMm: 1000,
    supportXMaxMm: 1600,
    ...overrides
  };
}

describe("drawElevationSupportedArtworkGhost", () => {
  it("stands the support on the floor line and the work on the support, each on its OWN span", async () => {
    const page = await freshPage();
    const rectSpy = vi.spyOn(page, "drawRectangle");

    drawElevationSupportedArtworkGhost(page, identityTransform(), supportedGhost());

    expect(rectSpy).toHaveBeenCalledTimes(2);
    const [support, work] = rectSpy.mock.calls.map((call) => call[0]!);
    // Model space is wall-local y-UP with the floor at 0 (the caller draws the
    // floor line at yMm=0), so the support's bottom IS 0 — no flip to apply.
    expect(support!.y).toBeCloseTo(0);
    expect(support!.height).toBeCloseTo(1100);
    // The ASSEMBLY's span bounds the block…
    expect(support!.x).toBeCloseTo(1000);
    expect(support!.width).toBeCloseTo(600);

    expect(work!.y).toBeCloseTo(1100);
    expect(work!.height).toBeCloseTo(400);
    // …while the work keeps its own, narrower one. Collapsing the two would
    // print a sculpture as wide as its plinth.
    expect(work!.x).toBeCloseTo(1100);
    expect(work!.width).toBeCloseTo(400);

    for (const rect of [support, work]) {
      expect(rect!.borderDashArray).toBeDefined();
      expect(rect!.borderWidth).toBeLessThan(0.65);
    }
  });

  it("adds the bonnet from the support's top face at the support's own footprint", async () => {
    const page = await freshPage();
    const rectSpy = vi.spyOn(page, "drawRectangle");

    drawElevationSupportedArtworkGhost(
      page,
      identityTransform(),
      supportedGhost({ bonnetHeightMm: 475 })
    );

    expect(rectSpy).toHaveBeenCalledTimes(3);
    const bonnet = rectSpy.mock.calls[2]![0]!;
    expect(bonnet.y).toBeCloseTo(1100);
    expect(bonnet.height).toBeCloseTo(475);
    // Bonnet footprint = support footprint (USER DECISION 2026-09-17).
    expect(bonnet.x).toBeCloseTo(1000);
    expect(bonnet.width).toBeCloseTo(600);
    // Glass takes the finer wire-weight dash, subordinate to the volumes.
    expect(bonnet.borderWidth).toBeLessThan(0.6);
  });

  it("draws a work TALLER than a locked bonnet in full rather than clipping it to the glass", async () => {
    const page = await freshPage();
    const rectSpy = vi.spyOn(page, "drawRectangle");

    drawElevationSupportedArtworkGhost(
      page,
      identityTransform(),
      supportedGhost({ workHeightMm: 900, bonnetHeightMm: 300 })
    );

    const work = rectSpy.mock.calls[1]![0]!;
    const bonnet = rectSpy.mock.calls[2]![0]!;
    expect(work.height).toBeCloseTo(900);
    // y-UP here, so the work's top is the LARGER number — it pokes out of the
    // glass, which is the collision the inspector warns about.
    expect(Number(work.y) + Number(work.height)).toBeGreaterThan(
      Number(bonnet.y) + Number(bonnet.height)
    );
  });
});

function monitorGhost(
  overrides: Partial<ElevationScene["monitorGhosts"][number]> = {}
): ElevationScene["monitorGhosts"][number] {
  return {
    object: {} as ArtworkFloorObject,
    // A 500mm cabinet on its own 800mm default pedestal: the legacy shape,
    // where the plinth's span and the cabinet's are the same span.
    xMinMm: 2750,
    xMaxMm: 3250,
    monitorHeightMm: 375,
    pedestalHeightMm: 800,
    supportXMinMm: 2750,
    supportXMaxMm: 3250,
    ...overrides
  };
}

describe("drawElevationMonitorGhost", () => {
  it("LEGACY: plinth, cabinet and screen, all at the cabinet's own span", async () => {
    const page = await freshPage();
    const rectSpy = vi.spyOn(page, "drawRectangle");

    drawElevationMonitorGhost(page, identityTransform(), monitorGhost());

    // No bonnet: exactly the three rects this has always drawn.
    expect(rectSpy).toHaveBeenCalledTimes(3);
    const [pedestal, cabinet] = rectSpy.mock.calls.map((call) => call[0]!);
    // Model space is wall-local y-UP with the floor at 0.
    expect(pedestal!.y).toBeCloseTo(0);
    expect(pedestal!.height).toBeCloseTo(800);
    expect(pedestal!.x).toBeCloseTo(2750);
    expect(pedestal!.width).toBeCloseTo(500);
    expect(cabinet!.y).toBeCloseTo(800);
    expect(cabinet!.height).toBeCloseTo(375);
  });

  it("draws an EXPLICIT plinth across the SUPPORT's span, not the cabinet's", async () => {
    const page = await freshPage();
    const rectSpy = vi.spyOn(page, "drawRectangle");

    drawElevationMonitorGhost(
      page,
      identityTransform(),
      monitorGhost({ pedestalHeightMm: 150, supportXMinMm: 2650, supportXMaxMm: 3550 })
    );

    const pedestal = rectSpy.mock.calls[0]![0]!;
    expect(pedestal.x).toBeCloseTo(2650);
    expect(pedestal.width).toBeCloseTo(900);
    // The cabinet keeps its own span — a monitor on a wide plinth is still a
    // 500mm monitor.
    const cabinet = rectSpy.mock.calls[1]![0]!;
    expect(cabinet.x).toBeCloseTo(2750);
    expect(cabinet.width).toBeCloseTo(500);
  });

  it("prints the bonnet from the plinth's top face at the plinth's footprint", async () => {
    const page = await freshPage();
    const rectSpy = vi.spyOn(page, "drawRectangle");

    drawElevationMonitorGhost(
      page,
      identityTransform(),
      monitorGhost({
        pedestalHeightMm: 150,
        supportXMinMm: 2650,
        supportXMaxMm: 3550,
        bonnetHeightMm: 450
      })
    );

    expect(rectSpy).toHaveBeenCalledTimes(4);
    const bonnet = rectSpy.mock.calls[3]![0]!;
    expect(bonnet.y).toBeCloseTo(150);
    expect(bonnet.height).toBeCloseTo(450);
    // Bonnet footprint = support footprint (USER DECISION 2026-09-17).
    expect(bonnet.x).toBeCloseTo(2650);
    expect(bonnet.width).toBeCloseTo(900);
    // Glass takes the finer wire-weight dash, the same subordination the
    // supported-artwork bonnet gets.
    expect(bonnet.borderWidth).toBeLessThan(0.6);
    // The cabinet still stands on the plinth, unmoved by the glass over it.
    expect(rectSpy.mock.calls[1]![0]!.y).toBeCloseTo(150);
  });

  it("leaves a cabinet TALLER than a locked bonnet poking out of the glass", async () => {
    const page = await freshPage();
    const rectSpy = vi.spyOn(page, "drawRectangle");

    drawElevationMonitorGhost(
      page,
      identityTransform(),
      monitorGhost({ pedestalHeightMm: 150, bonnetHeightMm: 200 })
    );

    const cabinet = rectSpy.mock.calls[1]![0]!;
    const bonnet = rectSpy.mock.calls[3]![0]!;
    // y-UP here, so the taller top is the LARGER number.
    expect(Number(cabinet.y) + Number(cabinet.height)).toBeGreaterThan(
      Number(bonnet.y) + Number(bonnet.height)
    );
  });
});
