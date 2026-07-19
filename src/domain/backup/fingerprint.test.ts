import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sample/sampleProject";
import { makeArtwork } from "../package/packageTestFixtures";
import type { Project } from "../project";
import {
  collectReferencedAssetIds,
  computeBackupFingerprint
} from "./fingerprint";

const project = createSampleProject();
const artworks = [
  makeArtwork("art-1", { assetId: "asset-1" }),
  makeArtwork("art-2", { assetId: "asset-2" })
];
const assetIds = ["asset-1", "asset-2"];

function baseline(): string {
  return computeBackupFingerprint({ project, artworks, assetIds });
}

describe("computeBackupFingerprint", () => {
  it("is stable across object key order", () => {
    // A project with the same fields written in a different key order must hash
    // identically — the canonical serialization sorts keys.
    const reordered = Object.fromEntries(
      Object.entries(project).reverse()
    ) as unknown as Project;
    expect(computeBackupFingerprint({ project: reordered, artworks, assetIds })).toBe(
      baseline()
    );
  });

  it("is stable across artwork ordering", () => {
    expect(
      computeBackupFingerprint({ project, artworks: [...artworks].reverse(), assetIds })
    ).toBe(baseline());
  });

  it("is stable across asset-id ordering", () => {
    expect(
      computeBackupFingerprint({ project, artworks, assetIds: [...assetIds].reverse() })
    ).toBe(baseline());
  });

  it("changes when the project document changes", () => {
    const edited: Project = { ...project, title: `${project.title} (edited)` };
    expect(computeBackupFingerprint({ project: edited, artworks, assetIds })).not.toBe(
      baseline()
    );
  });

  it("changes when an artwork record changes (no project edit)", () => {
    const editedArtworks = [
      { ...artworks[0], title: "Renamed" },
      artworks[1]
    ];
    expect(
      computeBackupFingerprint({ project, artworks: editedArtworks, assetIds })
    ).not.toBe(baseline());
  });

  it("changes when the referenced asset set changes", () => {
    expect(
      computeBackupFingerprint({ project, artworks, assetIds: ["asset-1", "asset-3"] })
    ).not.toBe(baseline());
  });
});

describe("collectReferencedAssetIds", () => {
  it("dedupes, sorts, and drops artworks without an asset", () => {
    const ids = collectReferencedAssetIds([
      makeArtwork("a", { assetId: "z-asset" }),
      makeArtwork("b", { assetId: "a-asset" }),
      makeArtwork("c", { assetId: "z-asset" }),
      makeArtwork("d")
    ]);
    expect(ids).toEqual(["a-asset", "z-asset"]);
  });
});
