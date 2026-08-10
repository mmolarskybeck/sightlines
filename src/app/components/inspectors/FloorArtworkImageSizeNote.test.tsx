import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dimensions } from "../../../domain/project";
import { TooltipProvider } from "../ui/tooltip";
import { FloorArtworkImageSizeNote } from "./FloorArtworkImageSizeNote";

afterEach(cleanup);

// The action carries a Tooltip, and Radix's Tooltip requires a provider —
// supplied once at App's root in production (App.tsx). Wrapping here rather
// than in the component keeps the note a plain inspector child like its
// siblings. The provider renders no element of its own, so
// `toBeEmptyDOMElement` still means "this component rendered nothing".
function renderNote(element: ReactElement) {
  return render(<TooltipProvider>{element}</TooltipProvider>);
}

// 60" x 48", the size the reported case was authored at.
const WORK: Dimensions = { widthMm: 1524, heightMm: 1219.2, status: "known" };

// The same work on a board widened to 7'.
const WIDENED_BOARD = { objectWidthMm: 2133.6, objectHeightMm: 1219.2 };

const MATCH_BUTTON = { name: "Match size to work" };

describe("FloorArtworkImageSizeNote", () => {
  it("says nothing while the box is still the work's size", () => {
    // Every fresh placement lands here (placeArtworkOnFloor seeds the box from
    // the work), so this is the state the note must stay silent in — a
    // permanent explanation of a distinction that isn't yet visible would be
    // clutter on every floor-placed work in the project.
    const { container } = renderNote(
      <FloorArtworkImageSizeNote
        dimensions={WORK}
        objectWidthMm={1524}
        objectHeightMm={1219.2}
        unit="in"
        onMatchSizeToWork={vi.fn()}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("appears once the box has been resized away from the work, naming the work's size", () => {
    renderNote(
      <FloorArtworkImageSizeNote
        dimensions={WORK}
        {...WIDENED_BOARD}
        unit="in"
        onMatchSizeToWork={vi.fn()}
      />
    );

    expect(screen.getByText(/The image stays at the work's own size/)).toHaveTextContent(
      '60" × 48"'
    );
    expect(screen.getByRole("button", MATCH_BUTTON)).toBeInTheDocument();
  });

  it("appears when only the height was changed, not just the width", () => {
    renderNote(
      <FloorArtworkImageSizeNote
        dimensions={WORK}
        objectWidthMm={1524}
        objectHeightMm={2000}
        unit="in"
        onMatchSizeToWork={vi.fn()}
      />
    );

    expect(screen.getByRole("button", MATCH_BUTTON)).toBeInTheDocument();
  });

  it("ignores sub-millimetre drift from a unit round-trip", () => {
    const { container } = renderNote(
      <FloorArtworkImageSizeNote
        dimensions={WORK}
        objectWidthMm={1524.0001}
        objectHeightMm={1219.1999}
        unit="in"
        onMatchSizeToWork={vi.fn()}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("writes the work's width and height, and leaves depth out of it", () => {
    // Depth describes how thick the board or plinth is; the work's face
    // dimensions say nothing about it, so the action must not touch it.
    const onMatchSizeToWork = vi.fn();
    renderNote(
      <FloorArtworkImageSizeNote
        dimensions={{ ...WORK, depthMm: 300 }}
        {...WIDENED_BOARD}
        unit="in"
        onMatchSizeToWork={onMatchSizeToWork}
      />
    );

    fireEvent.click(screen.getByRole("button", MATCH_BUTTON));

    expect(onMatchSizeToWork).toHaveBeenCalledTimes(1);
    expect(onMatchSizeToWork).toHaveBeenCalledWith(1524, 1219.2);
  });

  it("says nothing when the work's own size is half-unknown", () => {
    // "Match the box to the work" has no target, and 3D is falling back to the
    // image's native aspect there anyway — there is no discrepancy to explain.
    for (const dimensions of [
      { widthMm: 1524, status: "approximate" } as Dimensions,
      { heightMm: 1219.2, status: "approximate" } as Dimensions,
      { status: "unknown" } as Dimensions
    ]) {
      const { container } = renderNote(
        <FloorArtworkImageSizeNote
          dimensions={dimensions}
          {...WIDENED_BOARD}
          unit="in"
          onMatchSizeToWork={vi.fn()}
        />
      );
      expect(container).toBeEmptyDOMElement();
      cleanup();
    }
  });

  it("states the work's size in the project's own unit system", () => {
    renderNote(
      <FloorArtworkImageSizeNote
        dimensions={WORK}
        {...WIDENED_BOARD}
        unit="cm"
        onMatchSizeToWork={vi.fn()}
      />
    );

    expect(screen.getByText(/The image stays at the work's own size/)).toHaveTextContent(
      "152.4 cm × 121.9 cm"
    );
  });
});
