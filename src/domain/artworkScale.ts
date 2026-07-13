import type { Artwork } from "./project";

// Scale confidence depends on width and height; depth only affects the footprint.
export type ArtworkScaleState = "missing" | "estimated" | "true";

export function getArtworkScaleState(artwork: Pick<Artwork, "dimensions">): ArtworkScaleState {
  const { widthMm, heightMm, status } = artwork.dimensions;
  if (widthMm === undefined || heightMm === undefined) return "missing";
  return status === "known" ? "true" : "estimated";
}

// Estimated dimensions are sufficient for the compact inspector layout.
export function isArtworkRecordComplete(artwork: Pick<Artwork, "title" | "dimensions">): boolean {
  const hasTitle = (artwork.title ?? "").trim().length > 0;
  return hasTitle && getArtworkScaleState(artwork) !== "missing";
}
