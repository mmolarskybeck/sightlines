import { describe, expect, it } from "vitest";
import { parseSightlinesPackage } from "../schema/packageSchema";
import {
  buildSightlinesPackage,
  packageFilename,
  selectReferencedArtworkIds,
  selectReferencedArtworks,
  tiersForMode
} from "./buildPackage";
import { makeFixture } from "./packageTestFixtures";

describe("selectReferencedArtworks", () => {
  it("includes placed and unplaced checklist items, excludes unreferenced library records", () => {
    const { project, library } = makeFixture();

    const selected = selectReferencedArtworks(project, library).map((a) => a.id).sort();

    expect(selected).toEqual(["art-placed", "art-unplaced"]);
  });

  it("unions checklist membership with placed artworks not on the checklist", () => {
    const { project, library } = makeFixture();
    // A work placed on a wall but missing from checklistArtworkIds still ships.
    project.checklistArtworkIds = ["art-unplaced"];

    const ids = selectReferencedArtworkIds(project);

    expect(ids.has("art-placed")).toBe(true); // via wallObjects placement
    expect(ids.has("art-unplaced")).toBe(true); // via checklist
    expect(ids.has("art-unreferenced")).toBe(false);
  });
});

describe("tiersForMode", () => {
  it("maps each export mode to the tiers it ships (docs/plan.md §4.5)", () => {
    expect(tiersForMode("originals")).toEqual(["original", "display", "thumbnail"]);
    expect(tiersForMode("display")).toEqual(["display", "thumbnail"]);
    expect(tiersForMode("metadata-only")).toEqual([]);
  });
});

describe("buildSightlinesPackage", () => {
  it("produces a manifest that round-trips through the package schema", async () => {
    const { project, library, getAsset, getBlob } = makeFixture();

    const { manifest } = await buildSightlinesPackage({
      project,
      libraryArtworks: library,
      mode: "display",
      getAsset,
      getBlob,
      exportedAt: "2026-07-12T00:00:00.000Z"
    });

    expect(() => parseSightlinesPackage(manifest)).not.toThrow();
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.mode).toBe("display");
    expect(manifest.artworks.map((a) => a.id).sort()).toEqual(["art-placed", "art-unplaced"]);
  });

  it("display mode ships display + thumbnail tiers, no originals", async () => {
    const { project, library, getAsset, getBlob } = makeFixture();

    const { manifest, files } = await buildSightlinesPackage({
      project,
      libraryArtworks: library,
      mode: "display",
      getAsset,
      getBlob
    });

    for (const entry of manifest.assets) {
      expect(entry.tiers.map((t) => t.tier).sort()).toEqual(["display", "thumbnail"]);
    }
    // 2 assets × 2 tiers = 4 blob files + 1 manifest.
    const blobPaths = files.filter((f) => f.path.startsWith("assets/"));
    expect(blobPaths).toHaveLength(4);
    expect(files.some((f) => f.path === "manifest.json")).toBe(true);
  });

  it("originals mode ships all three tiers", async () => {
    const { project, library, getAsset, getBlob } = makeFixture();

    const { manifest, files } = await buildSightlinesPackage({
      project,
      libraryArtworks: library,
      mode: "originals",
      getAsset,
      getBlob
    });

    for (const entry of manifest.assets) {
      expect(entry.tiers.map((t) => t.tier).sort()).toEqual([
        "display",
        "original",
        "thumbnail"
      ]);
    }
    expect(files.filter((f) => f.path.startsWith("assets/"))).toHaveLength(6);
  });

  it("metadata-only mode ships no blobs but keeps the original content hash for re-link", async () => {
    const { project, library, getAsset, getBlob } = makeFixture();

    const { manifest, files } = await buildSightlinesPackage({
      project,
      libraryArtworks: library,
      mode: "metadata-only",
      getAsset,
      getBlob
    });

    expect(files.filter((f) => f.path.startsWith("assets/"))).toHaveLength(0);
    expect(manifest.assets).toHaveLength(2);
    for (const entry of manifest.assets) {
      expect(entry.tiers).toEqual([]);
      // The Asset record's original hash survives so a later re-link is possible.
      expect(entry.sha256).toMatch(/original-content-hash$/);
      expect(entry.mimeType).toBe("image/jpeg");
    }
  });

  it("records byteSize and content path per included tier, matching the blob bytes", async () => {
    const { project, library, assets, blobs, getAsset, getBlob } = makeFixture();

    const { manifest } = await buildSightlinesPackage({
      project,
      libraryArtworks: library,
      mode: "display",
      getAsset,
      getBlob
    });

    const entry = manifest.assets.find((a) => a.assetId === "asset-1")!;
    const displayTier = entry.tiers.find((t) => t.tier === "display")!;
    const expectedBytes = blobs.get(assets.get("asset-1")!.displayKey)!;
    expect(displayTier.byteSize).toBe(expectedBytes.byteLength);
    expect(displayTier.path).toMatch(/^assets\/[0-9a-f]{64}\.webp$/);
    expect(displayTier.mimeType).toBe("image/webp");
  });

  it("degrades gracefully when a single tier blob is missing", async () => {
    const { project, library, assets, blobs, getAsset, getBlob } = makeFixture();
    // Drop asset-1's display blob only.
    blobs.delete(assets.get("asset-1")!.displayKey);

    const { manifest, files } = await buildSightlinesPackage({
      project,
      libraryArtworks: library,
      mode: "display",
      getAsset,
      getBlob
    });

    const entry = manifest.assets.find((a) => a.assetId === "asset-1")!;
    expect(entry.tiers.map((t) => t.tier)).toEqual(["thumbnail"]);
    // asset-2 still ships both; asset-1 ships one → 3 blob files.
    expect(files.filter((f) => f.path.startsWith("assets/"))).toHaveLength(3);
  });

  it("drops an asset entry whose record is missing but keeps the artwork", async () => {
    const { project, library, assets, getBlob } = makeFixture();
    const getAsset = async (id: string) => {
      if (id === "asset-1") throw new Error("gone");
      const asset = assets.get(id);
      if (!asset) throw new Error("missing");
      return asset;
    };

    const { manifest } = await buildSightlinesPackage({
      project,
      libraryArtworks: library,
      mode: "display",
      getAsset,
      getBlob
    });

    // Artwork still exported...
    expect(manifest.artworks.some((a) => a.id === "art-placed")).toBe(true);
    // ...but no asset inventory entry for the missing record.
    expect(manifest.assets.some((a) => a.assetId === "asset-1")).toBe(false);
    expect(manifest.assets.some((a) => a.assetId === "asset-2")).toBe(true);
  });

  it("content-addresses blobs so identical bytes dedupe to one file", async () => {
    const { project, library, assets, blobs, getAsset, getBlob } = makeFixture();
    // Force asset-2's display bytes to equal asset-1's display bytes.
    const shared = blobs.get(assets.get("asset-1")!.displayKey)!;
    blobs.set(assets.get("asset-2")!.displayKey, shared);

    const { manifest, files } = await buildSightlinesPackage({
      project,
      libraryArtworks: library,
      mode: "display",
      getAsset,
      getBlob
    });

    const a1 = manifest.assets
      .find((a) => a.assetId === "asset-1")!
      .tiers.find((t) => t.tier === "display")!;
    const a2 = manifest.assets
      .find((a) => a.assetId === "asset-2")!
      .tiers.find((t) => t.tier === "display")!;
    expect(a1.path).toBe(a2.path); // same content hash → same path
    // 4 tiers referenced but 3 unique files (one shared display).
    expect(files.filter((f) => f.path.startsWith("assets/"))).toHaveLength(3);
  });
});

describe("packageFilename", () => {
  it("slugs the project title and uses the .sightlines extension", () => {
    const { project } = makeFixture();
    project.title = "Spring 2026: Light & Shadow!";
    expect(packageFilename(project)).toBe("spring-2026-light-shadow.sightlines");
  });

  it("falls back to 'project' when the title has no ascii-safe characters", () => {
    const { project } = makeFixture();
    project.title = "…";
    expect(packageFilename(project)).toBe("project.sightlines");
  });
});
