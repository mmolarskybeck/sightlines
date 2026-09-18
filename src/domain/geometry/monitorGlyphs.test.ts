import { describe, expect, it } from "vitest";
import {
  isMonitorArtwork,
  monitorBoxSizeMm,
  monitorElevationGlyph,
  monitorImageSizeMm,
  monitorPlanGlyph,
  monitorScreenRectMm,
  resolveMonitorSupport,
  MONITOR_ASPECT_RATIO,
  MONITOR_BEZEL_MM,
  MONITOR_DEFAULT_WIDTH_MM,
  MONITOR_DEPTH_MM,
  MONITOR_PEDESTAL_HEIGHT_MM
} from "./monitorGlyphs";
import { CURRENT_ARTWORK_SCHEMA_VERSION, type Artwork } from "../project";

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

describe("resolveMonitorSupport", () => {
  it("absent means pedestal", () => {
    expect(resolveMonitorSupport(undefined)).toBe("pedestal");
  });

  it("an explicit pedestal is the same answer as absent", () => {
    expect(resolveMonitorSupport("pedestal")).toBe("pedestal");
  });

  it("standing on the bare floor is the only way to lose the pedestal", () => {
    expect(resolveMonitorSupport("floor")).toBe("floor");
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

  it("LEGACY: the plinth defaults to the cabinet's own span, and there is no bonnet", () => {
    // Every pre-support call site passes neither, and a legacy monitor's own
    // default pedestal really is sized to its cabinet — so the defaults ARE the
    // old behaviour, bit for bit.
    const glyph = monitorElevationGlyph({
      widthMm: 500,
      monitorHeightMm: 375,
      pedestalHeightMm: MONITOR_PEDESTAL_HEIGHT_MM
    });
    expect(glyph.pedestal).toMatchObject({ xMm: 0, widthMm: 500 });
    expect(glyph.bonnet).toBeNull();
  });

  it("puts the plinth at ITS OWN span, not the cabinet's", () => {
    const glyph = monitorElevationGlyph({
      widthMm: 500,
      monitorHeightMm: 375,
      pedestalHeightMm: 150,
      pedestalXMm: -100,
      pedestalWidthMm: 900
    });
    expect(glyph.pedestal).toEqual({ xMm: -100, yMm: 375, widthMm: 900, heightMm: 150 });
    // The cabinet is untouched by a wider plinth under it.
    expect(glyph.monitor).toEqual({ xMm: 0, yMm: 0, widthMm: 500, heightMm: 375 });
  });

  it("rises the bonnet from the plinth's top at the plinth's own span", () => {
    const glyph = monitorElevationGlyph({
      widthMm: 500,
      monitorHeightMm: 375,
      pedestalHeightMm: 150,
      pedestalXMm: -100,
      pedestalWidthMm: 900,
      bonnetHeightMm: 450
    });
    // Assembly: 150 plinth + a 450 bonnet that out-tops the 375 cabinet = 600.
    expect(glyph.totalHeightMm).toBe(600);
    expect(glyph.bonnet).toEqual({ xMm: -100, yMm: 0, widthMm: 900, heightMm: 450 });
    // The cabinet drops by the bonnet's overtop (450 − 375), and the screen
    // rides down with it rather than staying pinned to the assembly's top.
    expect(glyph.monitor.yMm).toBe(75);
    expect(glyph.screen!.yMm).toBe(75 + MONITOR_BEZEL_MM);
  });

  it("leaves a LOCKED bonnet shorter than its cabinet sticking out of the glass", () => {
    // USER DECISION 2026-09-17: the normaliser warns rather than growing a
    // locked bonnet, so the drawing has to show the collision — the assembly is
    // as tall as the CABINET and the cabinet stays at the top.
    const glyph = monitorElevationGlyph({
      widthMm: 500,
      monitorHeightMm: 375,
      pedestalHeightMm: 150,
      bonnetHeightMm: 200
    });
    expect(glyph.totalHeightMm).toBe(150 + 375);
    expect(glyph.monitor.yMm).toBe(0);
    // Bonnet top = 150 + 200 off the floor, i.e. 175 down from the 525 top.
    expect(glyph.bonnet).toEqual({ xMm: 0, yMm: 175, widthMm: 500, heightMm: 200 });
  });
});
