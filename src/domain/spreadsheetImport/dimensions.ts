import type { Dimensions, DisplayUnit } from "../project";
import { parseLength } from "../units/length";
import { normalizeImportText } from "./columnMapping";
import type { DimensionOrder, ParsedImportDimensions } from "./types";

type DimensionRole = NonNullable<ParsedImportDimensions["role"]>;
export type ImportDimensionUnit = DisplayUnit | "mm";

// When one cell states several sizes, the FRAMED size wins. That is deliberate,
// not a bug to "fix" back to image-first: a framed size is the work's true
// wall footprint — the edge an installer measures to — and the framing contract
// exists precisely so geometry reads that outer edge. Importing it is safe
// because a framed-role pick sets frameIncludedInImage (see importPlan.ts), so
// the stored size is read AS frame-inclusive and never widened again. The
// unframed size, when the cell also carried one, is preserved as raw source
// text in metadata; it just isn't the geometry. object/overall (ambiguous —
// the legitimate size of a 3D work) and sheet come next, then a labeled image
// size, then an unlabeled one.
const ROLE_PRIORITY: DimensionRole[] = ["framed", "object", "sheet", "image", "unknown"];

export function parseImportedDimensions(
  sourceText: string,
  defaultUnit: DisplayUnit,
  dimensionOrder: DimensionOrder = "auto",
  unitOverride?: ImportDimensionUnit
): ParsedImportDimensions | null {
  const text = sourceText.trim();
  if (!text) return null;

  const candidates = splitDimensionCandidates(text)
    .map((candidate) => parseDimensionCandidate(candidate, defaultUnit, unitOverride))
    .filter((candidate): candidate is ParsedImportDimensions => candidate !== null)
    .sort(
      (a, b) =>
        ROLE_PRIORITY.indexOf(a.role ?? "unknown") - ROLE_PRIORITY.indexOf(b.role ?? "unknown")
    );

  const winner = candidates[0] ?? null;
  // A combined cell is read H x W by default. "width-first" swaps it outright;
  // "auto" stays height-first here and defers to image orientation later
  // (importPlan.ts), where a matched image is available to break the tie.
  if (winner && dimensionOrder === "width-first") return swapDimensionAxes(winner);
  return winner;
}

// Swaps the height/width axes of an already-parsed size — used both for the
// explicit "width-first" order and the "auto" image-orientation inference.
// Depth is untouched; a fresh dimensions object keeps callers pure.
export function swapDimensionAxes(parsed: ParsedImportDimensions): ParsedImportDimensions {
  return {
    ...parsed,
    dimensions: {
      ...parsed.dimensions,
      heightMm: parsed.dimensions.widthMm,
      widthMm: parsed.dimensions.heightMm
    }
  };
}

export function dimensionsFromColumns({
  width,
  height,
  depth,
  widthUnitHint,
  heightUnitHint,
  depthUnitHint,
  defaultUnit,
  unitOverride
}: {
  width?: string;
  height?: string;
  depth?: string;
  widthUnitHint?: ImportDimensionUnit;
  heightUnitHint?: ImportDimensionUnit;
  depthUnitHint?: ImportDimensionUnit;
  defaultUnit: DisplayUnit;
  unitOverride?: ImportDimensionUnit;
}): ParsedImportDimensions | null {
  const widthText = width?.trim();
  const heightText = height?.trim();
  const depthText = depth?.trim();
  if (!widthText && !heightText && !depthText) return null;

  // Tracks whether every non-empty cell had an explicit unit — via a column
  // hint or text written directly in the cell (e.g. "30 in") — as opposed to
  // a bare number that silently fell back to the project default. This is
  // kept separate from parse success so confidence: "high" consistently
  // means "unit was explicit", not just "parsing worked". A manual
  // unitOverride is explicit user intent, so it counts as an explicit unit
  // (it does NOT set hadImplicitUnit) — but it never displaces an inline unit
  // or a column-header hint, which still win.
  let hadImplicitUnit = false;

  const parseCell = (text: string | undefined, hint: ImportDimensionUnit | undefined): number | null => {
    if (!text) return null;
    const fallback = hint ?? unitOverride ?? defaultUnit;
    const parsed = parseLengthWithInlineUnit(text, fallback);
    if (parsed !== null && !hint && !unitOverride && !detectUnit(text)) hadImplicitUnit = true;
    return parsed;
  };

  const warnings: string[] = [];
  const parsedWidth = parseCell(widthText, widthUnitHint);
  const parsedHeight = parseCell(heightText, heightUnitHint);
  const parsedDepth = parseCell(depthText, depthUnitHint);

  if (widthText && !parsedWidth) warnings.push(`Could not parse width "${widthText}".`);
  if (heightText && !parsedHeight) warnings.push(`Could not parse height "${heightText}".`);
  if (depthText && !parsedDepth) warnings.push(`Could not parse depth "${depthText}".`);
  if (hadImplicitUnit) {
    warnings.push(`No unit found; interpreted as ${unitName(defaultUnit)} based on project settings.`);
  }

  // Column hints win over both the manual override and the project default for
  // displayUnit, height first — an accepted edge case: if height and width
  // hints disagree (rare — most sheets use one unit throughout), each cell's
  // VALUE still parses against its own hint correctly; only the display-unit
  // label follows height. A manual override slots in ahead of the project
  // default when no hint is present.
  const displayUnitHint = heightUnitHint ?? widthUnitHint ?? depthUnitHint ?? unitOverride;
  const displayUnit = displayUnitHint
    ? displayUnitHint === "mm"
      ? "cm"
      : displayUnitHint
    : defaultUnit;

  const dimensions: Dimensions = {
    widthMm: parsedWidth ?? undefined,
    heightMm: parsedHeight ?? undefined,
    depthMm: parsedDepth ?? undefined,
    status: parsedWidth && parsedHeight ? "known" : "approximate",
    displayUnit
  };

  if (!dimensions.widthMm && !dimensions.heightMm) return null;

  return {
    dimensions,
    sourceText: [heightText, widthText, depthText].filter(Boolean).join(" x "),
    role: "object",
    confidence:
      warnings.length === 0 && !hadImplicitUnit && parsedWidth && parsedHeight ? "high" : "medium",
    warnings
  };
}

// Reuses detectUnit's regexes, but runs them over normalizeImportText(label)
// first: detectUnit's \bcm\b fails on raw "height_cm" because underscore is
// a JS regex word character (no boundary between "t" and "_"), while
// normalizeImportText turns underscores into spaces first, so \bcm\b matches.
export function detectUnitFromLabel(label: string): ImportDimensionUnit | undefined {
  return detectUnit(normalizeImportText(label));
}

function splitDimensionCandidates(text: string): { text: string; role: DimensionRole }[] {
  const parts = text
    .split(/;/)
    .map((part) => part.trim())
    .filter(Boolean);

  return (parts.length > 0 ? parts : [text]).map((part) => ({
    text: stripRolePrefix(part),
    role: detectRole(part)
  }));
}

function parseDimensionCandidate(
  candidate: { text: string; role: DimensionRole },
  defaultUnit: DisplayUnit,
  unitOverride?: ImportDimensionUnit
): ParsedImportDimensions | null {
  // Museum exports often state the same size twice, the alternate unit in
  // parentheses: `9 5/16 × 2 1/2" (23.6 × 6.3 cm)`. Splitting the whole string
  // on " x " would strand a piece like `2 1/2" (23.6` that parses to null, so
  // the outside-parens and inside-parens texts are pulled apart into two
  // candidate size strings and parsed independently.
  const parenMatch = candidate.text.match(/\(([^)]*)\)/);
  if (parenMatch) {
    const outsideText = candidate.text.replace(/\([^)]*\)/g, " ").trim();
    const insideText = parenMatch[1].trim();
    const outside = parseDimensionText(outsideText, candidate, defaultUnit, unitOverride);
    const inside = parseDimensionText(insideText, candidate, defaultUnit, unitOverride);

    if (outside && inside) {
      // Keep the leading (outside-parens) size as primary, but defer to
      // whichever carried an explicit unit when only one did — a bare
      // outside size beside a cm-labeled parenthetical should read as cm.
      const outsideHasUnit = detectUnit(outsideText) !== undefined;
      const insideHasUnit = detectUnit(insideText) !== undefined;
      if (insideHasUnit && !outsideHasUnit) return inside;
      return outside;
    }
    return outside ?? inside;
  }

  return parseDimensionText(candidate.text, candidate, defaultUnit, unitOverride);
}

function parseDimensionText(
  text: string,
  candidate: { text: string; role: DimensionRole },
  defaultUnit: DisplayUnit,
  unitOverride?: ImportDimensionUnit
): ParsedImportDimensions | null {
  const normalized = text
    .replace(/[×✕]/g, " x ")
    .replace(/[″]/g, '"')
    .replace(/[′]/g, "'")
    .replace(/\b(in|cm|mm|ft|m)\./gi, "$1")
    .replace(/\s+/g, " ")
    .trim();

  // An inline unit in the cell always wins; only when the text is bare does a
  // manual override step in ahead of the project default. The override counts
  // as explicit user intent, so it earns "high" confidence and no fallback
  // warning — the same semantics as a unit written in the cell.
  const sourceUnit = detectUnit(normalized);
  const effectiveUnit = sourceUnit ?? unitOverride;
  const parseUnit = effectiveUnit ?? defaultUnit;
  const pieces = normalized
    .split(/\s+x\s+/i)
    .map((piece) => piece.trim())
    .filter(Boolean);

  if (pieces.length < 2 || pieces.length > 3) return null;

  const parsed = pieces.map((piece) => parseLengthWithInlineUnit(piece, parseUnit));
  if (!parsed[0] || !parsed[1]) return null;

  const warnings: string[] = [];
  if (!effectiveUnit) {
    warnings.push(`No unit found; interpreted as ${unitName(defaultUnit)} based on project settings.`);
  }

  const dimensions: Dimensions = {
    // Museum checklists usually write H x W. Sightlines stores W/H.
    heightMm: parsed[0],
    widthMm: parsed[1],
    depthMm: parsed[2] ?? undefined,
    status: "known",
    displayUnit: effectiveUnit === "mm" ? "cm" : (effectiveUnit ?? defaultUnit)
  };

  return {
    dimensions,
    // Preserve the whole original cell as source text even when only one of
    // its two unit variants supplied the geometry.
    sourceText: candidate.text,
    role: candidate.role,
    confidence: effectiveUnit ? "high" : "medium",
    warnings
  };
}

function parseLengthWithInlineUnit(piece: string, contextUnit: ImportDimensionUnit): number | null {
  if (contextUnit === "mm" && /^([+-]?\d+(?:\.\d+)?)$/.test(piece.trim())) {
    const value = Number(piece.trim());
    return value > 0 ? value : null;
  }

  const result = parseLength(piece, contextUnit === "mm" ? "cm" : contextUnit);
  return result.ok && result.valueMm > 0 ? result.valueMm : null;
}

function detectRole(text: string): DimensionRole {
  if (/framed|frame/i.test(text)) return "framed";
  if (/object|overall|panel|canvas/i.test(text)) return "object";
  if (/sheet|paper/i.test(text)) return "sheet";
  if (/image|sight/i.test(text)) return "image";
  return "unknown";
}

function stripRolePrefix(text: string): string {
  return text.replace(/^\s*(framed?|frame|object|overall|sheet|paper|image|sight)\s*:\s*/i, "");
}

function detectUnit(text: string): ImportDimensionUnit | undefined {
  if (/\bmm\b|millimeters?/i.test(text)) return "mm";
  if (/\bcm\b|centimeters?/i.test(text)) return "cm";
  if (/\bm\b|meters?/i.test(text)) return "m";
  if (/\bft\b|feet|'/.test(text)) return "ft";
  if (/\bin\b|inches?|"/i.test(text)) return "in";
  return undefined;
}

function unitName(unit: DisplayUnit): string {
  switch (unit) {
    case "in":
      return "inches";
    case "ft":
      return "feet";
    case "cm":
      return "centimeters";
    case "m":
      return "meters";
  }
}
