import { describe, expect, it } from "vitest";
import type { Artwork } from "../project";
import {
  PACKAGE_SCHEMA_VERSION,
  type PackageAssetEntry,
  type SightlinesPackage
} from "../schema/packageSchema";
import { hashBytes } from "./buildPackage";
import {
  MAX_ASSET_DIMENSION_PX,
  artworkContentEquals,
  finalizePackageImport,
  planPackageImport,
  validatePackageAssets,
  type ExistingLibraryState,
  type ImportPlan,
  type ValidatedPackageAssets
} from "./importPackage";
import { makeArtwork, makeFixture, makeWebpStubBytes } from "./packageTestFixtures";

const enc = new TextEncoder();

// A GIF header stub for pixel-bomb tests: GIF's 16-bit dimensions can exceed
// the 16384px cap, unlike the VP8L fixture stubs (whose 14-bit fields max out
// at exactly 16384).
function makeGifStubBytes(widthPx: number, heightPx: number): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set(Uint8Array.from("GIF89a", (c) => c.charCodeAt(0)), 0);
  bytes[6] = widthPx & 0xff;
  bytes[7] = (widthPx >> 8) & 0xff;
  bytes[8] = heightPx & 0xff;
  bytes[9] = (heightPx >> 8) & 0xff;
  return bytes;
}

async function makeTierEntry(
  tier: "original" | "display" | "thumbnail",
  bytes: Uint8Array,
  overrides: Partial<PackageAssetEntry["tiers"][number]> = {}
) {
  const sha256 = await hashBytes(bytes);
  return {
    tier,
    path: `assets/${sha256}.webp`,
    sha256,
    byteSize: bytes.byteLength,
    mimeType: "image/webp",
    ...overrides
  };
}

function makeManifest(overrides: Partial<SightlinesPackage> = {}): SightlinesPackage {
  const { project } = makeFixture();
  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    exportedAt: "2026-07-12T00:00:00.000Z",
    mode: "display",
    project,
    artworks: [],
    assets: [],
    ...overrides
  };
}

function noAssets(): ValidatedPackageAssets {
  return { byAssetId: new Map(), warnings: [] };
}

function emptyExisting(): ExistingLibraryState {
  return { artworks: [], assetShaById: new Map(), projectIds: [] };
}

describe("validatePackageAssets", () => {
  async function makeAssetCase() {
    const bytes = makeWebpStubBytes("blob-bytes");
    const tier = await makeTierEntry("display", bytes);
    const entry: PackageAssetEntry = {
      assetId: "asset-1",
      mimeType: "image/jpeg",
      sha256: "original-hash",
      tiers: [tier]
    };
    const manifest = makeManifest({ assets: [entry] });
    const files = new Map([[tier.path, bytes]]);
    return { bytes, tier, entry, manifest, files };
  }

  it("accepts an intact blob", async () => {
    const { manifest, files } = await makeAssetCase();
    const validated = await validatePackageAssets(manifest, files);
    expect(validated.warnings).toEqual([]);
    expect(validated.byAssetId.get("asset-1")?.tiers.display?.bytes).toBeDefined();
  });

  it("drops a blob whose bytes do not match the manifest hash", async () => {
    const { manifest, tier } = await makeAssetCase();
    const files = new Map([[tier.path, enc.encode("tampered!!")]]);
    const validated = await validatePackageAssets(manifest, files);
    expect(validated.byAssetId.size).toBe(0);
    expect(validated.warnings.join(" ")).toMatch(/size does not match|checksum mismatch/);
  });

  it("drops a blob whose hash matches but declared size was forged elsewhere", async () => {
    const { manifest, tier, bytes } = await makeAssetCase();
    tier.byteSize = bytes.byteLength + 1;
    const files = new Map([[tier.path, bytes]]);
    const validated = await validatePackageAssets(manifest, files);
    expect(validated.byAssetId.size).toBe(0);
    expect(validated.warnings.join(" ")).toMatch(/size does not match/);
  });

  it("rejects a MIME type outside the allowlist regardless of extension", async () => {
    const { manifest, entry, bytes } = await makeAssetCase();
    entry.tiers[0].mimeType = "text/html";
    const files = new Map([[entry.tiers[0].path, bytes]]);
    const validated = await validatePackageAssets(manifest, files);
    expect(validated.byAssetId.size).toBe(0);
    expect(validated.warnings.join(" ")).toMatch(/unsupported image type/);
  });

  it("rejects hostile dimensions before any decode", async () => {
    const { manifest, entry, bytes } = await makeAssetCase();
    entry.widthPx = MAX_ASSET_DIMENSION_PX + 1;
    const files = new Map([[entry.tiers[0].path, bytes]]);
    const validated = await validatePackageAssets(manifest, files);
    expect(validated.byAssetId.size).toBe(0);
    expect(validated.warnings.join(" ")).toMatch(/dimensions exceed/);
  });

  it("warns when a shipped blob file is missing from the zip", async () => {
    const { manifest } = await makeAssetCase();
    const validated = await validatePackageAssets(manifest, new Map());
    expect(validated.byAssetId.size).toBe(0);
    expect(validated.warnings.join(" ")).toMatch(/missing from the package/);
  });

  it("keeps intact tiers when a sibling tier is corrupt", async () => {
    const good = makeWebpStubBytes("good-thumbnail");
    const bad = makeWebpStubBytes("display-bytes");
    const goodTier = await makeTierEntry("thumbnail", good);
    const badTier = await makeTierEntry("display", bad);
    const manifest = makeManifest({
      assets: [
        { assetId: "asset-1", mimeType: "image/jpeg", sha256: "orig", tiers: [badTier, goodTier] }
      ]
    });
    const files = new Map([
      [goodTier.path, good],
      [badTier.path, enc.encode("corrupted--")]
    ]);

    const validated = await validatePackageAssets(manifest, files);

    const tiers = validated.byAssetId.get("asset-1")?.tiers;
    expect(tiers?.thumbnail).toBeDefined();
    expect(tiers?.display).toBeUndefined();
    expect(validated.warnings.length).toBe(1);
  });

  // --- header-sniffed enforcement (fail closed on actual bytes) -------------

  it("degrades a pixel bomb whose manifest declares innocent dimensions", async () => {
    const bomb = makeGifStubBytes(60000, 60000);
    const tier = await makeTierEntry("display", bomb, { mimeType: "image/gif" });
    const manifest = makeManifest({
      assets: [
        {
          assetId: "asset-1",
          mimeType: "image/gif",
          sha256: "orig",
          widthPx: 100, // attacker-declared, innocent
          heightPx: 100,
          tiers: [tier]
        }
      ]
    });

    const validated = await validatePackageAssets(manifest, new Map([[tier.path, bomb]]));

    expect(validated.byAssetId.size).toBe(0);
    expect(validated.warnings.join(" ")).toMatch(/dimensions exceed/);
  });

  it("degrades a pixel bomb when the manifest omits dimensions entirely", async () => {
    const bomb = makeGifStubBytes(60000, 60000);
    const tier = await makeTierEntry("display", bomb, { mimeType: "image/gif" });
    const manifest = makeManifest({
      assets: [{ assetId: "asset-1", mimeType: "image/gif", sha256: "orig", tiers: [tier] }]
    });

    const validated = await validatePackageAssets(manifest, new Map([[tier.path, bomb]]));

    expect(validated.byAssetId.size).toBe(0);
    expect(validated.warnings.join(" ")).toMatch(/dimensions exceed/);
  });

  it("degrades a blob whose header cannot be read as any allowlisted image", async () => {
    const notAnImage = enc.encode("this passes the hash check but is not an image");
    const tier = await makeTierEntry("display", notAnImage);
    const manifest = makeManifest({
      assets: [{ assetId: "asset-1", mimeType: "image/jpeg", sha256: "orig", tiers: [tier] }]
    });

    const validated = await validatePackageAssets(manifest, new Map([[tier.path, notAnImage]]));

    expect(validated.byAssetId.size).toBe(0);
    expect(validated.warnings.join(" ")).toMatch(/unreadable image data/);
  });

  it("degrades a blob whose header identifies a different format than it claims", async () => {
    const webpBytes = makeWebpStubBytes("mislabeled");
    const tier = await makeTierEntry("display", webpBytes, { mimeType: "image/png" });
    const manifest = makeManifest({
      assets: [{ assetId: "asset-1", mimeType: "image/png", sha256: "orig", tiers: [tier] }]
    });

    const validated = await validatePackageAssets(manifest, new Map([[tier.path, webpBytes]]));

    expect(validated.byAssetId.size).toBe(0);
    expect(validated.warnings.join(" ")).toMatch(/does not match its declared type/);
  });

  it("accepts a small valid image at its true dimensions", async () => {
    const smallGif = makeGifStubBytes(320, 200);
    const tier = await makeTierEntry("display", smallGif, { mimeType: "image/gif" });
    const manifest = makeManifest({
      assets: [{ assetId: "asset-1", mimeType: "image/gif", sha256: "orig", tiers: [tier] }]
    });

    const validated = await validatePackageAssets(manifest, new Map([[tier.path, smallGif]]));

    expect(validated.warnings).toEqual([]);
    expect(validated.byAssetId.get("asset-1")?.tiers.display).toBeDefined();
  });
});

describe("planPackageImport — §6 merge rules", () => {
  it("adds unknown artworks and prepares their assets", async () => {
    const bytes = makeWebpStubBytes("display-a");
    const tier = await makeTierEntry("display", bytes);
    const entry: PackageAssetEntry = {
      assetId: "asset-a",
      mimeType: "image/jpeg",
      sha256: "sha-a",
      tiers: [tier]
    };
    const manifest = makeManifest({
      artworks: [makeArtwork("art-1", { assetId: "asset-a" })],
      assets: [entry]
    });
    const validated = await validatePackageAssets(manifest, new Map([[tier.path, bytes]]));

    const plan = planPackageImport(manifest, validated, emptyExisting());

    expect(plan.artworksToAdd.map((a) => a.id)).toEqual(["art-1"]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.assetsToSave).toHaveLength(1);
    expect(plan.assetsToSave[0].asset.id).toBe("asset-a");
    // Display stands in for the missing original tier (fallback chain).
    expect(plan.assetsToSave[0].blobs.original.bytes).toEqual(bytes);
    expect(plan.assetsToSave[0].asset.sha256).toBe("sha-a"); // manifest anchor kept
  });

  it("reuses an existing record for same id + identical content + same image hash", () => {
    const artwork = makeArtwork("art-1", { assetId: "asset-a" });
    const manifest = makeManifest({
      artworks: [artwork],
      assets: [{ assetId: "asset-a", mimeType: "image/jpeg", sha256: "sha-a", tiers: [] }]
    });
    const existing: ExistingLibraryState = {
      artworks: [makeArtwork("art-1", { assetId: "asset-local" })],
      assetShaById: new Map([["asset-local", "sha-a"]]),
      projectIds: []
    };

    const plan = planPackageImport(manifest, noAssets(), existing);

    expect(plan.reusedArtworkIds).toEqual(["art-1"]);
    expect(plan.artworksToAdd).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it("collects a conflict for same id + differing metadata", () => {
    const incoming = makeArtwork("art-1", { title: "New Title" });
    const manifest = makeManifest({ artworks: [incoming], assets: [] });
    const existing: ExistingLibraryState = {
      artworks: [makeArtwork("art-1", { title: "Old Title" })],
      assetShaById: new Map(),
      projectIds: []
    };

    const plan = planPackageImport(manifest, noAssets(), existing);

    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].incoming.title).toBe("New Title");
    expect(plan.conflicts[0].existing.title).toBe("Old Title");
  });

  it("dedupes identical image content under a different asset id (reuses stored blob)", async () => {
    const bytes = makeWebpStubBytes("shared-display");
    const tier = await makeTierEntry("display", bytes);
    const manifest = makeManifest({
      artworks: [makeArtwork("art-new", { assetId: "asset-theirs" })],
      assets: [{ assetId: "asset-theirs", mimeType: "image/jpeg", sha256: "sha-shared", tiers: [tier] }]
    });
    const validated = await validatePackageAssets(manifest, new Map([[tier.path, bytes]]));
    const existing: ExistingLibraryState = {
      artworks: [makeArtwork("art-mine", { assetId: "asset-mine" })],
      assetShaById: new Map([["asset-mine", "sha-shared"]]),
      projectIds: []
    };

    const plan = planPackageImport(manifest, validated, existing);

    // No second copy of the bytes is written; the artwork points at the
    // existing local asset.
    expect(plan.assetsToSave).toEqual([]);
    expect(plan.artworksToAdd[0].assetId).toBe("asset-mine");
  });

  it("re-links a metadata-only package against a library that already has the image", () => {
    const manifest = makeManifest({
      mode: "metadata-only",
      artworks: [makeArtwork("art-new", { assetId: "asset-theirs" })],
      assets: [{ assetId: "asset-theirs", mimeType: "image/jpeg", sha256: "sha-known", tiers: [] }]
    });
    const existing: ExistingLibraryState = {
      artworks: [makeArtwork("art-mine", { assetId: "asset-local" })],
      assetShaById: new Map([["asset-local", "sha-known"]]),
      projectIds: []
    };

    const plan = planPackageImport(manifest, noAssets(), existing);

    expect(plan.artworksToAdd[0].assetId).toBe("asset-local");
    expect(plan.warnings.join(" ")).not.toMatch(/asset-theirs/);
  });

  it("imports an artwork imageless when its asset is absent, with a warning", () => {
    const manifest = makeManifest({
      mode: "metadata-only",
      artworks: [makeArtwork("art-1", { assetId: "asset-gone" })],
      assets: [{ assetId: "asset-gone", mimeType: "image/jpeg", sha256: "sha-x", tiers: [] }]
    });

    const plan = planPackageImport(manifest, noAssets(), emptyExisting());

    expect(plan.artworksToAdd[0].assetId).toBeUndefined();
    expect(plan.warnings.join(" ")).toMatch(/no image in the package/);
  });

  it("warns and imports imageless when the manifest has no entry for a referenced asset", () => {
    const manifest = makeManifest({
      artworks: [makeArtwork("art-1", { assetId: "asset-uninventoried" })],
      assets: []
    });

    const plan = planPackageImport(manifest, noAssets(), emptyExisting());

    expect(plan.artworksToAdd[0].assetId).toBeUndefined();
    expect(plan.warnings.join(" ")).toMatch(/not in the package/);
  });

  it("imports as a NEW project when the project id already exists locally", () => {
    const manifest = makeManifest();
    const existing: ExistingLibraryState = {
      artworks: [],
      assetShaById: new Map(),
      projectIds: [manifest.project.id]
    };

    const plan = planPackageImport(manifest, noAssets(), existing);

    expect(plan.projectRenamed).toBe(true);
    expect(plan.project.id).not.toBe(manifest.project.id);
    expect(plan.project.title).toBe(`${manifest.project.title} (imported)`);
  });

  it("gives an incoming asset a fresh id when its id is taken by different content", async () => {
    const bytes = makeWebpStubBytes("their-display");
    const tier = await makeTierEntry("display", bytes);
    const manifest = makeManifest({
      artworks: [makeArtwork("art-1", { assetId: "asset-shared-id" })],
      assets: [
        { assetId: "asset-shared-id", mimeType: "image/jpeg", sha256: "sha-theirs", tiers: [tier] }
      ]
    });
    const validated = await validatePackageAssets(manifest, new Map([[tier.path, bytes]]));
    const existing: ExistingLibraryState = {
      artworks: [makeArtwork("art-other", { assetId: "asset-shared-id" })],
      assetShaById: new Map([["asset-shared-id", "sha-mine-different"]]),
      projectIds: []
    };

    const plan = planPackageImport(manifest, validated, existing);

    expect(plan.assetsToSave).toHaveLength(1);
    expect(plan.assetsToSave[0].asset.id).not.toBe("asset-shared-id");
    expect(plan.artworksToAdd[0].assetId).toBe(plan.assetsToSave[0].asset.id);
  });
});

describe("finalizePackageImport", () => {
  function planWithConflict(): ImportPlan {
    const { project } = makeFixture();
    const incoming: Artwork = makeArtwork("art-placed", { title: "Theirs" });
    const existing: Artwork = makeArtwork("art-placed", { title: "Mine" });
    return {
      project,
      projectRenamed: false,
      mode: "display" as const,
      artworksToAdd: [],
      reusedArtworkIds: [],
      conflicts: [{ incoming, existing }],
      assetsToSave: [],
      warnings: []
    };
  }

  it("keep mine: saves nothing, references resolve to the local record", () => {
    const commit = finalizePackageImport(planWithConflict(), { "art-placed": "mine" });
    expect(commit.artworksToSave).toEqual([]);
    expect(commit.project.checklistArtworkIds).toContain("art-placed");
  });

  it("defaults an unresolved conflict to keep mine", () => {
    const commit = finalizePackageImport(planWithConflict(), {});
    expect(commit.artworksToSave).toEqual([]);
  });

  it("use theirs: overwrites the library record under the same id", () => {
    const commit = finalizePackageImport(planWithConflict(), { "art-placed": "theirs" });
    expect(commit.artworksToSave.map((a) => [a.id, a.title])).toEqual([["art-placed", "Theirs"]]);
  });

  it("keep both: adds a duplicate under a fresh id and remaps every project reference", () => {
    const commit = finalizePackageImport(planWithConflict(), { "art-placed": "both" });

    expect(commit.artworksToSave).toHaveLength(1);
    const duplicate = commit.artworksToSave[0];
    expect(duplicate.id).not.toBe("art-placed");
    expect(duplicate.title).toBe("Theirs");
    // Checklist and wall placement both point at the duplicate now.
    expect(commit.project.checklistArtworkIds).toContain(duplicate.id);
    expect(commit.project.checklistArtworkIds).not.toContain("art-placed");
    const placement = commit.project.wallObjects.find((o) => o.kind === "artwork");
    expect(placement && placement.kind === "artwork" ? placement.artworkId : null).toBe(
      duplicate.id
    );
  });

  it("drops prepared assets that no saved artwork references", async () => {
    const bytes = enc.encode("orphan-display");
    const plan = planWithConflict();
    plan.assetsToSave = [
      {
        asset: {
          id: "asset-orphan",
          schemaVersion: 1,
          mimeType: "image/webp",
          originalKey: "asset-orphan:original",
          displayKey: "asset-orphan:display",
          thumbnailKey: "asset-orphan:thumbnail"
        },
        blobs: {
          original: { bytes, mimeType: "image/webp" },
          display: { bytes, mimeType: "image/webp" },
          thumbnail: { bytes, mimeType: "image/webp" }
        }
      }
    ];
    plan.conflicts[0].incoming.assetId = "asset-orphan";

    // keep mine → the only artwork referencing the prepared asset is rejected.
    expect(finalizePackageImport(plan, { "art-placed": "mine" }).assetsToSave).toEqual([]);
    // use theirs → the asset ships.
    expect(finalizePackageImport(plan, { "art-placed": "theirs" }).assetsToSave).toHaveLength(1);
  });
});

describe("artworkContentEquals", () => {
  it("ignores assetId and key order, compares everything else", () => {
    const a = makeArtwork("art-1", { assetId: "x", artist: "A", title: "T" });
    const b = { ...makeArtwork("art-1", { artist: "A", title: "T" }), assetId: "y" };
    expect(artworkContentEquals(a, b)).toBe(true);
    expect(artworkContentEquals(a, { ...b, title: "Different" })).toBe(false);
  });
});
