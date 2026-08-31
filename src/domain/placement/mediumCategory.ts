// Medium → display-type defaults. The one place that decides what a curator
// typing "Film/video" into the Medium field is understood to mean, so the
// inspector's suggestion list, the display default, and any future consumer
// can never disagree about the vocabulary.
//
// EXACT MATCH ONLY, deliberately. "Oil on canvas" is not a painting category
// here, and "single-channel video, 12 min" is not a video one — both return
// undefined, and the work keeps whatever display type it already had. A
// substring rule would be more clever and far less predictable: it would let a
// free-text sentence silently restage a work in the room, and the failure
// ("why is my photograph suddenly a projection?") would be invisible. The
// combobox in the inspector is what makes the exact vocabulary reachable; a
// curator who wants the default picks the suggestion, and one who wants prose
// types prose and keeps control of Display.
//
// Medium is stored as free text at artwork.metadata.medium (the slot the
// spreadsheet importer writes and every export reads) — this module never
// changes that, it only READS it.

import type { ArtworkDisplayAs } from "../project";

// The handful of medium families that imply how a work is shown in a room.
// Not a taxonomy of art: a taxonomy of DISPLAY, which is why "drawing" and
// "print" collapse into one member (both hang framed) while "video" is its own
// (it needs a surface to play on).
export type MediumCategory =
  | "photograph"
  | "video"
  | "painting"
  | "sculpture"
  | "installation"
  | "drawingPrint";

// The display strings offered in the Medium field's combobox. Order is the
// order they appear; the canonical spelling of each category is its first
// alias below, capitalized.
export const MEDIUM_SUGGESTIONS: string[] = [
  "Photograph",
  "Film/video",
  "Painting",
  "Sculpture",
  "Installation",
  "Drawing/print"
];

// Every accepted spelling, already normalized (lowercase, no spaces around a
// slash). Kept flat rather than nested so the lookup is a single Map.get.
const CATEGORY_BY_ALIAS = new Map<string, MediumCategory>([
  ["photograph", "photograph"],
  ["photo", "photograph"],
  ["photography", "photograph"],
  ["film/video", "video"],
  ["film", "video"],
  ["video", "video"],
  ["painting", "painting"],
  ["sculpture", "sculpture"],
  ["installation", "installation"],
  ["drawing/print", "drawingPrint"],
  ["drawing", "drawingPrint"],
  ["print", "drawingPrint"]
]);

// Trim, lowercase, tighten the spacing around a slash ("Film / video" and
// "Film/video" are the same answer), then collapse any remaining runs of
// whitespace. Nothing else is stripped — punctuation a curator typed is part of
// the string and makes it prose, which is exactly what should NOT match.
function normalizeMedium(medium: string): string {
  return medium
    .trim()
    .toLowerCase()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ");
}

// The category a medium string names outright, or undefined for prose (and for
// an absent/empty medium). Undefined is a real answer, not a failure: it means
// "this string doesn't state a display family", and callers must fall back
// rather than guess.
export function mediumCategory(medium: string | undefined): MediumCategory | undefined {
  if (typeof medium !== "string") return undefined;
  const normalized = normalizeMedium(medium);
  if (normalized.length === 0) return undefined;
  return CATEGORY_BY_ALIAS.get(normalized);
}

// How a work of this medium family is shown by default. A photograph, a
// painting and a drawing all hang framed; a video wants a surface (v1 answers
// "wall projection" — a monitor is a deliberate choice, never a default,
// because it is a piece of equipment the curator has to actually own); a
// sculpture and an installation stand in the room.
export function defaultDisplayAsForCategory(
  category: MediumCategory | undefined
): ArtworkDisplayAs | undefined {
  switch (category) {
    case "photograph":
    case "painting":
    case "drawingPrint":
      return "framed";
    case "video":
      return "projection";
    case "sculpture":
    case "installation":
      return "sculpture";
    default:
      return undefined;
  }
}
