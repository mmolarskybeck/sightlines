import { PDFDocument, type PDFPage } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { ArtworkFloorObject } from "../../../domain/project";
import type { ElevationScene } from "../../../domain/scene2d/elevationScene";
import { drawElevationSuspendedArtworkGhost } from "./elevationPage";
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
