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

## Import behavior

Import treats every `.sightlines` file as untrusted input (docs/plan.md §13) and
runs one pipeline end to end before anything is persisted:
**zip safety → staged manifest parse → asset intake validation → merge plan →
(conflict review) → commit**. Nothing is written to IndexedDB until the final
commit step; cancelling the conflict dialog discards the import completely.

Relevant code: `src/domain/package/extractPackage.ts` (zip safety),
`readPackageManifest` in `packageSchema.ts` (staged manifest parse),
`src/domain/package/importPackage.ts` (asset validation, merge planning,
finalize), `importSightlinesPackage` in `src/app/store.ts` (wiring + persistence),
`src/app/components/imports/ImportConflictDialog.tsx` (one-step conflict review).

### Zip safety caps (enforced on declared sizes, BEFORE inflation)

The zip directory is walked once with a filter that admits nothing, building an
inventory of declared (pre-inflation) sizes; the caps and path rules run against
that inventory, and only then are the meaningful entries inflated. A
decompression bomb is rejected from its headers.

| Cap | Value | Rationale |
|---|---|---|
| Entry count | 4096 files | a 10-room / 200-work show at three tiers is ~600 blobs |
| Per-entry uncompressed | 256 MB | above any plausible single museum scan |
| Total uncompressed | 2 GB | the package inflates into memory; this bounds the peak |
| `manifest.json` | 20 MB | same cap as bare project-JSON import |

Path rules: `..` segments, absolute paths, drive letters, backslashes, and empty
segments are all rejected — and a single hostile path rejects the **whole
package** (a hostile path means a hostile file). Directory entries (`assets/`)
are tolerated and skipped. **Unknown-but-safe extra entries are ignored, never
inflated** — forward compatibility, so a future package version can add new
folders without breaking older apps. Only `manifest.json` and `assets/*` mean
anything in v1.

### Staged manifest parse (docs/plan.md §2 ordering)

The strict `sightlinesPackageSchema` embeds the CURRENT project/artwork schemas,
but a package written by an older app legitimately embeds older-schemaVersion
documents. Import therefore parses in stages:

1. **Version guard** — a package `schemaVersion` newer than the app is refused
   with a clear message (and a package-level migration chain slots in here when
   a v2 ever ships).
2. **Lenient envelope** — `{ schemaVersion, exportedAt, mode, project: unknown,
   artworks: unknown[], assets }` validates the wrapper only.
3. **Migrate embedded documents** — the embedded project and artworks run the
   SAME migration chains the app uses when loading from IndexedDB
   (`migrateProject` v1→v3, `migrateArtwork`), so a v1-era package opens exactly
   like a v1-era local file.
4. **Strict validation** — the assembled, fully-migrated manifest must pass the
   same contract export writes.

Export still uses the strict schema directly; it only ever writes
current-version documents.

### Asset intake validation

Per manifest asset entry, before anything is decoded:

- Each shipped tier blob must: exist at its manifest `path`, match the recorded
  `byteSize`, **re-hash to the recorded `sha256`** (the content-addressing
  promise, verified), and carry a MIME type in the allowlist export can emit
  (`image/webp,jpeg,jpg,png,gif,avif,tiff`) — extension is never trusted.
- **Dimension enforcement reads the ACTUAL file headers**, not the manifest:
  `readImageDimensions` (`src/domain/assets/imageDimensions.ts`) parses
  dimensions header-only — no decoding — for every allowlisted format (PNG
  IHDR, JPEG SOFn scan, GIF screen descriptor, WebP VP8/VP8L/VP8X, AVIF `ispe`
  box walk taking the max across boxes, TIFF first-IFD in both endiannesses).
  Either sniffed dimension over **16384 px** (the common GPU texture ceiling)
  degrades the tier. Manifest-declared `widthPx`/`heightPx` are
  attacker-controlled and serve only as a cheap fast-reject; omitting or
  under-declaring them does not bypass the guard.
- **Unreadable headers fail closed**: a blob whose header can't be parsed as
  any allowlisted image format is never persisted (degraded with a warning).
- **The header magic must agree with the declared MIME**: a blob whose bytes
  identify a *different* allowlisted format than its manifest `mimeType` claims
  (e.g. PNG bytes labelled `image/webp`) is degraded rather than persisted
  under a false type. (`image/jpg` is normalized to `image/jpeg` before the
  comparison.)

Failures degrade per-tier, then per-asset: a corrupt tier drops just that tier;
an asset with no intact tiers imports its artwork **metadata-only** with a
visible missing-image state and a one-line warning in the banner. One bad image
never fails the whole import.

### Library merge rules (docs/plan.md §6)

- **Same `artworkId`, identical content** (record fields match, image content
  hash matches) → the existing library record is reused untouched.
- **Same `artworkId`, differing content** → collected into ONE review dialog
  (never N sequential prompts) with a per-work choice: **Keep mine** (default —
  the local record stays; the imported layout references it), **Use theirs**
  (overwrite the library record), **Keep both** (the imported version gets a
  fresh id and every project reference — checklist, wall and floor placements —
  is remapped to it).
- **Referenced asset absent** (metadata-only mode, dropped blob, or corrupt) →
  the artwork imports without an image (`assetId` removed) and shows the app's
  standing missing-image placeholder.
- **Identical image content already in the library under a different id** →
  deduped by hash: the incoming artwork is re-bound to the existing local asset
  and **the incoming asset record and blobs are discarded** — no second copy is
  written. This also gives metadata-only packages automatic **re-linking**: on a
  machine that already has the image (matched by the manifest's original
  `sha256`), the artwork arrives with its image connected.
- An incoming asset whose id is already taken locally by different content gets
  a fresh id; ids are never reused for different bytes.

### Tier fallback on partial packages

Local storage always keeps three blob slots per asset. When a package ships
fewer tiers (display mode has no originals), the best available tier stands in
upward: stored *original* ← display ← thumbnail; *display* ← original-stand-in;
*thumbnail* ← display. The record's `sha256` remains the **manifest's original
hash**, so dedupe against a future upload of the true original file still
matches even though the stored stand-in bytes hash differently.

### Project identity

An incoming project whose id already exists locally imports as a **new** project
(fresh id, title suffixed “ (imported)”) — local work is never silently
overwritten. Without a collision, the project keeps its id.

### Entry point + text safety

One Import control accepts both formats and detects by **content**, not
extension: zip magic bytes (`PK\x03\x04`) route to the package pipeline,
anything else to the existing project-JSON pipeline. Imported strings are only
ever rendered through React text nodes — the codebase contains no
`dangerouslySetInnerHTML` — so no imported text is ever interpreted as HTML.
