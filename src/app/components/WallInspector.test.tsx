import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WallInspector } from "./WallInspector";
import { TooltipProvider } from "./ui/tooltip";

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
  it("shows an explicit start/end choice for an irregular room and defaults to start", async () => {
    const onCommitLength = renderInspector(true);

    expect(screen.getByRole("radio", { name: "Start", checked: true })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "End" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Length" }), {
      target: { value: "2 m" }
    });
    fireEvent.blur(screen.getByRole("textbox", { name: "Length" }));

    await waitFor(() => expect(onCommitLength).toHaveBeenCalledWith(2000, "start"));
  });

  it("commits with the selected end anchor", async () => {
    const onCommitLength = renderInspector(true);

    fireEvent.click(screen.getByRole("radio", { name: "End" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Length" }), {
      target: { value: "2 m" }
    });
    fireEvent.blur(screen.getByRole("textbox", { name: "Length" }));

    await waitFor(() => expect(onCommitLength).toHaveBeenCalledWith(2000, "end"));
  });

  it("retains rectangle behavior without showing an anchor choice", async () => {
    const onCommitLength = renderInspector(false);

    expect(screen.queryByRole("radiogroup", { name: "Keep fixed" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Length" }), {
      target: { value: "2 m" }
    });
    fireEvent.blur(screen.getByRole("textbox", { name: "Length" }));

    await waitFor(() => expect(onCommitLength).toHaveBeenCalledWith(2000, "start"));
  });
});
