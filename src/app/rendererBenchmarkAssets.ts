import { rendererBenchmarkEnabled } from "./rendererBenchmarkFlag";

// Non-persisting benchmark fixtures load images directly instead of from IndexedDB.
const benchmarkImageUrls = import.meta.glob(
  "../../fixtures/artworks/wikimedia/images/*.jpg",
  { eager: true, import: "default", query: "?url" }
) as Record<string, string>;

export async function getRendererBenchmarkBlob(key: string): Promise<Blob | null> {
  const tierSuffix = key.endsWith(":display")
    ? ":display"
    : key.endsWith(":thumbnail")
      ? ":thumbnail"
      : null;
  if (!rendererBenchmarkEnabled || !tierSuffix) return null;
  const assetId = key.slice(0, -tierSuffix.length);
  const url = Object.entries(benchmarkImageUrls).find(([path]) =>
    path.endsWith(`/images/${assetId}.jpg`)
  )?.[1];
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.blob();
}
