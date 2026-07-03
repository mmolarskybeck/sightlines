import { describe, expect, it } from "vitest";
import { CURRENT_ARTWORK_SCHEMA_VERSION, CURRENT_ASSET_SCHEMA_VERSION, type Artwork, type Asset } from "../project";
import { migrateArtwork, parseArtwork, parseAsset } from "./artworkSchema";

function createSampleArtwork(): Artwork {
  return {
    id: "artwork-1",
    schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
    artist: "Agnes Martin",
    title: "Untitled #9",
    date: "1990",
    accessionNumber: "1990.12",
    locationOrLender: "Private collection",
    dimensions: {
      widthMm: 1524,
      heightMm: 1524,
      status: "known",
      displayUnit: "in"
    },
    assetId: "asset-1",
    metadata: {}
  };
}

function createSampleAsset(): Asset {
  return {
    id: "asset-1",
    schemaVersion: CURRENT_ASSET_SCHEMA_VERSION,
    mimeType: "image/webp",
    originalFilename: "untitled-9.jpg",
    originalKey: "asset-1:original",
    displayKey: "asset-1:display",
    thumbnailKey: "asset-1:thumbnail",
    widthPx: 3000,
    heightPx: 3000,
    byteSize: 4_200_000,
    sha256: "a".repeat(64)
  };
}

describe("artworkSchema", () => {
  it("accepts a sample artwork", () => {
    expect(parseArtwork(createSampleArtwork()).title).toBe("Untitled #9");
  });

  it("accepts an artwork with only the required fields", () => {
    const minimal = {
      id: "artwork-minimal",
      schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
      dimensions: { status: "unknown" },
      metadata: {}
    };

    expect(() => parseArtwork(minimal)).not.toThrow();
  });

  it("rejects a missing id", () => {
    const { id: _id, ...artwork } = createSampleArtwork();

    expect(() => parseArtwork(artwork)).toThrow();
  });

  it("rejects an invalid dimensions status", () => {
    const artwork = createSampleArtwork();
    artwork.dimensions = { ...artwork.dimensions, status: "guessed" as never };

    expect(() => parseArtwork(artwork)).toThrow();
  });

  it("preserves unknown metadata keys", () => {
    const artwork = createSampleArtwork();
    artwork.metadata = { luxLimit: 50, onLoan: true, notes: "handle with care" };

    expect(parseArtwork(artwork).metadata).toEqual({
      luxLimit: 50,
      onLoan: true,
      notes: "handle with care"
    });
  });
});

describe("assetSchema", () => {
  it("accepts a sample asset", () => {
    expect(parseAsset(createSampleAsset()).mimeType).toBe("image/webp");
  });

  it("accepts an asset with only the required fields", () => {
    const minimal = {
      id: "asset-minimal",
      schemaVersion: CURRENT_ASSET_SCHEMA_VERSION,
      mimeType: "image/jpeg",
      originalKey: "asset-minimal:original",
      displayKey: "asset-minimal:display",
      thumbnailKey: "asset-minimal:thumbnail"
    };

    expect(() => parseAsset(minimal)).not.toThrow();
  });

  it("rejects a non-positive widthPx", () => {
    const asset = createSampleAsset();
    asset.widthPx = 0;

    expect(() => parseAsset(asset)).toThrow();
  });

  it("rejects a negative byteSize", () => {
    const asset = createSampleAsset();
    asset.byteSize = -1;

    expect(() => parseAsset(asset)).toThrow();
  });
});

describe("migrateArtwork", () => {
  it("rejects input with no recognizable schemaVersion as not a Sightlines artwork", () => {
    expect(() => migrateArtwork({ hello: 1 })).toThrow(/not a Sightlines artwork/);
    expect(() => migrateArtwork("just a string")).toThrow(/not a Sightlines artwork/);
    expect(() => migrateArtwork(null)).toThrow(/not a Sightlines artwork/);
  });

  it("distinguishes a newer schema version from a generally unrecognized file", () => {
    const fromTheFuture = {
      ...createSampleArtwork(),
      schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION + 1
    };

    expect(() => migrateArtwork(fromTheFuture)).toThrow(/newer version of Sightlines/);
    expect(() => migrateArtwork(fromTheFuture)).toThrow(
      new RegExp(`schema version ${CURRENT_ARTWORK_SCHEMA_VERSION + 1}`)
    );
  });

  it("reports a readable reason for a same-version document that fails validation", () => {
    const artwork = createSampleArtwork();
    // @ts-expect-error deliberately corrupting a required field for the test
    artwork.dimensions = undefined;

    expect(() => migrateArtwork(artwork)).toThrow(/doesn't match the Sightlines format/);
    expect(() => migrateArtwork(artwork)).toThrow(/dimensions/);
  });

  it("round-trips a valid artwork unchanged", () => {
    const artwork = createSampleArtwork();

    expect(migrateArtwork(artwork)).toEqual(artwork);
  });
});
