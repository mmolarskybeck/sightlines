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

export function guessColumnMapping(table: ImportTable): {
  mapping: ColumnMapping;
  guesses: ColumnGuess[];
} {
  const guesses: ColumnGuess[] = [];
  const usedColumns = new Set<number>();

  for (const field of FIELD_ORDER) {
    const scored = table.columns
      .map((column) => {
        const headerScore = scoreHeader(field, column.label);
        const valueScore = scoreValues(field, table.rows.map((row) => row.values[column.index] ?? ""));
        const score = headerScore.score + valueScore.score;
        return {
          field,
          columnIndex: column.index,
          score,
          reason: headerScore.reason ?? valueScore.reason ?? "column values look related"
        };
      })
      .filter((guess) => guess.score > 0)
      .sort((a, b) => b.score - a.score);

    const winner = scored.find((guess) => !usedColumns.has(guess.columnIndex));
    if (!winner) continue;

    const confidence = confidenceForScore(winner.score);
    if (confidence === "low" && winner.score < 8) continue;

    usedColumns.add(winner.columnIndex);
    guesses.push({
      field,
      columnIndex: winner.columnIndex,
      confidence,
      reason: winner.reason
    });
  }

  return {
    mapping: Object.fromEntries(guesses.map((guess) => [guess.field, guess.columnIndex])),
    guesses
  };
}

export function normalizeImportText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreHeader(field: ImportField, label: string): { score: number; reason?: string } {
  const normalized = normalizeImportText(label);
  if (!normalized) return { score: 0 };

  for (const alias of FIELD_ALIASES[field]) {
    const normalizedAlias = normalizeImportText(alias);
    if (normalized === normalizedAlias) {
      return { score: 60, reason: `header matches "${alias}"` };
    }
    if (normalizedAlias.length > 1 && normalized.includes(normalizedAlias)) {
      return { score: 42, reason: `header includes "${alias}"` };
    }
  }

  return { score: 0 };
}

function scoreValues(field: ImportField, values: string[]): { score: number; reason?: string } {
  const sample = values.filter((value) => value.trim().length > 0).slice(0, 25);
  if (sample.length === 0) return { score: 0 };

  const ratio = (predicate: (value: string) => boolean) =>
    sample.filter(predicate).length / sample.length;

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
    const accessionRatio = ratio((value) =>
      /[a-z./_-]/i.test(value.trim()) && /^[a-z]*\s*\d+[a-z0-9./_-]*$/i.test(value.trim())
    );
    if (accessionRatio >= 0.45) return { score: 18, reason: "values look like object numbers" };
  }

  return { score: 0 };
}

function confidenceForScore(score: number): ImportConfidence {
  if (score >= 45) return "high";
  if (score >= 20) return "medium";
  return "low";
}
