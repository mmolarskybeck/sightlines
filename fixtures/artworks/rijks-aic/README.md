# Rijksmuseum + Art Institute of Chicago artwork corpus

Starter public-domain / openly licensed artwork corpus for Sightlines testing and sample projects.

- `images/`: JPEGs requested at approximately 1800px wide through the museums’ official IIIF services.
- `metadata.json`: structured records, source URLs, rights notes, and SHA-256 checksums.
- `metadata.csv`: flat version for quick inspection or import.
- `scripts/download-museum-artworks.mjs`: repeatable resolver and downloader.

The corpus intentionally mixes canonical works with less famous paintings, prints, and objects. The downloader re-resolves each record from the museums’ APIs and preserves the museum’s rights information; review the linked object record before any use beyond testing or sample projects.

Run from the repository root with:

```sh
node scripts/download-museum-artworks.mjs
```
