import { getArtworkOuterDimensionsMm } from "../../../domain/framing";
import type { ArtworkFrame, Dimensions, DisplayUnit } from "../../../domain/project";
import { formatLength } from "../../../domain/units/length";

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

// "3" mat · 1" gold frame · 42" × 34" overall", either mat/frame half alone
// (with the overall appended), or "None" when there's neither. Uses the
// finish key itself ("gold", "wood"…) — the dropdown's long labels ("Silver /
// brushed aluminum") don't fit a one-line summary. The overall is what a
// curator/installer actually measures on the wall; a collapsed section still
// has to answer "how big does this really hang" without opening it.
export function formatFramingSummary(
  matWidthMm: number | undefined,
  frame: ArtworkFrame | undefined,
  dimensions: Dimensions,
  displayUnit: DisplayUnit,
  // When the stored size already includes the frame (frameIncludedInImage),
  // there is no band to add or draw — the summary says so instead of listing a
  // mat/frame clause or "None". The flag wins over any stored mat/frame, exactly
  // as effectiveFraming (domain/framing.ts) resolves it for geometry/render.
  frameIncludedInImage?: boolean
): string {
  if (frameIncludedInImage) return "Size includes the frame";

  const parts: string[] = [];

  if (matWidthMm !== undefined && matWidthMm > 0) {
    parts.push(`${formatLength(matWidthMm, { unit: displayUnit })} mat`);
  }

  if (frame && frame.widthMm > 0) {
    parts.push(`${formatLength(frame.widthMm, { unit: displayUnit })} ${frame.finish} frame`);
  }

  if (parts.length === 0) return "None";

  // Both image axes must be known to state an overall size — same guard as
  // formatDimensionsSummary/the tooltip; a mid-measurement work states only
  // the mat/frame it has, not a guessed overall.
  const { widthMm, heightMm } = dimensions;
  if (widthMm !== undefined && heightMm !== undefined) {
    const overall = getArtworkOuterDimensionsMm(widthMm, heightMm, matWidthMm, frame);
    parts.push(
      `${formatLength(overall.widthMm, { unit: displayUnit })} × ${formatLength(overall.heightMm, {
        unit: displayUnit
      })} overall`
    );
  }

  return parts.join(" · ");
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
