import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ElevationSupportedArtworkGhost } from "./ElevationSupportedArtworkGhost";

afterEach(cleanup);

const WALL_HEIGHT_MM = 3000;

// A sculpture on a 1100mm pedestal: the pedestal is wider than the work, so the
// assembly's span (xMin..xMax) and the work's own (workXMin..workXMax) really do
// differ — which is the only way this component's two-span rule can be tested.
function renderGhost(
  overrides: Partial<Parameters<typeof ElevationSupportedArtworkGhost>[0]> = {}
) {
  return render(
    <svg>
      <ElevationSupportedArtworkGhost
        wallHeightMm={WALL_HEIGHT_MM}
        xMinMm={1000}
        xMaxMm={1600}
        supportHeightMm={1100}
        workHeightMm={400}
        workXMinMm={1100}
        workXMaxMm={1500}
        supportXMinMm={1000}
        supportXMaxMm={1600}
        {...overrides}
      />
    </svg>
  );
}

// SVG y runs DOWN from the wall's top edge while the model is y-up from the
// floor, so a box whose bottom sits `bottomMm` off the floor has its top at
// this y. Restated here rather than imported: if the component and the test
// shared a helper, a flipped map would pass both.
const topSvgY = (bottomMm: number, heightMm: number) =>
  WALL_HEIGHT_MM - (bottomMm + heightMm);

describe("ElevationSupportedArtworkGhost", () => {
  it("stands the support block on the floor line across the ASSEMBLY's span", () => {
    const { container } = renderGhost();

    const support = container.querySelector(".supported-artwork-ghost-support")!;
    expect(support.getAttribute("y")).toBe(String(topSvgY(0, 1100)));
    expect(support.getAttribute("height")).toBe("1100");
    // The union span, not the work's: a plinth wider than its sculpture has to
    // draw as the plinth.
    expect(support.getAttribute("x")).toBe("1000");
    expect(support.getAttribute("width")).toBe("600");
  });

  it("puts the work's bottom edge ON the support's top face, across the WORK's own span", () => {
    const { container } = renderGhost();

    const work = container.querySelector(".supported-artwork-ghost-work")!;
    // 1100 + 400 = 1500 off the floor, so 1500 down from a 3000 wall's top.
    expect(work.getAttribute("y")).toBe(String(topSvgY(1100, 400)));
    expect(work.getAttribute("height")).toBe("400");
    // Collapsing the two spans into one would draw this sculpture as wide as
    // its pedestal.
    expect(work.getAttribute("x")).toBe("1100");
    expect(work.getAttribute("width")).toBe("400");
  });

  it("draws no bonnet when there is none", () => {
    const { container } = renderGhost();
    expect(container.querySelector(".supported-artwork-ghost-bonnet")).toBeNull();
  });

  it("rises the bonnet from the support's top face at the SUPPORT's footprint", () => {
    const { container } = renderGhost({ bonnetHeightMm: 475 });

    const bonnet = container.querySelector(".supported-artwork-ghost-bonnet")!;
    expect(bonnet.getAttribute("y")).toBe(String(topSvgY(1100, 475)));
    expect(bonnet.getAttribute("height")).toBe("475");
    // Bonnet footprint = support footprint (USER DECISION 2026-09-17).
    expect(bonnet.getAttribute("x")).toBe("1000");
    expect(bonnet.getAttribute("width")).toBe("600");
  });

  it("lets a work TALLER than a locked bonnet extend above it rather than clipping", () => {
    // The normaliser refuses to grow a locked bonnet and reports the shortfall
    // instead (USER DECISION 2026-09-17), so the drawing has to show the
    // collision the inspector is warning about.
    const { container } = renderGhost({ workHeightMm: 900, bonnetHeightMm: 300 });

    const work = container.querySelector(".supported-artwork-ghost-work")!;
    const bonnet = container.querySelector(".supported-artwork-ghost-bonnet")!;
    // Full height, not trimmed to the glass.
    expect(work.getAttribute("height")).toBe("900");
    // And its top is ABOVE the bonnet's — smaller SVG y is higher up.
    expect(Number(work.getAttribute("y"))).toBeLessThan(Number(bonnet.getAttribute("y")));
  });

  it("is inert — the whole group carries the non-interactive ghost class", () => {
    const { container } = renderGhost({ bonnetHeightMm: 475 });
    const group = container.querySelector(".elevation-supported-artwork-ghost")!;
    expect(group).not.toBeNull();
    // Every drawn part lives inside that one group, which is where the CSS
    // pointer-events:none / dashed-subtle treatment is applied.
    expect(group.querySelectorAll("rect")).toHaveLength(3);
  });

  it("draws the support and bonnet across the SUPPORT span, not the assembly, when the work overhangs", () => {
    // Overhang on: a 400-wide pedestal under a 1000-wide work. The assembly
    // span is the work's; the pedestal must still be drawn 400 wide.
    const { container } = renderGhost({
      xMinMm: 800,
      xMaxMm: 1800,
      workXMinMm: 800,
      workXMaxMm: 1800,
      supportXMinMm: 1100,
      supportXMaxMm: 1500,
      bonnetHeightMm: 500
    });
    const support = container.querySelector(".supported-artwork-ghost-support")!;
    expect(support.getAttribute("x")).toBe("1100");
    expect(support.getAttribute("width")).toBe("400");
    const bonnet = container.querySelector(".supported-artwork-ghost-bonnet")!;
    expect(bonnet.getAttribute("x")).toBe("1100");
    expect(bonnet.getAttribute("width")).toBe("400");
    const work = container.querySelector(".supported-artwork-ghost-work")!;
    expect(work.getAttribute("width")).toBe("1000");
  });
});
