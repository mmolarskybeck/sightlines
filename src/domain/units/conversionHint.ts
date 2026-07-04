import type { DisplayUnit } from "../project";
import { formatLength } from "./length";
import { parseLength } from "./length";

export function getConversionHint(
  input: string,
  units: { parseUnit: DisplayUnit; displayUnit: DisplayUnit }
): string | null {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    return null;
  }

  const parsed = parseLength(trimmedInput, units.parseUnit);
  if (!parsed.ok) {
    return null;
  }

  const hint = formatLength(parsed.valueMm, { unit: units.displayUnit });

  const canonicalize = (str: string): string => {
    return str
      .trim()
      .toLowerCase()
      .replace(/[′]/g, "'")
      .replace(/[″]/g, '"')
      .replace(/\s+/g, " ");
  };

  const canonicalHint = canonicalize(hint);
  const canonicalInput = canonicalize(trimmedInput);

  if (canonicalHint === canonicalInput) {
    return null;
  }

  // Trivial-suffix suppression: only when parseUnit === displayUnit
  if (units.parseUnit === units.displayUnit) {
    const unit = units.displayUnit;

    // Get the suffix to strip: only for in, cm, m (not ft)
    let suffix = "";
    if (unit === "in") {
      suffix = '"';
    } else if (unit === "cm") {
      suffix = " cm";
    } else if (unit === "m") {
      suffix = " m";
    }

    // If we have a suffix, try stripping it for comparison
    if (suffix) {
      const hintWithoutSuffix = canonicalHint.endsWith(suffix)
        ? canonicalHint.slice(0, -suffix.length)
        : canonicalHint;

      if (hintWithoutSuffix === canonicalInput) {
        return null;
      }
    }
  }

  return hint;
}
