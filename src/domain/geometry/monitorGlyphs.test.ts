import { describe, expect, it } from "vitest";
import {
  isMonitorArtwork,
  monitorBoxSizeMm,
  monitorElevationGlyph,
  monitorImageSizeMm,
  monitorPedestalHeightMm,
  monitorPlanGlyph,
  monitorScreenRectMm,
  resolveMonitorSupport
} from "./monitorGlyphs";
import {
  CURRENT_ARTWORK_SCHEMA_VERSION,
  MONITOR_ASPECT_RATIO,
  MONITOR_BEZEL_MM,
  MONITOR_DEFAULT_WIDTH_MM,
  MONITOR_DEPTH_MM,
  MONITOR_PEDESTAL_HEIGHT_MM,
  type Artwork
} from "../project";

function artwork(displayAs?: Artwork["displayAs"]): Artwork {
  return {
    id: "artwork-1",
    schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
    dimensions: { status: "unknown" },
    ...(displayAs ? { displayAs } : {}),
    metadata: {}
  };
}

describe("isMonitorArtwork", () => {
  it("recognises a monitor work", () => {
    expect(isMonitorArtwork(artwork("monitor"))).toBe(true);
  });

  it("reads an absent displayAs as a framed image", () => {
    expect(isMonitorArtwork(artwork())).toBe(false);
  });

  it("reads a missing record as a framed image rather than throwing", () => {
    expect(isMonitorArtwork(undefined)).toBe(false);
  });
});

describe("resolveMonitorSupport / monitorPedestalHeightMm", () => {
  it("absent means pedestal", () => {
    expect(resolveMonitorSupport(undefined)).toBe("pedestal");
    expect(monitorPedestalHeightMm(undefined)).toBe(MONITOR_PEDESTAL_HEIGHT_MM);
  });

  it("an explicit pedestal is the same answer as absent", () => {
    expect(resolveMonitorSupport("pedestal")).toBe("pedestal");
    expect(monitorPedestalHeightMm("pedestal")).toBe(MONITOR_PEDESTAL_HEIGHT_MM);
  });

  it("standing on the bare floor leaves no plinth height", () => {
    expect(resolveMonitorSupport("floor")).toBe("floor");
    expect(monitorPedestalHeightMm("floor")).toBe(0);
  });
});

describe("monitorBoxSizeMm — cabinet sizing", () => {
  it("takes a known width and derives the height at 4:3", () => {
    const size = monitorBoxSizeMm({ widthMm: 600 });
    expect(size.widthMm).toBe(600);
    expect(size.heightMm).toBeCloseTo(450, 6);
    expect(size.widthMm / size.heightMm).toBeCloseTo(MONITOR_ASPECT_RATIO, 6);
  });

  it("derives the width from a known height alone", () => {
    const size = monitorBoxSizeMm({ heightMm: 300 });
    expect(size.widthMm).toBeCloseTo(400, 6);
    expect(size.heightMm).toBeCloseTo(300, 6);
  });

  it("falls back to the default width when nothing usable is recorded", () => {
    const size = monitorBoxSizeMm({ status: "unknown" } as never);
    expect(size.widthMm).toBe(MONITOR_DEFAULT_WIDTH_MM);
    expect(size.heightMm).toBeCloseTo(MONITOR_DEFAULT_WIDTH_MM / MONITOR_ASPECT_RATIO, 6);
  });

  it("falls back to the default width for an undefined dimensions record", () => {
    expect(monitorBoxSizeMm(undefined).widthMm).toBe(MONITOR_DEFAULT_WIDTH_MM);
  });

  it("keeps the cabinet 4:3 even when the work's own pair is off-ratio", () => {
    // A 16:9 video: the cabinet is still 4:3, sized off the width. The picture
    // letterboxes inside it (monitorImageSizeMm), it does not reshape the box.
    const size = monitorBoxSizeMm({ widthMm: 1600, heightMm: 900 });
    expect(size.widthMm).toBe(1600);
    expect(size.heightMm).toBeCloseTo(1200, 6);
  });

  it("always uses the constant tube depth, never the work's own", () => {
    expect(monitorBoxSizeMm({ widthMm: 600, heightMm: 450 }).depthMm).toBe(
      MONITOR_DEPTH_MM
    );
  });

  it("ignores non-positive and non-finite dimensions", () => {
    expect(monitorBoxSizeMm({ widthMm: 0, heightMm: 0 }).widthMm).toBe(
      MONITOR_DEFAULT_WIDTH_MM
    );
    expect(monitorBoxSizeMm({ widthMm: Number.NaN }).widthMm).toBe(
      MONITOR_DEFAULT_WIDTH_MM
    );
  });
});

describe("monitorScreenRectMm — bezel inset", () => {
  it("insets the face by the bezel on every side", () => {
    const screen = monitorScreenRectMm({ widthMm: 500, heightMm: 375 });
    expect(screen).toEqual({
      xMm: MONITOR_BEZEL_MM,
      yMm: MONITOR_BEZEL_MM,
      widthMm: 500 - MONITOR_BEZEL_MM * 2,
      heightMm: 375 - MONITOR_BEZEL_MM * 2
    });
  });

  it("returns null rather than an inverted screen on a tiny cabinet", () => {
    expect(monitorScreenRectMm({ widthMm: 40, heightMm: 30 })).toBeNull();
  });
});

describe("monitorImageSizeMm — contain, never stretch", () => {
  it("letterboxes a wider-than-screen image (width-bound)", () => {
    const size = monitorImageSizeMm(400, 300, 16 / 9);
    expect(size.widthMm).toBe(400);
    expect(size.heightMm).toBeCloseTo(225, 6);
  });

  it("pillarboxes a taller-than-screen image (height-bound)", () => {
    const size = monitorImageSizeMm(400, 300, 1 / 2);
    expect(size.heightMm).toBe(300);
    expect(size.widthMm).toBeCloseTo(150, 6);
  });

  it("fills the screen exactly at 4:3, the native case", () => {
    const size = monitorImageSizeMm(400, 300, 4 / 3);
    expect(size.widthMm).toBeCloseTo(400, 6);
    expect(size.heightMm).toBeCloseTo(300, 6);
  });

  it("falls back to the whole screen while the aspect is unknown", () => {
    expect(monitorImageSizeMm(400, 300, undefined)).toEqual({
      widthMm: 400,
      heightMm: 300
    });
  });
});

describe("monitorPlanGlyph — screen line at the front edge", () => {
  it("draws the screen just inside the FRONT (+y) edge, spanning the bezel inset", () => {
    const { screen } = monitorPlanGlyph({ widthMm: 500, depthMm: 450 });
    expect(screen).toEqual({
      x1Mm: -250 + MONITOR_BEZEL_MM,
      x2Mm: 250 - MONITOR_BEZEL_MM,
      yMm: 225 - MONITOR_BEZEL_MM
    });
    // Positive y is the front face (PlanObject's FRONT-FACE CONVENTION), so the
    // line must sit on that side of the centre — a sign flip here would mark
    // the back of the cabinet as the screen.
    expect(screen!.yMm).toBeGreaterThan(0);
  });

  it("drops the mark when the bezel leaves no width span", () => {
    expect(monitorPlanGlyph({ widthMm: 40, depthMm: 450 }).screen).toBeNull();
  });

  it("drops the mark when the bezel is deeper than half the footprint", () => {
    expect(monitorPlanGlyph({ widthMm: 500, depthMm: 40 }).screen).toBeNull();
  });
});

describe("monitorElevationGlyph — pedestal + cabinet + screen", () => {
  it("stacks the cabinet on the plinth, measured down from the assembly top", () => {
    const glyph = monitorElevationGlyph({
      widthMm: 500,
      monitorHeightMm: 375,
      pedestalHeightMm: MONITOR_PEDESTAL_HEIGHT_MM
    });
    expect(glyph.monitor).toEqual({ xMm: 0, yMm: 0, widthMm: 500, heightMm: 375 });
    expect(glyph.pedestal).toEqual({
      xMm: 0,
      yMm: 375,
      widthMm: 500,
      heightMm: MONITOR_PEDESTAL_HEIGHT_MM
    });
    expect(glyph.totalHeightMm).toBe(375 + MONITOR_PEDESTAL_HEIGHT_MM);
  });

  it("omits the plinth entirely when the monitor stands on the floor", () => {
    const glyph = monitorElevationGlyph({
      widthMm: 500,
      monitorHeightMm: 375,
      pedestalHeightMm: 0
    });
    expect(glyph.pedestal).toBeNull();
    expect(glyph.totalHeightMm).toBe(375);
  });

  it("keeps the screen inside the cabinet, never past its edges", () => {
    const glyph = monitorElevationGlyph({
      widthMm: 500,
      monitorHeightMm: 375,
      pedestalHeightMm: 0
    });
    const screen = glyph.screen!;
    expect(screen.xMm).toBeGreaterThan(0);
    expect(screen.xMm + screen.widthMm).toBeLessThan(glyph.monitor.widthMm);
    expect(screen.yMm + screen.heightMm).toBeLessThan(glyph.monitor.heightMm);
  });

  it("drops the screen on a cabinet too small to hold a bezel", () => {
    expect(
      monitorElevationGlyph({ widthMm: 40, monitorHeightMm: 30, pedestalHeightMm: 0 })
        .screen
    ).toBeNull();
  });
});
