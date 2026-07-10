import type { WallObject } from "../project";

// How a same-wall overlapping pair is allowed to resolve at commit time.
//
//   "forbidden"  — the overlap can never be committed, whatever the curator's
//                  "Allow overlap" preference says. Two obstacles (doors,
//                  windows, blocked zones) occupying the same space is not a
//                  layout opinion, it's a physical impossibility, so there's
//                  no override for it.
//   "blockable"  — the overlap is rejected by default but the curator can opt
//                  in via "Allow overlap" (an artwork stacked over an obstacle,
//                  or two artworks sharing space, is a deliberate-if-unusual
//                  arrangement worth permitting).
export type OverlapRule = "forbidden" | "blockable";

// Single source of truth for classifying an overlapping same-wall pair. Both
// the commit gate (store.ts's gatePlacementWarnings) and the upcoming drag
// barriers (dragBarriers.ts) derive their behavior from this one function, so
// the policy can never drift between "what a drag lets you do" and "what a
// commit accepts". Kept pure and kind-only: overlap geometry is decided
// separately by doWallObjectsOverlap; this answers only "if these two kinds
// overlap, how strict are we?".
//
// Rule: two non-artwork objects (opening × opening) are "forbidden"; any pair
// that involves an artwork (artwork × opening or artwork × artwork) is
// "blockable".
export function getOverlapRule(a: WallObject["kind"], b: WallObject["kind"]): OverlapRule {
  const aIsArtwork = a === "artwork";
  const bIsArtwork = b === "artwork";
  return !aIsArtwork && !bIsArtwork ? "forbidden" : "blockable";
}
