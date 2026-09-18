import type { ComponentProps } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { doorSwingPlanGlyph } from "../../../domain/geometry/doorGlyphs";
import type { PlanRect } from "../../../domain/geometry/planObjects";
import { PlanObject } from "./PlanObject";

afterEach(cleanup);

const doorRect: PlanRect = {
  centerXMm: 2000,
  centerYMm: 1000,
  widthMm: 900,
  depthMm: 150,
  angleDeg: 0
};

function renderPlanObject(overrides: Partial<ComponentProps<typeof PlanObject>> = {}) {
  const props: ComponentProps<typeof PlanObject> = {
    kind: "door",
    planRect: doorRect,
    ...overrides
  };
  const utils = render(
    <svg>
      <PlanObject {...props} />
    </svg>
  );
  return { props, ...utils };
}

describe("PlanObject — hinged-door plan swing", () => {
  it("draws the plain void chevron for a doorway with no swing glyph (today's unhinged behavior)", () => {
    const { container } = renderPlanObject();

    expect(container.querySelector(".plan-object-mark--door")).not.toBeNull();
    expect(container.querySelector(".plan-object-mark--door-swing")).toBeNull();
  });

  it("draws the swing group instead of the chevron once a swing glyph is supplied", () => {
    const swing = doorSwingPlanGlyph({
      widthMm: doorRect.widthMm,
      depthMm: doorRect.depthMm,
      hingeAtStart: true,
      swingsToLeft: true
    });
    const { container } = renderPlanObject({ swing });

    expect(container.querySelector(".plan-object-mark--door")).toBeNull();
    const swingGroup = container.querySelector(".plan-object-mark--door-swing");
    expect(swingGroup).not.toBeNull();
    // One continuous glyph: a leaf line plus one arc path, per the "no seam"
    // construction (the leaf's tip IS the arc's start point).
    expect(swingGroup!.querySelectorAll("line")).toHaveLength(1);
    expect(swingGroup!.querySelectorAll("path")).toHaveLength(1);

    // The leaf line lands at midX/midY (planRect's center) + the glyph's
    // local-centered coordinates — the same recentering the `case` glyph uses.
    const midX = doorRect.centerXMm;
    const midY = doorRect.centerYMm;
    const line = swingGroup!.querySelector("line")!;
    expect(line.getAttribute("x1")).toBe(String(midX + swing.leaf.x1Mm));
    expect(line.getAttribute("y1")).toBe(String(midY + swing.leaf.y1Mm));
    expect(line.getAttribute("x2")).toBe(String(midX + swing.leaf.x2Mm));
    expect(line.getAttribute("y2")).toBe(String(midY + swing.leaf.y2Mm));
  });

  // The whole point of the swing being pointer-events:none is that it must
  // never grow the object's hit target or its marquee/renderedRect footprint
  // — the thin opening rect is the only thing those consult, hinged or not.
  it("leaves plan-object-hit and plan-object-outline exactly at planRect's own footprint regardless of the swing", () => {
    const swing = doorSwingPlanGlyph({
      widthMm: doorRect.widthMm,
      depthMm: doorRect.depthMm,
      hingeAtStart: true,
      swingsToLeft: true
    });
    const { container: plainContainer } = renderPlanObject({ hitMinSizeMm: 200 });
    const { container: hingedContainer } = renderPlanObject({ hitMinSizeMm: 200, swing });

    const plainHit = plainContainer.querySelector(".plan-object-hit")!;
    const hingedHit = hingedContainer.querySelector(".plan-object-hit")!;
    expect(hingedHit.getAttribute("x")).toBe(plainHit.getAttribute("x"));
    expect(hingedHit.getAttribute("y")).toBe(plainHit.getAttribute("y"));
    expect(hingedHit.getAttribute("width")).toBe(plainHit.getAttribute("width"));
    expect(hingedHit.getAttribute("height")).toBe(plainHit.getAttribute("height"));

    const plainOutline = plainContainer.querySelector(".plan-object-outline")!;
    const hingedOutline = hingedContainer.querySelector(".plan-object-outline")!;
    expect(hingedOutline.getAttribute("width")).toBe(plainOutline.getAttribute("width"));
    expect(hingedOutline.getAttribute("height")).toBe(plainOutline.getAttribute("height"));
  });

  it("ignores a swing glyph on a non-door kind — a window keeps its mullion cross only", () => {
    const swing = doorSwingPlanGlyph({
      widthMm: doorRect.widthMm,
      depthMm: doorRect.depthMm,
      hingeAtStart: true,
      swingsToLeft: true
    });
    const { container } = renderPlanObject({ kind: "window", swing });

    expect(container.querySelector(".plan-object-mark--window")).not.toBeNull();
    expect(container.querySelector(".plan-object-mark--door-swing")).toBeNull();
  });
});

// A video projection surface is modelled as a floor artwork whose depthMm is
// the board's real thickness (~18mm MDF), so its plan rect is a hairline at
// every realistic zoom. These lock the two things that make such a board
// usable: it stays grabbable, and it says which way it faces.
const boardRect: PlanRect = {
  centerXMm: 3000,
  centerYMm: 2000,
  widthMm: 2400,
  depthMm: 18,
  angleDeg: 0
};

describe("PlanObject — thin floor object hit target", () => {
  // The hit-line-inert pattern (measurement's .measurement-line-hit): the
  // transparent rect grows, the drawn rect never does.
  it("pads only the thin axis of a hairline board and leaves the drawn rect at true thickness", () => {
    // 250mm ≈ MIN_OBJECT_HIT_PX at a whole-floor plan zoom.
    const { container } = renderPlanObject({
      kind: "artwork",
      isFloorPlaced: true,
      planRect: boardRect,
      hitMinSizeMm: 250
    });

    const hit = container.querySelector(".plan-object-hit")!;
    // Thin axis padded up to the floor…
    expect(hit.getAttribute("height")).toBe("250");
    // …long axis untouched, so the band never overhangs the board's ends into
    // whatever sits past them.
    expect(hit.getAttribute("width")).toBe(String(boardRect.widthMm));
    // Padding is symmetric about the object's own center, so the grab band is
    // centered on the drawn hairline rather than biased to one face.
    expect(hit.getAttribute("x")).toBe(String(boardRect.centerXMm - boardRect.widthMm / 2));
    expect(hit.getAttribute("y")).toBe(String(boardRect.centerYMm - 250 / 2));

    const outline = container.querySelector(".plan-object-outline")!;
    expect(outline.getAttribute("height")).toBe(String(boardRect.depthMm));
    expect(outline.getAttribute("width")).toBe(String(boardRect.widthMm));
  });

  it("keeps the hit band in the object's own rotated frame, not the world frame", () => {
    const { container } = renderPlanObject({
      kind: "artwork",
      isFloorPlaced: true,
      planRect: { ...boardRect, angleDeg: 45 },
      hitMinSizeMm: 250
    });

    // The pad is a plain rect inside the group's rotate() transform, so a 45°
    // board's grab band tilts with it — the untransformed geometry stays
    // identical and only the group's transform changes.
    const group = container.querySelector(".plan-object")!;
    expect(group.getAttribute("transform")).toBe(
      `rotate(45 ${boardRect.centerXMm} ${boardRect.centerYMm})`
    );
    const hit = container.querySelector(".plan-object-hit")!;
    expect(hit.getAttribute("height")).toBe("250");
    expect(hit.getAttribute("width")).toBe(String(boardRect.widthMm));
  });

  it("gives a ghost no hit target at all, so a click-to-place click still commits", () => {
    const { container } = renderPlanObject({
      kind: "artwork",
      isGhost: true,
      planRect: boardRect,
      hitMinSizeMm: 250
    });

    expect(container.querySelector(".plan-object-hit")).toBeNull();
  });
});

describe("PlanObject — front-face marker", () => {
  // FRONT-FACE CONVENTION: the front is the +depth long edge (local +y), which
  // at rotationDeg = 0 is the edge at centerY + depth/2.
  it("marks the +depth long edge of a floor-placed artwork", () => {
    const { container } = renderPlanObject({
      kind: "artwork",
      isFloorPlaced: true,
      planRect: boardRect
    });

    const front = container.querySelector(".plan-object-mark--front-face")!;
    expect(front).not.toBeNull();
    const frontYMm = boardRect.centerYMm + boardRect.depthMm / 2;
    expect(front.getAttribute("y1")).toBe(String(frontYMm));
    expect(front.getAttribute("y2")).toBe(String(frontYMm));
    expect(front.getAttribute("x1")).toBe(String(boardRect.centerXMm - boardRect.widthMm / 2));
    expect(front.getAttribute("x2")).toBe(String(boardRect.centerXMm + boardRect.widthMm / 2));
  });

  // The marker is drawn in the rect's own local frame and carried by the
  // group's rotate(), so "front" tracks rotationDeg for free. This is the
  // assertion the 3D and elevation views have to agree with: at 45° the front
  // normal (-sin θ, cos θ) points toward (-0.707, +0.707) in floor space.
  it("rotates with the object rather than staying pinned to world +y", () => {
    const { container } = renderPlanObject({
      kind: "artwork",
      isFloorPlaced: true,
      planRect: { ...boardRect, angleDeg: 45 }
    });

    const group = container.querySelector(".plan-object")!;
    expect(group.getAttribute("transform")).toBe(
      `rotate(45 ${boardRect.centerXMm} ${boardRect.centerYMm})`
    );

    // Local geometry is unchanged — still the +depth edge — which is exactly
    // what makes the world-space front normal come out as (-sin 45, cos 45).
    const front = container.querySelector(".plan-object-mark--front-face")!;
    const frontYMm = boardRect.centerYMm + boardRect.depthMm / 2;
    expect(front.getAttribute("y1")).toBe(String(frontYMm));
    expect(front.getAttribute("y2")).toBe(String(frontYMm));
  });

  it("is withheld from a wall-hung artwork, whose wall line is already the cue", () => {
    const { container } = renderPlanObject({
      kind: "artwork",
      planRect: boardRect
    });

    expect(container.querySelector(".plan-object-mark--artwork")).not.toBeNull();
    expect(container.querySelector(".plan-object-mark--front-face")).toBeNull();
  });

  it("is withheld from floor blocked zones and cases, which have no physical front", () => {
    for (const kind of ["blocked-zone", "case"] as const) {
      const { container } = renderPlanObject({
        kind,
        isFloorPlaced: true,
        planRect: boardRect
      });
      expect(container.querySelector(".plan-object-mark--front-face")).toBeNull();
      cleanup();
    }
  });
});

describe("PlanObject — box-monitor glyph", () => {
  const monitorRect: PlanRect = {
    centerXMm: 2000,
    centerYMm: 1000,
    widthMm: 500,
    depthMm: 450,
    angleDeg: 0
  };

  it("replaces the generic artwork inset with the screen line", () => {
    const { container } = renderPlanObject({
      kind: "artwork",
      isFloorPlaced: true,
      isMonitor: true,
      planRect: monitorRect
    });

    expect(container.querySelector(".plan-object-mark--monitor line")).not.toBeNull();
    // The 0.22 inset rect describes a framed work's image, which a cabinet has
    // no equivalent of — drawing both would read as a screen inside a screen.
    expect(container.querySelector(".plan-object-mark--artwork")).toBeNull();
    // The front-face marker stays: it is the orientation cue the screen line
    // sits on, and it applies to every floor-placed work.
    expect(container.querySelector(".plan-object-mark--front-face")).not.toBeNull();
  });

  it("puts the screen line on the FRONT (+depth) side of the centre", () => {
    const { container } = renderPlanObject({
      kind: "artwork",
      isFloorPlaced: true,
      isMonitor: true,
      planRect: monitorRect
    });

    const line = container.querySelector(".plan-object-mark--monitor line")!;
    // A sign flip here would mark the BACK of the cabinet as the screen — the
    // one error this glyph can make that still looks plausible.
    expect(Number(line.getAttribute("y1"))).toBeGreaterThan(monitorRect.centerYMm);
    expect(Number(line.getAttribute("y1"))).toBeLessThan(
      monitorRect.centerYMm + monitorRect.depthMm / 2
    );
  });

  it("leaves a non-monitor artwork drawing exactly what it drew before", () => {
    const { container } = renderPlanObject({
      kind: "artwork",
      isFloorPlaced: true,
      planRect: monitorRect
    });

    expect(container.querySelector(".plan-object-mark--monitor")).toBeNull();
    expect(container.querySelector(".plan-object-mark--artwork")).not.toBeNull();
  });
});

// A work standing on a pedestal/plinth. The scene hands the component the
// support's footprint already positioned in floor space (supportPlanRect); the
// component's whole job is to draw it beneath the work and inside the same
// pointer-handling group.
describe("PlanObject — floor support", () => {
  const workRect: PlanRect = {
    centerXMm: 2000,
    centerYMm: 1500,
    widthMm: 400,
    depthMm: 400,
    angleDeg: 0
  };
  // 100mm reveal on every side (the pedestal default), centred on the work.
  const supportRect: PlanRect = {
    centerXMm: 2000,
    centerYMm: 1500,
    widthMm: 600,
    depthMm: 600,
    angleDeg: 0
  };

  it("draws the support rect at the scene's footprint, BENEATH the work", () => {
    const { container } = renderPlanObject({
      kind: "artwork",
      isFloorPlaced: true,
      planRect: workRect,
      support: { rect: supportRect, hasBonnet: false }
    });

    const support = container.querySelector(".plan-object-support")!;
    expect(support).not.toBeNull();
    // The scene's numbers, untouched — the view never re-derives a footprint.
    expect(support.getAttribute("width")).toBe(String(supportRect.widthMm));
    expect(support.getAttribute("height")).toBe(String(supportRect.depthMm));
    expect(support.getAttribute("x")).toBe(
      String(supportRect.centerXMm - supportRect.widthMm / 2)
    );
    expect(support.getAttribute("y")).toBe(
      String(supportRect.centerYMm - supportRect.depthMm / 2)
    );

    // Paint order is the whole reason the support is drawn first: the work's
    // own outline has to overdraw the seam where the two meet.
    const painted = Array.from(
      container.querySelectorAll(".plan-object-support, .plan-object-outline")
    );
    expect(painted[0]!.classList.contains("plan-object-support")).toBe(true);
    expect(painted[1]!.classList.contains("plan-object-outline")).toBe(true);
  });

  it("puts the support inside the same handler group as the work, so the assembly selects as one", () => {
    const onSelect = vi.fn();
    const { container } = renderPlanObject({
      kind: "artwork",
      isFloorPlaced: true,
      planRect: workRect,
      support: { rect: supportRect, hasBonnet: false },
      onSelect
    });

    // Not "the rect has its own onClick": the group carries the handler and the
    // support rect sits inside it, which is what makes one click on the reveal
    // around a sculpture select the sculpture.
    const group = container.querySelector(".plan-object")!;
    expect(group.querySelector(".plan-object-support")).not.toBeNull();
    fireEvent.click(container.querySelector(".plan-object-support")!);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("nets out to the support's own rotation, not a double one, on a turned placement", () => {
    // The support group's two rotations exist to undo the outer group's rotate
    // about the WORK's center and re-apply the support's own about ITS center.
    // Getting this wrong rotates an offset support twice — it swings away from
    // the work instead of turning with it — which is invisible at angleDeg 0.
    const offsetSupport: PlanRect = { ...supportRect, centerXMm: 2100, angleDeg: 45 };
    const { container } = renderPlanObject({
      kind: "artwork",
      isFloorPlaced: true,
      planRect: { ...workRect, angleDeg: 45 },
      support: { rect: offsetSupport, hasBonnet: false }
    });

    expect(container.querySelector(".plan-object")!.getAttribute("transform")).toBe(
      `rotate(45 ${workRect.centerXMm} ${workRect.centerYMm})`
    );
    expect(
      container.querySelector(".plan-object-support-group")!.getAttribute("transform")
    ).toBe(
      `rotate(-45 ${workRect.centerXMm} ${workRect.centerYMm})` +
        ` rotate(45 ${offsetSupport.centerXMm} ${offsetSupport.centerYMm})`
    );
  });

  it("adds a dashed bonnet rect at the SUPPORT's footprint only when there is a bonnet", () => {
    const { container: without } = renderPlanObject({
      kind: "artwork",
      isFloorPlaced: true,
      planRect: workRect,
      support: { rect: supportRect, hasBonnet: false }
    });
    expect(without.querySelector(".plan-object-support-bonnet")).toBeNull();

    const { container: with_ } = renderPlanObject({
      kind: "artwork",
      isFloorPlaced: true,
      planRect: workRect,
      support: { rect: supportRect, hasBonnet: true }
    });
    const bonnet = with_.querySelector(".plan-object-support-bonnet")!;
    expect(bonnet).not.toBeNull();
    // Bonnet footprint = support footprint (USER DECISION 2026-09-17) — not the
    // work's, and not an inset of either.
    expect(bonnet.getAttribute("width")).toBe(String(supportRect.widthMm));
    expect(bonnet.getAttribute("height")).toBe(String(supportRect.depthMm));
  });

  it("draws nothing extra for a work standing on the bare floor", () => {
    const { container } = renderPlanObject({
      kind: "artwork",
      isFloorPlaced: true,
      planRect: workRect
    });
    expect(container.querySelector(".plan-object-support")).toBeNull();
    expect(container.querySelector(".plan-object-support-group")).toBeNull();
  });

  it("takes a legacy monitor's pedestal from the scene entry, not from the cabinet's own size", () => {
    // Before supports existed, plan drew ONE rect and called it both cabinet
    // and pedestal on the grounds that the two footprints were equal by
    // construction. They are equal for the monitor default and diverge the
    // moment the cabinet goes on a named plinth, so the pedestal now comes off
    // the scene like any other support.
    const plinth: PlanRect = { ...supportRect, widthMm: 900, depthMm: 800 };
    const { container } = renderPlanObject({
      kind: "artwork",
      isFloorPlaced: true,
      isMonitor: true,
      planRect: workRect,
      support: { rect: plinth, hasBonnet: false }
    });

    const support = container.querySelector(".plan-object-support")!;
    expect(support.getAttribute("width")).toBe("900");
    expect(support.getAttribute("height")).toBe("800");
    // The cabinet's own rect is untouched by what it stands on.
    const outline = container.querySelector(".plan-object-outline")!;
    expect(outline.getAttribute("width")).toBe(String(workRect.widthMm));
    // And the screen line is still drawn: the support did not replace the glyph.
    expect(container.querySelector(".plan-object-mark--monitor line")).not.toBeNull();
  });

  it("gives a ghost no support rect at all, so a click-to-place click still commits", () => {
    const { container } = renderPlanObject({
      kind: "artwork",
      isGhost: true,
      planRect: workRect,
      support: { rect: supportRect, hasBonnet: true }
    });
    expect(container.querySelector(".plan-object-support")).toBeNull();
  });
});
