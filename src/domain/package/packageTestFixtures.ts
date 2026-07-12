// Test-only fixtures for the .sightlines package export slice. Not imported by
// any app code (tree-shaken out of the bundle); shared across the package tests
// so the same project/library/asset/blob shape is exercised everywhere.
//
// getBlob returns Node's Blob (from node:buffer) rather than jsdom's, because
// jsdom's Blob has no `arrayBuffer()` — a jsdom limitation, not something the
// production browser Blob shares. buildPackage reads bytes the standard way; the
// fixture just hands it a Blob that behaves like a real browser's.
import { Blob as NodeBlob } from "node:buffer";
import { CURRENT_ARTWORK_SCHEMA_VERSION, CURRENT_ASSET_SCHEMA_VERSION } from "../project";
import type { Artwork, Asset, Project } from "../project";
import { createSampleProject } from "../sample/sampleProject";

export function makeArtwork(id: string, overrides: Partial<Artwork> = {}): Artwork {
  return {
    id,
    schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
    title: `Artwork ${id}`,
    dimensions: { status: "known", widthMm: 500, heightMm: 400 },
    metadata: {},
    ...overrides
  };
}

export function makeAsset(id: string, overrides: Partial<Asset> = {}): Asset {
  return {
    id,
    schemaVersion: CURRENT_ASSET_SCHEMA_VERSION,
    mimeType: "image/jpeg",
    originalFilename: `${id}.jpg`,
    originalKey: `${id}:original`,
    displayKey: `${id}:display`,
    thumbnailKey: `${id}:thumbnail`,
    widthPx: 1800,
    heightPx: 1440,
    byteSize: 123456,
    sha256: `${id}-original-content-hash`,
    ...overrides
  };
}

export type PackageFixture = {
  project: Project;
  library: Artwork[];
  assets: Map<string, Asset>;
  // blob key (e.g. "asset-1:display") -> raw bytes
  blobs: Map<string, Uint8Array>;
  getAsset: (assetId: string) => Promise<Asset>;
  getBlob: (key: string) => Promise<Blob>;
};

// A minimal VALID WebP (VP8L flavor): RIFF/WEBP container, VP8L chunk with the
// 0x2F signature and real 14-bit dimensions, then the label as trailing payload
// so every stub has distinct, deterministic content (distinct hashes). Import's
// fail-closed header sniffer (readImageDimensions) accepts these; arbitrary
// text bytes would be rejected as unreadable image data.
export function makeWebpStubBytes(label: string, widthPx = 8, heightPx = 6): Uint8Array {
  const payload = new TextEncoder().encode(`:${label}`);
  // VP8L chunk data: signature byte + 4 dimension-bit bytes + payload.
  const chunkSize = 5 + payload.length;
  const bytes = new Uint8Array(12 + 8 + chunkSize);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  const u32le = (offset: number, value: number) => {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >> 8) & 0xff;
    bytes[offset + 2] = (value >> 16) & 0xff;
    bytes[offset + 3] = (value >> 24) & 0xff;
  };

  ascii(0, "RIFF");
  u32le(4, bytes.length - 8);
  ascii(8, "WEBP");
  ascii(12, "VP8L");
  u32le(16, chunkSize);
  bytes[20] = 0x2f; // VP8L signature
  u32le(21, ((widthPx - 1) & 0x3fff) | (((heightPx - 1) & 0x3fff) << 14));
  bytes.set(payload, 25);
  return bytes;
}

function bytesFor(label: string): Uint8Array {
  // Distinct, deterministic, VALID image content per tier so hashes differ
  // and the import-side header sniffer accepts them.
  return makeWebpStubBytes(label);
}

// A project with:
// - art-placed:       on checklist AND placed on a wall (assetId asset-1)
// - art-unplaced:     on checklist, never placed        (assetId asset-2)
// - art-unreferenced: in the library only, not on this checklist (must be excluded)
export function makeFixture(): PackageFixture {
  const base = createSampleProject();
  const wallId = base.floor.rooms[0].room.walls[0].id;

  const project: Project = {
    ...base,
    checklistArtworkIds: ["art-placed", "art-unplaced"],
    wallObjects: [
      {
        id: "wo-1",
        kind: "artwork",
        wallId,
        artworkId: "art-placed",
        xMm: 1000,
        yMm: 1450,
        widthMm: 500,
        heightMm: 400
      }
    ],
    floorObjects: []
  };

  const library: Artwork[] = [
    makeArtwork("art-placed", { assetId: "asset-1" }),
    makeArtwork("art-unplaced", { assetId: "asset-2" }),
    makeArtwork("art-unreferenced", { assetId: "asset-3" })
  ];

  const assets = new Map<string, Asset>([
    ["asset-1", makeAsset("asset-1")],
    ["asset-2", makeAsset("asset-2")],
    ["asset-3", makeAsset("asset-3")]
  ]);

  const blobs = new Map<string, Uint8Array>();
  for (const asset of assets.values()) {
    blobs.set(asset.originalKey, bytesFor(`${asset.id}-original`));
    blobs.set(asset.displayKey, bytesFor(`${asset.id}-display`));
    blobs.set(asset.thumbnailKey, bytesFor(`${asset.id}-thumbnail`));
  }

  const getAsset = async (assetId: string): Promise<Asset> => {
    const asset = assets.get(assetId);
    if (!asset) throw new Error(`asset not found: ${assetId}`);
    return asset;
  };

  const getBlob = async (key: string): Promise<Blob> => {
    const bytes = blobs.get(key);
    if (!bytes) throw new Error(`blob not found: ${key}`);
    // Copy into a concrete ArrayBuffer-backed view so the Blob part type matches.
    const part = new Uint8Array(bytes.byteLength);
    part.set(bytes);
    return new NodeBlob([part], { type: "image/webp" }) as unknown as Blob;
  };

  return { project, library, assets, blobs, getAsset, getBlob };
}

// Reads the ZIP local file headers to recover each entry's compression method
// (0 = store, 8 = deflate) — the only way to prove image blobs are stored
// uncompressed, since a transparent unzip hides which method produced them.
export function readZipCompressionMethods(bytes: Uint8Array): Map<string, number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const methods = new Map<string, number>();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(
      bytes.subarray(offset + 30, offset + 30 + nameLength)
    );
    methods.set(name, method);
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  return methods;
}
