import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockedZoneFloorObject } from "../../../domain/project";
import { FloorObjectInspector, FloorPlacementFields } from "./FloorObjectInspector";

afterEach(cleanup);

const blockedZone: BlockedZoneFloorObject = {
  id: "zone-1",
  kind: "blocked-zone",
  xMm: 1000,
  yMm: 1500,
  widthMm: 600,
  depthMm: 400,
  rotationDeg: 0,
  heightMm: 0,
  wallYMm: 0
};

// FloorPlacementFields is the shared component covering all three floor-object
// kinds (blocked zone, case, artwork) — see its onCommitBaseHeight/
// onCommitRotation doc comments in FloorObjectInspector.tsx for the per-kind
// scope decisions. Exercised directly here (both callbacks wired), mirroring
// how WallPlacementFields.test.ts tests the shared field component rather
// than one particular wrapping inspector.
describe("FloorPlacementFields — Angle and Height off floor", () => {
  function renderFields(overrides: Partial<Parameters<typeof FloorPlacementFields>[0]> = {}) {
    const onCommitPosition = vi.fn();
    const onCommitSize = vi.fn();
    const onCommitRotation = vi.fn();
    const onCommitBaseHeight = vi.fn();
    render(
      <FloorPlacementFields
        floorObject={blockedZone}
        unit="cm"
        onCommitPosition={onCommitPosition}
        onCommitSize={onCommitSize}
        onCommitRotation={onCommitRotation}
        onCommitBaseHeight={onCommitBaseHeight}
        {...overrides}
      />
    );
    return { onCommitPosition, onCommitSize, onCommitRotation, onCommitBaseHeight };
  }

  it("hides both fields when neither commit handler is supplied", () => {
    renderFields({ onCommitRotation: undefined, onCommitBaseHeight: undefined });

    expect(screen.queryByLabelText("Height off floor")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Angle in degrees")).not.toBeInTheDocument();
  });

  it("shows only the field whose commit handler is supplied", () => {
    renderFields({ onCommitBaseHeight: undefined });
    expect(screen.queryByLabelText("Height off floor")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Angle in degrees")).toBeInTheDocument();
    cleanup();

    renderFields({ onCommitRotation: undefined });
    expect(screen.getByLabelText("Height off floor")).toBeInTheDocument();
    expect(screen.queryByLabelText("Angle in degrees")).not.toBeInTheDocument();
  });

  it("commits a typed height off floor in mm", async () => {
    const { onCommitBaseHeight } = renderFields();
    const input = screen.getByLabelText("Height off floor");

    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.blur(input);

    await waitFor(() => expect(onCommitBaseHeight).toHaveBeenCalledWith(1500));
  });

  it("commits 0 to explicitly rest an object back on the floor", async () => {
    const { onCommitBaseHeight } = renderFields({
      floorObject: { ...blockedZone, baseHeightMm: 900 }
    });
    const input = screen.getByLabelText("Height off floor");

    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);

    await waitFor(() => expect(onCommitBaseHeight).toHaveBeenCalledWith(0));
  });

  it("does not re-commit an untouched height field on blur", () => {
    const { onCommitBaseHeight } = renderFields({
      floorObject: { ...blockedZone, baseHeightMm: 900 }
    });
    const input = screen.getByLabelText("Height off floor");

    fireEvent.focus(input);
    fireEvent.blur(input);

    expect(onCommitBaseHeight).not.toHaveBeenCalled();
  });

  it("commits a typed angle in degrees, including negative values", () => {
    const { onCommitRotation } = renderFields();
    const input = screen.getByLabelText("Angle in degrees");

    fireEvent.change(input, { target: { value: "-45" } });
    fireEvent.blur(input);

    expect(onCommitRotation).toHaveBeenCalledWith(-45);
  });

  it("does not wrap or clamp a large angle — 400 stays 400", () => {
    const { onCommitRotation } = renderFields();
    const input = screen.getByLabelText("Angle in degrees");

    fireEvent.change(input, { target: { value: "400" } });
    fireEvent.blur(input);

    expect(onCommitRotation).toHaveBeenCalledWith(400);
  });

  it("commits an angle on Enter (which blurs the field)", () => {
    const { onCommitRotation } = renderFields();
    const input = screen.getByLabelText("Angle in degrees");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCommitRotation).toHaveBeenCalledWith(30);
  });

  it("does not re-commit an untouched angle field on blur", () => {
    const { onCommitRotation } = renderFields({
      floorObject: { ...blockedZone, rotationDeg: 33.7 }
    });
    const input = screen.getByLabelText("Angle in degrees");

    // Blurring without ever having changed the input must not fire — a click
    // on another control that blurs this field first must not race a stray
    // recommit ahead of whatever that click was actually for (see
    // RotationField's isClean comment).
    fireEvent.focus(input);
    fireEvent.blur(input);

    expect(onCommitRotation).not.toHaveBeenCalled();
  });

  it("does not re-commit an angle that round-trips to the same value", () => {
    const { onCommitRotation } = renderFields({
      floorObject: { ...blockedZone, rotationDeg: 45 }
    });
    const input = screen.getByLabelText("Angle in degrees");

    // Re-typing the displayed value verbatim is a no-op, not a fresh edit.
    fireEvent.change(input, { target: { value: "45" } });
    fireEvent.blur(input);

    expect(onCommitRotation).not.toHaveBeenCalled();
  });
});

// FloorObjectInspector (the blocked-zone inspector) intentionally never
// exposes onCommitBaseHeight — see its doc comment. Angle is wired.
describe("FloorObjectInspector (blocked zone) scope", () => {
  it("shows Angle but never a Height off floor field, even with rotation wired", () => {
    render(
      <FloorObjectInspector
        floorObject={blockedZone}
        unit="cm"
        onCommitPosition={vi.fn()}
        onCommitSize={vi.fn()}
        onCommitRotation={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Angle in degrees")).toBeInTheDocument();
    expect(screen.queryByLabelText("Height off floor")).not.toBeInTheDocument();
  });

  it("hides Angle entirely when the caller has not wired a rotation handler", () => {
    render(
      <FloorObjectInspector
        floorObject={blockedZone}
        unit="cm"
        onCommitPosition={vi.fn()}
        onCommitSize={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.queryByLabelText("Angle in degrees")).not.toBeInTheDocument();
  });
});
