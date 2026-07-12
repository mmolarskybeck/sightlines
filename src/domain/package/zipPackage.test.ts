import { describe, expect, it } from "vitest";
import { parseSightlinesPackage } from "../schema/packageSchema";
import { buildSightlinesPackage, createSightlinesPackage } from "./buildPackage";
import { readSightlinesZip } from "./zipPackage";
import { makeFixture, readZipCompressionMethods } from "./packageTestFixtures";

describe("writeSightlinesZip / readSightlinesZip", () => {
  it("round-trips: manifest parses and every asset tier path is a real zip entry", async () => {
    const { project, library, getAsset, getBlob } = makeFixture();

    const { zip, manifest } = await createSightlinesPackage({
      project,
      libraryArtworks: library,
      mode: "display",
      getAsset,
      getBlob
    });

    const unzipped = await readSightlinesZip(zip);

    // manifest.json is present, parses, and matches what was built.
    const manifestJson = JSON.parse(new TextDecoder().decode(unzipped["manifest.json"]));
    const parsed = parseSightlinesPackage(manifestJson);
    expect(parsed.exportedAt).toBe(manifest.exportedAt);

    // Every tier entry in the manifest inventory corresponds to a real zip file
    // whose byte length matches the recorded byteSize.
    for (const asset of parsed.assets) {
      for (const tier of asset.tiers) {
        const entry = unzipped[tier.path];
        expect(entry, `missing zip entry ${tier.path}`).toBeDefined();
        expect(entry.byteLength).toBe(tier.byteSize);
      }
    }
  });

  it("the zip contains exactly the manifest plus the inventoried blob files", async () => {
    const { project, library, getAsset, getBlob } = makeFixture();

    const { files } = await buildSightlinesPackage({
      project,
      libraryArtworks: library,
      mode: "display",
      getAsset,
      getBlob
    });
    const { zip } = await createSightlinesPackage({
      project,
      libraryArtworks: library,
      mode: "display",
      getAsset,
      getBlob
    });

    const unzipped = await readSightlinesZip(zip);
    expect(Object.keys(unzipped).sort()).toEqual(files.map((f) => f.path).sort());
  });

  it("stores image blobs uncompressed and deflates the JSON manifest", async () => {
    const { project, library, getAsset, getBlob } = makeFixture();

    const { zip } = await createSightlinesPackage({
      project,
      libraryArtworks: library,
      mode: "originals",
      getAsset,
      getBlob
    });

    const methods = readZipCompressionMethods(zip);
    // 0 = store, 8 = deflate.
    expect(methods.get("manifest.json")).toBe(8);
    const imagePaths = [...methods.keys()].filter((name) => name.startsWith("assets/"));
    expect(imagePaths.length).toBeGreaterThan(0);
    for (const path of imagePaths) {
      expect(methods.get(path), `${path} should be stored uncompressed`).toBe(0);
    }
  });
});
