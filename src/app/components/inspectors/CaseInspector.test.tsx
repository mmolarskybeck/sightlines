import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaseFloorObject } from "../../../domain/project";
import { FloorCaseInspector } from "./CaseInspector";

afterEach(cleanup);

const floorCase: CaseFloorObject = {
  id: "case-1",
  kind: "case",
  xMm: 1000,
  yMm: 1500,
  widthMm: 900,
  depthMm: 600,
  heightMm: 1100,
  rotationDeg: 0,
  wallYMm: 0
};

// A vitrine stands on its own legs, so FloorCaseInspector never exposes
// onCommitBaseHeight (see its doc comment) — only Angle. This mirrors the
// FloorObjectInspector (blocked zone) coverage in FloorObjectInspector.test.tsx.
describe("FloorCaseInspector scope", () => {
  it("shows Angle (rotation is useful for a case) but never Height off floor", () => {
    render(
      <FloorCaseInspector
        floorCase={floorCase}
        unit="cm"
        onCommitPosition={vi.fn()}
        onCommitSize={vi.fn()}
        onCommitHeight={vi.fn()}
        onCommitRotation={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Angle in degrees")).toBeInTheDocument();
    expect(screen.queryByLabelText("Height off floor")).not.toBeInTheDocument();
  });

  it("commits a typed angle for the case", () => {
    const onCommitRotation = vi.fn();
    render(
      <FloorCaseInspector
        floorCase={floorCase}
        unit="cm"
        onCommitPosition={vi.fn()}
        onCommitSize={vi.fn()}
        onCommitHeight={vi.fn()}
        onCommitRotation={onCommitRotation}
        onDelete={vi.fn()}
      />
    );
    const input = screen.getByLabelText("Angle in degrees");

    fireEvent.change(input, { target: { value: "90" } });
    fireEvent.blur(input);

    expect(onCommitRotation).toHaveBeenCalledWith(90);
  });

  it("hides Angle when the caller has not wired a rotation handler", () => {
    render(
      <FloorCaseInspector
        floorCase={floorCase}
        unit="cm"
        onCommitPosition={vi.fn()}
        onCommitSize={vi.fn()}
        onCommitHeight={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.queryByLabelText("Angle in degrees")).not.toBeInTheDocument();
  });
});
