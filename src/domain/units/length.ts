import type { DisplayUnit } from "../project";

export type ParseLengthResult =
  | { ok: true; valueMm: number }
  | { ok: false; error: string };

export type LengthFormatOptions = {
  unit: DisplayUnit;
  fractionDenominator?: 4 | 8 | 16 | 32;
  precision?: number;
  feetAndInches?: boolean;
  secondaryUnit?: DisplayUnit;
};

const MM_PER_INCH = 25.4;
const MM_PER_FOOT = MM_PER_INCH * 12;

export function inchesToMm(inches: number): number {
  return inches * MM_PER_INCH;
}

export function feetToMm(feet: number): number {
  return feet * MM_PER_FOOT;
}

export function cmToMm(cm: number): number {
  return cm * 10;
}

export function mToMm(meters: number): number {
  return meters * 1000;
}

export function mmToInches(mm: number): number {
  return mm / MM_PER_INCH;
}

export function parseLength(
  input: string,
  contextUnit: DisplayUnit
): ParseLengthResult {
  const source = input.trim().toLowerCase().replace(/[′]/g, "'").replace(/[″]/g, '"');

  if (!source) {
    return { ok: false, error: "Enter a measurement." };
  }

  const feetMatch = source.match(
    /^([+-]?\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?))?\s*(?:(\d+)\/(\d+))?\s*(?:"|in|inch|inches)?$/
  );

  if (feetMatch) {
    // A leading minus negates the ENTIRE compound value, not just the feet
    // component: "-5' 3 9/16" is −(5' + 3 9/16"), so format→parse round-trips.
    // Parsing the sign separately and taking |feet| keeps the inches from
    // being added back in with the wrong polarity.
    const negative = feetMatch[1].startsWith("-");
    const feet = Math.abs(Number(feetMatch[1]));
    const wholeInches = Number(feetMatch[2] ?? 0);
    const numerator = Number(feetMatch[3] ?? 0);
    const denominator = Number(feetMatch[4] ?? 1);

    if (denominator === 0) {
      return { ok: false, error: "Fractions cannot divide by zero." };
    }

    const magnitudeMm =
      feetToMm(feet) + inchesToMm(wholeInches + numerator / denominator);

    return { ok: true, valueMm: negative ? -magnitudeMm : magnitudeMm };
  }

  const mixedFractionMatch = source.match(
    /^([+-]?\d+)?\s*(?:(\d+)\/(\d+))\s*(?:"|in|inch|inches)?$/
  );

  if (mixedFractionMatch) {
    // Same leading-minus rule as the feet branch: "-3 9/16" is −(3 9/16"), so
    // the fraction isn't subtracted from a negative whole (which would read as
    // −2 7/16"). Parse the sign off the whole part and negate the total.
    const wholeRaw = mixedFractionMatch[1] ?? "0";
    const negative = wholeRaw.startsWith("-");
    const whole = Math.abs(Number(wholeRaw));
    const numerator = Number(mixedFractionMatch[2]);
    const denominator = Number(mixedFractionMatch[3]);

    if (denominator === 0) {
      return { ok: false, error: "Fractions cannot divide by zero." };
    }

    const magnitudeMm = inchesToMm(whole + numerator / denominator);

    return { ok: true, valueMm: negative ? -magnitudeMm : magnitudeMm };
  }

  const explicitUnitMatch = source.match(
    /^([+-]?\d+(?:\.\d+)?)\s*(mm|millimeter|millimeters|cm|centimeter|centimeters|m|meter|meters|in|inch|inches|"|ft|feet|')$/
  );

  if (explicitUnitMatch) {
    const value = Number(explicitUnitMatch[1]);
    const unit = explicitUnitMatch[2];

    return { ok: true, valueMm: valueToMm(value, unitToDisplayUnit(unit)) };
  }

  const bareNumberMatch = source.match(/^([+-]?\d+(?:\.\d+)?)$/);

  if (bareNumberMatch) {
    return {
      ok: true,
      valueMm: valueToMm(Number(bareNumberMatch[1]), contextUnit)
    };
  }

  return { ok: false, error: `Could not parse "${input}" as a measurement.` };
}

export function formatLength(mm: number, options: LengthFormatOptions): string {
  const primary = formatSingleLength(mm, options.unit, options);

  if (!options.secondaryUnit || options.secondaryUnit === options.unit) {
    return primary;
  }

  return `${primary} (${formatSingleLength(mm, options.secondaryUnit, options)})`;
}

function formatSingleLength(
  mm: number,
  unit: DisplayUnit,
  options: LengthFormatOptions
): string {
  if (unit === "ft") {
    return formatFeetAndInches(mm, options.fractionDenominator ?? 16);
  }

  if (unit === "in") {
    return `${formatFractionalNumber(mmToInches(mm), options.fractionDenominator ?? 16)}"`;
  }

  if (unit === "cm") {
    return `${trimNumber(mm / 10, options.precision ?? 1)} cm`;
  }

  return `${trimNumber(mm / 1000, options.precision ?? 2)} m`;
}

function valueToMm(value: number, unit: DisplayUnit | "mm"): number {
  switch (unit) {
    case "mm":
      return value;
    case "cm":
      return cmToMm(value);
    case "m":
      return mToMm(value);
    case "ft":
      return feetToMm(value);
    case "in":
      return inchesToMm(value);
  }
}

function unitToDisplayUnit(unit: string): DisplayUnit | "mm" {
  if (unit === "mm" || unit.startsWith("millimeter")) return "mm";
  if (unit === "cm" || unit.startsWith("centimeter")) return "cm";
  if (unit === "m" || unit.startsWith("meter")) return "m";
  if (unit === "ft" || unit === "feet" || unit === "'") return "ft";
  return "in";
}

function formatFeetAndInches(mm: number, denominator: number): string {
  const sign = mm < 0 ? "-" : "";
  const totalInches = Math.abs(mmToInches(mm));
  let feet = Math.floor(totalInches / 12);
  let inches = totalInches - feet * 12;

  const roundedInches = roundToDenominator(inches, denominator);

  if (roundedInches >= 12) {
    feet += 1;
    inches = 0;
  } else {
    inches = roundedInches;
  }

  const inchText = formatFractionalNumber(inches, denominator);

  if (feet === 0) {
    return `${sign}${inchText}"`;
  }

  if (inchText === "0") {
    return `${sign}${feet}'`;
  }

  return `${sign}${feet}' ${inchText}"`;
}

function formatFractionalNumber(value: number, denominator: number): string {
  const rounded = roundToDenominator(value, denominator);
  const whole = Math.floor(rounded);
  const numerator = Math.round((rounded - whole) * denominator);

  if (numerator === 0) {
    return String(whole);
  }

  const divisor = gcd(numerator, denominator);
  const fraction = `${numerator / divisor}/${denominator / divisor}`;

  return whole > 0 ? `${whole} ${fraction}` : fraction;
}

function roundToDenominator(value: number, denominator: number): number {
  return Math.round(value * denominator) / denominator;
}

function trimNumber(value: number, precision: number): string {
  return value.toFixed(precision).replace(/\.?0+$/, "");
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
