import type {
  ColumnGuess,
  ColumnMapping,
  ImportConfidence,
  ImportField,
  ImportTable
} from "./types";

const FIELD_ALIASES: Record<ImportField, string[]> = {
  artist: ["artist", "artist name", "creator", "maker", "author", "photographer"],
  title: ["title", "work title", "object title", "artwork title"],
  date: ["date", "year", "object date", "creation date", "dated"],
  accessionNumber: [
    "accession",
    "accession number",
    "object number",
    "object no",
    "inventory number",
    "inv no",
    "catalog number",
    "cat no"
  ],
  locationOrLender: ["location", "current location", "gallery", "lender", "owner", "collection"],
  dimensions: ["dimensions", "dims", "size", "measurements", "display dimensions"],
  height: ["height", "h", "height cm", "height in", "height mm"],
  width: ["width", "w", "width cm", "width in", "width mm"],
  depth: ["depth", "d", "depth cm", "depth in", "depth mm"],
  imageFilename: ["image", "image file", "filename", "file name", "image filename", "image path"],
  medium: ["medium", "materials", "material", "technique"]
};

const FIELD_ORDER: ImportField[] = [
  "artist",
  "title",
  "date",
  "accessionNumber",
  "dimensions",
  "height",
  "width",
  "depth",
  "imageFilename",
  "locationOrLender",
  "medium"
];

const FIELD_ORDER_INDEX = new Map<ImportField, number>(FIELD_ORDER.map((field, index) => [field, index]));

// Score floor below which a (field, column) pairing is noise, not a guess.
const MIN_SCORE = 8;

export function guessColumnMapping(table: ImportTable): {
  mapping: ColumnMapping;
  guesses: ColumnGuess[];
} {
  const candidates: { field: ImportField; columnIndex: number; score: number; reason: string }[] = [];

  for (const field of FIELD_ORDER) {
    for (const column of table.columns) {
      // Disqualifying tokens zero the whole pair up front — a column named
      // "byte_size" can't be resurrected for "dimensions" just because its
      // header also happens to include the "size" alias.
      if (isDisqualified(field, column.label)) continue;

      const headerScore = scoreHeader(field, column.label);
      const valueScore = scoreValues(
        field,
        table.rows.map((row) => row.values[column.index] ?? ""),
        column.label
      );
      const score = headerScore.score + valueScore.score;
      if (score < MIN_SCORE) continue;

      candidates.push({
        field,
        columnIndex: column.index,
        score,
        reason: headerScore.reason ?? valueScore.reason ?? "column values look related"
      });
    }
  }

  // Explicit total order (score desc, then FIELD_ORDER position, then column
  // index) rather than relying on Array.prototype.sort's stability alone —
  // this is what makes the walk below deterministic across runs/engines.
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const fieldDelta = FIELD_ORDER_INDEX.get(a.field)! - FIELD_ORDER_INDEX.get(b.field)!;
    if (fieldDelta !== 0) return fieldDelta;
    return a.columnIndex - b.columnIndex;
  });

  // Greedy-by-score assignment, not a Hungarian/optimal one: each pass claims
  // the best remaining (field, column) pair. That's deliberate — it's
  // deterministic, gives an explainable per-column reason, and is good enough
  // for real-world spreadsheets where field-vs-column conflicts are rare.
  const usedFields = new Set<ImportField>();
  const usedColumns = new Set<number>();
  const guesses: ColumnGuess[] = [];

  for (const candidate of candidates) {
    if (usedFields.has(candidate.field) || usedColumns.has(candidate.columnIndex)) continue;

    usedFields.add(candidate.field);
    usedColumns.add(candidate.columnIndex);
    guesses.push({
      field: candidate.field,
      columnIndex: candidate.columnIndex,
      confidence: confidenceForScore(candidate.score),
      reason: candidate.reason
    });
  }

  // Restore FIELD_ORDER order so downstream UI sees stable array ordering,
  // independent of the score-first order used for the assignment walk.
  guesses.sort((a, b) => FIELD_ORDER_INDEX.get(a.field)! - FIELD_ORDER_INDEX.get(b.field)!);

  return {
    mapping: Object.fromEntries(guesses.map((guess) => [guess.field, guess.columnIndex])),
    guesses
  };
}

export function normalizeImportText(value: string): string {
  return value
    // Preserve semantic word boundaries used by APIs and database exports.
    // Do this before lowercasing: artistName -> artist Name, heightCM ->
    // height CM, and IIIFImageURL -> IIIF Image URL.
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokensOf(text: string): Set<string> {
  return new Set(normalizeImportText(text).split(" ").filter(Boolean));
}

function isSubsetOf(small: Set<string>, big: Set<string>): boolean {
  for (const token of small) {
    if (!big.has(token)) return false;
  }
  return true;
}

function tokenSetsEqual(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && isSubsetOf(a, b);
}

// Word-boundary-aware unit tokens (post-normalization, so "height_cm" and
// "Height (cm)" both reduce to a "cm" token rather than needing a raw regex).
const UNIT_TOKENS = new Set(["cm", "mm", "in", "inch", "inches", "ft", "feet", "m", "meter", "meters"]);

// Per-axis fields where a unit in the header disambiguates the column's
// scale enough to be worth a bonus. "dimensions" is a free-text field (e.g.
// "24 x 30 in") so a bare unit token in ITS header isn't the same signal.
const UNIT_BONUS_FIELDS = new Set<ImportField>(["height", "width", "depth"]);

function scoreHeader(field: ImportField, label: string): { score: number; reason?: string } {
  const labelTokens = tokensOf(label);
  if (labelTokens.size === 0) return { score: 0 };
  const compactLabel = [...labelTokens].join("");

  let best: { score: number; reason?: string } = { score: 0 };

  for (const alias of FIELD_ALIASES[field]) {
    const aliasTokens = tokensOf(alias);
    if (aliasTokens.size === 0) continue;

    let score = 0;
    if (tokenSetsEqual(labelTokens, aliasTokens)) {
      const [onlyAliasToken] = aliasTokens;
      const isSingleCharAlias = aliasTokens.size === 1 && onlyAliasToken.length === 1;
      // A header that is JUST a single letter ("H") is too weak to trust on the
      // header alone — a stray "W" column could be anything. It earns a score
      // only when its VALUES look like measurements (see scoreValues), so the
      // strong exact-match score is withheld here.
      score = isSingleCharAlias ? 0 : 60;
    } else if (compactLabel === [...aliasTokens].join("")) {
      // Some exports flatten identifiers completely (ARTISTNAME, imagefile).
      // Requiring the whole compacted header to equal a known alias keeps this
      // generous without introducing fuzzy substring matches such as
      // "copyright" -> "right".
      score = 56;
    } else if (isSubsetOf(aliasTokens, labelTokens)) {
      const [onlyAliasToken] = aliasTokens;
      const isSingleCharAlias = aliasTokens.size === 1 && onlyAliasToken.length === 1;
      if (isSingleCharAlias) {
        // "h"/"w"/"d" are too short to trust alone — only count the match
        // when every leftover label token is itself a unit ("H (cm)" should
        // match height, but "h res" must not).
        const leftover = [...labelTokens].filter((token) => !aliasTokens.has(token));
        if (leftover.length > 0 && leftover.every((token) => UNIT_TOKENS.has(token))) {
          score = 42;
        }
      } else {
        score = 42;
      }
    }

    if (score === 0) continue;

    // Bonus only stacks on top of an existing alias match — it's never a
    // score of its own — and only for the per-axis fields.
    if (UNIT_BONUS_FIELDS.has(field) && [...labelTokens].some((token) => UNIT_TOKENS.has(token))) {
      score += 8;
    }

    if (score > best.score) {
      best = { score, reason: `header ${score >= 60 ? "matches" : "includes"} "${alias}"` };
    }
  }

  return best;
}

// Tokens that disqualify a column for every field — these describe pixel
// geometry, file integrity, or MIME metadata, never a mappable artwork field.
const UNIVERSAL_DISQUALIFIER_TOKENS = new Set([
  "px",
  "pixel",
  "pixels",
  "byte",
  "bytes",
  "kb",
  "mb",
  "gb",
  "mime",
  "sha",
  "sha1",
  "sha256",
  "md5",
  "hash",
  "checksum",
  "dpi",
  "ppi"
]);

// Extra disqualifiers for fields where a stray substring match would
// otherwise be plausible: an image/download URL column is noise for every
// field it might coincidentally resemble, not just imageFilename — imports
// match against local image FILES, so URL columns map nowhere, deliberately.
const URL_LIKE_DISQUALIFIER_FIELDS = new Set<ImportField>([
  "height",
  "width",
  "depth",
  "dimensions",
  "imageFilename"
]);
const URL_LIKE_DISQUALIFIER_TOKENS = new Set(["url", "link", "resolution", "id"]);

// "file" would break the "file name"/"image file" aliases for imageFilename,
// so it only disqualifies the physical-dimension fields.
const FILE_DISQUALIFIED_FIELDS = new Set<ImportField>(["height", "width", "depth", "dimensions"]);

function disqualifierTokensFor(field: ImportField): Set<string> {
  const tokens = new Set(UNIVERSAL_DISQUALIFIER_TOKENS);
  if (URL_LIKE_DISQUALIFIER_FIELDS.has(field)) {
    for (const token of URL_LIKE_DISQUALIFIER_TOKENS) tokens.add(token);
  }
  if (FILE_DISQUALIFIED_FIELDS.has(field)) tokens.add("file");
  return tokens;
}

function isDisqualified(field: ImportField, label: string): boolean {
  const disqualifiers = disqualifierTokensFor(field);
  for (const token of tokensOf(label)) {
    if (disqualifiers.has(token)) return true;
  }
  return false;
}

// A header that is EXACTLY one of these single letters carries no unit token
// to lean on ("H (cm)" would), so it can only earn a score when its column's
// VALUES look like measurements — see the scoreValues branch below.
const BARE_AXIS_LETTER: Partial<Record<ImportField, string>> = {
  height: "h",
  width: "w",
  depth: "d"
};

function scoreValues(
  field: ImportField,
  values: string[],
  label: string
): { score: number; reason?: string } {
  const sample = values.filter((value) => value.trim().length > 0).slice(0, 25);
  if (sample.length === 0) return { score: 0 };

  const ratio = (predicate: (value: string) => boolean) =>
    sample.filter(predicate).length / sample.length;

  // Legacy exports (e.g. CAD reports) label their size columns just "H"/"W"/"D".
  // A bare letter is too weak to score on the header alone, but when the token
  // set is EXACTLY that letter — so "h res" and "H (cm)" are both excluded —
  // and most values parse as measurements, a medium score is warranted.
  const axisLetter = BARE_AXIS_LETTER[field];
  if (axisLetter) {
    const labelTokens = tokensOf(label);
    if (labelTokens.size === 1 && labelTokens.has(axisLetter)) {
      const measurementRatio = ratio(looksLikeMeasurementValue);
      if (measurementRatio >= 0.6) {
        return { score: 22, reason: `bare "${axisLetter.toUpperCase()}" column with numeric values` };
      }
    }
  }

  if (field === "imageFilename") {
    const imageRatio = ratio((value) => /\.(jpe?g|png|webp|tiff?)$/i.test(value.trim()));
    if (imageRatio >= 0.35) return { score: 34, reason: "values look like image filenames" };
  }

  if (field === "dimensions") {
    const dimensionRatio = ratio((value) =>
      /\d/.test(value) && /(×| x | in\b|cm\b|mm\b|framed|sheet|image|object)/i.test(value)
    );
    if (dimensionRatio >= 0.35) return { score: 28, reason: "values look like dimensions" };
  }

  if (field === "date") {
    const dateRatio = ratio((value) => /\b(?:1[5-9]\d{2}|20\d{2}|c\.|circa)\b/i.test(value));
    if (dateRatio >= 0.45) return { score: 20, reason: "values look like dates" };
  }

  if (field === "accessionNumber") {
    const accessionRatio = ratio((value) => looksLikeAccessionValue(value));
    if (accessionRatio >= 0.45) return { score: 18, reason: "values look like object numbers" };
  }

  return { score: 0 };
}

// Bare numbers ("73.7") read identically to a plain measurement, so they can
// never earn accessionNumber points from values alone — only letter-prefixed
// ("P.123", "INV 2003.4") or multi-segment ("1979.620.1") shapes count. An
// all-numeric accession column can still map, but only via a header alias
// (see the "Numeric accessions via header only" test).
function looksLikeAccessionValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return false;
  // Catalog codes are normally compact (ABC123), punctuated (P.123), or
  // uppercase prefixes (INV 2003.4). Requiring one of those shapes prevents
  // ordinary prose such as "height 45 cm" or "hoogte 45,5 cm" from being
  // mistaken for an accession number.
  if (/^[a-z]{1,6}[.-]\s*\d/i.test(trimmed)) return true;
  if (/^[a-z]{1,4}\d/i.test(trimmed)) return true;
  if (/^[A-Z]{1,6}\s+\d/.test(trimmed)) return true;
  const dotCount = (trimmed.match(/\./g) ?? []).length;
  return dotCount >= 2 && /^\d/.test(trimmed);
}

// A cell "looks like a measurement" if it's a bare positive decimal ("12",
// "12.5") or a number carrying a length unit, fraction, or inch/foot mark
// ("12 cm", "9 5/16\"", "2 1/2\""). Deliberately narrow so a numeric column of
// pixel counts or years can't masquerade as a bare-letter size column.
function looksLikeMeasurementValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed) > 0;
  if (
    /^\d/.test(trimmed) &&
    /(\d\s*\d+\/\d+|\/|["']|\b(?:cm|mm|in|ft|m|inch|inches|feet)\b)/i.test(trimmed)
  ) {
    return true;
  }
  return false;
}

function confidenceForScore(score: number): ImportConfidence {
  if (score >= 45) return "high";
  if (score >= 20) return "medium";
  return "low";
}
