import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WallInspector } from "./WallInspector";
import { TooltipProvider } from "../ui/tooltip";

afterEach(cleanup);

function renderInspector(
  polygonLengthEditing: boolean,
  overrides: {
    isOpenSide?: boolean;
    onOpenWall?: () => void;
    onRestoreWall?: () => void;
    onCommitHeight?: (heightMm: number) => Promise<void>;
  } = {}
) {
  const onCommitLength = vi.fn().mockResolvedValue(undefined);
  render(
    <TooltipProvider>
      <WallInspector
        centerlineMm={1450}
        changedWallNames={[]}
        dimensionLink={null}
        isOpenSide={overrides.isOpenSide ?? false}
        lastGeometryEdit={null}
        onAddCase={vi.fn()}
        onAddOpening={vi.fn()}
        onCommitHeight={overrides.onCommitHeight ?? vi.fn()}
        onCommitLength={onCommitLength}
        onOpenWall={overrides.onOpenWall ?? vi.fn()}
        onRestoreWall={overrides.onRestoreWall ?? vi.fn()}
        polygonLengthEditing={polygonLengthEditing}
        roomName="Gallery 2"
        unit="cm"
        wallHeightMm={3600}
        wallLengthMm={1500}
        wallName="Wall 3"
      />
    </TooltipProvider>
  );
  return onCommitLength;
}

describe("WallInspector open/closed states", () => {
  it("offers Open this wall on a solid wall, alongside the add chips", () => {
    const onOpenWall = vi.fn();
    renderInspector(false, { onOpenWall });

    expect(screen.queryByRole("button", { name: "Restore wall" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Door" })).toBeInTheDocument();
    expect(screen.getByText("Centerline")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open this wall" }));
    expect(onOpenWall).toHaveBeenCalledTimes(1);
  });

  it("swaps to Restore on an open wall and HIDES the whole add category", () => {
    const onRestoreWall = vi.fn();
    renderInspector(false, { isOpenSide: true, onRestoreWall });

    expect(screen.queryByRole("button", { name: "Open this wall" })).not.toBeInTheDocument();
    // Hidden, not disabled — the entire category is unavailable.
    expect(screen.queryByRole("button", { name: "Door" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wall case" })).not.toBeInTheDocument();
    // A hanging-height readout is meaningless without a surface.
    expect(screen.queryByText("Centerline")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restore wall" }));
    expect(onRestoreWall).toHaveBeenCalledTimes(1);
  });

  it("says plainly that Restore does not bring the contents back", () => {
    renderInspector(false, { isOpenSide: true });

    expect(
      screen.getByText(/brings the wall back, but not what used to hang here/i)
    ).toBeInTheDocument();
  });

  it("keeps Length and Height editable while open — the edge still shapes the room", async () => {
    const onCommitHeight = vi.fn().mockResolvedValue(undefined);
    const onCommitLength = renderInspector(false, { isOpenSide: true, onCommitHeight });

    const lengthInput = screen.getByRole("textbox", { name: "Length" });
    expect(lengthInput).toBeEnabled();
    fireEvent.change(lengthInput, { target: { value: "200" } });
    fireEvent.blur(lengthInput);
    await waitFor(() => expect(onCommitLength).toHaveBeenCalled());

    const heightInput = screen.getByRole("textbox", { name: "Height" });
    expect(heightInput).toBeEnabled();
  });
});

describe("WallInspector wall length anchor", () => {
  it("reveals the moving-endpoint choice while editing an irregular wall", async () => {
    const onCommitLength = renderInspector(true);
    const lengthInput = screen.getByRole("textbox", { name: "Length" });

    expect(screen.queryByRole("radiogroup", { name: "Move endpoint" })).not.toBeInTheDocument();

    fireEvent.focus(lengthInput);

    expect(screen.getByRole("radio", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "End", checked: true })).toBeInTheDocument();
    expect(screen.getByText("The other endpoint stays in place.")).toBeInTheDocument();

    fireEvent.change(lengthInput, { target: { value: "2 m" } });
    fireEvent.blur(lengthInput);

    await waitFor(() => expect(onCommitLength).toHaveBeenCalledWith(2000, "start"));
    expect(screen.queryByRole("radiogroup", { name: "Move endpoint" })).not.toBeInTheDocument();
  });

  it("maps the selected moving endpoint to the opposite fixed anchor", async () => {
    const onCommitLength = renderInspector(true);
    const lengthInput = screen.getByRole("textbox", { name: "Length" });

    fireEvent.focus(lengthInput);
    fireEvent.click(screen.getByRole("radio", { name: "Start" }));
    fireEvent.change(lengthInput, { target: { value: "2 m" } });
    fireEvent.blur(lengthInput);

    await waitFor(() => expect(onCommitLength).toHaveBeenCalledWith(2000, "end"));
  });

  it("keeps the choice available while focus moves from Length to an endpoint", () => {
    renderInspector(true);
    const lengthInput = screen.getByRole("textbox", { name: "Length" });

    fireEvent.focus(lengthInput);
    const startOption = screen.getByRole("radio", { name: "Start" });
    fireEvent.blur(lengthInput, { relatedTarget: startOption });
    fireEvent.focus(startOption);

    expect(screen.getByRole("radiogroup", { name: "Move endpoint" })).toBeInTheDocument();
  });

  it("uses an endpoint chosen as the dirty Length field loses focus", async () => {
    const onCommitLength = renderInspector(true);
    const lengthInput = screen.getByRole("textbox", { name: "Length" });

    fireEvent.focus(lengthInput);
    fireEvent.change(lengthInput, { target: { value: "2 m" } });
    const startOption = screen.getByRole("radio", { name: "Start" });
    fireEvent.pointerDown(startOption);
    fireEvent.blur(lengthInput, { relatedTarget: startOption });
    fireEvent.click(startOption);

    await waitFor(() => expect(onCommitLength).toHaveBeenCalledWith(2000, "end"));
  });

  it("keeps the choice visible for a dirty value and a validation error", async () => {
    renderInspector(true);
    const lengthInput = screen.getByRole("textbox", { name: "Length" });

    fireEvent.focus(lengthInput);
    fireEvent.change(lengthInput, { target: { value: "not a length" } });
    fireEvent.blur(lengthInput);

    expect(screen.getByRole("radiogroup", { name: "Move endpoint" })).toBeInTheDocument();
    await waitFor(() => expect(lengthInput).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByRole("radiogroup", { name: "Move endpoint" })).toBeInTheDocument();
  });

  it("retains rectangle behavior without showing an anchor choice", async () => {
    const onCommitLength = renderInspector(false);

    fireEvent.focus(screen.getByRole("textbox", { name: "Length" }));
    expect(screen.queryByRole("radiogroup", { name: "Move endpoint" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Length" }), {
      target: { value: "2 m" }
    });
    fireEvent.blur(screen.getByRole("textbox", { name: "Length" }));

    await waitFor(() => expect(onCommitLength).toHaveBeenCalledWith(2000, "start"));
  });
});
