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
  it("inset mode: anchor select, editable inset field, calculated gap readout", () => {
    renderPanel();

    // The anchor sub-choice is a collapsed select, not a segmented row.
    expect(screen.getByRole("combobox", { name: "Measured from" })).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: "Distance from each wall edge" })
    ).toBeTruthy();
    // The companion value reads as calculated output, and the hint names the
    // derived relationship.
    expect(screen.getByText("Distance between works")).toBeTruthy();
    expect(screen.getByText("Calculated")).toBeTruthy();
    expect(
      screen.getByText(/The group stays centered — the spacing between works/)
    ).toBeTruthy();
    // A live session surfaces Apply/Cancel.
    expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("equal mode: zone select and equal-distance readout, no anchor select", () => {
    renderPanel({ arrange: { ...baseArrange, mode: "equal" } });

    expect(screen.getByRole("combobox", { name: "Space within" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Measured from" })).toBeNull();
    expect(screen.getByText("Equal distance")).toBeTruthy();
  });

  it("gap mode: editable gap field and calculated wall-edge readout", () => {
    renderPanel({ arrange: { ...baseArrange, mode: "gap" } });

    expect(
      screen.getByRole("textbox", { name: "Distance between works" })
    ).toBeTruthy();
    expect(screen.getByText("Distance from each wall edge")).toBeTruthy();
    expect(
      screen.getByText(/The group stays where it is — the wall-edge distances/)
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
