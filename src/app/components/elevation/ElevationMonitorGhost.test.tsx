import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ElevationMonitorGhost } from "./ElevationMonitorGhost";
import { MONITOR_PEDESTAL_HEIGHT_MM } from "../../../domain/geometry/monitorGlyphs";

afterEach(cleanup);

const WALL_HEIGHT_MM = 3000;

// A 500mm cabinet centred at 3000 on its own 800mm default pedestal: the
// legacy shape, where the plinth's span and the cabinet's are the same span.
function renderGhost(
  overrides: Partial<Parameters<typeof ElevationMonitorGhost>[0]> = {}
) {
  return render(
    <svg>
      <ElevationMonitorGhost
        wallHeightMm={WALL_HEIGHT_MM}
        xMinMm={2750}
        xMaxMm={3250}
        supportXMinMm={2750}
        supportXMaxMm={3250}
        monitorHeightMm={375}
        pedestalHeightMm={MONITOR_PEDESTAL_HEIGHT_MM}
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

describe("ElevationMonitorGhost", () => {
  it("LEGACY: draws the plinth under the cabinet at the cabinet's span", () => {
    const { container } = renderGhost();

    const pedestal = container.querySelector(".monitor-ghost-pedestal")!;
    expect(pedestal.getAttribute("x")).toBe("2750");
    expect(pedestal.getAttribute("width")).toBe("500");
    expect(pedestal.getAttribute("y")).toBe(String(topSvgY(0, MONITOR_PEDESTAL_HEIGHT_MM)));
    expect(pedestal.getAttribute("height")).toBe(String(MONITOR_PEDESTAL_HEIGHT_MM));

    const cabinet = container.querySelector(".monitor-ghost-cabinet")!;
    expect(cabinet.getAttribute("x")).toBe("2750");
    expect(cabinet.getAttribute("width")).toBe("500");
    expect(cabinet.getAttribute("y")).toBe(
      String(topSvgY(MONITOR_PEDESTAL_HEIGHT_MM, 375))
    );

    expect(container.querySelector(".monitor-ghost-bonnet")).toBeNull();
  });

  it("draws an EXPLICIT plinth across the SUPPORT's span, not the cabinet's", () => {
    // The disagreement this fixes: plan draws a 900mm plinth shoved 100mm along
    // the placement, elevation used to shrink it back to the 500mm box.
    const { container } = renderGhost({
      pedestalHeightMm: 150,
      supportXMinMm: 2650,
      supportXMaxMm: 3550
    });

    const pedestal = container.querySelector(".monitor-ghost-pedestal")!;
    expect(pedestal.getAttribute("x")).toBe("2650");
    expect(pedestal.getAttribute("width")).toBe("900");
    // The cabinet keeps its own span — a monitor on a wide plinth is still a
    // 500mm monitor.
    const cabinet = container.querySelector(".monitor-ghost-cabinet")!;
    expect(cabinet.getAttribute("x")).toBe("2750");
    expect(cabinet.getAttribute("width")).toBe("500");
  });

  it("rises the bonnet from the plinth's top face, at the plinth's span", () => {
    const { container } = renderGhost({
      pedestalHeightMm: 150,
      supportXMinMm: 2650,
      supportXMaxMm: 3550,
      bonnetHeightMm: 450
    });

    const bonnet = container.querySelector(".monitor-ghost-bonnet")!;
    expect(bonnet.getAttribute("x")).toBe("2650");
    expect(bonnet.getAttribute("width")).toBe("900");
    expect(bonnet.getAttribute("y")).toBe(String(topSvgY(150, 450)));
    expect(bonnet.getAttribute("height")).toBe("450");
    // The cabinet still stands on the plinth, unmoved by the glass over it.
    expect(container.querySelector(".monitor-ghost-cabinet")!.getAttribute("y")).toBe(
      String(topSvgY(150, 375))
    );
  });

  it("lets a LOCKED bonnet shorter than the cabinet be overtopped by it", () => {
    // USER DECISION 2026-09-17: the normaliser warns rather than growing the
    // glass, so the drawing has to show the collision.
    const { container } = renderGhost({
      pedestalHeightMm: 150,
      bonnetHeightMm: 200
    });

    const bonnet = container.querySelector(".monitor-ghost-bonnet")!;
    const cabinet = container.querySelector(".monitor-ghost-cabinet")!;
    expect(bonnet.getAttribute("y")).toBe(String(topSvgY(150, 200)));
    // Cabinet top (150 + 375) is HIGHER on the wall — a smaller SVG y — than
    // the bonnet's (150 + 200), and the cabinet is drawn in full.
    expect(Number(cabinet.getAttribute("y"))).toBeLessThan(Number(bonnet.getAttribute("y")));
    expect(cabinet.getAttribute("height")).toBe("375");
  });

  it("is inert: one non-interactive group, every rect non-scaling-stroke", () => {
    const { container } = renderGhost({ bonnetHeightMm: 450 });
    const group = container.querySelector(".elevation-monitor-ghost")!;
    for (const rect of Array.from(group.querySelectorAll("rect"))) {
      expect(rect.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    }
  });
});
