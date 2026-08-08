import type { ComponentProps } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { doorElevationGlyph } from "../../../domain/geometry/doorGlyphs";
import { getArtworkRectSvg } from "../../../domain/scene2d/elevationScene";
import { ElevationOpening } from "./ElevationOpening";

afterEach(cleanup);

function renderOpening(overrides: Partial<ComponentProps<typeof ElevationOpening>> = {}) {
  const props: ComponentProps<typeof ElevationOpening> = {
    center: { xMm: 1500, yMm: 1050 },
    kind: "door",
    size: { widthMm: 900, heightMm: 2100 },
    wallHeightMm: 3000,
    wallObjectId: "wo-door",
    ...overrides
  };
  const utils = render(
    <svg>
      <ElevationOpening {...props} />
    </svg>
  );
  return { props, ...utils };
}

describe("ElevationOpening — hinged-door leaf + knob", () => {
  it("draws nothing but the plain outline for a doorway with no leaf (today's unhinged behavior)", () => {
    const { container } = renderOpening();

    expect(container.querySelector(".opening-outline")).not.toBeNull();
    expect(container.querySelector(".door-leaf")).toBeNull();
    expect(container.querySelector(".door-knob")).toBeNull();
  });

  it("draws an inset leaf + knob for a hinged door, matching doorElevationGlyph exactly", () => {
    const { container, props } = renderOpening({ leaf: { hingeAtStart: true } });

    const rect = getArtworkRectSvg(props.wallHeightMm, props.center, props.size);
    const glyph = doorElevationGlyph({
      widthMm: props.size.widthMm,
      heightMm: props.size.heightMm,
      hingeAtStart: true
    });
    expect(glyph.showMarks).toBe(true);
    expect(glyph.knob).not.toBeNull();

    const leafEl = container.querySelector(".door-leaf")!;
    expect(leafEl).not.toBeNull();
    expect(leafEl.getAttribute("x")).toBe(String(rect.xMm + glyph.leafRect.xMm));
    expect(leafEl.getAttribute("y")).toBe(String(rect.yMm + glyph.leafRect.yMm));
    expect(leafEl.getAttribute("width")).toBe(String(glyph.leafRect.widthMm));
    expect(leafEl.getAttribute("height")).toBe(String(glyph.leafRect.heightMm));

    const knobEl = container.querySelector(".door-knob")!;
    expect(knobEl).not.toBeNull();
    expect(knobEl.getAttribute("cx")).toBe(String(rect.xMm + glyph.knob!.cxMm));
    expect(knobEl.getAttribute("cy")).toBe(String(rect.yMm + glyph.knob!.cyMm));
  });

  // hingeAtStart maps STRAIGHT through with no view-direction flip (the plan's
  // explicit "no mirror" rule — getArtworkRectSvg already maps wall-local x
  // straight through from the authored start): flipping the flag must move
  // the knob to the opposite stile, not leave it fixed or invert some other
  // axis.
  it("moves the knob to the opposite stile when hingeAtStart flips, with no other change", () => {
    const { container: hingedAtStart } = renderOpening({ leaf: { hingeAtStart: true } });
    const { container: hingedAtEnd } = renderOpening({ leaf: { hingeAtStart: false } });

    const knobAtStart = hingedAtStart.querySelector(".door-knob")!;
    const knobAtEnd = hingedAtEnd.querySelector(".door-knob")!;
    expect(knobAtStart.getAttribute("cx")).not.toBe(knobAtEnd.getAttribute("cx"));
    expect(knobAtStart.getAttribute("cy")).toBe(knobAtEnd.getAttribute("cy"));
  });

  it("draws only the plain outline for a door too narrow for its own reveal inset (showMarks: false)", () => {
    const { container } = renderOpening({
      leaf: { hingeAtStart: true },
      size: { widthMm: 50, heightMm: 2100 }
    });

    expect(container.querySelector(".opening-outline")).not.toBeNull();
    expect(container.querySelector(".door-leaf")).toBeNull();
    expect(container.querySelector(".door-knob")).toBeNull();
  });

  it("drops the knob but keeps the leaf panel for a door too narrow to fit a legible knob", () => {
    // leafWidthMm = 100 - 2*40 = 20mm, well under 2*knobRadius(28) = 56mm.
    const { container } = renderOpening({
      leaf: { hingeAtStart: true },
      size: { widthMm: 100, heightMm: 2100 }
    });

    expect(container.querySelector(".door-leaf")).not.toBeNull();
    expect(container.querySelector(".door-knob")).toBeNull();
  });

  it("ignores a `leaf` prop on a non-door kind — no leaf/knob on a window", () => {
    const { container } = renderOpening({
      kind: "window",
      leaf: { hingeAtStart: true }
    });

    expect(container.querySelector(".window-mullions")).not.toBeNull();
    expect(container.querySelector(".door-leaf")).toBeNull();
    expect(container.querySelector(".door-knob")).toBeNull();
  });
});
