import { describe, expect, it } from "vitest";
import { createSightlinesPackage } from "./buildPackage";
import {
  finalizePackageImport,
  openSightlinesPackage,
  planPackageImport,
  validatePackageAssets,
  type ExistingLibraryState
} from "./importPackage";
import { makeFixture } from "./packageTestFixtures";

const emptyLibrary: ExistingLibraryState = {
  artworks: [],
  assetShaById: new Map(),
  projectIds: []
};

describe("export → import round trip", () => {
  it("display mode: project, checklist, placements, and assets arrive intact in an empty library", async () => {
    const { project, library, getAsset, getBlob } = makeFixture();
    library[0] = {
      ...library[0],
      matWidthMm: 75,
      frame: { widthMm: 25, finish: "black" }
    };

    const { zip } = await createSightlinesPackage({
      project,
      libraryArtworks: library,
      mode: "display",
      getAsset,
      getBlob
    });

    const opened = await openSightlinesPackage(zip);
    const validated = await validatePackageAssets(opened.manifest, opened.files);
    expect(validated.warnings).toEqual([]);

    const plan = planPackageImport(opened.manifest, validated, emptyLibrary);
    expect(plan.conflicts).toEqual([]);
    expect(plan.projectRenamed).toBe(false);

    const commit = finalizePackageImport(plan, {});

    // Project structure survives whole: same id, checklist, placement.
    expect(commit.project.id).toBe(project.id);
    expect(commit.project.checklistArtworkIds).toEqual(project.checklistArtworkIds);
    expect(commit.project.wallObjects).toEqual(project.wallObjects);

    // Both referenced artworks arrive; the unreferenced one does not exist here.
    expect(commit.artworksToSave.map((a) => a.id).sort()).toEqual(["art-placed", "art-unplaced"]);
    expect(commit.artworksToSave.every((a) => a.assetId !== undefined)).toBe(true);
    expect(commit.artworksToSave.find((a) => a.id === "art-placed")).toMatchObject({
      matWidthMm: 75,
      frame: { widthMm: 25, finish: "black" }
    });
    expect(commit.project.wallObjects.find((object) => object.id === "wo-1")).toMatchObject({
      widthMm: 500,
      heightMm: 400
    });

    // Both assets save with display bytes standing in for the original slot.
    expect(commit.assetsToSave).toHaveLength(2);
    for (const prepared of commit.assetsToSave) {
      expect(prepared.blobs.original.bytes).toEqual(prepared.blobs.display.bytes);
      expect(prepared.blobs.thumbnail.bytes).toBeDefined();
    }
    expect(commit.warnings).toEqual([]);
  });

  it("display cases (wall + floor) survive a display-mode round trip", async () => {
    const { project: base, library, getAsset, getBlob } = makeFixture();
    const wallId = base.floor.rooms[0].room.walls[0].id;
    const project = {
      ...base,
      wallObjects: [
        ...base.wallObjects,
        {
          id: "wall-case-1",
          kind: "case" as const,
          wallId,
          xMm: 1200,
          yMm: 950,
          widthMm: 1500,
          heightMm: 180,
          depthMm: 450
        }
      ],
      floorObjects: [
        {
          id: "floor-case-1",
          kind: "case" as const,
          xMm: 3000,
          yMm: 2000,
          widthMm: 1800,
          depthMm: 600,
          rotationDeg: 0,
          heightMm: 950,
          wallYMm: 950
        }
      ]
    };

    const { zip } = await createSightlinesPackage({
      project,
      libraryArtworks: library,
      mode: "display",
      getAsset,
      getBlob
    });

    const opened = await openSightlinesPackage(zip);
    const validated = await validatePackageAssets(opened.manifest, opened.files);
    const commit = finalizePackageImport(
      planPackageImport(opened.manifest, validated, emptyLibrary),
      {}
    );

    expect(commit.project.wallObjects).toEqual(project.wallObjects);
    expect(commit.project.floorObjects).toEqual(project.floorObjects);
    // The version-4 project schema round-trips intact through the package.
    expect(commit.project.schemaVersion).toBe(project.schemaVersion);
  });

  it("saved views survive a display-mode round trip", async () => {
    const { project: base, library, getAsset, getBlob } = makeFixture();
    const project = {
      ...base,
      savedViews: [
        {
          id: "view-1",
          ordinal: 1,
          title: "Entrance sightline",
          roomId: "room-main",
          pose: {
            position: { x: 1, y: 1.6, z: 3 },
            target: { x: 1, y: 1.6, z: 0 }
          },
          createdAt: "2026-07-16T00:00:00.000Z"
        }
      ]
    };

    const { zip } = await createSightlinesPackage({
      project,
      libraryArtworks: library,
      mode: "display",
      getAsset,
      getBlob
    });

    const opened = await openSightlinesPackage(zip);
    const validated = await validatePackageAssets(opened.manifest, opened.files);
    const commit = finalizePackageImport(
      planPackageImport(opened.manifest, validated, emptyLibrary),
      {}
    );

    expect(commit.project.savedViews).toEqual(project.savedViews);
  });

  it("originals mode: original bytes round-trip exactly", async () => {
    const { project, library, assets, blobs, getAsset, getBlob } = makeFixture();

    const { zip } = await createSightlinesPackage({
      project,
      libraryArtworks: library,
      mode: "originals",
      getAsset,
      getBlob
    });

    const opened = await openSightlinesPackage(zip);
    const validated = await validatePackageAssets(opened.manifest, opened.files);
    const commit = finalizePackageImport(
      planPackageImport(opened.manifest, validated, emptyLibrary),
      {}
    );

    for (const prepared of commit.assetsToSave) {
      const source = assets.get(prepared.asset.id)!;
      // Compare as plain arrays: the unzipped views come from a different
      // buffer/realm, which trips typed-array deep equality despite
      // byte-identical content.
      expect(Array.from(prepared.blobs.original.bytes)).toEqual(
        Array.from(blobs.get(source.originalKey)!)
      );
      expect(Array.from(prepared.blobs.display.bytes)).toEqual(
        Array.from(blobs.get(source.displayKey)!)
      );
      expect(Array.from(prepared.blobs.thumbnail.bytes)).toEqual(
        Array.from(blobs.get(source.thumbnailKey)!)
      );
      // The verified original tier hash lands on the record — even if the
      // source record's cached anchor was stale.
      const manifestAsset = opened.manifest.assets.find((asset) => asset.assetId === source.id)!;
      expect(prepared.asset.sha256).toBe(
        manifestAsset.tiers.find((tier) => tier.tier === "original")!.sha256
      );
    }
  });

  it("metadata-only mode: artworks arrive imageless with per-work warnings", async () => {
    const { project, library, getAsset, getBlob } = makeFixture();

    const { zip } = await createSightlinesPackage({
      project,
      libraryArtworks: library,
      mode: "metadata-only",
      getAsset,
      getBlob
    });

    const opened = await openSightlinesPackage(zip);
    const validated = await validatePackageAssets(opened.manifest, opened.files);
    const commit = finalizePackageImport(
      planPackageImport(opened.manifest, validated, emptyLibrary),
      {}
    );

    expect(commit.assetsToSave).toEqual([]);
    expect(commit.artworksToSave.every((a) => a.assetId === undefined)).toBe(true);
    expect(commit.warnings.length).toBe(2); // one per imageless work
    // The layout still arrives whole.
    expect(commit.project.wallObjects).toEqual(project.wallObjects);
  });
});
