import type { ComponentProps } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
