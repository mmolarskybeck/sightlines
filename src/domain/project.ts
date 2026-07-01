export const CURRENT_SCHEMA_VERSION = 1;

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

export type Project = {
  id: string;
  schemaVersion: number;
  title: string;
  unit: DisplayUnit;
  defaultWallHeightMm: number;
  defaultCenterlineHeightMm: number;
  floor: Floor;
  checklistArtworkIds: string[];
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
