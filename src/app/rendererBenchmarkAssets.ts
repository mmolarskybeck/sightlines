// Non-persisting benchmark fixtures load images directly instead of from IndexedDB.
const benchmarkImageUrls = import.meta.glob(
  "../../fixtures/artworks/wikimedia/images/*.jpg",
  { eager: true, import: "default", query: "?url" }
) as Record<string, string>;

export const rendererBenchmarkEnabled =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("benchmark") === "renderer";

export async function getRendererBenchmarkBlob(key: string): Promise<Blob | null> {
  if (!rendererBenchmarkEnabled || !key.endsWith(":display")) return null;
  const assetId = key.slice(0, -":display".length);
  const url = Object.entries(benchmarkImageUrls).find(([path]) =>
    path.endsWith(`/images/${assetId}.jpg`)
  )?.[1];
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.blob();
}
