import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionInspector } from "./SelectionInspector";

afterEach(cleanup);

type ArrangeProp = NonNullable<ComponentProps<typeof SelectionInspector>["arrange"]>;

const baseArrange: ArrangeProp = {
  mode: "inset",
  insetAnchor: "both",
  evenZone: "wall",
  insetMm: 500,
  gapMm: 800,
  leftEdgeDistanceMm: 500,
  rightEdgeDistanceMm: 500,
  leftBoundary: { type: "wall" },
  rightBoundary: { type: "wall" },
  insetIsMixed: false,
  gapIsMixed: false,
  equalSpacingMm: 650,
  sessionActive: true
};

function renderPanel(
  overrides: Partial<ComponentProps<typeof SelectionInspector>> = {}
) {
  const props: ComponentProps<typeof SelectionInspector> = {
    arrange: baseArrange,
    count: 2,
    unit: "cm",
    wallName: "North wall",
    onSetMode: vi.fn(),
    onSetAnchor: vi.fn(),
    onSetEvenZone: vi.fn(),
    onArrangeValue: vi.fn(),
    onAcceptArrange: vi.fn(),
    onCancelArrange: vi.fn(),
    onRemoveAll: vi.fn(),
    ...overrides
  };
  return { props, ...render(<SelectionInspector {...props} />) };
}

describe("SelectionInspector arrange body", () => {
  it("inset/both, wall boundaries: anchor tabs, editable edge field, calculated gap readout", () => {
    renderPanel();

    // The anchor sub-choice is underline tabs (a radiogroup), not a select.
    expect(screen.getByRole("radiogroup", { name: "Measured from" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Left" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Both", checked: true })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Right" })).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: "Distance from each edge" })
    ).toBeTruthy();
    // The companion value reads as calculated output, and the caption names
    // what both sides measure against.
    expect(screen.getByText("Distance between works")).toBeTruthy();
    expect(screen.getByText("Calculated")).toBeTruthy();
    expect(screen.getByText("Measuring to each wall edge.")).toBeTruthy();
    // No "Neighbor" tag when both detected boundaries are the wall.
    expect(screen.queryByText("Neighbor")).toBeNull();
    // A live session surfaces Apply/Cancel.
    expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("inset/left, a neighbouring artwork: field label, Neighbor tag, and caption name the artwork", () => {
    renderPanel({
      arrange: {
        ...baseArrange,
        insetAnchor: "left",
        leftBoundary: { type: "object", kind: "artwork", name: "Portrait Study" },
        rightBoundary: { type: "wall" }
      }
    });

    expect(
      screen.getByRole("textbox", { name: "Distance from Portrait Study on the left" })
    ).toBeTruthy();
    expect(screen.getByText("Neighbor")).toBeTruthy();
    expect(screen.getByText("Distance from right wall edge")).toBeTruthy();
    expect(
      screen.getByText("Measuring to nearest artwork on the left.")
    ).toBeTruthy();
  });

  it("inset/right, a neighbouring door: field label and caption name the door", () => {
    renderPanel({
      arrange: {
        ...baseArrange,
        insetAnchor: "right",
        leftBoundary: { type: "wall" },
        rightBoundary: { type: "object", kind: "door", name: "Door" }
      }
    });

    expect(
      screen.getByRole("textbox", { name: "Distance from Door on the right" })
    ).toBeTruthy();
    expect(screen.getByText("Neighbor")).toBeTruthy();
    expect(
      screen.getByText("Measuring to nearest door on the right.")
    ).toBeTruthy();
  });

  it("equal mode: zone select and equal-distance readout, no anchor tabs", () => {
    renderPanel({ arrange: { ...baseArrange, mode: "equal" } });

    expect(screen.getByRole("combobox", { name: "Space within" })).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Measured from" })).toBeNull();
    expect(screen.getByText("Equal distance")).toBeTruthy();
  });

  it("gap mode, wall boundaries: editable gap field and per-side wall-edge readouts", () => {
    renderPanel({ arrange: { ...baseArrange, mode: "gap" } });

    expect(
      screen.getByRole("textbox", { name: "Distance between works" })
    ).toBeTruthy();
    // Outer distances are now neighbour-aware, per-side — with no neighbour
    // they name the wall edge on each side.
    expect(screen.getByText("Distance from left wall edge")).toBeTruthy();
    expect(screen.getByText("Distance from right wall edge")).toBeTruthy();
    expect(screen.getByText("Measuring to each wall edge.")).toBeTruthy();
    expect(
      screen.getByText(/The group stays where it is\. The side distances follow/)
    ).toBeTruthy();
    // No "Neighbor" tag when both detected boundaries are the wall.
    expect(screen.queryByText("Neighbor")).toBeNull();
  });

  it("gap mode, neighbouring groups: per-side readouts name the neighbours with a tag", () => {
    renderPanel({
      arrange: {
        ...baseArrange,
        mode: "gap",
        leftBoundary: { type: "object", kind: "artwork", name: "Portrait Study" },
        rightBoundary: { type: "object", kind: "artwork", name: "Still Life" }
      }
    });

    expect(screen.getByText("Distance from Portrait Study on the left")).toBeTruthy();
    expect(screen.getByText("Distance from Still Life on the right")).toBeTruthy();
    // Both outer readouts carry the Neighbor tag.
    expect(screen.getAllByText("Neighbor")).toHaveLength(2);
    expect(
      screen.getByText(
        "Measuring to nearest artwork on the left and nearest artwork on the right."
      )
    ).toBeTruthy();
  });

  it("no arrange: only the disabled reason renders", () => {
    renderPanel({
      arrange: null,
      arrangeDisabledReason: "Arranging is for works only."
    });

    expect(screen.getByText("Arranging is for works only.")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Remove all takes the two-step confirm before firing onRemoveAll", () => {
    const onRemoveAll = vi.fn();
    renderPanel({ onRemoveAll });

    fireEvent.click(screen.getByRole("button", { name: "Remove all" }));
    expect(onRemoveAll).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove 2 selected objects" })
    );
    expect(onRemoveAll).toHaveBeenCalledTimes(1);
  });
});
