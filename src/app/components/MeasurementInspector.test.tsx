import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MeasurementInspector } from "./MeasurementInspector";

describe("MeasurementInspector", () => {
  it("shows a read-only formatted distance and the temporary-result actions", () => {
    render(
      <MeasurementInspector
        distanceMm={1524}
        unit="ft"
        onKeepAsReference={() => {}}
        onClear={() => {}}
      />
    );

    expect(screen.getByRole("form", { name: "Measurement" })).toBeTruthy();
    expect(screen.getByText("Distance").nextElementSibling?.textContent).toBe(`5'`);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Keep as reference" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
  });

  it("routes keep and clear actions without submitting the inspector form", () => {
    const onKeepAsReference = vi.fn();
    const onClear = vi.fn();
    render(
      <MeasurementInspector
        distanceMm={1000}
        unit="m"
        onKeepAsReference={onKeepAsReference}
        onClear={onClear}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep as reference" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(onKeepAsReference).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledOnce();
  });
});
