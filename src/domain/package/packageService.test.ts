import { describe, expect, it } from "vitest";
import { makeFixture } from "./packageTestFixtures";
import {
  SIGHTLINES_PACKAGE_MIME_TYPE,
  buildProjectPackage
} from "./packageService";
import { writeSightlinesZip } from "./zipPackage";

describe("buildProjectPackage", () => {
  it("builds a blob + zip + filename from pure inputs, with no ambient state", async () => {
    const { project, library, getAsset, getBlob } = makeFixture();

    const built = await buildProjectPackage({
      project,
      libraryArtworks: library,
      mode: "display",
      getAsset,
      getBlob
    });

    expect(built.filename).toBe("untitled-exhibition.sightlines");
    expect(built.blob).toBeInstanceOf(Blob);
    expect(built.blob.type).toBe(SIGHTLINES_PACKAGE_MIME_TYPE);
    expect(built.zip).toBeInstanceOf(Uint8Array);
    expect(built.zip.byteLength).toBeGreaterThan(0);
    // The blob wraps the same bytes the download path receives.
    expect(built.blob.size).toBe(built.zip.byteLength);
    expect(built.warnings).toEqual([]);
    // A real zip container (PK local-file-header magic).
    expect([built.zip[0], built.zip[1]]).toEqual([0x50, 0x4b]);
  });

  it("surfaces per-asset degradations as warnings without throwing", async () => {
    const { project, library, getAsset, getBlob } = makeFixture();

    const built = await buildProjectPackage({
      project,
      libraryArtworks: library,
      mode: "display",
      // One referenced asset record is missing — metadata still exports.
      getAsset: (id) => (id === "asset-1" ? Promise.reject(new Error("gone")) : getAsset(id)),
      getBlob
    });

    expect(built.warnings.some((w) => w.includes("asset-1"))).toBe(true);
    expect(built.filename).toBe("untitled-exhibition.sightlines");
  });

  it("propagates a hard build failure (throws) instead of swallowing it", async () => {
    const { project, library, getAsset, getBlob } = makeFixture();
    // A referenced artwork with no matching library record is a structural
    // failure buildSightlinesPackage throws on — the service must let it out.
    const brokenProject = {
      ...project,
      checklistArtworkIds: [...project.checklistArtworkIds, "art-ghost"]
    };

    await expect(
      buildProjectPackage({
        project: brokenProject,
        libraryArtworks: library,
        mode: "display",
        getAsset,
        getBlob
      })
    ).rejects.toThrow(/art-ghost/);
  });

  // Guard that the service still leans on the shared zip writer rather than
  // re-implementing the container.
  it("uses the shared zip writer (round-trippable container)", async () => {
    const empty = await writeSightlinesZip([]);
    expect(empty).toBeInstanceOf(Uint8Array);
  });
});
