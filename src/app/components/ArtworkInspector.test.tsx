import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Artwork } from "../../domain/project";
import { ArtworkInspector } from "./ArtworkInspector";

afterEach(cleanup);

// A fully complete record: title + artist + date, and known width/height —
// isArtworkRecordComplete(baseArtwork) is true and getArtworkScaleState is
// "true". No assetId, so useArtworkAsset's effect resolves synchronously to
// no asset/thumbnail without touching IndexedDB.
const baseArtwork: Artwork = {
  id: "artwork-1",
  schemaVersion: 1,
  title: "Portrait Study",
  artist: "Jane Doe",
  date: "1990",
  dimensions: { widthMm: 500, heightMm: 700, status: "known" },
  metadata: {}
};

function renderInspector(overrides: Partial<ComponentProps<typeof ArtworkInspector>> = {}) {
  const props: ComponentProps<typeof ArtworkInspector> = {
    artwork: baseArtwork,
    isPlaced: false,
    sectionsOpen: {},
    unit: "cm",
    onCommitDimensions: vi.fn(),
    onCommitField: vi.fn(),
    onChangePlacementForm: vi.fn(),
    onCommitFraming: vi.fn(),
    onSectionOpenChange: vi.fn(),
    ...overrides
  };
  return { props, ...render(<ArtworkInspector {...props} />) };
}

describe("ArtworkInspector identity", () => {
  it("incomplete (no title): shows Title/Artist/Date inputs and no Edit details button", () => {
    renderInspector({ artwork: { ...baseArtwork, title: undefined } });

    expect(screen.getByRole("textbox", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Artist" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Date" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
  });

  it("incomplete (missing dims): shows Title/Artist/Date inputs and no Edit details button", () => {
    renderInspector({ artwork: { ...baseArtwork, dimensions: { status: "known" } } });

    expect(screen.getByRole("textbox", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Artist" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Date" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
  });

  it("complete: compacts to an Artist · Date summary with an Edit details affordance, and Done returns to compact", () => {
    renderInspector();

    expect(screen.getByText("Jane Doe · 1990")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));

    expect(screen.getByRole("textbox", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Artist" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Date" })).toBeInTheDocument();
    const doneButton = screen.getByRole("button", { name: "Done" });
    expect(doneButton).toBeInTheDocument();

    fireEvent.click(doneButton);

    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    expect(screen.getByText("Jane Doe · 1990")).toBeInTheDocument();
  });

  it("anti-yank: focusing an identity field mid-edit keeps fields expanded even after the record becomes complete", () => {
    const onCommitField = vi.fn();
    const incomplete: Artwork = { ...baseArtwork, title: undefined };
    const { rerender, props } = renderInspector({ artwork: incomplete, onCommitField });

    // Incomplete record: fields are already showing. Focus Title (the
    // anti-yank latch), type a title, and commit on blur.
    const titleInput = screen.getByRole("textbox", { name: "Title" });
    fireEvent.focus(titleInput);
    fireEvent.change(titleInput, { target: { value: "New Title" } });
    fireEvent.blur(titleInput);

    expect(onCommitField).toHaveBeenCalledWith({ title: "New Title" });

    // Simulate the parent applying the commit: a new artwork object, same id,
    // now complete (has both title and dims).
    const nowComplete: Artwork = { ...incomplete, title: "New Title" };
    rerender(<ArtworkInspector {...props} artwork={nowComplete} />);

    // The record is complete now, but the focus-latched userEditing state
    // must survive the prop swap (same artwork.id => ArtworkIdentity is not
    // remounted) — fields stay expanded rather than snapping to compact.
    expect(screen.getByRole("textbox", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Artist" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Date" })).toBeInTheDocument();
  });

  it("resets the explicit-edit latch when the artwork id changes", () => {
    const { rerender, props } = renderInspector(); // complete, starts compact

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    expect(screen.getByRole("textbox", { name: "Title" })).toBeInTheDocument();

    // A different artwork id (also complete) — ArtworkIdentity is keyed on
    // artwork.id, so this remounts and userEditing resets to false.
    const otherArtwork: Artwork = { ...baseArtwork, id: "artwork-2" };
    rerender(<ArtworkInspector {...props} artwork={otherArtwork} />);

    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit details" })).toBeInTheDocument();
  });
});

describe("ArtworkInspector scale badge", () => {
  it("reads 'No dims — approx. scale' (with a visually-hidden 'approximate') when width/height are missing", () => {
    renderInspector({ artwork: { ...baseArtwork, dimensions: { status: "known" } } });

    const badge = screen.getByTitle(
      "No dimensions — the artwork is drawn at an approximate scale"
    );
    expect(badge).toBeInTheDocument();
    expect(badge.querySelector(".visually-hidden")?.textContent).toBe("approximate");
  });

  it("reads 'Estimated scale' when dims are present but status is approximate", () => {
    renderInspector({
      artwork: { ...baseArtwork, dimensions: { widthMm: 500, heightMm: 700, status: "approximate" } }
    });

    expect(screen.getByText("Estimated scale")).toBeInTheDocument();
  });

  it("reads 'True scale' when dims are present and status is known", () => {
    renderInspector();

    expect(screen.getByText("True scale")).toBeInTheDocument();
  });
});

describe("ArtworkInspector missing-dims notice", () => {
  it("shows the caution notice only when the scale state is missing (Dimensions open)", () => {
    renderInspector({
      artwork: { ...baseArtwork, dimensions: { status: "known" } },
      sectionsOpen: { dimensions: true }
    });

    expect(
      screen.getByText("Add width and height to show this artwork at true scale.")
    ).toBeInTheDocument();
  });

  it("omits the notice when the scale state is not missing", () => {
    renderInspector({ sectionsOpen: { dimensions: true } });

    expect(
      screen.queryByText("Add width and height to show this artwork at true scale.")
    ).not.toBeInTheDocument();
  });

  it("omits the notice body while Dimensions starts collapsed", () => {
    renderInspector({
      artwork: { ...baseArtwork, dimensions: { status: "known" } },
      sectionsOpen: { dimensions: false }
    });

    expect(
      screen.queryByText("Add width and height to show this artwork at true scale.")
    ).not.toBeInTheDocument();
  });
});

describe("ArtworkInspector framing auto-collapse", () => {
  it("collapses Mat & frame by default for an unframed artwork", () => {
    renderInspector(); // baseArtwork has no matWidthMm/frame, sectionsOpen={}

    expect(screen.queryByRole("textbox", { name: "Mat" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Frame" })).not.toBeInTheDocument();
  });

  it("opens Mat & frame by default when the artwork already has a mat", () => {
    renderInspector({ artwork: { ...baseArtwork, matWidthMm: 50 } });

    expect(screen.getByRole("textbox", { name: "Mat" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Frame" })).toBeInTheDocument();
  });

  it("explicit sectionsOpen.matframe=false forces it closed even with a mat present", () => {
    renderInspector({
      artwork: { ...baseArtwork, matWidthMm: 50 },
      sectionsOpen: { matframe: false }
    });

    expect(screen.queryByRole("textbox", { name: "Mat" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Frame" })).not.toBeInTheDocument();
  });

  it("explicit sectionsOpen.matframe=true forces it open even when unframed", () => {
    renderInspector({ sectionsOpen: { matframe: true } });

    expect(screen.getByRole("textbox", { name: "Mat" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Frame" })).toBeInTheDocument();
  });
});

describe("ArtworkInspector placement", () => {
  it("placed: the Type control leads the placement section, before the injected content; remove uses removeLabel", () => {
    renderInspector({
      isPlaced: true,
      placementSection: <div data-testid="injected-position-fields">Position fields</div>,
      placementTitle: "Position on North wall",
      removeLabel: "Remove from floor"
    });

    expect(screen.getByText("Position on North wall")).toBeInTheDocument();

    const typeControl = screen.getByRole("radiogroup", { name: "Placement type" });
    const injected = screen.getByTestId("injected-position-fields");
    // DOM order: the Type row must precede the injected placement fields.
    expect(
      typeControl.compareDocumentPosition(injected) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    expect(screen.getByRole("button", { name: "Remove from floor" })).toBeInTheDocument();
  });

  it("unplaced: shows the not-placed notice and the Type control, with no remove button", () => {
    renderInspector({ isPlaced: false });

    expect(screen.getByText(/Not placed yet/)).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Placement type" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove from/ })).not.toBeInTheDocument();
  });
});

describe("ArtworkInspector overall disclosure", () => {
  const framedArtwork: Artwork = {
    ...baseArtwork,
    dimensions: { widthMm: 500, heightMm: 700, status: "known" },
    frame: { widthMm: 50, finish: "black" }
  };

  it("Overall reads quiet at rest and reveals W/H inputs only after Set…", () => {
    renderInspector({ artwork: framedArtwork }); // matframe opens by default (has a frame)

    expect(screen.getByText("Overall")).toBeInTheDocument();
    expect(screen.getByText("60 cm × 80 cm")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Overall W" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Overall H" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Set…" }));

    expect(screen.getByRole("textbox", { name: "Overall W" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Overall H" })).toBeInTheDocument();
  });
});
