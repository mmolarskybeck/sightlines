export const CURRENT_SCHEMA_VERSION = 2;
export const CURRENT_ARTWORK_SCHEMA_VERSION = 1;
export const CURRENT_ASSET_SCHEMA_VERSION = 1;

export type DisplayUnit = "in" | "ft" | "cm" | "m";

export type Dimensions = {
  widthMm?: number;
  heightMm?: number;
  depthMm?: number;
  status: "known" | "approximate" | "unknown";
  displayUnit?: DisplayUnit;
  // Explicit curator choice: whether editing width/height should
  // proportionally scale the other to match the image's aspect ratio.
  // Undefined (legacy records) falls back to a tolerance-based heuristic —
  // see isAspectLocked in domain/units/aspectFill.ts.
  aspectLocked?: boolean;
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
  floorObjects: FloorObject[];
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

// Editable default depth for floor-placed objects (doors/windows have a
// fixed nominal wall-object thickness instead; see WALL_OBJECT_PLAN_DEPTH_MM).
export const DEFAULT_FLOOR_OBJECT_DEPTH_MM = 400;

export type FloorObjectBase = {
  id: string;
  // Floor-space center, not top-left — mirrors WallObjectBase's xMm/yMm
  // convention for its own coordinate space.
  xMm: number;
  yMm: number;
  widthMm: number;
  depthMm: number;
  // Wall angle preserved on wall→floor conversion; 0 for fresh floor placements.
  rotationDeg: number;
  // Remembered elevation height, restored on floor→wall conversion.
  heightMm: number;
  // Remembered hang-height center, restored on floor→wall conversion.
  wallYMm: number;
};

export type ArtworkFloorObject = FloorObjectBase & {
  kind: "artwork";
  artworkId: string;
  displayDimensionsOverride?: Dimensions;
};

export type BlockedZoneFloorObject = FloorObjectBase & {
  kind: "blocked-zone";
};

// Doors/windows are excluded from floor placement by the type system —
// they only ever exist as WallObjects.
export type FloorObject = ArtworkFloorObject | BlockedZoneFloorObject;

export type ProjectSummary = {
  id: string;
  title: string;
  updatedAt: string;
};
