import type { Artwork } from "../../../domain/project";

export type BulkTextKey = "artist" | "date" | "medium" | "locationOrLender" | "creditLine";

export const TEXT_SOURCES: Record<BulkTextKey, (a: Artwork) => string | undefined> = {
  artist: (a) => a.artist,
  date: (a) => a.date,
  medium: (a) => (typeof a.metadata.medium === "string" ? a.metadata.medium : undefined),
  locationOrLender: (a) => a.locationOrLender,
  creditLine: (a) => a.creditLine
};

// The value every target shares (trimmed, undefined ≡ ""), or null when they differ.
export function sharedValue<T>(
  artworks: Artwork[],
  read: (a: Artwork) => T | undefined
): T | "" | null {
  if (artworks.length === 0) return "";
  const norm = (a: Artwork): T | "" => {
    const v = read(a);
    return typeof v === "string" ? ((v.trim() as unknown) as T) : (v ?? "");
  };
  const first = norm(artworks[0]);
  return artworks.every((a) => norm(a) === first) ? first : null;
}

export const TEXT_FIELDS: { key: BulkTextKey; label: string }[] = [
  { key: "artist", label: "Artist" },
  { key: "date", label: "Date" },
  { key: "medium", label: "Medium" },
  { key: "locationOrLender", label: "Lender / location" },
  { key: "creditLine", label: "Credit line" }
];
