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
