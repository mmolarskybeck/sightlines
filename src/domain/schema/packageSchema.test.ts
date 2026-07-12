import { describe, expect, it } from "vitest";
import { createSampleProject } from "../sample/sampleProject";
import {
  PACKAGE_SCHEMA_VERSION,
  parseSightlinesPackage,
  readPackageManifest,
  type SightlinesPackage
} from "./packageSchema";

function makeManifest(overrides: Partial<SightlinesPackage> = {}): SightlinesPackage {
  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    exportedAt: "2026-07-12T00:00:00.000Z",
    mode: "display",
    project: createSampleProject(),
    artworks: [],
    assets: [],
    ...overrides
  };
}

describe("sightlinesPackageSchema", () => {
  it("accepts a minimal valid manifest and round-trips", () => {
    const manifest = makeManifest();
    expect(parseSightlinesPackage(manifest)).toMatchObject({
      schemaVersion: 1,
      mode: "display"
    });
  });

  it("validates asset tier entries", () => {
    const manifest = makeManifest({
      assets: [
        {
          assetId: "asset-1",
          mimeType: "image/jpeg",
          sha256: "original-hash",
          tiers: [
            {
              tier: "display",
              path: "assets/abc.webp",
              sha256: "display-hash",
              byteSize: 42,
              mimeType: "image/webp"
            }
          ]
        }
      ]
    });
    expect(() => parseSightlinesPackage(manifest)).not.toThrow();
  });

  it("rejects an unknown export mode", () => {
    const manifest = makeManifest({ mode: "everything" as never });
    expect(() => parseSightlinesPackage(manifest)).toThrow();
  });

  it("rejects an unknown asset tier", () => {
    const manifest = makeManifest({
      assets: [
        {
          assetId: "asset-1",
          mimeType: "image/jpeg",
          tiers: [
            {
              tier: "preview" as never,
              path: "assets/abc.webp",
              sha256: "h",
              byteSize: 1,
              mimeType: "image/webp"
            }
          ]
        }
      ]
    });
    expect(() => parseSightlinesPackage(manifest)).toThrow();
  });
});

describe("readPackageManifest", () => {
  it("accepts a current-version manifest", () => {
    expect(readPackageManifest(makeManifest()).schemaVersion).toBe(1);
  });

  it("rejects a non-object / unversioned payload", () => {
    expect(() => readPackageManifest("not a package")).toThrow(/not a Sightlines package/);
    expect(() => readPackageManifest({})).toThrow(/not a Sightlines package/);
  });

  it("rejects a package from a newer app version", () => {
    const manifest = { ...makeManifest(), schemaVersion: PACKAGE_SCHEMA_VERSION + 1 };
    expect(() => readPackageManifest(manifest)).toThrow(/newer version/);
  });

  it("surfaces a human-readable path when the shape is wrong", () => {
    const manifest = makeManifest();
    // Corrupt a required field.
    (manifest as unknown as Record<string, unknown>).exportedAt = 12345;
    expect(() => readPackageManifest(manifest)).toThrow(/Sightlines format/);
  });
});
