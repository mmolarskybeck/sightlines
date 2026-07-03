export const CURRENT_SCHEMA_VERSION = 1;
export const CURRENT_ARTWORK_SCHEMA_VERSION = 1;
export const CURRENT_ASSET_SCHEMA_VERSION = 1;

export type DisplayUnit = "in" | "ft" | "cm" | "m";

export type Dimensions = {
  widthMm?: number;
  heightMm?: number;
  depthMm?: number;
  status: "known" | "approximate" | "unknown";
  displayUnit?: DisplayUnit;
};

export type Artwork = {
  id: string;
  schemaVersion: number;
  artist?: string;
  title?: string;
  date?: string;
  accessionNumber?: string;
  locationOrLender?: string;
  dimensions: Dimensions;
  assetId?: string;
  metadata: Record<string, string | number | boolean>;
};

// Tiered image storage (docs/plan.md §4.5) — original/display/thumbnail are
// keys into a blob store (see repositories/assetRepository.ts), not the
// blobs themselves, so Asset records stay small and IndexedDB-friendly.
export type Asset = {
  id: string;
  schemaVersion: number;
  mimeType: string;
  originalFilename?: string;
  originalKey: string;
  displayKey: string;
  thumbnailKey: string;
  widthPx?: number;
  heightPx?: number;
  byteSize?: number;
  sha256?: string;
};

export type Project = {
  id: string;
  schemaVersion: number;
  title: string;
  unit: DisplayUnit;
  defaultWallHeightMm: number;
  defaultCenterlineHeightMm: number;
  floor: Floor;
  checklistArtworkIds: string[];
  wallObjects: WallObject[];
  createdAt: string;
  updatedAt: string;
};

export type Floor = {
  rooms: RoomPlacement[];
};

export type RoomPlacement = {
  roomId: string;
  offsetXMm: number;
  offsetYMm: number;
  rotationDeg: number;
  room: Room;
};

export type RoomVertex = {
  id: string;
  xMm: number;
  yMm: number;
};

export type Room = {
  id: string;
  name: string;
  heightMm: number;
  vertices: RoomVertex[];
  walls: Wall[];
};

export type Wall = {
  id: string;
  roomId: string;
  name: string;
  startVertexId: string;
  endVertexId: string;
  heightMm: number;
  defaultCenterlineHeightMm?: number;
};

export type WallObjectBase = {
  id: string;
  wallId: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  rotationDeg?: number;
  groupId?: string;
};

export type ArtworkWallObject = WallObjectBase & {
  kind: "artwork";
  artworkId: string;
  displayDimensionsOverride?: Dimensions;
};

export type OpeningWallObject = WallObjectBase & {
  kind: "door" | "window" | "blocked-zone";
  blocksPlacement: true;
  connectsToWallId?: string;
};

export type WallObject = ArtworkWallObject | OpeningWallObject;

export type ProjectSummary = {
  id: string;
  title: string;
  updatedAt: string;
};
