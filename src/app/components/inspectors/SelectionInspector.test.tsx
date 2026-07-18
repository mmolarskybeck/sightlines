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
    selectionKey: "obj-1\nobj-2",
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

  it("inset/both, a stacked (vertically overlapping) selection: overlap magnitude readout, no Calculated tag", () => {
    renderPanel({
      arrange: {
        ...baseArrange,
        // Stacked works share a column, so their x-extents overlap and the
        // averaged interior gap goes negative — the panel should show the
        // overlap magnitude, not a nonsensical negative distance.
        gapMm: -60,
        gapIsMixed: false
      }
    });

    expect(screen.getByText("Distance between works")).toBeTruthy();
    expect(screen.getByText(/^Overlapping /)).toBeTruthy();
    expect(screen.queryByText("Calculated")).toBeNull();
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

  it("hides the Mat & frame section when the selection holds no artwork", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: /Mat . frame/ })).toBeNull();
  });

  it("Mat & frame opens inline and applies the drafted bands to the selection", () => {
    const onApply = vi.fn();
    renderPanel({ matFrame: { targetCount: 2, skippedCount: 0, onApply } });

    // Closed at rest: the disclosure is present, its fields are not.
    const trigger = screen.getByRole("button", { name: /Mat . frame/ });
    expect(screen.queryByRole("textbox", { name: "Mat" })).toBeNull();

    fireEvent.click(trigger);

    // Draft a mat band, then apply — the whole draft goes out in one call.
    const matField = screen.getByRole("textbox", { name: "Mat" });
    fireEvent.change(matField, { target: { value: "5" } });
    fireEvent.blur(matField);
    fireEvent.click(screen.getByRole("button", { name: "Apply to 2 works" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      matWidthMm: expect.closeTo(50, 5),
      frame: undefined
    });
  });

  it("Mat & frame drops the draft when a same-size selection swaps identity", () => {
    const onApply = vi.fn();
    const { props, rerender } = renderPanel({
      matFrame: { targetCount: 2, skippedCount: 0, onApply }
    });

    fireEvent.click(screen.getByRole("button", { name: /Mat . frame/ }));
    const matField = screen.getByRole("textbox", { name: "Mat" });
    fireEvent.change(matField, { target: { value: "5" } });
    fireEvent.blur(matField);

    // Same count, different works: the drafted band must not survive to be
    // applied against artworks the curator never typed it for.
    rerender(<SelectionInspector {...props} selectionKey="obj-3\nobj-4" />);

    expect(screen.queryByRole("textbox", { name: "Mat" })).toBeNull();
  });

  it("Mat & frame disables Apply and explains when every work is frame-inclusive", () => {
    renderPanel({ matFrame: { targetCount: 0, skippedCount: 2, onApply: vi.fn() } });

    fireEvent.click(screen.getByRole("button", { name: /Mat . frame/ }));

    expect(
      screen.getByText(/2 selected works include the frame in their size/)
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply to 0 works" })).toBeDisabled();
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
