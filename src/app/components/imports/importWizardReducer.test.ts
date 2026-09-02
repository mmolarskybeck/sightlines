import { describe, expect, it } from "vitest";
import {
  importWizardReducer,
  initialImportWizardState,
  type ImportWizardAction,
  type ImportWizardState
} from "./importWizardReducer";
import type { ImportWorkbookPreview } from "../../../domain/spreadsheetImport/types";

function workbookPreview(
  sourceFilename = "works.csv",
  sheetNames = ["Sheet1"]
): ImportWorkbookPreview {
  return {
    sourceFilename,
    sheets: sheetNames.map((name) => ({ name, rows: [["Title"], ["Mona Lisa"]] }))
  };
}

function spreadsheet(name = "works.csv") {
  return new File(["Title\nMona Lisa"], name, { type: "text/csv" });
}

function image(name: string) {
  return new File(["x"], name, { type: "image/jpeg" });
}

function apply(state: ImportWizardState, ...actions: ImportWizardAction[]): ImportWizardState {
  return actions.reduce(importWizardReducer, state);
}

// A wizard that has been carried all the way to Review: a table is loaded, the
// mapping and per-draft choices are populated and the sample card has been
// paged. Every reset assertion below is against this.
function loadedState(): ImportWizardState {
  return {
    ...initialImportWizardState,
    step: "review",
    workbook: workbookPreview(),
    spreadsheetFile: spreadsheet(),
    selectedSheet: "Sheet1",
    headerRowIndex: 2,
    imageFiles: [image("one.jpg")],
    mapping: { title: 0, artist: 1 },
    dimensionOrder: "width-first",
    unitOverride: "cm",
    imageAspectByName: new Map([["one.jpg", 1.5]]),
    selectedDraftIds: new Set(["a", "b"]),
    imageChoiceByDraftId: { a: "one.jpg", b: "__none" },
    error: "Stale error",
    sampleRowIndex: 3
  };
}

function expectTableDerivedCleared(state: ImportWizardState) {
  expect(state.mapping).toEqual({});
  expect(state.selectedDraftIds.size).toBe(0);
  expect(state.imageChoiceByDraftId).toEqual({});
  expect(state.sampleRowIndex).toBe(0);
}

describe("importWizardReducer", () => {
  it("starts on upload with nothing loaded", () => {
    expect(initialImportWizardState.step).toBe("upload");
    expect(initialImportWizardState.workbook).toBeNull();
    expect(initialImportWizardState.spreadsheetFile).toBeNull();
    expect(initialImportWizardState.imageFiles).toEqual([]);
    expectTableDerivedCleared(initialImportWizardState);
    expect(initialImportWizardState.error).toBeNull();
  });

  it("moves between steps without touching anything else", () => {
    const before = loadedState();
    const after = importWizardReducer(before, { type: "step-changed", step: "map" });

    expect(after.step).toBe("map");
    expect({ ...after, step: before.step }).toEqual(before);
  });

  it("workbook-loaded selects the first sheet, re-detects the header and clears table state", () => {
    const file = spreadsheet("other.csv");
    const after = importWizardReducer(loadedState(), {
      type: "workbook-loaded",
      file,
      workbook: workbookPreview("other.csv", ["Loans", "Notes"])
    });

    expect(after.spreadsheetFile).toBe(file);
    expect(after.selectedSheet).toBe("Loans");
    expect(after.headerRowIndex).toBeUndefined();
    expect(after.error).toBeNull();
    expectTableDerivedCleared(after);
    // Files, unit preferences and the current step survive a new workbook.
    expect(after.imageFiles.map((entry) => entry.name)).toEqual(["one.jpg"]);
    expect(after.unitOverride).toBe("cm");
    expect(after.dimensionOrder).toBe("width-first");
    expect(after.step).toBe("review");
  });

  it("workbook-cleared empties the spreadsheet well but keeps images and the step", () => {
    const after = importWizardReducer(loadedState(), { type: "workbook-cleared" });

    expect(after.workbook).toBeNull();
    expect(after.spreadsheetFile).toBeNull();
    expect(after.selectedSheet).toBeNull();
    expect(after.headerRowIndex).toBeUndefined();
    expect(after.error).toBeNull();
    expectTableDerivedCleared(after);
    expect(after.imageFiles.map((entry) => entry.name)).toEqual(["one.jpg"]);
    expect(after.step).toBe("review");
  });

  it("sheet-selected re-detects the header row and clears table state", () => {
    const after = importWizardReducer(loadedState(), { type: "sheet-selected", sheet: "Notes" });

    expect(after.selectedSheet).toBe("Notes");
    expect(after.headerRowIndex).toBeUndefined();
    expectTableDerivedCleared(after);
    expect(after.workbook).not.toBeNull();
  });

  it("header-row-selected clears the mapping because the columns are re-labelled", () => {
    const after = importWizardReducer(loadedState(), {
      type: "header-row-selected",
      headerRowIndex: 4
    });

    expect(after.headerRowIndex).toBe(4);
    expectTableDerivedCleared(after);
    expect(after.selectedSheet).toBe("Sheet1");
  });

  it("table-rebuilt adopts a guessed mapping, or only rewinds the sample when there is no table", () => {
    const guessed = importWizardReducer(loadedState(), {
      type: "table-rebuilt",
      mapping: { title: 3 }
    });
    expect(guessed.mapping).toEqual({ title: 3 });
    expect(guessed.sampleRowIndex).toBe(0);

    const noTable = importWizardReducer(loadedState(), { type: "table-rebuilt", mapping: null });
    expect(noTable.mapping).toEqual({ title: 0, artist: 1 });
    expect(noTable.sampleRowIndex).toBe(0);
  });

  it("mapping-field-changed edits one field and unmaps with undefined", () => {
    const mapped = importWizardReducer(loadedState(), {
      type: "mapping-field-changed",
      field: "date",
      columnIndex: 5
    });
    expect(mapped.mapping).toEqual({ title: 0, artist: 1, date: 5 });

    const unmapped = importWizardReducer(mapped, {
      type: "mapping-field-changed",
      field: "artist",
      columnIndex: undefined
    });
    expect(unmapped.mapping.artist).toBeUndefined();
    expect(unmapped.mapping.title).toBe(0);
    // Editing the mapping never disturbs the sample card the user is watching.
    expect(unmapped.sampleRowIndex).toBe(3);
  });

  it("appends, removes and clears image files without dropping measured aspects", () => {
    const added = apply(initialImportWizardState, {
      type: "images-added",
      files: [image("a.jpg"), image("b.jpg")]
    });
    expect(added.imageFiles.map((entry) => entry.name)).toEqual(["a.jpg", "b.jpg"]);

    const more = importWizardReducer(added, { type: "images-added", files: [image("c.jpg")] });
    expect(more.imageFiles.map((entry) => entry.name)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);

    const measured = importWizardReducer(more, {
      type: "image-aspects-measured",
      aspects: new Map([["a.jpg", 1.2]])
    });
    const removed = importWizardReducer(measured, { type: "image-removed", index: 1 });
    expect(removed.imageFiles.map((entry) => entry.name)).toEqual(["a.jpg", "c.jpg"]);

    const cleared = importWizardReducer(removed, { type: "images-cleared" });
    expect(cleared.imageFiles).toEqual([]);
    expect(cleared.imageAspectByName.get("a.jpg")).toBe(1.2);

    expect(importWizardReducer(cleared, { type: "images-added", files: [] })).toBe(cleared);
  });

  it("image-aspects-measured merges into the existing map", () => {
    const after = importWizardReducer(loadedState(), {
      type: "image-aspects-measured",
      aspects: new Map([
        ["two.jpg", 0.8],
        ["one.jpg", 2]
      ])
    });

    expect(after.imageAspectByName.get("one.jpg")).toBe(2);
    expect(after.imageAspectByName.get("two.jpg")).toBe(0.8);
    expect(
      importWizardReducer(after, { type: "image-aspects-measured", aspects: new Map() })
    ).toBe(after);
  });

  it("drafts-planned replaces selection and image choices wholesale", () => {
    const after = importWizardReducer(loadedState(), {
      type: "drafts-planned",
      draftIds: ["x", "y"],
      imageChoiceByDraftId: { x: "one.jpg", y: "__none" }
    });

    expect([...after.selectedDraftIds]).toEqual(["x", "y"]);
    expect(after.imageChoiceByDraftId).toEqual({ x: "one.jpg", y: "__none" });
    // The old drafts' ids are gone, not merged.
    expect(after.selectedDraftIds.has("a")).toBe(false);
  });

  it("toggles one draft's selection and image choice at a time", () => {
    const deselected = importWizardReducer(loadedState(), {
      type: "draft-selection-changed",
      draftId: "a",
      selected: false
    });
    expect([...deselected.selectedDraftIds]).toEqual(["b"]);

    const reselected = importWizardReducer(deselected, {
      type: "draft-selection-changed",
      draftId: "a",
      selected: true
    });
    expect(reselected.selectedDraftIds.has("a")).toBe(true);

    const chosen = importWizardReducer(reselected, {
      type: "draft-image-choice-changed",
      draftId: "b",
      choice: "one.jpg"
    });
    expect(chosen.imageChoiceByDraftId).toEqual({ a: "one.jpg", b: "one.jpg" });
  });

  it("clamps the sample row to the current draft count before stepping", () => {
    const base = { ...loadedState(), sampleRowIndex: 9 };

    expect(importWizardReducer(base, { type: "sample-row-stepped", delta: 1, total: 4 })
      .sampleRowIndex).toBe(3);
    expect(importWizardReducer(base, { type: "sample-row-stepped", delta: -1, total: 4 })
      .sampleRowIndex).toBe(2);
    expect(
      importWizardReducer({ ...base, sampleRowIndex: 0 }, {
        type: "sample-row-stepped",
        delta: -1,
        total: 4
      }).sampleRowIndex
    ).toBe(0);
    expect(importWizardReducer(base, { type: "sample-row-stepped", delta: 1, total: 0 })).toBe(base);
  });

  it("raises and clears the error banner", () => {
    const raised = importWizardReducer(initialImportWizardState, {
      type: "error-raised",
      message: "Could not open workbook."
    });
    expect(raised.error).toBe("Could not open workbook.");

    const cleared = importWizardReducer(raised, { type: "error-cleared" });
    expect(cleared.error).toBeNull();
    expect(importWizardReducer(cleared, { type: "error-cleared" })).toBe(cleared);
  });

  it("reset returns the whole wizard to its opening state", () => {
    const after = importWizardReducer(loadedState(), { type: "reset" });
    expect(after).toEqual(initialImportWizardState);
  });
});
