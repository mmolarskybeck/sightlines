import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ElevationMonitorGhost } from "./ElevationMonitorGhost";
import { MONITOR_PEDESTAL_HEIGHT_MM } from "../../../domain/geometry/monitorGlyphs";

afterEach(cleanup);

const WALL_HEIGHT_MM = 3000;

// A 500mm cabinet centred at 3000. Whatever it is standing on is a separate
// support object with its own ghost (schema v8), so all this component is given
// is how high the cabinet's bottom edge sits.
function renderGhost(
  overrides: Partial<Parameters<typeof ElevationMonitorGhost>[0]> = {}
) {
  return render(
    <svg>
      <ElevationMonitorGhost
        wallHeightMm={WALL_HEIGHT_MM}
        xMinMm={2750}
        xMaxMm={3250}
        monitorHeightMm={375}
        baseHeightMm={0}
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
  it("stands a bare-floor cabinet on the floor line and draws no plinth", () => {
    const { container } = renderGhost();

    const cabinet = container.querySelector(".monitor-ghost-cabinet")!;
    expect(cabinet.getAttribute("x")).toBe("2750");
    expect(cabinet.getAttribute("width")).toBe("500");
    expect(cabinet.getAttribute("y")).toBe(String(topSvgY(0, 375)));
    expect(cabinet.getAttribute("height")).toBe("375");

    // The pedestal and the bonnet belong to the SUPPORT ghost now.
    expect(container.querySelector(".monitor-ghost-pedestal")).toBeNull();
    expect(container.querySelector(".monitor-ghost-bonnet")).toBeNull();
  });

  it("lifts a RIDER cabinet to its base height — the pedestal's top face", () => {
    const { container } = renderGhost({ baseHeightMm: MONITOR_PEDESTAL_HEIGHT_MM });

    const cabinet = container.querySelector(".monitor-ghost-cabinet")!;
    expect(cabinet.getAttribute("y")).toBe(
      String(topSvgY(MONITOR_PEDESTAL_HEIGHT_MM, 375))
    );
    expect(container.querySelector(".monitor-ghost-pedestal")).toBeNull();
  });

  it("carries the screen up with the cabinet", () => {
    const { container } = renderGhost({ baseHeightMm: MONITOR_PEDESTAL_HEIGHT_MM });
    const screen = container.querySelector(".monitor-ghost-screen")!;
    const cabinet = container.querySelector(".monitor-ghost-cabinet")!;
    expect(Number(screen.getAttribute("y"))).toBeGreaterThan(
      Number(cabinet.getAttribute("y"))
    );
    expect(Number(screen.getAttribute("y"))).toBeLessThan(
      Number(cabinet.getAttribute("y")) + 375
    );
  });

  it("is inert: one non-interactive group, every rect non-scaling-stroke", () => {
    const { container } = renderGhost();
    const group = container.querySelector(".elevation-monitor-ghost")!;
    for (const rect of Array.from(group.querySelectorAll("rect"))) {
      expect(rect.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    }
  });
});
