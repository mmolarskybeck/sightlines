// Shared vocabulary for the checklist spreadsheet export (docs/export-spec.md
// §3.4). The row model here is deliberately view-agnostic: the PDF checklist is
// a later sibling slice and is expected to consume the SAME rows rather than
// re-deriving placement/framing/dimension text from the project.
import type { Artwork } from "../project";

export type ChecklistExportFormat = "xlsx" | "csv";

// Which asset tier ships in the images/ folder. Mirrors PackageExportMode's
// intent (metadata-only / display / originals) without reusing it: "none" here
// means "no images folder at all", which is a container decision, not a
// manifest one.
export type ChecklistExportImageMode = "none" | "display" | "originals";

export type ChecklistExportSort =
  | "project"
  | "artist"
  | "title"
  | "accession"
  | "placement";

export type ChecklistExportOptions = {
  format: ChecklistExportFormat;
  images: ChecklistExportImageMode;
  sort: ChecklistExportSort;
  // Drops unplaced works from the sheet entirely (the Status column still
  // exists — an all-placed sheet is a valid, if uniform, one).
  placedOnly: boolean;
};

export const DEFAULT_CHECKLIST_EXPORT_OPTIONS: ChecklistExportOptions = {
  format: "xlsx",
  images: "display",
  sort: "project",
  placedOnly: false
};

// The PDF checklist (docs/export-spec.md §3.5): the same rows, laid out as a
// reading document rather than a grid. `sort` and `placedOnly` are deliberately
// the SAME two questions the spreadsheet asks — the dialog shares that state
// across formats, so switching format never silently reorders or refilters the
// works. Everything below them is presentation, which is why none of it exists
// on the spreadsheet side.
export type ChecklistPdfExportOptions = {
  format: "pdf";
  sort: ChecklistExportSort;
  placedOnly: boolean;
  // A small bold ordinal above each artist line. Off by default: a numbered
  // checklist implies a hang sequence, which is only true for some documents.
  numbering: boolean;
  // Adds the accession number after the dimensions line.
  accession: boolean;
  // Appends a muted "Room · Wall" line for placed works. On by default — the
  // thing this app knows that a collection database does not.
  location: boolean;
};

export const DEFAULT_CHECKLIST_PDF_EXPORT_OPTIONS: ChecklistPdfExportOptions = {
  format: "pdf",
  sort: "project",
  placedOnly: false,
  numbering: false,
  accession: false,
  location: true
};

// What the one Export-checklist dialog hands back. A discriminated union rather
// than one wide options object: the two builders share no fields beyond sort and
// placedOnly, and a union keeps "images" from looking meaningful on the PDF path
// (where the thumbnail tier is a layout decision, not a user choice).
export type ChecklistExportRequest =
  | { kind: "spreadsheet"; options: ChecklistExportOptions }
  | { kind: "pdf"; options: ChecklistPdfExportOptions };

// Where a checklist work currently sits. Absent for unplaced works.
//
// The three sort keys are captured HERE, at derivation time, rather than
// recomputed inside the comparator: resolving a wall's index means walking
// getRoomPlaceableWalls for every room, and doing that per comparison turns an
// n log n sort into a quadratic one on a 200-work show.
export type ChecklistExportPlacement = {
  kind: "wall" | "floor";
  roomName: string | null;
  wallName: string | null;
  // Index into project.floor.rooms. Rooms.length when the placement's room
  // can't be resolved, so orphans sort after everything real rather than first.
  roomIndex: number;
  // Index into that room's placeable walls (perimeter walls then partition
  // faces, per getRoomPlaceableWalls). -1 for floor objects, which have no wall.
  wallIndex: number;
  // Distance along the wall for wall objects (their wall-local xMm); the plan
  // x for floor objects. Only ever compared within one wall / one room.
  alongMm: number;
};

// One checklist membership, placed or not. `artwork` is null when the project
// references a library record that has since been deleted — the row still
// exports (degraded) rather than silently vanishing, matching ChecklistPanel.
export type ChecklistExportRow = {
  artworkId: string;
  artwork: Artwork | null;
  // Position in project.checklistArtworkIds — the tie-breaker for every sort.
  projectIndex: number;
  placement: ChecklistExportPlacement | null;
};

// A spreadsheet cell. `null` is a blank cell (unknown dimension, no image),
// deliberately distinct from the empty string a text field can legitimately
// hold.
export type ChecklistExportCell = string | number | null;

export type ChecklistExportTable = {
  headers: string[];
  rows: ChecklistExportCell[][];
};
