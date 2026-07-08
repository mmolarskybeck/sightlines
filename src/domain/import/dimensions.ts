import type { Dimensions, DisplayUnit } from "../project";
import { parseLength } from "../units/length";
import type { ParsedImportDimensions } from "./types";

type DimensionRole = NonNullable<ParsedImportDimensions["role"]>;
type ImportDimensionUnit = DisplayUnit | "mm";

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
  defaultUnit
}: {
  width?: string;
  height?: string;
  depth?: string;
  defaultUnit: DisplayUnit;
}): ParsedImportDimensions | null {
  const widthText = width?.trim();
  const heightText = height?.trim();
  const depthText = depth?.trim();
  if (!widthText && !heightText && !depthText) return null;

  const warnings: string[] = [];
  const parsedWidth = widthText ? parseLengthWithInlineUnit(widthText, defaultUnit) : null;
  const parsedHeight = heightText ? parseLengthWithInlineUnit(heightText, defaultUnit) : null;
  const parsedDepth = depthText ? parseLengthWithInlineUnit(depthText, defaultUnit) : null;

  if (widthText && !parsedWidth) warnings.push(`Could not parse width "${widthText}".`);
  if (heightText && !parsedHeight) warnings.push(`Could not parse height "${heightText}".`);
  if (depthText && !parsedDepth) warnings.push(`Could not parse depth "${depthText}".`);

  const dimensions: Dimensions = {
    widthMm: parsedWidth ?? undefined,
    heightMm: parsedHeight ?? undefined,
    depthMm: parsedDepth ?? undefined,
    status: parsedWidth && parsedHeight ? "known" : "approximate",
    displayUnit: defaultUnit
  };

  if (!dimensions.widthMm && !dimensions.heightMm) return null;

  return {
    dimensions,
    sourceText: [heightText, widthText, depthText].filter(Boolean).join(" x "),
    role: "object",
    confidence: warnings.length === 0 && parsedWidth && parsedHeight ? "high" : "medium",
    warnings
  };
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
