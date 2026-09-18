import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WallInspector } from "./WallInspector";
import { TooltipProvider } from "../ui/tooltip";

afterEach(cleanup);

function renderInspector(
  polygonLengthEditing: boolean,
  overrides: {
    canSetNorth?: boolean;
    isOpenSide?: boolean;
    onOpenWall?: () => void;
    onRenameWall?: (name: string) => void;
    onRestoreWall?: () => void;
    onSetNorthWall?: () => void;
    onCommitHeight?: (heightMm: number) => Promise<void>;
    onAddShelf?: () => void;
  } = {}
) {
  const onCommitLength = vi.fn().mockResolvedValue(undefined);
  render(
    <TooltipProvider>
      <WallInspector
        canSetNorth={overrides.canSetNorth ?? false}
        centerlineMm={1450}
        changedWallNames={[]}
        dimensionLink={null}
        isOpenSide={overrides.isOpenSide ?? false}
        lastGeometryEdit={null}
        onAddCase={vi.fn()}
        onAddOpening={vi.fn()}
        onAddShelf={overrides.onAddShelf ?? vi.fn()}
        onCommitHeight={overrides.onCommitHeight ?? vi.fn()}
        onCommitLength={onCommitLength}
        onOpenWall={overrides.onOpenWall ?? vi.fn()}
        onRenameWall={overrides.onRenameWall ?? vi.fn()}
        onRestoreWall={overrides.onRestoreWall ?? vi.fn()}
        onSetNorthWall={overrides.onSetNorthWall ?? vi.fn()}
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

  // The shelf chip sits in the same "Add to this wall" category as the case,
  // so a shelf can be created without arming the Insert tool.
  it("fires onAddShelf from the Shelf chip", () => {
    const onAddShelf = vi.fn();
    renderInspector(false, { onAddShelf });

    fireEvent.click(screen.getByRole("button", { name: "Shelf" }));
    expect(onAddShelf).toHaveBeenCalledTimes(1);
  });

  it("swaps to Restore on an open wall and HIDES the whole add category", () => {
    const onRestoreWall = vi.fn();
    renderInspector(false, { isOpenSide: true, onRestoreWall });

    expect(screen.queryByRole("button", { name: "Open this wall" })).not.toBeInTheDocument();
    // Hidden, not disabled — the entire category is unavailable.
    expect(screen.queryByRole("button", { name: "Door" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wall case" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Shelf" })).not.toBeInTheDocument();
    // A hanging-height readout is meaningless without a surface.
    expect(screen.queryByText("Centerline")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restore wall" }));
    expect(onRestoreWall).toHaveBeenCalledTimes(1);
  });

  it("says plainly that Restore does not bring the contents back", () => {
    renderInspector(false, { isOpenSide: true });

    expect(
      screen.getByText(/will rebuild that surface, but not what was on it/i)
    ).toBeInTheDocument();
    // The other half of the promise: undo is the only route to the contents.
    expect(screen.getByText(/Only undo will bring those back/i)).toBeInTheDocument();
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

// The name field is the only prop-driven value in this inspector, so it gets a
// harness that can re-render with a new committed name.
function renderNamed(wallName: string) {
  const onRenameWall = vi.fn();
  const element = (name: string) => (
    <TooltipProvider>
      <WallInspector
        centerlineMm={1450}
        changedWallNames={[]}
        dimensionLink={null}
        lastGeometryEdit={null}
        onAddCase={vi.fn()}
        onAddOpening={vi.fn()}
        onAddShelf={vi.fn()}
        onCommitHeight={vi.fn()}
        onCommitLength={vi.fn().mockResolvedValue(undefined)}
        onOpenWall={vi.fn()}
        onRenameWall={onRenameWall}
        onRestoreWall={vi.fn()}
        onSetNorthWall={vi.fn()}
        roomName="Gallery 2"
        unit="cm"
        wallHeightMm={3600}
        wallLengthMm={1500}
        wallName={name}
      />
    </TooltipProvider>
  );
  const view = render(element(wallName));
  return { onRenameWall, rerender: (name: string) => view.rerender(element(name)) };
}

describe("WallInspector name field", () => {
  it("commits a trimmed name on blur", () => {
    const onRenameWall = vi.fn();
    renderInspector(false, { onRenameWall });

    const field = screen.getByLabelText("Name");
    fireEvent.change(field, { target: { value: "  Entrance wall  " } });
    fireEvent.blur(field);

    expect(onRenameWall).toHaveBeenCalledWith("Entrance wall");
  });

  it("commits on Enter", () => {
    const onRenameWall = vi.fn();
    renderInspector(false, { onRenameWall });

    const field = screen.getByLabelText("Name");
    fireEvent.change(field, { target: { value: "Entrance wall" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.blur(field);

    expect(onRenameWall).toHaveBeenCalledWith("Entrance wall");
  });

  it("reverts a pending edit on Escape and commits nothing", () => {
    const onRenameWall = vi.fn();
    renderInspector(false, { onRenameWall });

    const field = screen.getByLabelText("Name");
    fireEvent.change(field, { target: { value: "Entrance wall" } });
    fireEvent.keyDown(field, { key: "Escape" });

    expect(field).toHaveValue("Wall 3");
    fireEvent.blur(field);
    expect(onRenameWall).not.toHaveBeenCalled();
  });

  // The inspector is keyed on the wall id, so a rename from the rooms panel
  // (or an undo) keeps it mounted — the draft has to follow the store, or a
  // later blur would commit the stale name back over it.
  it("resyncs when the name changes out from under it", () => {
    const { rerender } = renderNamed("Wall 3");

    rerender("Entrance wall");

    expect(screen.getByLabelText("Name")).toHaveValue("Entrance wall");
  });

  // A wall must always be named, so an empty field is a revert, not a clear.
  it("restores the committed name rather than clearing it", () => {
    const onRenameWall = vi.fn();
    renderInspector(false, { onRenameWall });

    const field = screen.getByLabelText("Name");
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.blur(field);

    expect(field).toHaveValue("Wall 3");
    expect(onRenameWall).not.toHaveBeenCalled();
  });
});

describe("WallInspector North wall action", () => {
  it("offers Use as North wall only for a room that can carry a compass", () => {
    const onSetNorthWall = vi.fn();
    renderInspector(false, { canSetNorth: true, onSetNorthWall });

    fireEvent.click(screen.getByRole("button", { name: "Use as North wall" }));
    expect(onSetNorthWall).toHaveBeenCalledTimes(1);
  });

  it("hides it when the room is not a quadrilateral", () => {
    renderInspector(false);
    expect(
      screen.queryByRole("button", { name: "Use as North wall" })
    ).not.toBeInTheDocument();
  });

  // The wall record survives opening, so it can still be the room's north.
  it("keeps it on an open wall, where Open this wall is gone", () => {
    renderInspector(false, { canSetNorth: true, isOpenSide: true });

    expect(screen.getByRole("button", { name: "Use as North wall" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open this wall" })
    ).not.toBeInTheDocument();
  });
});
