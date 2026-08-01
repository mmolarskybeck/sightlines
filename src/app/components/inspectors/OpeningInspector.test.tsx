import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OpeningFit } from "../../../domain/placement/fitOpeningOnWall";
import type { OpeningWallObject } from "../../../domain/project";
import { OpeningInspector, type OpeningConnectionCandidate } from "./OpeningInspector";

const door: OpeningWallObject = {
  id: "door-a",
  kind: "door",
  blocksPlacement: true,
  wallId: "wall-a",
  xMm: 1000,
  yMm: 1000,
  widthMm: 900,
  heightMm: 2000
};

const candidate: OpeningConnectionCandidate = {
  id: "door-b",
  label: "Gallery 2 — West wall",
  alignment: {
    status: "aligned",
    clearA: { xMinMm: 550, xMaxMm: 1450 },
    clearB: { xMinMm: 1550, xMaxMm: 2450 }
  }
};

function props(opening: OpeningWallObject = door) {
  return {
    opening,
    unit: "m" as const,
    wallLengthMm: 6000,
    connectionCandidates: [candidate],
    onCommitPosition: vi.fn().mockResolvedValue(null),
    onCommitSize: vi.fn().mockResolvedValue(null),
    onFitToWall: vi.fn().mockResolvedValue(null),
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onDelete: vi.fn()
  };
}

describe("OpeningInspector connections", () => {
  it("keeps the connection select controlled as an opening becomes paired", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const rendered = render(<OpeningInspector {...props()} />);

    expect(screen.getByRole("combobox", { name: "Connect door to" })).toBeTruthy();

    rendered.rerender(
      <OpeningInspector
        {...props({ ...door, connectsToObjectId: "door-b" })}
      />
    );

    expect(screen.getByRole("status").textContent).toBe("Aligned");
    expect(
      consoleError.mock.calls.some((call) => String(call[0]).includes("uncontrolled"))
    ).toBe(false);
    consoleError.mockRestore();
  });

  it("does not emit a connection change when selection moves between paired openings", () => {
    const firstOnConnect = vi.fn();
    const secondOnConnect = vi.fn();
    const rendered = render(
      <OpeningInspector
        {...props({ ...door, connectsToObjectId: "door-b" })}
        onConnect={firstOnConnect}
      />
    );

    const nextPartner: OpeningConnectionCandidate = {
      ...candidate,
      id: "door-d",
      label: "Gallery 3, South wall"
    };
    rendered.rerender(
      <OpeningInspector
        {...props({
          ...door,
          id: "door-c",
          wallId: "wall-c",
          connectsToObjectId: nextPartner.id
        })}
        connectionCandidates={[nextPartner]}
        onConnect={secondOnConnect}
      />
    );

    expect(firstOnConnect).not.toHaveBeenCalled();
    expect(secondOnConnect).not.toHaveBeenCalled();
  });
});

describe("OpeningInspector width fitting", () => {
  const widthField = () => screen.getByRole("textbox", { name: /Width/ });

  // A door on a 4 m wall, asked for 6 m and trimmed to fit. Metric opening
  // sizes display in cm (getScopeUnits), so notes read "400 cm".
  const clampedToWall: OpeningFit = {
    requestedWidthMm: 6000,
    widthMm: 4000,
    xMm: 2000,
    widthClamped: true,
    positionAdjusted: true,
    movedByMm: 1000,
    constraint: "wall"
  };

  const slidToFit: OpeningFit = {
    requestedWidthMm: 3000,
    widthMm: 3000,
    xMm: 1500,
    widthClamped: false,
    positionAdjusted: true,
    movedByMm: 500,
    constraint: "wall"
  };

  async function commitWidth(text: string) {
    const field = widthField();
    fireEvent.change(field, { target: { value: text } });
    fireEvent.blur(field);
  }

  it("explains a width that was trimmed to the wall", async () => {
    const onCommitSize = vi.fn().mockResolvedValue(clampedToWall);
    render(<OpeningInspector {...props()} onCommitSize={onCommitSize} />);

    await commitWidth("6 m");

    expect(onCommitSize).toHaveBeenCalledWith(6000, door.heightMm);
    expect(
      await screen.findByText("Limited to 400 cm, the maximum width for this wall.")
    ).toBeTruthy();
  });

  it("explains a width that was kept but slid along the wall", async () => {
    const onCommitSize = vi.fn().mockResolvedValue(slidToFit);
    render(<OpeningInspector {...props()} onCommitSize={onCommitSize} />);

    await commitWidth("3 m");

    expect(await screen.findByText("Moved 50 cm to fit the wall.")).toBeTruthy();
  });

  it("names the facing wall when a paired opening is the binding constraint", async () => {
    const onCommitSize = vi
      .fn()
      .mockResolvedValue({ ...clampedToWall, constraint: "paired-wall" });
    render(<OpeningInspector {...props()} onCommitSize={onCommitSize} />);

    await commitWidth("6 m");

    expect(await screen.findByText("Limited to 400 cm by the facing wall.")).toBeTruthy();
  });

  it("stays silent when the committed width is exactly what was asked for", async () => {
    const onCommitSize = vi.fn().mockResolvedValue({
      ...slidToFit,
      positionAdjusted: false,
      movedByMm: 0,
      constraint: "none"
    });
    render(<OpeningInspector {...props()} onCommitSize={onCommitSize} />);

    await commitWidth("3 m");
    await screen.findByDisplayValue("300 cm");

    expect(screen.queryByText(/to fit the wall/)).toBeNull();
    expect(screen.queryByText(/^Limited to/)).toBeNull();
  });

  // The note must survive the value resync that fires when the corrected value
  // arrives from the store, and clear only when the next edit begins.
  it("keeps the note through a corrected-value rerender and clears it on the next edit", async () => {
    const onCommitSize = vi.fn().mockResolvedValue(clampedToWall);
    const rendered = render(
      <OpeningInspector {...props()} onCommitSize={onCommitSize} />
    );

    await commitWidth("6 m");
    await screen.findByText("Limited to 400 cm, the maximum width for this wall.");

    // The store now reports the trimmed width back down.
    rendered.rerender(
      <OpeningInspector
        {...props({ ...door, widthMm: 4000, xMm: 2000 })}
        onCommitSize={onCommitSize}
      />
    );
    expect(
      screen.getByText("Limited to 400 cm, the maximum width for this wall.")
    ).toBeTruthy();

    fireEvent.change(widthField(), { target: { value: "2 m" } });
    expect(screen.queryByText(/^Limited to/)).toBeNull();
  });

  it("fills the available span from the Fit wall action and reports the result", async () => {
    const onFitToWall = vi.fn().mockResolvedValue({
      ...clampedToWall,
      constraint: "neighbor"
    });
    render(<OpeningInspector {...props()} onFitToWall={onFitToWall} />);

    fireEvent.click(screen.getByRole("button", { name: "Fit wall" }));

    expect(onFitToWall).toHaveBeenCalled();
    expect(
      await screen.findByText("Limited to 400 cm by the opening beside it.")
    ).toBeTruthy();
  });
});
