# Wikimedia Artwork Corpus

Small public-domain artwork fixture set for Sightlines testing.

## Contents

- `images/`: resized JPEG downloads from Wikimedia Commons.
- `metadata.json`: structured corpus metadata, including artwork details and image file checksums.
- `metadata.csv`: flat metadata table for quick imports or spreadsheet inspection.

## Artworks

| Title | Artist | Year | Physical dimensions |
| --- | --- | --- | --- |
| Mona Lisa | Leonardo da Vinci | c. 1503-1506 | 77 x 53 cm |
| The Starry Night | Vincent van Gogh | 1889 | 73.7 x 92.1 cm |
| Girl with a Pearl Earring | Johannes Vermeer | c. 1665 | 44.5 x 39 cm |
| The Great Wave off Kanagawa | Katsushika Hokusai | 1831 | 24.6 x 36.5 cm |
| The Birth of Venus | Sandro Botticelli | c. 1484-1486 | 172.5 x 278.9 cm |
| The Swing | Jean-Honore Fragonard | c. 1767-1768 | 81 x 64.2 cm |

## Notes

The downloaded images are intentionally resized through Wikimedia's file endpoint so the fixture set stays lightweight. Source file pages and download URLs are recorded per artwork in both metadata files.

All included works are public domain due to age; verify each linked Wikimedia Commons file page before any non-test reuse.
