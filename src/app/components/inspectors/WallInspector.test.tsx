import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WallInspector } from "./WallInspector";
import { TooltipProvider } from "../ui/tooltip";

afterEach(cleanup);

function renderInspector(polygonLengthEditing: boolean) {
  const onCommitLength = vi.fn().mockResolvedValue(undefined);
  render(
    <TooltipProvider>
      <WallInspector
        centerlineMm={1450}
        changedWallNames={[]}
        dimensionLink={null}
        lastGeometryEdit={null}
        onAddOpening={vi.fn()}
        onCommitHeight={vi.fn()}
        onCommitLength={onCommitLength}
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
