import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MeasurementInspector, ReferenceMeasurementInspector } from "./MeasurementInspector";

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
    expect(screen.getByRole("button", { name: "Save reference" })).toBeTruthy();
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

    fireEvent.click(screen.getByRole("button", { name: "Save reference" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(onKeepAsReference).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledOnce();
  });
});

describe("ReferenceMeasurementInspector", () => {
  it("uses compact reference-setting toggles instead of native checkboxes", () => {
    render(
      <ReferenceMeasurementInspector
        distanceMm={1143}
        locked={false}
        unit="in"
        visible
        onChange={() => {}}
        onDelete={() => {}}
      />
    );

    expect(screen.getByRole("textbox", { name: "Name" })).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Hide measurement" }).getAttribute("data-state")).toBe("on");
    expect(screen.getByRole("button", { name: "Lock measurement" }).getAttribute("data-state")).toBe("off");
    expect(screen.queryByText("Type")).toBeNull();
  });

  it("routes visibility, lock, name, and delete changes", () => {
    const onChange = vi.fn();
    const onDelete = vi.fn();
    render(
      <ReferenceMeasurementInspector
        distanceMm={1000}
        locked={false}
        name="Door clearance"
        unit="m"
        visible
        onChange={onChange}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Hide measurement" }));
    fireEvent.click(screen.getByRole("button", { name: "Lock measurement" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Sightline" }
    });
    fireEvent.blur(screen.getByRole("textbox", { name: "Name" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete measurement" }));

    expect(onChange).toHaveBeenCalledWith({ visible: false });
    expect(onChange).toHaveBeenCalledWith({ locked: true });
    expect(onChange).toHaveBeenCalledWith({ name: "Sightline" });
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
