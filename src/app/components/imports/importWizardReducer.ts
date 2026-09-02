import type { ImportDimensionUnit } from "../../../domain/spreadsheetImport/dimensions";
import type {
  ColumnMapping,
  DimensionOrder,
  ImportField,
  ImportWorkbookPreview
} from "../../../domain/spreadsheetImport/types";

export type ImportWizardStep = "upload" | "map" | "review";

export const IMPORT_WIZARD_STEP_ORDER: ImportWizardStep[] = ["upload", "map", "review"];

export type ImportWizardState = {
  step: ImportWizardStep;
  workbook: ImportWorkbookPreview | null;
  spreadsheetFile: File | null;
  selectedSheet: string | null;
  headerRowIndex: number | undefined;
  imageFiles: File[];
  mapping: ColumnMapping;
  dimensionOrder: DimensionOrder;
  // "auto" defers to the project default; any other value manually forces the
  // unit for bare (unit-less) dimension numbers. Inline units and column-header
  // hints still take precedence over this override.
  unitOverride: ImportDimensionUnit | "auto";
  // Filename → width/height ratio, filled asynchronously from the uploaded
  // image bitmaps. "auto" dimension order consults this to settle whether a
  // combined "12 x 13" cell is H x W or W x H.
  imageAspectByName: ReadonlyMap<string, number>;
  selectedDraftIds: ReadonlySet<string>;
  imageChoiceByDraftId: Record<string, string>;
  error: string | null;
  // Which draft the Map step's sample card is showing.
  sampleRowIndex: number;
};

export type ImportWizardAction =
  | { type: "step-changed"; step: ImportWizardStep }
  | { type: "workbook-loaded"; file: File; workbook: ImportWorkbookPreview }
  | { type: "workbook-cleared" }
  | { type: "sheet-selected"; sheet: string }
  | { type: "header-row-selected"; headerRowIndex: number }
  // The table memo was rebuilt: adopt the freshly guessed mapping (null when
  // there is no table) and re-aim the sample card at the first row.
  | { type: "table-rebuilt"; mapping: ColumnMapping | null }
  | { type: "mapping-field-changed"; field: ImportField; columnIndex: number | undefined }
  | { type: "dimension-order-changed"; dimensionOrder: DimensionOrder }
  | { type: "unit-override-changed"; unitOverride: ImportDimensionUnit | "auto" }
  | { type: "images-added"; files: File[] }
  | { type: "image-removed"; index: number }
  | { type: "images-cleared" }
  | { type: "image-aspects-measured"; aspects: ReadonlyMap<string, number> }
  // The plan produced a new set of drafts: everything keyed by draft id is
  // stale, so selection and image choices are re-seeded wholesale.
  | { type: "drafts-planned"; draftIds: string[]; imageChoiceByDraftId: Record<string, string> }
  | { type: "draft-selection-changed"; draftId: string; selected: boolean }
  | { type: "draft-image-choice-changed"; draftId: string; choice: string }
  | { type: "sample-row-stepped"; delta: number; total: number }
  | { type: "error-raised"; message: string }
  | { type: "error-cleared" }
  | { type: "reset" };

export const initialImportWizardState: ImportWizardState = {
  step: "upload",
  workbook: null,
  spreadsheetFile: null,
  selectedSheet: null,
  headerRowIndex: undefined,
  imageFiles: [],
  mapping: {},
  dimensionOrder: "auto",
  unitOverride: "auto",
  imageAspectByName: new Map(),
  selectedDraftIds: new Set(),
  imageChoiceByDraftId: {},
  error: null,
  sampleRowIndex: 0
};

// Every field that describes the loaded spreadsheet rather than the whole
// wizard. A column→field mapping, a row selection and a per-row image choice
// are all stated against one specific table, so any change to which table is
// loaded (new workbook, new sheet, new header row, cleared well) must drop all
// three together or the wizard maps stale column indices onto new columns.
function clearedTableDerived() {
  return {
    mapping: {} as ColumnMapping,
    selectedDraftIds: new Set<string>() as ReadonlySet<string>,
    imageChoiceByDraftId: {} as Record<string, string>,
    sampleRowIndex: 0
  };
}

export function importWizardReducer(
  state: ImportWizardState,
  action: ImportWizardAction
): ImportWizardState {
  switch (action.type) {
    case "step-changed":
      return { ...state, step: action.step };

    case "workbook-loaded":
      return {
        ...state,
        ...clearedTableDerived(),
        spreadsheetFile: action.file,
        workbook: action.workbook,
        // First sheet by default; the header row stays auto-detected until the
        // user overrides it on the Map step.
        selectedSheet: action.workbook.sheets[0]?.name ?? null,
        headerRowIndex: undefined,
        error: null
      };

    case "workbook-cleared":
      // Deliberately leaves `step` and the image well alone: clearing the
      // metadata tile is not a retreat from the wizard, and images import on
      // their own.
      return {
        ...state,
        ...clearedTableDerived(),
        workbook: null,
        spreadsheetFile: null,
        selectedSheet: null,
        headerRowIndex: undefined,
        error: null
      };

    case "sheet-selected":
      return {
        ...state,
        ...clearedTableDerived(),
        selectedSheet: action.sheet,
        // A different sheet has its own header; re-detect rather than carry the
        // old sheet's row number over.
        headerRowIndex: undefined
      };

    case "header-row-selected":
      return { ...state, ...clearedTableDerived(), headerRowIndex: action.headerRowIndex };

    case "table-rebuilt":
      return action.mapping
        ? { ...state, mapping: action.mapping, sampleRowIndex: 0 }
        : { ...state, sampleRowIndex: 0 };

    case "mapping-field-changed":
      return {
        ...state,
        mapping: { ...state.mapping, [action.field]: action.columnIndex }
      };

    case "dimension-order-changed":
      return { ...state, dimensionOrder: action.dimensionOrder };

    case "unit-override-changed":
      return { ...state, unitOverride: action.unitOverride };

    case "images-added":
      return action.files.length === 0
        ? state
        : { ...state, imageFiles: [...state.imageFiles, ...action.files] };

    case "image-removed":
      return {
        ...state,
        imageFiles: state.imageFiles.filter((_, index) => index !== action.index)
      };

    case "images-cleared":
      // Measured aspect ratios are keyed by filename and cost a bitmap decode
      // each; keep them so re-adding the same file does not re-measure it.
      return { ...state, imageFiles: [] };

    case "image-aspects-measured": {
      if (action.aspects.size === 0) return state;
      const next = new Map(state.imageAspectByName);
      for (const [name, ratio] of action.aspects) next.set(name, ratio);
      return { ...state, imageAspectByName: next };
    }

    case "drafts-planned":
      return {
        ...state,
        selectedDraftIds: new Set(action.draftIds),
        imageChoiceByDraftId: action.imageChoiceByDraftId
      };

    case "draft-selection-changed": {
      const selectedDraftIds = new Set(state.selectedDraftIds);
      if (action.selected) selectedDraftIds.add(action.draftId);
      else selectedDraftIds.delete(action.draftId);
      return { ...state, selectedDraftIds };
    }

    case "draft-image-choice-changed":
      return {
        ...state,
        imageChoiceByDraftId: {
          ...state.imageChoiceByDraftId,
          [action.draftId]: action.choice
        }
      };

    case "sample-row-stepped": {
      if (action.total === 0) return state;
      // Clamp before stepping: the stored index can point past the end after a
      // mapping change shrank the draft list.
      const clamped = Math.min(state.sampleRowIndex, action.total - 1);
      const sampleRowIndex = Math.max(0, Math.min(action.total - 1, clamped + action.delta));
      return sampleRowIndex === state.sampleRowIndex ? state : { ...state, sampleRowIndex };
    }

    case "error-raised":
      return { ...state, error: action.message };

    case "error-cleared":
      return state.error === null ? state : { ...state, error: null };

    case "reset":
      return initialImportWizardState;
  }
}
