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

    expect(screen.getByText("Date")).toBeTruthy();
    expect(screen.getByText(/Yours: 1998/)).toBeTruthy();
    expect(screen.getByText(/Theirs: 1999/)).toBeTruthy();
    // Unchanged fields stay out of the way.
    expect(screen.queryByText("Accession")).toBeNull();
    expect(screen.queryByText("Title")).toBeNull();
  });

  it("renders an empty value as an em dash", () => {
    renderDialog([makeConflict("art-1", { locationOrLender: "Vault 2" }, {})]);
    expect(screen.getByText(/Yours: Vault 2/)).toBeTruthy();
    expect(screen.getByText(/Theirs: —/)).toBeTruthy();
  });

  it("formats differing dimensions in the artwork unit", () => {
    renderDialog([
      makeConflict(
        "art-1",
        { dimensions: { widthMm: 254, heightMm: 508, status: "known" } },
        { dimensions: { widthMm: 254, heightMm: 762, status: "known" } }
      )
    ]);

    expect(screen.getByText("Dimensions")).toBeTruthy();
    expect(screen.getByText(/Yours: 10" × 20".*Theirs: 10" × 30"/)).toBeTruthy();
  });

  // Two rows can be two DIFFERENT works whose labels merely match; without the
  // identity fields the curator cannot tell which row is which.
  it("shows identity fields on same-labelled rows even when they match", () => {
    renderDialog([
      makeConflict("art-1", { date: "1998" }, { date: "1998", locationOrLender: "Vault" }),
      makeConflict("art-2", { date: "2004" }, { date: "2004", locationOrLender: "Crate" })
    ]);

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

    expect(screen.getByText("Yours")).toBeTruthy();
    expect(screen.getByText("Theirs")).toBeTruthy();
    // Their thumbnail comes from the package (nothing is in the asset store
    // yet); yours resolves through the shared asset-URL hook.
    await waitFor(() => expect(screen.getAllByRole("presentation")).toHaveLength(2));
  });

  it("cancelling discards the import", () => {
    const { onDismiss, onResolve } = renderDialog(TWO_CONFLICTS);
    fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));
    expect(onDismiss).toHaveBeenCalled();
    expect(onResolve).not.toHaveBeenCalled();
  });
});
