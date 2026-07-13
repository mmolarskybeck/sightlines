import type { WallObject } from "../project";

// Forbidden overlaps cannot be overridden; blockable overlaps can.
export type OverlapRule = "forbidden" | "blockable";

// Non-artwork pairs are physical conflicts; pairs involving artwork are optional.
export function getOverlapRule(a: WallObject["kind"], b: WallObject["kind"]): OverlapRule {
  const aIsArtwork = a === "artwork";
  const bIsArtwork = b === "artwork";
  return !aIsArtwork && !bIsArtwork ? "forbidden" : "blockable";
}
