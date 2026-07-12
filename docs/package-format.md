# The `.sightlines` Package Format

A `.sightlines` file is the self-contained, portable form of a single project: a
ZIP archive holding a JSON manifest plus the image blobs the project references.
It is the sharing and backup format (docs/plan.md §6), designed so a project can
travel to another machine with a different — or empty — artwork library and still
open completely.

This document describes the **export** format. Import is a later slice; every
decision here is made to keep that pipeline (docs/plan.md §13:
parse → validate shape → migrate → validate → persist, dedupe by sha256, graceful
missing-asset degradation) straightforward to build.

Relevant code:
- `src/domain/schema/packageSchema.ts` — the manifest zod contract (`SightlinesPackage`).
- `src/domain/package/buildPackage.ts` — pure manifest + file-list derivation.
- `src/domain/package/zipPackage.ts` — the fflate zip writer / reader.
- `src/app/store.ts` — `exportProjectPackage(mode)` action wiring it to repositories.

## Zip layout

```
<project-name>.sightlines            (a ZIP archive)
├── manifest.json                    the single, well-known entry point
└── assets/
    ├── <sha256>.webp                one image blob per unique content hash
    ├── <sha256>.jpg
    └── …
```

- **`manifest.json` at the root**, not `project.sightlines.json`. A fixed,
  well-known filename means import never has to guess a name derived from the
  project title. It is the only place structural facts live — nothing is implied
  by file ordering or naming (see asset keying below).
- **`assets/` holds image blobs, named by content hash** (`assets/<sha256>.<ext>`),
  not by asset id. See "Why content-addressed" below.

### Compression (docs/plan.md §4.5)

- **Image blobs are stored, not compressed** (ZIP method 0 / level 0). They are
  already-compressed WebP/JPEG/PNG bytes; deflating them again wastes CPU for no
  size benefit.
- **`manifest.json` is deflated** (level 6). JSON compresses well.

The writer uses fflate's async `zip`, which runs off the main thread, so packing
a large project does not freeze the UI. No dedicated worker of our own is needed
for this slice.

## Manifest schema

```ts
type SightlinesPackage = {
  schemaVersion: number;          // package format version — currently 1
  exportedAt: string;             // ISO 8601
  mode: "originals" | "display" | "metadata-only";
  project: Project;               // full, current-schema Project (docs/plan.md §4.2)
  artworks: Artwork[];            // ONLY the subset this project references
  assets: PackageAssetEntry[];    // blob inventory + hashes for every referenced asset
};

type PackageAssetEntry = {
  assetId: string;
  mimeType: string;               // the Asset record's own mime (original tier)
  originalFilename?: string;
  widthPx?: number;
  heightPx?: number;
  byteSize?: number;              // original file size, from the Asset record
  sha256?: string;                // ORIGINAL content hash — the re-link anchor
  tiers: PackageAssetTierEntry[]; // one per tier actually shipped in the zip
};

type PackageAssetTierEntry = {
  tier: "original" | "display" | "thumbnail";
  path: string;                   // e.g. "assets/<sha256>.webp"
  sha256: string;                 // hash of THIS tier's bytes
  byteSize: number;               // THIS tier's byte length
  mimeType: string;               // THIS tier's mime (derivatives are WebP)
};
```

`project` and `artworks` are validated by the exact same zod schemas the app uses
to persist to IndexedDB (`projectSchema`, `artworkSchema`), so a package
round-trips through the identical contract the rest of the app already trusts.
The manifest is validated before it is ever emitted — an invalid manifest is
never written (docs/plan.md §8).

### Which artworks are included

The denormalized subset **actually referenced by this project**, never the whole
library (docs/plan.md §4.1/§6): the union of

- `project.checklistArtworkIds` (checklist membership — placed *or* unplaced), and
- every `artworkId` appearing in `project.wallObjects` / `project.floorObjects`
  (placements, in case anything is placed without a checklist row).

A library artwork belonging to no other project's checklist and unplaced here is
excluded.

## Export modes (docs/plan.md §4.5)

Three modes, chosen from the topbar Export menu (and Settings → "Export backup",
which uses `display`):

| Mode            | Tiers in the zip                     | Use |
|-----------------|--------------------------------------|-----|
| `originals`     | `original` + `display` + `thumbnail` | Archival fidelity — final venue handoff, press kit. Largest file. Re-import never has to regenerate derivatives. |
| `display`       | `display` + `thumbnail`              | **Default.** Good balance for backup and sharing. |
| `metadata-only` | none                                 | Checklist + layout only. Lightest possible file. |

In every mode the manifest records a `PackageAssetEntry` for each referenced
asset, including its original `sha256`. In `metadata-only` mode `tiers` is empty
but that original hash still ships, so a later **re-link** (the user re-supplies
the images and the app matches them by content) remains possible.

## Asset keying: why content-addressed

Blob files are named by the **sha256 of their bytes**, and each manifest tier
entry records both its `path` and its `sha256`. This was the main format fork not
fully pinned by plan.md; content addressing was chosen because it keeps import
simplest (docs/plan.md constraint):

- **Dedupe is the whole point of the hash (§4.5/§6).** Import compares content
  hashes to decide "identical image already in the library under a different id."
  Naming files by that same hash means the comparison currency and the file
  identity are one thing.
- **Within a package, identical bytes collapse to one file automatically** — if
  two assets (or two tiers) share content, they share the single `assets/<hash>`
  entry, and both tier entries point at it.
- **Import can verify integrity on extract** by re-hashing each blob and checking
  it against the manifest, catching a corrupt or truncated zip.
- The cost — a filename that doesn't reveal which asset/tier it is — is fully
  covered by the manifest, which maps `(assetId, tier) → path` explicitly. No
  information lives only in a filename.

The top-level `PackageAssetEntry.sha256` is the **original** content hash from the
`Asset` record (the stable re-link anchor); each `PackageAssetTierEntry.sha256` is
the hash of that specific tier's bytes.

## Compatibility promise

- Every package carries `schemaVersion` (currently `1`). A file on disk is
  self-describing and can be migrated by whatever app version later opens it,
  independently of the `Project`/`Artwork`/`Asset` schema versions embedded inside
  it (docs/plan.md §2).
- **Newer than us → refuse, don't guess.** `readPackageManifest()` rejects a
  package whose `schemaVersion` exceeds the app's, with a clear message.
- **Older than us → migrate.** When a second package version ships, a stepwise
  migration chain (`v1→v2→…`) slots into `readPackageManifest()` exactly like
  `migrateProject`'s in `projectSchema.ts`, run before full-shape validation.
  Today v1 is the only version, so no chain exists yet.
- Additive, optional fields inside the embedded `Project`/`Artwork` (e.g. the
  `metadata` bag, framing) do **not** require a package-version bump — they are
  absorbed by the existing per-document schemas (docs/plan.md §4.4).

## Deferred to the import slice

Export only produces packages. The import pipeline (docs/plan.md §13) will add,
on top of this format: zip path-traversal rejection, extracted file-count and
total-uncompressed-size caps (decompression-bomb guard), MIME validation over
extension trust, image-dimension checks before decode, freeform-text
sanitization, the `readPackageManifest` migrate-then-validate run, sha256-based
library dedupe, and graceful missing-asset degradation (import a work as
metadata-only with a "missing image" warning rather than failing the whole
import). `readSightlinesZip()` in `zipPackage.ts` is the seam those checks layer
onto.
