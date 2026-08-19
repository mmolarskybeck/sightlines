import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ArtworkConflict, PreparedAssetSave } from "../../../domain/package/importPackage";
import type { Artwork } from "../../../domain/project";
import { ImportConflictDialog } from "./ImportConflictDialog";

afterEach(cleanup);

// jsdom ships no object-URL implementation; the dialog only needs the two
// calls to exist so the incoming-thumbnail effect can run and clean up.
beforeAll(() => {
  const urls = globalThis.URL as unknown as {
    createObjectURL?: (blob: Blob) => string;
    revokeObjectURL?: (url: string) => void;
  };
  if (!urls.createObjectURL) {
    let next = 0;
    urls.createObjectURL = () => `blob:test/${next++}`;
    urls.revokeObjectURL = () => {};
  }
});

function makeArtwork(id: string, overrides: Partial<Artwork> = {}): Artwork {
  return {
    id,
    schemaVersion: 1,
    title: "Study",
    artist: "A. Painter",
    dimensions: { widthMm: 254, heightMm: 508, status: "known" },
    metadata: {},
    ...overrides
  };
}

function makeConflict(
  id: string,
  existing: Partial<Artwork>,
  incoming: Partial<Artwork>,
  imageChanged = false
): ArtworkConflict {
  return {
    existing: makeArtwork(id, existing),
    incoming: makeArtwork(id, incoming),
    imageChanged
  };
}

function renderDialog(
  conflicts: ArtworkConflict[],
  overrides: Partial<Parameters<typeof ImportConflictDialog>[0]> = {}
) {
  const onResolve = vi.fn();
  const onDismiss = vi.fn();
  render(
    <ImportConflictDialog
      conflicts={conflicts}
      unit="in"
      onDismiss={onDismiss}
      onResolve={onResolve}
      {...overrides}
    />
  );
  return { onResolve, onDismiss };
}

function choiceGroup(label: string) {
  return within(screen.getByRole("radiogroup", { name: label }));
}

// Rows collapse their diff by default, so the header button is how a test
// reaches the field list. Its accessible name is the title line plus the
// collapsed summary, hence the prefix match.
function rowToggles(titleLine: string) {
  return screen.queryAllByRole("button", {
    name: new RegExp(`^${titleLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
  });
}

function expandRow(titleLine: string, index = 0) {
  fireEvent.click(rowToggles(titleLine)[index]!);
}

// The diff values and the collapsed summary both mix text with quieter inline
// spans, so match on the element's full textContent rather than on the direct
// text nodes getByText reads by default.
function textOf(selector: string, pattern: RegExp) {
  return screen.getByText(
    (_content, element) =>
      element instanceof HTMLElement &&
      element.matches(selector) &&
      pattern.test(element.textContent ?? "")
  );
}

// art-2 is byte-identical on both sides: a conflict whose difference lies
// outside the fields this diff lists, so it has nothing to expand.
const TWO_CONFLICTS = [
  makeConflict("art-1", { title: "First" }, { title: "First (revised)" }),
  makeConflict("art-2", { title: "Second" }, { title: "Second" })
];

describe("ImportConflictDialog", () => {
  it("renders nothing when there are no conflicts", () => {
    const { container } = render(
      <ImportConflictDialog conflicts={[]} onDismiss={vi.fn()} onResolve={vi.fn()} />
    );
    expect(container.textContent).toBe("");
  });

  it("passes the per-row choices to onResolve", () => {
    const { onResolve } = renderDialog(TWO_CONFLICTS);

    fireEvent.click(
      choiceGroup("Resolution for First, A. Painter").getByRole("radio", { name: "Use theirs" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(onResolve).toHaveBeenCalledWith({ "art-1": "theirs" });
  });

  // Radix's single toggle emits "" when the ACTIVE segment is clicked again;
  // these choices have no empty state, so a re-click must keep the value.
  it("re-clicking the selected segment keeps that choice", () => {
    const { onResolve } = renderDialog(TWO_CONFLICTS);

    const group = choiceGroup("Resolution for First, A. Painter");
    const theirs = group.getByRole("radio", { name: "Use theirs" });
    fireEvent.click(theirs);
    fireEvent.click(theirs);

    expect(theirs.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(onResolve).toHaveBeenCalledWith({ "art-1": "theirs" });
  });

  it("defaults every unresolved row to keep mine", () => {
    renderDialog(TWO_CONFLICTS);
    expect(
      choiceGroup("Resolution for First, A. Painter")
        .getByRole("radio", { name: "Keep mine" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  it("apply-to-all sets every row, and a row can still be changed afterwards", () => {
    const { onResolve } = renderDialog(TWO_CONFLICTS);

    fireEvent.click(
      choiceGroup("Resolution for all artworks").getByRole("radio", { name: "Keep both" })
    );
    fireEvent.click(
      choiceGroup("Resolution for Second, A. Painter").getByRole("radio", { name: "Use theirs" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(onResolve).toHaveBeenCalledWith({ "art-1": "both", "art-2": "theirs" });
  });

  it("hides the apply-to-all control for a single conflict", () => {
    renderDialog([TWO_CONFLICTS[0]!]);
    expect(screen.queryByRole("radiogroup", { name: "Resolution for all artworks" })).toBeNull();
  });

  it("lists only the fields that differ, both sides on one line", () => {
    renderDialog([
      makeConflict(
        "art-1",
        { title: "First", date: "1998", accessionNumber: "A.1" },
        { title: "First", date: "1999", accessionNumber: "A.1" }
      )
    ]);
    expandRow("First, A. Painter");

    expect(screen.getByText("Date")).toBeTruthy();
    expect(textOf("dd", /Yours: 1998/)).toBeTruthy();
    expect(textOf("dd", /Theirs: 1999/)).toBeTruthy();
    // Unchanged fields stay out of the way.
    expect(screen.queryByText("Accession")).toBeNull();
    expect(screen.queryByText("Title")).toBeNull();
  });

  it("renders an empty value as an em dash", () => {
    renderDialog([makeConflict("art-1", { locationOrLender: "Vault 2" }, {})]);
    expandRow("Study, A. Painter");
    expect(textOf("dd", /Yours: Vault 2/)).toBeTruthy();
    expect(textOf("dd", /Theirs: —/)).toBeTruthy();
  });

  it("formats differing dimensions in the artwork unit", () => {
    renderDialog([
      makeConflict(
        "art-1",
        { dimensions: { widthMm: 254, heightMm: 508, status: "known" } },
        { dimensions: { widthMm: 254, heightMm: 762, status: "known" } }
      )
    ]);
    expandRow("Study, A. Painter");

    expect(screen.getByText("Dimensions")).toBeTruthy();
    expect(textOf("dd", /Yours: 10" × 20".*Theirs: 10" × 30"/)).toBeTruthy();
  });

  // Two rows can be two DIFFERENT works whose labels merely match; without the
  // identity fields the curator cannot tell which row is which.
  it("shows identity fields on same-labelled rows even when they match", () => {
    renderDialog([
      makeConflict("art-1", { date: "1998" }, { date: "1998", locationOrLender: "Vault" }),
      makeConflict("art-2", { date: "2004" }, { date: "2004", locationOrLender: "Crate" })
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Show all details" }));

    expect(screen.getAllByText("Dimensions")).toHaveLength(2);
    expect(screen.getAllByText("Accession")).toHaveLength(2);
    expect(screen.getByText("1998")).toBeTruthy();
    expect(screen.getByText("2004")).toBeTruthy();
  });

  it("shows a Yours/Theirs thumbnail pair when the image changed", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const prepared: PreparedAssetSave = {
      asset: {
        id: "asset-theirs",
        schemaVersion: 1,
        mimeType: "image/webp",
        originalKey: "asset-theirs:original",
        displayKey: "asset-theirs:display",
        thumbnailKey: "asset-theirs:thumbnail"
      },
      blobs: {
        original: { bytes, mimeType: "image/webp" },
        display: { bytes, mimeType: "image/webp" },
        thumbnail: { bytes, mimeType: "image/webp" }
      }
    };

    renderDialog(
      [
        makeConflict(
          "art-1",
          { assetId: "asset-mine" },
          { assetId: "asset-theirs" },
          true
        )
      ],
      {
        assetsToSave: [prepared],
        getBlob: () => Promise.resolve(new Blob([new Uint8Array([9])], { type: "image/webp" }))
      }
    );
    expandRow("Study, A. Painter");

    expect(screen.getByText("Yours")).toBeTruthy();
    expect(screen.getByText("Theirs")).toBeTruthy();
    // Their thumbnail comes from the package (nothing is in the asset store
    // yet); yours resolves through the shared asset-URL hook.
    await waitFor(() => expect(screen.getAllByRole("presentation")).toHaveLength(2));
  });

  it("collapses every diff by default and opens one row at a time", () => {
    renderDialog([
      makeConflict("art-1", { title: "First", date: "1998" }, { title: "First", date: "1999" })
    ]);

    expect(screen.queryByText("Date")).toBeNull();

    const toggle = rowToggles("First, A. Painter")[0]!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Date")).toBeTruthy();
    // Radix points the trigger at the body it just mounted (it omits
    // aria-controls while closed, when there is no body to point at).
    const controls = toggle.getAttribute("aria-controls");
    expect(controls && document.getElementById(controls)).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Date")).toBeNull();
  });

  it("names the differing fields in the collapsed summary", () => {
    renderDialog([
      makeConflict(
        "art-1",
        { title: "First", artist: "A. Painter", matWidthMm: 50 },
        { title: "First (revised)", artist: "B. Painter", matWidthMm: 80 },
        true
      )
    ]);

    expect(screen.getByText("Differs in title, artist, mat, image")).toBeTruthy();
  });

  // Two rows can share one label; collapsed, the local work's own size and
  // date are what tell them apart.
  it("keeps same-labelled rows tellable apart while collapsed", () => {
    renderDialog([
      makeConflict("art-1", { date: "1998" }, { date: "1998", locationOrLender: "Vault" }),
      makeConflict("art-2", { date: "2004" }, { date: "2004", locationOrLender: "Crate" })
    ]);

    expect(
      textOf(".import-conflict-summary", /^Yours is 10" × 20", 1998 · differs in location$/)
    ).toBeTruthy();
    expect(
      textOf(".import-conflict-summary", /^Yours is 10" × 20", 2004 · differs in location$/)
    ).toBeTruthy();
  });

  it("expand-all opens every expandable row and flips its label", () => {
    renderDialog([
      makeConflict("art-1", { title: "First" }, { title: "First (revised)" }),
      makeConflict("art-2", { title: "Second" }, { title: "Second (revised)" })
    ]);

    const button = () => screen.getByRole("button", { name: /all details$/ });
    fireEvent.click(button());

    expect(button().textContent).toBe("Hide all details");
    expect(screen.getAllByText("Title")).toHaveLength(2);

    // One row closed again is enough to make the label offer expansion.
    fireEvent.click(rowToggles("First, A. Painter")[0]!);
    expect(button().textContent).toBe("Show all details");
    expect(screen.getAllByText("Title")).toHaveLength(1);

    fireEvent.click(button());
    expect(screen.getAllByText("Title")).toHaveLength(2);
  });

  // A conflict can differ only in fields this diff does not list; that row is
  // a plain header, never a disclosure that opens onto nothing.
  it("gives a row with no listed difference no disclosure", () => {
    renderDialog(TWO_CONFLICTS);

    expect(rowToggles("Second, A. Painter")).toHaveLength(0);
    expect(screen.getByText("Details differ")).toBeTruthy();
  });

  it("keeps the choice control operable while the row is collapsed", () => {
    const { onResolve } = renderDialog(TWO_CONFLICTS);

    expect(screen.queryByText("Title")).toBeNull();
    fireEvent.click(
      choiceGroup("Resolution for First, A. Painter").getByRole("radio", { name: "Keep both" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(onResolve).toHaveBeenCalledWith({ "art-1": "both" });
  });

  it("cancelling discards the import", () => {
    const { onDismiss, onResolve } = renderDialog(TWO_CONFLICTS);
    fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));
    expect(onDismiss).toHaveBeenCalled();
    expect(onResolve).not.toHaveBeenCalled();
  });
});
