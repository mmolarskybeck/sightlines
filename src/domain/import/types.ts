import type { Artwork, Dimensions } from "../project";

export type ImportField =
  | "artist"
  | "title"
  | "date"
  | "accessionNumber"
  | "locationOrLender"
  | "dimensions"
  | "height"
  | "width"
  | "depth"
  | "imageFilename"
  | "medium";

export type ImportConfidence = "high" | "medium" | "low";

export type ImportColumn = {
  index: number;
  label: string;
};

export type ImportRow = {
  sourceRowIndex: number;
  values: string[];
};

export type ImportTable = {
  sourceFilename: string;
  sheetName: string;
  headerRowIndex: number;
  columns: ImportColumn[];
  rows: ImportRow[];
};

export type ImportSheetPreview = {
  name: string;
  rows: string[][];
};

export type ImportWorkbookPreview = {
  sourceFilename: string;
  sheets: ImportSheetPreview[];
};

export type ColumnMapping = Partial<Record<ImportField, number>>;

export type ColumnGuess = {
  field: ImportField;
  columnIndex: number;
  confidence: ImportConfidence;
  reason: string;
};

export type ImportWarning = {
  field?: ImportField | "image";
  message: string;
};

export type ImageMatchCandidate = {
  file: File;
  score: number;
  reason: string;
};

export type ImageMatchResult =
  | { status: "matched"; file: File; score: number; reason: string }
  | { status: "needs-review"; candidates: ImageMatchCandidate[] }
  | { status: "conflict"; file: File; candidates: ImageMatchCandidate[]; reason: string }
  | { status: "none"; candidates: ImageMatchCandidate[] };

export type ArtworkImportDraft = {
  id: string;
  row: ImportRow;
  artwork: Artwork;
  imageFile?: File;
  imageMatch: ImageMatchResult;
  warnings: ImportWarning[];
  raw: Record<string, string>;
  selected: boolean;
};

export type ImportPlan = {
  sourceFilename: string;
  sheetName: string;
  table: ImportTable;
  mapping: ColumnMapping;
  guesses: ColumnGuess[];
  drafts: ArtworkImportDraft[];
};

export type ParsedImportDimensions = {
  dimensions: Dimensions;
  sourceText: string;
  role?: "framed" | "object" | "sheet" | "image" | "unknown";
  confidence: ImportConfidence;
  warnings: string[];
};
