import type { ComponentProps, ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Artwork } from "../../../domain/project";
import { MEDIUM_SUGGESTIONS } from "../../../domain/placement/mediumCategory";
import { ArtworkInspector } from "./ArtworkInspector";
import { TooltipProvider } from "../ui/tooltip";

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
    // App derives this from the surface a placed work sits on and from the
    // library flag only while it is unplaced; the default here matches the
    // unplaced baseArtwork (no depth → wall).
    placementForm: "wall",
    sectionsOpen: {},
    unit: "cm",
    onCommitDimensions: vi.fn(),
    onCommitField: vi.fn(),
    onChangePlacementForm: vi.fn(),
    onCommitFraming: vi.fn(),
    onSectionOpenChange: vi.fn(),
    ...overrides
  };
  const result = render(
    <TooltipProvider>
      <ArtworkInspector {...props} />
    </TooltipProvider>
  );

  return {
    props,
    ...result,
    rerender: (ui: ReactElement) =>
      result.rerender(<TooltipProvider>{ui}</TooltipProvider>)
  };
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

  it("complete: keeps a compact tombstone visible and toggles the details editor", () => {
    renderInspector();

    expect(screen.getByText("Portrait Study")).toBeInTheDocument();
    expect(screen.getByText("Jane Doe · 1990")).toBeInTheDocument();
    expect(screen.getByText("50 cm × 70 cm")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));

    expect(screen.getByRole("textbox", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Artist" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Date" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));

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

describe("ArtworkInspector scale status", () => {
  it("shows a compact missing-state icon when width/height are missing", () => {
    renderInspector({ artwork: { ...baseArtwork, dimensions: { status: "known" } } });

    expect(screen.getByText("Approximate scale")).toBeInTheDocument();
  });

  it("shows a compact estimated-state icon when dimensions are approximate", () => {
    renderInspector({
      artwork: { ...baseArtwork, dimensions: { widthMm: 500, heightMm: 700, status: "approximate" } }
    });

    expect(screen.getByText("Estimated scale")).toBeInTheDocument();
  });

  it("uses no header icon for the healthy true-scale state", () => {
    renderInspector();

    expect(screen.queryByText("True scale")).not.toBeInTheDocument();
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

describe("ArtworkInspector dimension utilities", () => {
  it("replaces the status dropdown with a compact Approximate checkbox", () => {
    renderInspector({
      artwork: {
        ...baseArtwork,
        dimensions: { ...baseArtwork.dimensions, status: "approximate" }
      },
      sectionsOpen: { dimensions: true }
    });

    expect(
      screen.getByRole("checkbox", { name: "Dimensions are approximate" })
    ).toBeChecked();
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
  });

  it("marks complete dimensions approximate or known while preserving their values", () => {
    const onCommitDimensions = vi.fn();
    renderInspector({
      sectionsOpen: { dimensions: true },
      onCommitDimensions
    });

    const approximate = screen.getByRole("checkbox", {
      name: "Dimensions are approximate"
    });
    fireEvent.click(approximate);
    expect(onCommitDimensions).toHaveBeenLastCalledWith({
      widthMm: 500,
      heightMm: 700,
      status: "approximate"
    });
  });

  it("hides Approximate until both width and height exist", () => {
    renderInspector({
      artwork: {
        ...baseArtwork,
        dimensions: { widthMm: 500, status: "unknown" }
      },
      sectionsOpen: { dimensions: true }
    });

    expect(
      screen.queryByRole("checkbox", { name: "Dimensions are approximate" })
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

  it("keeps frame-inclusive controls disabled without an extra notice", () => {
    renderInspector({
      artwork: { ...baseArtwork, frameIncludedInImage: true },
      sectionsOpen: { matframe: true }
    });

    expect(screen.getByRole("checkbox", { name: "Size includes the frame" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Frame finish" })).toBeDisabled();
    expect(screen.queryByText(/Frame is part of the photo/)).not.toBeInTheDocument();
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

  it("Overall reads quiet at rest and reveals W/H inputs from its edit icon", () => {
    renderInspector({ artwork: framedArtwork }); // matframe opens by default (has a frame)

    expect(screen.getByText("Overall")).toBeInTheDocument();
    expect(screen.getByText("60 cm × 80 cm")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Overall W" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Overall H" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit overall size" }));

    expect(screen.getByRole("textbox", { name: "Overall W" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Overall H" })).toBeInTheDocument();
  });
});

describe("ArtworkInspector metadata fields", () => {
  it("edits Medium in the identity block, committing it as the virtual medium key", () => {
    const onCommitField = vi.fn();
    renderInspector({
      artwork: { ...baseArtwork, metadata: { medium: "Oil on canvas" } },
      onCommitField
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));

    // Medium is stored at artwork.metadata.medium, not as a column on Artwork —
    // the field reads it from there and commits it back under the same name.
    // Its role is "combobox", not "textbox": the field carries a suggestion
    // list. It is still an ordinary free-text input — the list only offers, and
    // typed prose commits on blur exactly as every other identity field does.
    const mediumInput = screen.getByRole("combobox", { name: "Medium" });
    expect(mediumInput).toHaveValue("Oil on canvas");

    fireEvent.change(mediumInput, { target: { value: "Acrylic on linen" } });
    fireEvent.blur(mediumInput);

    expect(onCommitField).toHaveBeenCalledWith({ medium: "Acrylic on linen" });
  });

  it("clears Medium to undefined so the store deletes the metadata key", () => {
    const onCommitField = vi.fn();
    renderInspector({
      artwork: { ...baseArtwork, metadata: { medium: "Oil on canvas" } },
      onCommitField
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    const mediumInput = screen.getByRole("combobox", { name: "Medium" });
    fireEvent.change(mediumInput, { target: { value: "   " } });
    fireEvent.blur(mediumInput);

    expect(onCommitField).toHaveBeenCalledWith({ medium: undefined });
  });

  // The bug the combobox replaced the native <datalist> to fix: a browser
  // filters a datalist against the committed value, so "Photograph" filtered
  // the list down to "Photograph" and the field looked like it had no other
  // options left. An exact match must show every suggestion.
  it("shows all medium suggestions when the committed value already is one", () => {
    renderInspector({
      artwork: { ...baseArtwork, metadata: { medium: "Photograph" } },
      onCommitField: vi.fn()
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    const mediumInput = screen.getByRole("combobox", { name: "Medium" });
    expect(mediumInput).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(mediumInput, { key: "ArrowDown" });

    expect(mediumInput).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(
      MEDIUM_SUGGESTIONS
    );
    // Arrow-down landed on the first row, and the input — which keeps focus —
    // is what points at it.
    expect(mediumInput).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Photograph" }).id
    );
  });

  it("filters the medium list only while the typed value matches nothing exactly", () => {
    renderInspector({
      artwork: { ...baseArtwork, metadata: { medium: "Photograph" } },
      onCommitField: vi.fn()
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    const mediumInput = screen.getByRole("combobox", { name: "Medium" });
    fireEvent.change(mediumInput, { target: { value: "paint" } });

    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Painting"
    ]);

    // Prose matches nothing, so there is nothing to offer and no popup.
    fireEvent.change(mediumInput, { target: { value: "Oil on canvas" } });

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(mediumInput).toHaveAttribute("aria-expanded", "false");
  });

  it("commits a picked medium suggestion immediately, without waiting for a blur", () => {
    const onCommitField = vi.fn();
    renderInspector({
      artwork: { ...baseArtwork, metadata: { medium: "Photograph" } },
      onCommitField
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    const mediumInput = screen.getByRole("combobox", { name: "Medium" });
    fireEvent.click(mediumInput);
    fireEvent.click(screen.getByRole("option", { name: "Film/video" }));

    // The Display default derives from Medium, so the pick has to reach the
    // store now rather than on some later blur.
    expect(onCommitField).toHaveBeenCalledWith({ medium: "Film/video" });
    expect(mediumInput).toHaveValue("Film/video");
    expect(mediumInput).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the medium list on Escape without clobbering the typed text", () => {
    const onCommitField = vi.fn();
    renderInspector({ artwork: baseArtwork, onCommitField });

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    const mediumInput = screen.getByRole("combobox", { name: "Medium" });
    fireEvent.change(mediumInput, { target: { value: "Paint" } });
    fireEvent.keyDown(mediumInput, { key: "ArrowDown" });
    fireEvent.keyDown(mediumInput, { key: "Escape" });

    expect(mediumInput).toHaveValue("Paint");
    expect(mediumInput).toHaveAttribute("aria-expanded", "false");
    expect(onCommitField).not.toHaveBeenCalled();

    // Escape dismissed the list, not the edit: the field still commits its own
    // text on blur.
    fireEvent.blur(mediumInput);
    expect(onCommitField).toHaveBeenCalledWith({ medium: "Paint" });
  });

  it("keeps Details collapsed by default and offers Object no. / Location / Credit line inside it", () => {
    const onCommitField = vi.fn();
    const artwork = { ...baseArtwork, accessionNumber: "1990.12" };

    // Collapsed by default: App owns the open flags, and "details" has no
    // entry here, so the section falls back to closed.
    const { unmount } = renderInspector({ artwork, onCommitField });
    expect(screen.queryByRole("textbox", { name: "Credit line" })).not.toBeInTheDocument();
    unmount();

    renderInspector({ artwork, onCommitField, sectionsOpen: { details: true } });

    expect(screen.getByRole("textbox", { name: "Object no." })).toHaveValue("1990.12");
    expect(screen.getByRole("textbox", { name: "Location / lender" })).toBeInTheDocument();

    const creditInput = screen.getByRole("textbox", { name: "Credit line" });
    expect(creditInput).toHaveAttribute(
      "placeholder",
      "Courtesy of the artist and Gallery X"
    );

    fireEvent.change(creditInput, {
      target: { value: "Courtesy of the artist and Gallery X" }
    });
    fireEvent.blur(creditInput);

    expect(onCommitField).toHaveBeenCalledWith({
      creditLine: "Courtesy of the artist and Gallery X"
    });
  });
  // Regression: TextField seeds its draft once per mount, and the Details
  // fields used to be keyed on field.key alone — so changing the selection
  // kept every subsequently selected artwork showing (and, on blur, able to
  // commit) the PREVIOUS artwork's object number. The key must carry the
  // artwork id so a selection change remounts and reseeds the inputs.
  it("reseeds the Details inputs when the selected artwork changes", () => {
    const { rerender, props } = renderInspector({
      artwork: { ...baseArtwork, accessionNumber: "1787.2001" },
      sectionsOpen: { details: true }
    });

    expect(screen.getByRole("textbox", { name: "Object no." })).toHaveValue(
      "1787.2001"
    );

    rerender(
      <ArtworkInspector
        {...props}
        artwork={{
          ...baseArtwork,
          id: "artwork-2",
          title: "Smoky City",
          accessionNumber: "325.1963"
        }}
      />
    );

    expect(screen.getByRole("textbox", { name: "Object no." })).toHaveValue(
      "325.1963"
    );
  });
});
