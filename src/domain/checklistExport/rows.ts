// Pure derivation of the checklist spreadsheet's rows and cells from a project
// plus its library records (docs/export-spec.md §3.4).
//
// Scope is the CHECKLIST, not the placement graph: every id in
// project.checklistArtworkIds gets a row whether or not it is on a wall, which
// is the whole point of a checklist ("what is in the show") as against an
// elevation ("where it goes"). Works placed but never added to the checklist are
// deliberately absent — the .sightlines package's union rule
// (selectReferencedArtworkIds) is about not losing data, this is about a
// curatorial document.
import { effectiveFraming, FRAME_FINISHES } from "../framing";
import { getRoomPlaceableWalls } from "../geometry/placeableWalls";
import { isPointInPolygon, type Point } from "../geometry/polygon";
import type { Artwork, DisplayUnit, Project, RoomPlacement } from "../project";
import { normalizeImportText } from "../spreadsheetImport/columnMapping";
import { formatLength } from "../units/length";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../units/unitSystem";
import type {
  ChecklistExportCell,
  ChecklistExportPlacement,
  ChecklistExportRow,
  ChecklistExportTable
} from "./types";

// Metadata keys the importer writes for its own bookkeeping. They describe how
// a spreadsheet cell was interpreted, not the work, so re-exporting them would
// grow a new pair of columns on every import → export → import cycle.
const INTERNAL_METADATA_KEYS = new Set(["dimensionSourceText", "dimensionRole", "medium"]);

// Prefix the importer stamps on every raw source column it preserved verbatim.
const SOURCE_METADATA_PREFIX = "source:";

// The artwork-scope display unit: inches on imperial projects, centimetres on
// metric ones — the same scope the checklist panel and inspector use, so the
// numbers in the sheet match the numbers on screen.
export function checklistExportUnit(project: Project): DisplayUnit {
  return getScopeUnits(unitSystemFromDisplayUnit(project.unit), "artwork").displayUnit;
}

// Header suffix for the numeric axis columns. The unit lives IN the header
// because the cells are bare numbers — and because the import wizard scores a
// unit token in the header as extra evidence for height/width/depth
// (see UNIT_BONUS_FIELDS in columnMapping.ts), so this is what makes the file
// round-trip cleanly.
function axisHeader(axis: string, unit: DisplayUnit): string {
  return `${axis} (${unit})`;
}

// mm → the project's artwork unit, rounded to hundredths. Numbers, not
// formatted text: a spreadsheet column of numbers can be summed, sorted, and
// re-imported; "24 1/2\"" can only be read.
function toUnitNumber(mm: number | undefined, unit: DisplayUnit): number | null {
  if (mm === undefined || !Number.isFinite(mm)) return null;
  const value = unit === "in" || unit === "ft" ? mm / 25.4 : mm / 10;
  return Math.round(value * 100) / 100;
}

// One placement's floor polygon in floor-space millimetres (rotation then
// offset). Mirrors savedViews.roomFloorPolygon; winding is irrelevant to
// point-in-polygon so vertices stay as authored.
function roomFloorPolygon(placement: RoomPlacement): Point[] {
  const rad = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return placement.room.vertices.map((vertex) => ({
    xMm: vertex.xMm * cos - vertex.yMm * sin + placement.offsetXMm,
    yMm: vertex.xMm * sin + vertex.yMm * cos + placement.offsetYMm
  }));
}

type WallLocation = {
  roomIndex: number;
  wallIndex: number;
  roomName: string;
  wallName: string;
};

// wallId → its room/wall position, across perimeter walls AND partition faces
// (getRoomPlaceableWalls is the canonical union). Built once per export.
function indexPlaceableWalls(project: Project): Map<string, WallLocation> {
  const byWallId = new Map<string, WallLocation>();
  project.floor.rooms.forEach((placement, roomIndex) => {
    getRoomPlaceableWalls(placement.room).forEach((wall, wallIndex) => {
      byWallId.set(wall.id, {
        roomIndex,
        wallIndex,
        roomName: placement.room.name,
        wallName: wall.name
      });
    });
  });
  return byWallId;
}

export function buildChecklistExportRows(
  project: Project,
  libraryArtworks: readonly Artwork[]
): ChecklistExportRow[] {
  const artworksById = new Map(libraryArtworks.map((artwork) => [artwork.id, artwork]));
  const wallLocations = indexPlaceableWalls(project);
  const roomPolygons = project.floor.rooms.map(roomFloorPolygon);

  const placements = new Map<string, ChecklistExportPlacement>();

  // Wall placements win over floor ones when both somehow exist for a work
  // (the app enforces one placement per artwork, so this is belt and braces):
  // walls are written first and later writes are skipped.
  for (const object of project.wallObjects) {
    if (object.kind !== "artwork" || placements.has(object.artworkId)) continue;
    const location = wallLocations.get(object.wallId);
    placements.set(object.artworkId, {
      kind: "wall",
      roomName: location?.roomName ?? null,
      wallName: location?.wallName ?? null,
      // A placement on a wall that no longer resolves still counts as placed —
      // it sorts after every real wall rather than pretending to be unplaced.
      roomIndex: location?.roomIndex ?? project.floor.rooms.length,
      wallIndex: location?.wallIndex ?? Number.MAX_SAFE_INTEGER,
      alongMm: object.xMm
    });
  }

  for (const object of project.floorObjects) {
    if (object.kind !== "artwork" || placements.has(object.artworkId)) continue;
    const point: Point = { xMm: object.xMm, yMm: object.yMm };
    const roomIndex = roomPolygons.findIndex((polygon) => isPointInPolygon(point, polygon));
    placements.set(object.artworkId, {
      kind: "floor",
      roomName:
        roomIndex >= 0 ? project.floor.rooms[roomIndex].room.name : null,
      wallName: null,
      roomIndex: roomIndex >= 0 ? roomIndex : project.floor.rooms.length,
      wallIndex: -1,
      alongMm: object.xMm
    });
  }

  return project.checklistArtworkIds.map((artworkId, projectIndex) => ({
    artworkId,
    artwork: artworksById.get(artworkId) ?? null,
    projectIndex,
    placement: placements.get(artworkId) ?? null
  }));
}

// The human-readable size string, in the project's artwork unit — the same
// `W × H` shape the checklist panel draws, plus depth when the record carries
// one. Blank when either axis is unknown: half a size is worse than none.
export function formatChecklistDimensions(
  artwork: Artwork | null,
  unit: DisplayUnit
): string {
  if (!artwork) return "";
  const { widthMm, heightMm, depthMm } = artwork.dimensions;
  if (widthMm === undefined || heightMm === undefined) return "";
  const parts = [formatLength(widthMm, { unit }), formatLength(heightMm, { unit })];
  if (depthMm !== undefined && depthMm > 0) parts.push(formatLength(depthMm, { unit }));
  return parts.join(" × ");
}

const FRAME_FINISH_LABELS = new Map(
  FRAME_FINISHES.map((finish) => [finish.value, finish.label])
);

// Mat/frame in one cell, read through effectiveFraming so this agrees with
// geometry and the renderer about what the record means. A work whose stored
// size already includes its frame says so instead of listing bands that are
// deliberately not drawn.
export function formatChecklistFraming(
  artwork: Artwork | null,
  unit: DisplayUnit
): string {
  if (!artwork) return "";
  if (artwork.frameIncludedInImage) return "Frame included in image";

  const { matWidthMm, frame } = effectiveFraming(artwork);
  const parts: string[] = [];
  if (matWidthMm !== undefined && matWidthMm > 0) {
    parts.push(`${formatLength(matWidthMm, { unit })} mat`);
  }
  if (frame && frame.widthMm > 0) {
    const label = FRAME_FINISH_LABELS.get(frame.finish) ?? frame.finish;
    parts.push(`${label} frame, ${formatLength(frame.widthMm, { unit })}`);
  }
  return parts.join("; ");
}

function metadataValueToCell(value: string | number | boolean): ChecklistExportCell {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value;
}

// Extra metadata columns, in first-seen row order. `source:*` keys shed their
// prefix (they hold the original spreadsheet's own column values, and the
// prefix is an implementation detail of the import wizard); anything whose
// header would collide with a core column is dropped rather than duplicated.
function collectExtraMetadataHeaders(
  rows: readonly ChecklistExportRow[],
  reserved: ReadonlySet<string>
): { header: string; key: string }[] {
  const columns: { header: string; key: string }[] = [];
  const seen = new Set(reserved);

  for (const row of rows) {
    if (!row.artwork) continue;
    for (const key of Object.keys(row.artwork.metadata)) {
      if (INTERNAL_METADATA_KEYS.has(key)) continue;
      const header = key.startsWith(SOURCE_METADATA_PREFIX)
        ? key.slice(SOURCE_METADATA_PREFIX.length).trim()
        : key;
      if (!header) continue;
      const identity = normalizeImportText(header);
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      columns.push({ header, key });
    }
  }

  return columns;
}

// Headers chosen so the exported file round-trips through the import wizard's
// FIELD_ALIASES (domain/spreadsheetImport/columnMapping.ts). Changing one of
// these strings is a round-trip change, not a wording change.
export function checklistExportHeaders(unit: DisplayUnit): string[] {
  return [
    "#",
    "Artist",
    "Title",
    "Date",
    "Medium",
    "Dimensions",
    axisHeader("Height", unit),
    axisHeader("Width", unit),
    axisHeader("Depth", unit),
    "Accession number",
    "Location / Lender",
    "Framing",
    "Status",
    "Room",
    "Wall",
    "Image file"
  ];
}

export type BuildChecklistTableInput = {
  project: Project;
  // Already filtered and sorted — the table builder numbers rows in the order
  // it is given.
  rows: readonly ChecklistExportRow[];
  // artworkId → the value for the "Image file" column (e.g. "images/012_…jpg").
  // Absent ids get a blank cell.
  imagePaths?: ReadonlyMap<string, string>;
};

export function buildChecklistExportTable({
  project,
  rows,
  imagePaths
}: BuildChecklistTableInput): ChecklistExportTable {
  const unit = checklistExportUnit(project);
  const coreHeaders = checklistExportHeaders(unit);
  // Bare axis names join the reserved set: a `source:Height` column would
  // otherwise slip past "Height (cm)" on a plain string comparison and land the
  // importer with two height candidates.
  const reserved = new Set([
    ...coreHeaders.map((header) => normalizeImportText(header)),
    "height",
    "width",
    "depth"
  ]);
  const extraColumns = collectExtraMetadataHeaders(rows, reserved);

  return {
    headers: [...coreHeaders, ...extraColumns.map((column) => column.header)],
    rows: rows.map((row, index) => {
      const artwork = row.artwork;
      const dimensions = artwork?.dimensions;
      const core: ChecklistExportCell[] = [
        index + 1,
        artwork?.artist ?? "",
        artwork?.title ?? "",
        artwork?.date ?? "",
        typeof artwork?.metadata.medium === "string" ? artwork.metadata.medium : "",
        formatChecklistDimensions(artwork, unit),
        toUnitNumber(dimensions?.heightMm, unit),
        toUnitNumber(dimensions?.widthMm, unit),
        toUnitNumber(dimensions?.depthMm, unit),
        artwork?.accessionNumber ?? "",
        artwork?.locationOrLender ?? "",
        formatChecklistFraming(artwork, unit),
        row.placement ? "Placed" : "Unplaced",
        row.placement?.roomName ?? "",
        row.placement?.wallName ?? "",
        imagePaths?.get(row.artworkId) ?? ""
      ];
      const extras = extraColumns.map((column) => {
        const value = artwork?.metadata[column.key];
        return value === undefined ? "" : metadataValueToCell(value);
      });
      return [...core, ...extras];
    })
  };
}
