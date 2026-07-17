import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeasurementToolState } from "../../hooks/useMeasurementTool";
import { MeasurementLiveRegion } from "./MeasurementLiveRegion";

const context = { kind: "plan" } as const;
const drawing = (xMm: number): MeasurementToolState => ({
  phase: "drawing",
  context,
  start: { xMm: 0, yMm: 0 },
  preview: { xMm, yMm: 0 }
});

describe("MeasurementLiveRegion", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("throttles changing drawing distances and publishes the latest value", () => {
    vi.setSystemTime(1000);
    const rendered = render(<MeasurementLiveRegion state={drawing(1000)} unit="m" />);
    expect(screen.getByRole("status").textContent).toBe("Measurement, 1 m");

    vi.setSystemTime(1100);
    rendered.rerender(<MeasurementLiveRegion state={drawing(2000)} unit="m" />);
    rendered.rerender(<MeasurementLiveRegion state={drawing(3000)} unit="m" />);
    expect(screen.getByRole("status").textContent).toBe("Measurement, 1 m");

    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByRole("status").textContent).toBe("Measurement, 3 m");
  });

  it("announces completion immediately and cancels a pending live update", () => {
    vi.setSystemTime(1000);
    const rendered = render(<MeasurementLiveRegion state={drawing(1000)} unit="m" />);
    vi.setSystemTime(1100);
    rendered.rerender(<MeasurementLiveRegion state={drawing(2000)} unit="m" />);
    rendered.rerender(
      <MeasurementLiveRegion
        state={{
          phase: "armed-complete",
          context,
          start: { xMm: 0, yMm: 0 },
          end: { xMm: 5000, yMm: 0 }
        }}
        unit="m"
      />
    );

    expect(screen.getByRole("status").textContent).toBe("Measurement complete, 5 m");
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("status").textContent).toBe("Measurement complete, 5 m");
  });
});
