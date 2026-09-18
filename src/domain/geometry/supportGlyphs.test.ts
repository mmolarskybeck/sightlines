import { describe, expect, it } from "vitest";
import type {
  Artwork,
  ArtworkFloorObject,
  CaseFloorObject,
  FloorSupport
} from "../project";
import { CASE_GLASS_THICKNESS_MM } from "./caseGlyphs";
import { MONITOR_PEDESTAL_HEIGHT_MM } from "./monitorGlyphs";
import {
  assemblyPlanRect,
  BONNET_CLEARANCE_MM,
  BONNET_HEADROOM_MM,
  BONNET_MIN_HEIGHT_MM,
  defaultFloorSupport,
  normalizeFloorSupport,
  PEDESTAL_FALLBACK_HEIGHT_MM,
  PEDESTAL_MARGIN_MM,
  PEDESTAL_MAX_HEIGHT_MM,
  PEDESTAL_MIN_FOOTPRINT_MM,
  PEDESTAL_MIN_HEIGHT_MM,
  PLINTH_DEFAULT_HEIGHT_MM,
  PLINTH_MARGIN_MM,
  PLINTH_MIN_FOOTPRINT_MM,
  resolveFloorSupport,
  resolveStandsOn,
  supportedTotalHeightMm,
  supportPlanRect
} from "./supportGlyphs";

// Per-side inset between the support's edge and the largest work a bonnet over
// it can cover: the glass wall plus its clearance.
const BONNET_INSET_MM = CASE_GLASS_THICKNESS_MM + BONNET_CLEARANCE_MM;

function sculpture(overrides: Partial<ArtworkFloorObject> = {}): ArtworkFloorObject {
  return {
    id: "floor-1",
    kind: "artwork",
    artworkId: "art-1",
    xMm: 3000,
    yMm: 1500,
    widthMm: 400,
    depthMm: 300,
    rotationDeg: 0,
    heightMm: 900,
    wallYMm: 1450,
    ...overrides
  };
}

function floorCase(): CaseFloorObject {
  return {
    id: "floor-case",
    kind: "case",
    xMm: 0,
    yMm: 0,
    widthMm: 1800,
    depthMm: 600,
    rotationDeg: 0,
    heightMm: 950,
    wallYMm: 0
  };
}

function artwork(overrides: Partial<Artwork> = {}): Artwork {
  return {
    id: "art-1",
    schemaVersion: 1,
    dimensions: { status: "unknown" },
    metadata: {},
    ...overrides
  } as Artwork;
}

const MONITOR = artwork({ displayAs: "monitor" });
const SCULPTURE = artwork({ displayAs: "sculpture" });

function pedestal(overrides: Partial<FloorSupport> = {}): FloorSupport {
  return { kind: "pedestal", widthMm: 600, depthMm: 500, heightMm: 1100, ...overrides };
}

describe("resolveFloorSupport", () => {
  it("returns an explicit support, tagged as explicit", () => {
    const support = pedestal();
    expect(resolveFloorSupport(sculpture({ support }), SCULPTURE)).toEqual({
      ...support,
      source: "explicit"
    });
  });

  it("gives a box monitor its cabinet-wide 800mm pedestal when none is stored", () => {
    expect(resolveFloorSupport(sculpture({ widthMm: 500, depthMm: 450 }), MONITOR)).toEqual({
      kind: "pedestal",
      widthMm: 500,
      depthMm: 450,
      heightMm: MONITOR_PEDESTAL_HEIGHT_MM,
      source: "monitor-default"
    });
  });

  it("gives an ordinary work with no stored support nothing", () => {
    expect(resolveFloorSupport(sculpture(), SCULPTURE)).toBeNull();
    // No joined record either: a work whose artwork failed to join is a plain
    // box, never a monitor that grows a pedestal.
    expect(resolveFloorSupport(sculpture(), undefined)).toBeNull();
  });

  it("respects a monitor explicitly stood on the bare floor", () => {
    expect(resolveFloorSupport(sculpture({ monitorSupport: "floor" }), MONITOR)).toBeNull();
  });

  it("lets an explicit support beat the monitor default, including a plinth", () => {
    const support = pedestal({ heightMm: 450 });
    expect(resolveFloorSupport(sculpture({ support }), MONITOR)).toMatchObject({
      heightMm: 450,
      source: "explicit"
    });

    const plinth: FloorSupport = {
      kind: "plinth",
      widthMm: 900,
      depthMm: 900,
      heightMm: 150
    };
    expect(resolveFloorSupport(sculpture({ support: plinth }), MONITOR)).toEqual({
      ...plinth,
      source: "explicit"
    });

    // Even a monitor explicitly stood on the floor: the explicit block wins.
    expect(
      resolveFloorSupport(sculpture({ support: plinth, monitorSupport: "floor" }), MONITOR)
    ).toMatchObject({ kind: "plinth", source: "explicit" });
  });

  it("returns null for non-artwork floor objects", () => {
    expect(resolveFloorSupport(floorCase(), undefined)).toBeNull();
    expect(
      resolveFloorSupport(
        { ...floorCase(), id: "zone", kind: "blocked-zone" },
        undefined
      )
    ).toBeNull();
  });
});

describe("resolveStandsOn", () => {
  it("names the support's own kind", () => {
    expect(resolveStandsOn(sculpture({ support: pedestal() }), SCULPTURE)).toBe("pedestal");
    expect(
      resolveStandsOn(
        sculpture({ support: { kind: "plinth", widthMm: 900, depthMm: 900, heightMm: 150 } }),
        SCULPTURE
      )
    ).toBe("plinth");
    expect(resolveStandsOn(sculpture(), MONITOR)).toBe("pedestal");
  });

  it("reads a support, not suspension, through a stale baseHeightMm", () => {
    expect(
      resolveStandsOn(sculpture({ support: pedestal(), baseHeightMm: 900 }), SCULPTURE)
    ).toBe("pedestal");
  });

  it("reads suspension only for an unsupported non-monitor above the floor", () => {
    expect(resolveStandsOn(sculpture({ baseHeightMm: 900 }), SCULPTURE)).toBe("suspended");
    expect(resolveStandsOn(sculpture({ baseHeightMm: 0 }), SCULPTURE)).toBe("floor");
    expect(resolveStandsOn(sculpture(), SCULPTURE)).toBe("floor");
    // A monitor never suspends, however stale the height it carries.
    expect(
      resolveStandsOn(sculpture({ monitorSupport: "floor", baseHeightMm: 900 }), MONITOR)
    ).toBe("floor");
  });
});

describe("supportedTotalHeightMm", () => {
  it("stacks the work on the support", () => {
    expect(supportedTotalHeightMm(sculpture(), pedestal())).toBe(1100 + 900);
  });

  it("takes the bonnet's top when the bonnet is taller than the work", () => {
    expect(
      supportedTotalHeightMm(sculpture(), pedestal({ bonnetHeightMm: 1000 }))
    ).toBe(1100 + 1000);
  });

  it("keeps the work's top when a locked bonnet is shorter than it", () => {
    expect(
      supportedTotalHeightMm(sculpture(), pedestal({ bonnetHeightMm: 500 }))
    ).toBe(1100 + 900);
  });
});

describe("supportPlanRect / assemblyPlanRect", () => {
  it("centres an unoffset support on the placement", () => {
    expect(supportPlanRect(sculpture(), pedestal())).toEqual({
      centerXMm: 3000,
      centerYMm: 1500,
      widthMm: 600,
      depthMm: 500,
      angleDeg: 0
    });
  });

  it("applies the offset in the placement's ROTATED local frame", () => {
    const rect = supportPlanRect(
      sculpture({ rotationDeg: 90 }),
      pedestal({ offsetXMm: 100, offsetYMm: 0 })
    );
    // At 90° the support's local +x runs along floor +y.
    expect(rect.centerXMm).toBeCloseTo(3000, 6);
    expect(rect.centerYMm).toBeCloseTo(1600, 6);
    expect(rect.angleDeg).toBe(90);
  });

  it("unions work and support in the local frame, not axis-aligned in floor space", () => {
    // Support 600×500 centred, work 400×300 centred: the support swallows the
    // work, so the union is the support, at the placement's own angle.
    expect(assemblyPlanRect(sculpture({ rotationDeg: 45 }), pedestal())).toMatchObject({
      widthMm: 600,
      depthMm: 500,
      angleDeg: 45
    });
  });

  it("grows the union and re-centres it when the support hangs to one side", () => {
    // Work 400 wide centred at 0; support 600 wide centred at +200 spans
    // -100..+500, so the union spans -200..+500: 700 wide, centred at +150.
    const rect = assemblyPlanRect(sculpture(), pedestal({ offsetXMm: 200 }));
    expect(rect.widthMm).toBe(700);
    expect(rect.centerXMm).toBe(3000 + 150);
    // The depth axis is untouched: the support (500) still swallows the work.
    expect(rect.depthMm).toBe(500);
    expect(rect.centerYMm).toBe(1500);
  });
});

describe("defaultFloorSupport", () => {
  const work = { objectWidthMm: 400, objectDepthMm: 300, objectHeightMm: 900 };

  it("seeds a pedestal with a 100mm reveal and a centerline-derived height", () => {
    expect(
      defaultFloorSupport({
        kind: "pedestal",
        ...work,
        isMonitor: false,
        centerlineHeightMm: 1450
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
      defaultFloorSupport({
        kind: "pedestal",
        ...work,
        objectHeightMm: 3000,
        isMonitor: false,
        centerlineHeightMm: 1450
      }).heightMm
    ).toBe(PEDESTAL_MIN_HEIGHT_MM);
    // A flat work against a very high centerline hits the other end.
    expect(
      defaultFloorSupport({
        kind: "pedestal",
        ...work,
        objectHeightMm: 50,
        isMonitor: false,
        centerlineHeightMm: 2600
      }).heightMm
    ).toBe(PEDESTAL_MAX_HEIGHT_MM);
    expect(
      defaultFloorSupport({ kind: "pedestal", ...work, isMonitor: false }).heightMm
    ).toBe(PEDESTAL_FALLBACK_HEIGHT_MM);
  });

  it("floors a pedestal's footprint at the smallest buildable one", () => {
    expect(
      defaultFloorSupport({
        kind: "pedestal",
        objectWidthMm: 40,
        objectDepthMm: 40,
        objectHeightMm: 120,
        isMonitor: false,
        centerlineHeightMm: 1450
      })
    ).toMatchObject({
      widthMm: PEDESTAL_MIN_FOOTPRINT_MM,
      depthMm: PEDESTAL_MIN_FOOTPRINT_MM
    });
  });

  it("gives a monitor's pedestal the cabinet's own footprint at 800mm", () => {
    expect(
      defaultFloorSupport({
        kind: "pedestal",
        objectWidthMm: 500,
        objectDepthMm: 450,
        objectHeightMm: 375,
        isMonitor: true,
        centerlineHeightMm: 1450
      })
    ).toEqual({
      kind: "pedestal",
      widthMm: 500,
      depthMm: 450,
      heightMm: MONITOR_PEDESTAL_HEIGHT_MM
    });
  });

  it("seeds a plinth low and wide, monitor or not", () => {
    expect(
      defaultFloorSupport({
        kind: "plinth",
        ...work,
        isMonitor: true,
        centerlineHeightMm: 1450
      })
    ).toEqual({
      kind: "plinth",
      // 400 + 300 = 700 clears the 600 minimum; the depth axis does not.
      widthMm: 400 + PLINTH_MARGIN_MM * 2,
      depthMm: PLINTH_MIN_FOOTPRINT_MM,
      heightMm: PLINTH_DEFAULT_HEIGHT_MM
    });
  });

  it("seeds a support the normaliser has nothing to repair", () => {
    for (const kind of ["pedestal", "plinth"] as const) {
      for (const isMonitor of [false, true]) {
        const support = defaultFloorSupport({
          kind,
          ...work,
          isMonitor,
          centerlineHeightMm: 1450
        });
        expect(normalizeFloorSupport(sculpture(), support).changed).toBe(false);
      }
    }
  });
});

describe("normalizeFloorSupport", () => {
  const work = sculpture(); // 400 × 300 × 900

  it("leaves a containing support untouched", () => {
    const support = pedestal();
    const result = normalizeFloorSupport(work, support);
    expect(result).toEqual({ support, changed: false, bonnetTooShortByMm: 0 });
  });

  it("grows an undersized support up to the work rather than shrinking the work", () => {
    const result = normalizeFloorSupport(work, pedestal({ widthMm: 200, depthMm: 100 }));
    expect(result.changed).toBe(true);
    expect(result.support).toMatchObject({ widthMm: 400, depthMm: 300 });
  });

  it("clamps offsets to the support top with overhang off", () => {
    // 600 wide over a 400 work leaves ±100; 500 deep over a 300 work leaves ±100.
    const result = normalizeFloorSupport(
      work,
      pedestal({ offsetXMm: 400, offsetYMm: -400 })
    );
    expect(result.support).toMatchObject({ offsetXMm: 100, offsetYMm: -100 });
    expect(result.changed).toBe(true);
  });

  it("clamps a shrunk support up to the work instead of centring it over an overhang", () => {
    const result = normalizeFloorSupport(
      work,
      pedestal({ widthMm: 200, offsetXMm: 150 })
    );
    // The support grew to the work, which leaves no room to displace it at all.
    expect(result.support.widthMm).toBe(400);
    expect(result.support.offsetXMm).toBeUndefined();
  });

  it("allows extreme overhang but never a detached support", () => {
    const support = pedestal({ overhangAllowed: true, offsetXMm: 10000 });
    const result = normalizeFloorSupport(work, support);
    // Positive overlap only: (600 + 400) / 2 − 1.
    expect(result.support.offsetXMm).toBe(499);
    expect(result.support.overhangAllowed).toBe(true);
    // A legal extreme overhang survives verbatim.
    expect(
      normalizeFloorSupport(work, pedestal({ overhangAllowed: true, offsetXMm: 480 })).changed
    ).toBe(false);
  });

  it("imposes no minimum footprint while overhang is on", () => {
    const support = pedestal({ widthMm: 120, depthMm: 120, overhangAllowed: true });
    expect(normalizeFloorSupport(work, support).changed).toBe(false);
  });

  it("preserves an explicit overhangAllowed:false exactly as it preserves absence", () => {
    expect(
      normalizeFloorSupport(work, pedestal({ overhangAllowed: false })).support.overhangAllowed
    ).toBe(false);
    expect(normalizeFloorSupport(work, pedestal()).support).not.toHaveProperty(
      "overhangAllowed"
    );
  });

  it("writes an offset that clamps to zero as ABSENT", () => {
    // A 400-wide support over a 400-wide work leaves no displacement at all.
    const result = normalizeFloorSupport(
      work,
      pedestal({ widthMm: 400, offsetXMm: 90, offsetYMm: 0 })
    );
    expect(result.support).not.toHaveProperty("offsetXMm");
    expect(result.support).not.toHaveProperty("offsetYMm");
  });

  it("clears overhangAllowed when a bonnet is present", () => {
    const result = normalizeFloorSupport(
      work,
      pedestal({ overhangAllowed: true, bonnetHeightMm: 1200, bonnetHeightLocked: true })
    );
    expect(result.support).not.toHaveProperty("overhangAllowed");
    expect(result.changed).toBe(true);
  });

  it("grows the support so the work fits inside the glass, and re-centres it", () => {
    const result = normalizeFloorSupport(
      work,
      pedestal({ widthMm: 400, depthMm: 300, offsetXMm: 80, bonnetHeightMm: 975 })
    );
    expect(result.support.widthMm).toBe(400 + BONNET_INSET_MM * 2);
    expect(result.support.depthMm).toBe(300 + BONNET_INSET_MM * 2);
    // The grown box leaves exactly zero slack, so the offset clamps away.
    expect(result.support).not.toHaveProperty("offsetXMm");
  });

  it("clamps a bonnet offset to the inner box, not to the support's edge", () => {
    // 600 wide − 2 × 31 inset = 538 of glass-free width over a 400 work: ±69.
    const result = normalizeFloorSupport(
      work,
      pedestal({ offsetXMm: 200, bonnetHeightMm: 975 })
    );
    expect(result.support.offsetXMm).toBe((600 - BONNET_INSET_MM * 2 - 400) / 2);
  });

  it("derives an unlocked bonnet's height from the work, every pass", () => {
    const derivedMm = 900 + BONNET_HEADROOM_MM;
    // A stale imported number is overwritten rather than trusted.
    const result = normalizeFloorSupport(work, pedestal({ bonnetHeightMm: 3000 }));
    expect(result.support.bonnetHeightMm).toBe(derivedMm);
    expect(result.changed).toBe(true);
    expect(result.bonnetTooShortByMm).toBe(0);
    // An explicit false tracks exactly as absence does, and survives verbatim.
    expect(
      normalizeFloorSupport(
        work,
        pedestal({ bonnetHeightMm: 100, bonnetHeightLocked: false })
      ).support
    ).toMatchObject({ bonnetHeightMm: derivedMm, bonnetHeightLocked: false });
  });

  it("keeps a locked bonnet's height and reports how far the work overtops it", () => {
    const result = normalizeFloorSupport(
      work,
      pedestal({ bonnetHeightMm: 700, bonnetHeightLocked: true })
    );
    expect(result.support.bonnetHeightMm).toBe(700);
    expect(result.bonnetTooShortByMm).toBe(200);
    // Reporting is not repairing: the support itself is left alone.
    expect(result.changed).toBe(false);
  });

  it("floors a locked bonnet at the minimum glass height", () => {
    const result = normalizeFloorSupport(
      work,
      pedestal({ bonnetHeightMm: 40, bonnetHeightLocked: true })
    );
    expect(result.support.bonnetHeightMm).toBe(BONNET_MIN_HEIGHT_MM);
    expect(result.bonnetTooShortByMm).toBe(900 - BONNET_MIN_HEIGHT_MM);
    expect(result.changed).toBe(true);
  });

  it("deletes bonnetHeightLocked whenever there is no bonnet", () => {
    const result = normalizeFloorSupport(work, pedestal({ bonnetHeightLocked: true }));
    expect(result.support).not.toHaveProperty("bonnetHeightLocked");
    expect(result.support).not.toHaveProperty("bonnetHeightMm");
    expect(result.changed).toBe(true);
  });

  it("is idempotent", () => {
    const once = normalizeFloorSupport(
      work,
      pedestal({
        widthMm: 100,
        depthMm: 100,
        offsetXMm: 900,
        overhangAllowed: true,
        bonnetHeightMm: 40,
        bonnetHeightLocked: true
      })
    );
    const twice = normalizeFloorSupport(work, once.support);
    expect(twice.support).toEqual(once.support);
    expect(twice.changed).toBe(false);
  });
});
