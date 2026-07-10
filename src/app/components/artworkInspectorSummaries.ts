import type { ArtworkFrame, Dimensions, DisplayUnit } from "../../domain/project";
import { formatLength } from "../../domain/units/length";

// At-rest summaries for ArtworkInspector's collapsed sections (see
// InspectorSection): a collapsed row must still answer "what's in here?"
// at a glance. Pure string builders so they're unit-testable without
// rendering; callers pass the artwork-scope display unit (see
// getScopedUnitContext), not the raw project unit.

// "36 1/4" × 29"", appending depth when present ("… × 2""). Null when
// neither face dimension is known — an all-unknown section has nothing
// honest to summarize, and the bare title reads better than "? × ?".
export function formatDimensionsSummary(
  dimensions: Dimensions,
  displayUnit: DisplayUnit
): string | null {
  const { widthMm, heightMm, depthMm } = dimensions;
  if (widthMm === undefined && heightMm === undefined) return null;

  const face = (valueMm: number | undefined) =>
    valueMm === undefined ? "?" : formatLength(valueMm, { unit: displayUnit });

  const parts = [face(widthMm), face(heightMm)];
  if (depthMm !== undefined) parts.push(face(depthMm));

  return parts.join(" × ");
}

// "3" mat · 1" gold frame", either half alone, or "None". Uses the finish
// key itself ("gold", "wood"…) — the dropdown's long labels ("Silver /
// brushed aluminum") don't fit a one-line summary.
export function formatFramingSummary(
  matWidthMm: number | undefined,
  frame: ArtworkFrame | undefined,
  displayUnit: DisplayUnit
): string {
  const parts: string[] = [];

  if (matWidthMm !== undefined && matWidthMm > 0) {
    parts.push(`${formatLength(matWidthMm, { unit: displayUnit })} mat`);
  }

  if (frame && frame.widthMm > 0) {
    parts.push(`${formatLength(frame.widthMm, { unit: displayUnit })} ${frame.finish} frame`);
  }

  return parts.length > 0 ? parts.join(" · ") : "None";
}

// Accession number when set; location/lender as the fallback scent; null
// (no summary at all) when the registrar cluster is empty.
export function formatDetailsSummary(
  accessionNumber: string | undefined,
  locationOrLender: string | undefined
): string | null {
  const accession = accessionNumber?.trim();
  if (accession) return accession;

  const location = locationOrLender?.trim();
  return location ? location : null;
}
