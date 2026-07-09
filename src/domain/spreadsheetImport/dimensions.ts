import type { Dimensions, DisplayUnit } from "../project";
import { parseLength } from "../units/length";
import { normalizeImportText } from "./columnMapping";
import type { ParsedImportDimensions } from "./types";

type DimensionRole = NonNullable<ParsedImportDimensions["role"]>;
export type ImportDimensionUnit = DisplayUnit | "mm";

const ROLE_PRIORITY: DimensionRole[] = ["framed", "object", "sheet", "image", "unknown"];

export function parseImportedDimensions(
  sourceText: string,
  defaultUnit: DisplayUnit
): ParsedImportDimensions | null {
  const text = sourceText.trim();
  if (!text) return null;

  const candidates = splitDimensionCandidates(text)
    .map((candidate) => parseDimensionCandidate(candidate, defaultUnit))
    .filter((candidate): candidate is ParsedImportDimensions => candidate !== null)
    .sort(
      (a, b) =>
        ROLE_PRIORITY.indexOf(a.role ?? "unknown") - ROLE_PRIORITY.indexOf(b.role ?? "unknown")
    );

  return candidates[0] ?? null;
}

export function dimensionsFromColumns({
  width,
  height,
  depth,
  widthUnitHint,
  heightUnitHint,
  depthUnitHint,
  defaultUnit
}: {
  width?: string;
  height?: string;
  depth?: string;
  widthUnitHint?: ImportDimensionUnit;
  heightUnitHint?: ImportDimensionUnit;
  depthUnitHint?: ImportDimensionUnit;
  defaultUnit: DisplayUnit;
}): ParsedImportDimensions | null {
  const widthText = width?.trim();
  const heightText = height?.trim();
  const depthText = depth?.trim();
  if (!widthText && !heightText && !depthText) return null;

  // Tracks whether every non-empty cell had an explicit unit — via a column
  // hint or text written directly in the cell (e.g. "30 in") — as opposed to
  // a bare number that silently fell back to the project default. This is
  // kept separate from parse success so confidence: "high" consistently
  // means "unit was explicit", not just "parsing worked".
  let hadImplicitUnit = false;

  const parseCell = (text: string | undefined, hint: ImportDimensionUnit | undefined): number | null => {
    if (!text) return null;
    const parsed = parseLengthWithInlineUnit(text, hint ?? defaultUnit);
    if (parsed !== null && !hint && !detectUnit(text)) hadImplicitUnit = true;
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

  // Column hints win over the project default for displayUnit, height first —
  // an accepted edge case: if height and width hints disagree (rare — most
  // sheets use one unit throughout), each cell's VALUE still parses against
  // its own hint correctly; only the display-unit label follows height.
  const hintedUnit = heightUnitHint ?? widthUnitHint ?? depthUnitHint;
  const displayUnit = hintedUnit ? (hintedUnit === "mm" ? "cm" : hintedUnit) : defaultUnit;

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
  defaultUnit: DisplayUnit
): ParsedImportDimensions | null {
  const normalized = candidate.text
    .replace(/[×✕]/g, " x ")
    .replace(/[″]/g, '"')
    .replace(/[′]/g, "'")
    .replace(/\b(in|cm|mm|ft|m)\./gi, "$1")
    .replace(/\s+/g, " ")
    .trim();

  const sourceUnit = detectUnit(normalized);
  const parseUnit = sourceUnit ?? defaultUnit;
  const pieces = normalized
    .split(/\s+x\s+/i)
    .map((piece) => piece.trim())
    .filter(Boolean);

  if (pieces.length < 2 || pieces.length > 3) return null;

  const parsed = pieces.map((piece) => parseLengthWithInlineUnit(piece, parseUnit));
  if (!parsed[0] || !parsed[1]) return null;

  const warnings: string[] = [];
  if (!sourceUnit) {
    warnings.push(`No unit found; interpreted as ${unitName(defaultUnit)} based on project settings.`);
  }

  const dimensions: Dimensions = {
    // Museum checklists usually write H x W. Sightlines stores W/H.
    heightMm: parsed[0],
    widthMm: parsed[1],
    depthMm: parsed[2] ?? undefined,
    status: "known",
    displayUnit: sourceUnit === "mm" ? "cm" : (sourceUnit ?? defaultUnit)
  };

  return {
    dimensions,
    sourceText: candidate.text,
    role: candidate.role,
    confidence: sourceUnit ? "high" : "medium",
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
