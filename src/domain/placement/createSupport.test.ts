import { describe, expect, it } from "vitest";
import {
  createSupport,
  defaultSupportForWork,
  monitorPedestalForPlacement,
  supportFootprintCoveringMm
} from "./createSupport";
import type { FloorObject } from "../project";
import {
  PEDESTAL_FALLBACK_HEIGHT_MM,
  PEDESTAL_MARGIN_MM,
  PEDESTAL_MAX_HEIGHT_MM,
  PEDESTAL_MIN_FOOTPRINT_MM,
  PEDESTAL_MIN_HEIGHT_MM,
  PLINTH_DEFAULT_HEIGHT_MM,
  PLINTH_MARGIN_MM,
  PLINTH_MIN_FOOTPRINT_MM
} from "../geometry/supportGlyphs";
import { MONITOR_PEDESTAL_HEIGHT_MM } from "../geometry/monitorGlyphs";

describe("createSupport", () => {
  it("builds a floor object with a fresh id, wallYMm 0 and no base height", () => {
    const support = createSupport({
      kind: "plinth",
      xMm: 1200,
      yMm: 800,
      rotationDeg: 30,
      widthMm: 900,
      depthMm: 700,
      heightMm: 150
    });
    expect(support).toMatchObject({
      kind: "support",
      supportKind: "plinth",
      xMm: 1200,
      yMm: 800,
      rotationDeg: 30,
      widthMm: 900,
      depthMm: 700,
      heightMm: 150,
      wallYMm: 0
    });
    expect(support.id).toMatch(/[0-9a-f-]{36}/);
    expect("baseHeightMm" in support).toBe(false);
  });

  it("defaults rotation to 0 and gives two calls different ids", () => {
    const a = createSupport({
      kind: "pedestal",
      xMm: 0,
      yMm: 0,
      widthMm: 300,
      depthMm: 300,
      heightMm: 1100
    });
    const b = createSupport({
      kind: "pedestal",
      xMm: 0,
      yMm: 0,
      widthMm: 300,
      depthMm: 300,
      heightMm: 1100
    });
    expect(a.rotationDeg).toBe(0);
    expect(a.id).not.toBe(b.id);
  });
});

describe("defaultSupportForWork", () => {
  const work = { widthMm: 400, depthMm: 300, heightMm: 900 };

  it("seeds a pedestal with a 100mm reveal and a centerline-derived height", () => {
    expect(
      defaultSupportForWork({
        kind: "pedestal",
        work,
        project: { defaultCenterlineHeightMm: 1450 }
      })
    ).toEqual({
      kind: "pedestal",
      widthMm: 400 + PEDESTAL_MARGIN_MM * 2,
      depthMm: 300 + PEDESTAL_MARGIN_MM * 2,
      // 1450 − 900/2 = 1000, inside the clamp.
      heightMm: 1000
    });
  });

  it("clamps a pedestal's derived height and falls back without a centerline", () => {
    // A very tall work would otherwise drive the pedestal below floor level.
    expect(
      defaultSupportForWork({
        kind: "pedestal",
        work: { ...work, heightMm: 3000 },
        project: { defaultCenterlineHeightMm: 1450 }
      }).heightMm
    ).toBe(PEDESTAL_MIN_HEIGHT_MM);
    // A flat work against a very high centerline hits the other end.
    expect(
      defaultSupportForWork({
        kind: "pedestal",
        work: { ...work, heightMm: 50 },
        project: { defaultCenterlineHeightMm: 2600 }
      }).heightMm
    ).toBe(PEDESTAL_MAX_HEIGHT_MM);
    expect(defaultSupportForWork({ kind: "pedestal", work }).heightMm).toBe(
      PEDESTAL_FALLBACK_HEIGHT_MM
    );
  });

  it("floors a pedestal's footprint at the smallest buildable one", () => {
    expect(
      defaultSupportForWork({
        kind: "pedestal",
        work: { widthMm: 40, depthMm: 40, heightMm: 120 },
        project: { defaultCenterlineHeightMm: 1450 }
      })
    ).toMatchObject({
      widthMm: PEDESTAL_MIN_FOOTPRINT_MM,
      depthMm: PEDESTAL_MIN_FOOTPRINT_MM
    });
  });

  it("seeds a plinth low and wide", () => {
    expect(
      defaultSupportForWork({
        kind: "plinth",
        work,
        project: { defaultCenterlineHeightMm: 1450 }
      })
    ).toEqual({
      kind: "plinth",
      // 400 + 300 = 700 clears the 600 minimum; the depth axis does not.
      widthMm: 400 + PLINTH_MARGIN_MM * 2,
      depthMm: PLINTH_MIN_FOOTPRINT_MM,
      heightMm: PLINTH_DEFAULT_HEIGHT_MM
    });
  });

  it("always contains the work it is sized for", () => {
    for (const kind of ["pedestal", "plinth"] as const) {
      const box = defaultSupportForWork({
        kind,
        work,
        project: { defaultCenterlineHeightMm: 1450 }
      });
      expect(box.widthMm).toBeGreaterThanOrEqual(work.widthMm);
      expect(box.depthMm).toBeGreaterThanOrEqual(work.depthMm);
    }
  });
});

describe("monitorPedestalForPlacement", () => {
  it("takes the cabinet's own footprint, centre and angle at 800mm", () => {
    expect(
      monitorPedestalForPlacement({
        xMm: 2400,
        yMm: 1800,
        widthMm: 500,
        depthMm: 450,
        rotationDeg: 90
      })
    ).toMatchObject({
      kind: "support",
      supportKind: "pedestal",
      xMm: 2400,
      yMm: 1800,
      widthMm: 500,
      depthMm: 450,
      rotationDeg: 90,
      heightMm: MONITOR_PEDESTAL_HEIGHT_MM
    });
  });
});

describe("supportFootprintCoveringMm", () => {
  const SUPPORT = {
    xMm: 1000,
    yMm: 1000,
    widthMm: 400,
    depthMm: 400,
    rotationDeg: 0
  };

  function work(
    id: string,
    { xMm = 1000, yMm = 1000, widthMm = 300, depthMm = 300, rotationDeg = 0 } = {}
  ): FloorObject {
    return {
      id,
      kind: "artwork",
      artworkId: `art-${id}`,
      xMm,
      yMm,
      widthMm,
      depthMm,
      rotationDeg,
      heightMm: 400,
      wallYMm: 0
    };
  }

  it("never shrinks — a hand-sized plinth stays hand-sized", () => {
    expect(supportFootprintCoveringMm(SUPPORT, [work("a", { widthMm: 50, depthMm: 50 })], 0))
      .toEqual({ widthMm: 400, depthMm: 400 });
  });

  it("grows SYMMETRICALLY about the centre, so the support never walks", () => {
    // One work pushed 300mm off-centre: covering it needs 300 + 150 of reach on
    // that side, and the box has to be twice that so its centre stays put.
    expect(supportFootprintCoveringMm(SUPPORT, [work("a", { xMm: 1300 })], 0)).toEqual({
      widthMm: 900,
      depthMm: 400
    });
  });

  it("adds the margin on every side", () => {
    expect(supportFootprintCoveringMm(SUPPORT, [work("a")], 100)).toEqual({
      widthMm: 500,
      depthMm: 500
    });
  });

  it("covers a turned work's real reach, not its stored width", () => {
    const fitted = supportFootprintCoveringMm(
      SUPPORT,
      [work("a", { widthMm: 400, depthMm: 200, rotationDeg: 45 })],
      0
    );
    // A 400×200 rect at 45° spans (400 + 200)/√2 ≈ 424.26 on both axes.
    expect(fitted.widthMm).toBeCloseTo(600 / Math.SQRT2, 6);
    expect(fitted.depthMm).toBeCloseTo(600 / Math.SQRT2, 6);
  });

  it("measures in the SUPPORT's rotated frame", () => {
    const turned = { ...SUPPORT, rotationDeg: 90 };
    // The work is offset along world +x, which is the turned support's local
    // −y: the DEPTH has to grow, not the width.
    expect(supportFootprintCoveringMm(turned, [work("a", { xMm: 1300 })], 0)).toEqual({
      widthMm: 400,
      depthMm: 900
    });
  });

  it("is a no-op at zero riders", () => {
    expect(supportFootprintCoveringMm(SUPPORT, [], 500)).toEqual({
      widthMm: 400,
      depthMm: 400
    });
  });
});
