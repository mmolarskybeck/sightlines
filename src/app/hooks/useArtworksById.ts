import { useMemo } from "react";
import type { Artwork } from "../../domain/project";
import { useAppStore } from "../store";

// The library keyed by artwork id. Placements store only an artworkId, so every
// surface that draws or exports one needs this map; sharing the hook keeps the
// several consumers on one memo per render tree instead of rebuilding it each.
export function useArtworksById(): Map<string, Artwork> {
  const libraryArtworks = useAppStore((state) => state.libraryArtworks);
  return useMemo(
    () => new Map(libraryArtworks.map((artwork) => [artwork.id, artwork])),
    [libraryArtworks]
  );
}
