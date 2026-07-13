import type { Artwork } from "./project";

// Whether an artwork's on-canvas size is trustworthy, and how much the
// inspector should trust the curator's own dimensions over what's typed.
// "missing" means the renderer has no real width/height to work from at all —
// it falls back to a placeholder size taken from the image's aspect ratio, so
// nothing drawn to scale can be believed. "estimated" and "true" both have
// real numbers driving the render; they differ only in whether the curator
// has vouched for those numbers (status "known") or not ("approximate" /
// "unknown"). depthMm never enters this: depth affects footprint and
// wall-vs-floor form (see placement/artworkForm.ts), never the width/height
// scale a 2D elevation or plan draws against.
export type ArtworkScaleState = "missing" | "estimated" | "true";

export function getArtworkScaleState(artwork: Pick<Artwork, "dimensions">): ArtworkScaleState {
  const { widthMm, heightMm, status } = artwork.dimensions;
  if (widthMm === undefined || heightMm === undefined) return "missing";
  return status === "known" ? "true" : "estimated";
}

// Gate for the inspector's compact-identity mode: a record only earns the
// terse, identity-led layout once it has both a name to show and dimensions
// real enough to render at scale (estimated dims still count — only a
// missing width/height forces the fuller, dims-first layout back on).
export function isArtworkRecordComplete(artwork: Pick<Artwork, "title" | "dimensions">): boolean {
  const hasTitle = (artwork.title ?? "").trim().length > 0;
  return hasTitle && getArtworkScaleState(artwork) !== "missing";
}
