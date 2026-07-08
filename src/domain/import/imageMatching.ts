import { ACCEPTED_IMAGE_MIME_TYPES } from "../assets/imageIntake";
import { normalizeImportText } from "./columnMapping";
import type { ImageMatchCandidate, ImageMatchResult } from "./types";

export type ImageMatchArtwork = {
  title?: string;
  artist?: string;
  date?: string;
  accessionNumber?: string;
  imageFilename?: string;
};

const AUTO_MATCH_THRESHOLD = 85;
const REVIEW_MATCH_THRESHOLD = 55;

export function filterImportImageFiles(files: File[]): File[] {
  return files.filter((file) =>
    (ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)
  );
}

export function matchImageFile(artwork: ImageMatchArtwork, imageFiles: File[]): ImageMatchResult {
  const candidates = imageFiles
    .map((file) => scoreImageCandidate(artwork, file))
    .filter((candidate) => candidate.score >= REVIEW_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best) return { status: "none", candidates };

  if (best.score >= AUTO_MATCH_THRESHOLD) {
    return { status: "matched", file: best.file, score: best.score, reason: best.reason };
  }

  return { status: "needs-review", candidates: candidates.slice(0, 4) };
}

export function flagImageConflicts(matches: ImageMatchResult[]): ImageMatchResult[] {
  const matchedByName = new Map<string, number[]>();

  matches.forEach((match, index) => {
    if (match.status !== "matched") return;
    const key = match.file.name;
    matchedByName.set(key, [...(matchedByName.get(key) ?? []), index]);
  });

  return matches.map((match, index) => {
    if (match.status !== "matched") return match;
    const peers = matchedByName.get(match.file.name) ?? [];
    if (peers.length <= 1 || peers[0] === index) return match;
    return {
      status: "conflict",
      file: match.file,
      candidates: [{ file: match.file, score: match.score, reason: match.reason }],
      reason: "another row already matched this image"
    };
  });
}

function scoreImageCandidate(artwork: ImageMatchArtwork, file: File): ImageMatchCandidate {
  const filename = normalizeImportText(file.name);
  const imageFilename = normalizeImportText(basename(artwork.imageFilename ?? ""));
  const accession = normalizeImportText(artwork.accessionNumber ?? "");
  const title = normalizeImportText(artwork.title ?? "");
  const artist = normalizeImportText(artwork.artist ?? "");
  const artistLast = artist.split(" ").filter(Boolean).at(-1) ?? "";
  const date = normalizeImportText(artwork.date ?? "");

  if (imageFilename && filename === imageFilename) {
    return { file, score: 100, reason: "exact filename" };
  }

  if (imageFilename && filename.includes(imageFilename)) {
    return { file, score: 92, reason: "filename column" };
  }

  if (accession && compact(filename).includes(compact(accession))) {
    return { file, score: 90, reason: "accession number" };
  }

  const titleIsWeak = title === "untitled" || title === "unknown";
  if (title && !titleIsWeak && artistLast && filename.includes(title) && filename.includes(artistLast)) {
    return { file, score: 82, reason: "artist and title" };
  }

  if (title && !titleIsWeak && filename.includes(title)) {
    return { file, score: 68, reason: "title" };
  }

  if (artistLast && date && filename.includes(artistLast) && filename.includes(date)) {
    return { file, score: 58, reason: "artist and date" };
  }

  return { file, score: 0, reason: "no strong signal" };
}

function compact(value: string): string {
  return value.replace(/[^a-z0-9]+/g, "");
}

function basename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
}
