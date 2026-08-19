// The words in one checklist-PDF band, derived from the shared
// ChecklistExportRow (docs/export-spec.md §3.5). Pure text: no pdf-lib, no font
// metrics, no page geometry — so the wall label a curator reads can be asserted
// directly, and the layout code below only ever asks "how tall is this list".
//
// Line ORDER is the museum caption convention (artist, title, date, medium,
// dimensions, credit) and is not configurable. What IS configurable is which
// optional lines join it, and those all sit where the convention puts them: the
// ordinal above the block, the accession number with the object data, the
// location last because it describes this show rather than the work.
import type { ChecklistExportRow } from "../../../domain/checklistExport/types";
import type { Artwork, DisplayUnit } from "../../../domain/project";
import { formatLength } from "../../../domain/units/length";

// How a line prints. The style is a role, not a font: the writer owns the
// mapping to size/weight/colour so the caption stays testable as text.
export type ChecklistCaptionStyle =
  | "number"
  | "artist"
  | "title"
  | "body"
  | "muted";

export type ChecklistCaptionLine = {
  text: string;
  style: ChecklistCaptionStyle;
};

export type ChecklistCaptionOptions = {
  // The 1-based ordinal to print above the artist line. Absent = no ordinal.
  number?: number;
  accession: boolean;
  location: boolean;
};

// The artwork-scope units, which are the only two a caption ever prints: a
// project is imperial (inches, with centimetres in parentheses) or metric
// (centimetres, with inches). Feet and metres are wall-scope units and would
// read as a typo next to a 10 5/8" drawing.
export type CaptionUnit = Extract<DisplayUnit, "in" | "cm">;

export function captionUnitsFor(projectUnit: DisplayUnit): {
  primary: CaptionUnit;
  secondary: CaptionUnit;
} {
  return projectUnit === "in" || projectUnit === "ft"
    ? { primary: "in", secondary: "cm" }
    : { primary: "cm", secondary: "in" };
}

const UNIT_SUFFIX: Record<CaptionUnit, string> = { in: '"', cm: " cm" };

// One axis WITHOUT its unit mark, so a group of axes can carry a single trailing
// one: museum captions read `30 × 24"`, never `30" × 24"`.
function bareAxis(mm: number, unit: CaptionUnit): string {
  const text = formatLength(mm, { unit });
  const suffix = UNIT_SUFFIX[unit];
  return text.endsWith(suffix) ? text.slice(0, -suffix.length) : text;
}

function axisGroup(valuesMm: readonly number[], unit: CaptionUnit): string {
  return (
    valuesMm.map((mm) => bareAxis(mm, unit)).join(" × ") + UNIT_SUFFIX[unit]
  );
}

// `H × W[ × D]" (H × W[ × D] cm)` — height first, which is the caption
// convention and deliberately the reverse of the spreadsheet's `W × H` (that
// one mirrors the on-screen size fields). Blank when either principal axis is
// unknown: half a size is worse than none.
export function formatCaptionDimensions(
  artwork: Artwork | null,
  projectUnit: DisplayUnit
): string {
  if (!artwork) return "";
  const { widthMm, heightMm, depthMm } = artwork.dimensions;
  if (widthMm === undefined || heightMm === undefined) return "";
  const axes = [heightMm, widthMm];
  if (depthMm !== undefined && depthMm > 0) axes.push(depthMm);
  const { primary, secondary } = captionUnitsFor(projectUnit);
  return `${axisGroup(axes, primary)} (${axisGroup(axes, secondary)})`;
}

// "Room · Wall" for a wall placement, the room alone for a floor one, nothing
// for an unplaced work or a placement whose room no longer resolves.
export function formatCaptionLocation(row: ChecklistExportRow): string {
  const placement = row.placement;
  if (!placement) return "";
  const room = placement.roomName?.trim();
  if (!room) return "";
  const wall = placement.wallName?.trim();
  return wall ? `${room} · ${wall}` : room;
}

function text(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function buildChecklistCaptionLines(
  row: ChecklistExportRow,
  projectUnit: DisplayUnit,
  options: ChecklistCaptionOptions
): ChecklistCaptionLine[] {
  const artwork = row.artwork;
  const medium =
    typeof artwork?.metadata.medium === "string" ? artwork.metadata.medium : "";

  const candidates: ChecklistCaptionLine[] = [
    ...(options.number === undefined
      ? []
      : [{ text: String(options.number), style: "number" as const }]),
    { text: text(artwork?.artist), style: "artist" },
    { text: text(artwork?.title), style: "title" },
    { text: text(artwork?.date), style: "body" },
    { text: text(medium), style: "body" },
    { text: formatCaptionDimensions(artwork, projectUnit), style: "body" },
    ...(options.accession
      ? [{ text: text(artwork?.accessionNumber), style: "body" as const }]
      : []),
    { text: text(artwork?.locationOrLender), style: "body" },
    ...(options.location
      ? [{ text: formatCaptionLocation(row), style: "muted" as const }]
      : [])
  ];

  // Blank fields are dropped rather than printed as empty lines: a work with no
  // date must not leave a gap where the date would be, or the block stops
  // reading as a caption and starts reading as a form with holes in it.
  return candidates.filter((line) => line.text.length > 0);
}
