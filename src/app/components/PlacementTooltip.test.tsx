import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Artwork } from "../../domain/project";
import { ArtworkTooltipContent } from "./PlacementTooltip";

afterEach(cleanup);

// 36" x 24" image; mat 3" + frame 1" per side -> overall 44" x 32" (matches
// the round-number fixture used in artworkInspectorSummaries.test.ts).
const baseArtwork: Artwork = {
  id: "artwork-1",
  schemaVersion: 1,
  title: "Portrait Study",
  dimensions: { widthMm: 914.4, heightMm: 609.6, status: "known" },
  metadata: {}
};

describe("ArtworkTooltipContent", () => {
  it("shows exactly one dims line for an unframed work", () => {
    render(
      <ArtworkTooltipContent artwork={baseArtwork} dimensions={baseArtwork.dimensions} unit="in" />
    );

    expect(screen.getByText('36" × 24"')).toBeInTheDocument();
    expect(screen.queryByText(/overall/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Image/)).not.toBeInTheDocument();
  });

  it("shows both the image dims and the overall dims for a framed work", () => {
    const framed: Artwork = {
      ...baseArtwork,
      matWidthMm: 76.2,
      frame: { widthMm: 25.4, finish: "gold" }
    };

    render(<ArtworkTooltipContent artwork={framed} dimensions={framed.dimensions} unit="in" />);

    expect(screen.getByText('Image 36" × 24"')).toBeInTheDocument();
    expect(screen.getByText('Overall 44" × 32"')).toBeInTheDocument();
  });

  it("does not render an overall line when an axis is unknown", () => {
    const framed: Artwork = {
      ...baseArtwork,
      matWidthMm: 76.2,
      frame: { widthMm: 25.4, finish: "gold" },
      dimensions: { widthMm: 914.4, status: "approximate" }
    };

    render(<ArtworkTooltipContent artwork={framed} dimensions={framed.dimensions} unit="in" />);

    expect(screen.queryByText('36" × 24"', { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText(/overall/i)).not.toBeInTheDocument();
  });

  it("shows a single, unlabeled dims line for a frame-inclusive work despite a stored frame", () => {
    // frameIncludedInImage collapses the overall onto the image size, so the
    // tooltip states one number even though a mat/frame is stored on the record.
    const framed: Artwork = {
      ...baseArtwork,
      matWidthMm: 76.2,
      frame: { widthMm: 25.4, finish: "gold" },
      frameIncludedInImage: true
    };

    render(<ArtworkTooltipContent artwork={framed} dimensions={framed.dimensions} unit="in" />);

    expect(screen.getByText('36" × 24"')).toBeInTheDocument();
    expect(screen.queryByText(/overall/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Image/)).not.toBeInTheDocument();
  });
});
