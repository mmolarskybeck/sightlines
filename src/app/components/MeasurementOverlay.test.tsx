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

  it("marks snapped endpoints with a non-color diamond and sizes hit targets in screen pixels", () => {
    const { container } = renderOverlay({ snappedEndpoint: "b" });
    const snapped = container.querySelector('[data-endpoint="b"]');
    const hit = snapped?.querySelector(".measurement-handle-hit");

    expect(snapped?.getAttribute("data-snapped")).toBe("true");
    expect(snapped?.querySelector(".measurement-handle")?.getAttribute("transform")).toContain(
      "rotate(45"
    );
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
});
