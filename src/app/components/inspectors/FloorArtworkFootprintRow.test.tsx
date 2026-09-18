import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dimensions } from "../../../domain/project";
import { FloorArtworkFootprintRow } from "./FloorArtworkFootprintRow";

const workDimensions: Dimensions = { widthMm: 400, heightMm: 600, status: "known" };

afterEach(cleanup);

// A 400 × 600 work standing on a 400-wide, 300-deep, 600-tall box: the box's
// width and height agree with the work, so the row reads "Same as work". Depth
// is NOT part of the comparison for a plain floor work.
function renderRow(
  overrides: Partial<Parameters<typeof FloorArtworkFootprintRow>[0]> = {}
) {
  const props = {
    dimensions: workDimensions,
    placementId: "floor-a",
    widthMm: 400,
    depthMm: 300,
    heightMm: 600,
    unit: "cm" as const,
    onCommit: vi.fn(),
    ...overrides
  };
  const onCommit = props.onCommit as ReturnType<typeof vi.fn>;
  const view = render(<FloorArtworkFootprintRow {...props} />);
  return { ...view, props, onCommit };
}

function commit(label: string, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe("FloorArtworkFootprintRow", () => {
  it("states the footprint and present equality, collapsed, with an Edit action", () => {
    renderRow();

    expect(screen.getByText("Footprint")).toBeInTheDocument();
    expect(screen.getByText("40 cm × 30 cm")).toBeInTheDocument();
    // The comparison is a quiet second line, not part of the value.
    expect(screen.getByText("Same as work")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    // Collapsed: the numbers are a click away, not on the panel.
    expect(screen.queryByLabelText("Width")).toBeNull();
  });

  it("expands the Width / Depth / Height fields on Edit and commits each one alone", () => {
    const { props } = renderRow();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );

    commit("Width", "50");
    expect(props.onCommit).toHaveBeenLastCalledWith({ widthMm: 500 });
    commit("Depth", "45");
    expect(props.onCommit).toHaveBeenLastCalledWith({ depthMm: 450 });
    commit("Height", "70");
    expect(props.onCommit).toHaveBeenLastCalledWith({ heightMm: 700 });
  });

  // Edit is a toggle, not a one-way door: with the numbers still in agreement
  // there is no Reset action to close the fields with.
  it("collapses again on a second Edit while the values still agree", () => {
    renderRow();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Width")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByLabelText("Width")).toBeNull();
  });

  it("reads Differs from work, stays expanded, and Resets the work's size", () => {
    const { props } = renderRow({ widthMm: 900 });

    expect(screen.getByText("90 cm × 30 cm")).toBeInTheDocument();
    expect(screen.getByText("Differs from work")).toBeInTheDocument();
    // Diverged numbers are never hidden behind a disclosure.
    expect(screen.getByLabelText("Width")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    // Width and Height only: depth describes how thick the board is, which the
    // work's own dimensions say nothing about.
    expect(props.onCommit).toHaveBeenCalledWith({ widthMm: 400, heightMm: 600 });
  });

  // A monitor's floor object is the CABINET, so the target is the 4:3 box the
  // work implies and all three axes travel together.
  it("compares a monitor against its cabinet and resets all three axes", () => {
    const { onCommit } = renderRow({
      isMonitor: true,
      dimensions: { widthMm: 400, heightMm: 300, status: "known" as const },
      widthMm: 1000,
      depthMm: 1000,
      heightMm: 1000
    });

    expect(screen.getByText("Differs from work")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    const changes = onCommit.mock.calls.at(-1)?.[0] as Record<string, number>;
    expect(Object.keys(changes).sort()).toEqual(["depthMm", "heightMm", "widthMm"]);
    expect(changes.depthMm).toBeGreaterThan(0);
  });

  // No recorded size means no target, so the row states the footprint and makes
  // no claim about matching — and still offers the numbers.
  it("drops the comparison clause when the work has no recorded size", () => {
    renderRow({ dimensions: { status: "unknown" } });

    expect(screen.getByText("40 cm × 30 cm")).toBeInTheDocument();
    expect(screen.queryByText(/Same as work/)).toBeNull();
    expect(screen.queryByText(/Differs from work/)).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  // The Details stale-draft trap: a draft must never outlive the selection that
  // opened it, so the expanded fields are keyed on the placement id.
  it("abandons a pending draft when the selection changes", () => {
    const onCommit = vi.fn();
    const { rerender } = renderRow({ widthMm: 900, onCommit });

    const width = screen.getByLabelText("Width");
    fireEvent.change(width, { target: { value: "123" } });

    rerender(
      <FloorArtworkFootprintRow
        dimensions={workDimensions}
        placementId="floor-b"
        widthMm={800}
        depthMm={300}
        heightMm={600}
        unit="cm"
        onCommit={onCommit}
      />
    );

    expect(screen.getByLabelText("Width")).toHaveValue("80 cm");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
