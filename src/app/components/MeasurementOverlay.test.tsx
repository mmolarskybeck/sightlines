import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MeasurementOverlay } from "./MeasurementOverlay";

function renderOverlay(overrides: Partial<Parameters<typeof MeasurementOverlay>[0]> = {}) {
  return render(
    <svg>
      <MeasurementOverlay
        a={{ xMm: 10, yMm: 20 }}
        b={{ xMm: 3010, yMm: 4020 }}
        pixelsPerMm={2}
        unit="m"
        {...overrides}
      />
    </svg>
  );
}

describe("MeasurementOverlay", () => {
  it("formats the model-space direct distance and exposes accessible hit targets", () => {
    const { container } = renderOverlay();

    expect(container.querySelector(".measurement-label")?.textContent).toBe("5 m");
    expect(screen.getByRole("group", { name: "Measurement, 5 m" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Measurement start point, 5 m" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Measurement end point, 5 m" })).toBeTruthy();
  });

  it("terminates outward-facing arrowheads exactly at endpoints with bases inside the span", () => {
    const { container } = renderOverlay();
    const start = container.querySelector('[data-endpoint="a"]')!;
    const end = container.querySelector('[data-endpoint="b"]')!;

    expect(start.querySelector(".measurement-handle")?.getAttribute("points")?.split(" ")[0]).toBe("10,20");
    expect(end.querySelector(".measurement-handle")?.getAttribute("points")?.split(" ")[0]).toBe("3010,4020");
    const startBaseX = Number(start.querySelector(".measurement-handle")?.getAttribute("points")?.split(" ")[1].split(",")[0]);
    const endBaseX = Number(end.querySelector(".measurement-handle")?.getAttribute("points")?.split(" ")[1].split(",")[0]);
    expect(startBaseX).toBeGreaterThan(10);
    expect(endBaseX).toBeLessThan(3010);
    const startPoints = start.querySelector(".measurement-handle")!.getAttribute("points")!.split(" ").map((pair) => pair.split(",").map(Number));
    const baseCenter = {
      x: (startPoints[1][0] + startPoints[2][0]) / 2,
      y: (startPoints[1][1] + startPoints[2][1]) / 2
    };
    expect(Math.hypot(baseCenter.x - 10, baseCenter.y - 20) * 2).toBeCloseTo(11);
    const line = container.querySelector(".measurement-line")!;
    expect([line.getAttribute("x1"), line.getAttribute("y1")]).toEqual(["10", "20"]);
    expect([line.getAttribute("x2"), line.getAttribute("y2")]).toEqual(["3010", "4020"]);
    expect(start.querySelector(".measurement-handle-hit")?.getAttribute("r")).toBe("11");
  });

  it("marks snapped state on the arrowhead itself without adding or moving endpoint geometry", () => {
    const { container } = renderOverlay({ snappedEndpoint: "b" });
    const snapped = container.querySelector('[data-endpoint="b"]');
    const hit = snapped?.querySelector(".measurement-handle-hit");

    expect(snapped?.getAttribute("data-snapped")).toBe("true");
    expect(snapped?.querySelector(".measurement-snap-marker")).toBeNull();
    expect(snapped?.querySelectorAll(".measurement-handle")).toHaveLength(1);
    expect(snapped?.querySelector(".measurement-handle")?.getAttribute("points")?.split(" ")[0]).toBe("3010,4020");
    expect(hit?.getAttribute("r")).toBe("11");
  });

  it("gives handles precedence and reports which endpoint was pressed", () => {
    const onBodyPointerDown = vi.fn();
    const onEndpointPointerDown = vi.fn();
    renderOverlay({ onBodyPointerDown, onEndpointPointerDown });

    fireEvent.pointerDown(screen.getByRole("button", { name: "Measurement end point, 5 m" }));

    expect(onEndpointPointerDown).toHaveBeenCalledWith("b", expect.anything());
    expect(onBodyPointerDown).not.toHaveBeenCalled();
  });

  it("delegates endpoint keyboard editing and claims arrow keys from global shortcuts", () => {
    const onEndpointKeyDown = vi.fn();
    renderOverlay({ onEndpointKeyDown });
    const endpoint = screen.getByRole("button", { name: "Measurement start point, 5 m" });

    fireEvent.keyDown(endpoint, { key: "ArrowRight" });

    expect(endpoint.getAttribute("data-owns-arrow-keys")).toBe("");
    expect(onEndpointKeyDown).toHaveBeenCalledWith("a", expect.anything());
  });

  it("hides endpoint handles when the measurement is not selected", () => {
    renderOverlay({ selected: false });
    expect(screen.queryByRole("button", { name: /point/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Select measurement, 5 m" })).toBeTruthy();
  });

  it("shows fixed endpoint caps instead of draggable arrowheads when locked", () => {
    const { container } = renderOverlay({ locked: true, reference: true });

    expect(screen.queryByRole("button", { name: /point/ })).toBeNull();
    expect(container.querySelectorAll(".measurement-handle")).toHaveLength(0);
    expect(container.querySelectorAll(".measurement-locked-endcap")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Select measurement, 5 m" })).toBeTruthy();
  });

  it("keeps the rubber-band hit line inert while unselected so it cannot swallow the completing click", () => {
    renderOverlay({ selected: false });
    const hitLine = screen.getByRole("button", { name: "Select measurement, 5 m" });

    expect(hitLine.style.pointerEvents).toBe("none");
    expect(hitLine.getAttribute("tabindex")).toBe("-1");
  });

  it("keeps the completed measurement's hit line interactive once selected", () => {
    renderOverlay({ selected: true });
    const hitLine = screen.getByRole("button", { name: "Select measurement, 5 m" });

    expect(hitLine.style.pointerEvents).toBe("stroke");
    expect(hitLine.getAttribute("tabindex")).toBe("0");
  });
});
