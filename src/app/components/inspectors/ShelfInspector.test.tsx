import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShelfWallObject } from "../../../domain/project";
import { ShelfInspector } from "./ShelfInspector";

afterEach(cleanup);

// yMm is the slab's CENTRE, heightMm its thickness: this shelf's top face is
// at 1200 + 40/2 = 1220.
const shelf: ShelfWallObject = {
  id: "shelf-1",
  kind: "shelf",
  wallId: "wall-north",
  xMm: 2000,
  yMm: 1200,
  widthMm: 1200,
  heightMm: 40,
  depthMm: 300
};

function renderInspector(overrides: Partial<Parameters<typeof ShelfInspector>[0]> = {}) {
  const props = {
    shelf,
    riderCount: 0,
    onSelectRiders: vi.fn(),
    wallLengthMm: 6000,
    centerTargetXMm: 3000,
    centerBoundaryKind: "wall" as const,
    onCommitPosition: vi.fn(),
    onCommitSize: vi.fn(),
    onCommitTop: vi.fn(),
    onDelete: vi.fn(),
    unit: "cm" as const,
    ...overrides
  };
  render(<ShelfInspector {...props} />);
  return props;
}

function commit(label: string, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe("ShelfInspector", () => {
  // The whole point of the field: a curator types the height of the face a
  // work stands on, not the middle of the timber.
  it("shows the TOP face, not the stored centre, and commits a typed top", () => {
    const props = renderInspector();

    // Displayed in the project's unit: 1220mm reads as 122cm.
    expect(screen.getByLabelText("Top height")).toHaveValue("122 cm");

    commit("Top height", "150");
    expect(props.onCommitTop).toHaveBeenCalledWith(1500);
  });

  // heightMm is the slab's THICKNESS here; the field must say so, and must not
  // be confusable with the top-height field beside it.
  it("labels thickness as Thickness and commits it in the size triple", () => {
    const props = renderInspector();

    expect(screen.getByLabelText("Thickness")).toHaveValue("4 cm");
    expect(screen.queryByLabelText("Height")).toBeNull();

    commit("Thickness", "6");
    expect(props.onCommitSize).toHaveBeenCalledWith(1200, 60, 300);
  });

  it("commits width and depth without touching the other two", () => {
    const props = renderInspector();

    commit("Width", "150");
    expect(props.onCommitSize).toHaveBeenLastCalledWith(1500, 40, 300);

    commit("Depth", "25");
    expect(props.onCommitSize).toHaveBeenLastCalledWith(1200, 40, 250);
  });

  // The shared along-wall controls, same as WallCaseInspector: position edits
  // arrive as (xMm, yMm) with yMm the stored centre.
  it("wires the shared wall placement fields to onCommitPosition", () => {
    const props = renderInspector();

    commit("From left edge", "50");
    // 500 + widthMm / 2
    expect(props.onCommitPosition).toHaveBeenCalledWith(1100, 1200);

    fireEvent.click(screen.getByRole("button", { name: "Center on wall" }));
    expect(props.onCommitPosition).toHaveBeenLastCalledWith(3000, 1200);
  });

  it("deletes the shelf", () => {
    const props = renderInspector();

    fireEvent.click(screen.getByRole("button", { name: "Delete shelf" }));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  // Nothing on the shelf yet: the notice teaches the gesture instead of
  // showing a "Holds" readout with nothing to select.
  it("shows a notice teaching the drag gesture when riderCount is 0", () => {
    renderInspector({ riderCount: 0 });

    expect(
      screen.getByText("Nothing on this shelf yet. Drag a work over it to stand it on the shelf.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Holds")).toBeNull();
    expect(screen.queryByRole("button", { name: "Select works" })).toBeNull();
  });

  // Works are standing on it: "Holds" replaces the notice with a live count
  // and a way back to those works.
  it("shows the Holds row and selects riders at 2 riders", () => {
    const props = renderInspector({ riderCount: 2 });

    expect(screen.getByText("Holds")).toBeInTheDocument();
    expect(screen.getByText("2 works")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Select works" }));
    expect(props.onSelectRiders).toHaveBeenCalledTimes(1);
  });
});
