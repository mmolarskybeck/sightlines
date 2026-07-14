export const CURRENT_SCHEMA_VERSION = 3;
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

// Flat, schematic frame/mat finishes (docs/quick-todos.md) — hex values and
// labels live in domain/framing.ts so schema, renderer, and inspector agree.
export type FrameFinish = "gold" | "white" | "black" | "silver" | "wood";

export type ArtworkFrame = {
  // Face width of the frame band, added outside the mat on every side.
  widthMm: number;
  finish: FrameFinish;
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
  // Whether this work hangs on a wall or sits on the floor, as an explicit
  // curator override. Absent by default — the effective form is then DERIVED
  // from dimensions.depthMm (see domain/placement/artworkForm.ts). Additive and
  // optional, so pre-existing artwork documents validate unchanged.
  placementForm?: "wall" | "floor";
  // Optional, additive framing (no schema-version bump): a mat band width and
  // a frame spec. Both absent on legacy records, which then load and render
  // exactly as before (see getArtworkOuterDimensionsMm).
  matWidthMm?: number;
  frame?: ArtworkFrame;
  // The stored `dimensions` (and the uploaded image) ALREADY include the frame
  // — often because the photo itself shows the frame. When true, the footprint
  // IS `dimensions`: geometry adds no mat/frame band and the renderer draws
  // none, because the frame is part of the work as given. Absent/false on every
  // legacy record ⇒ widen by mat/frame exactly as before. Additive and
  // optional (no schema-version bump). The flag is interpreted in EXACTLY one
  // place — effectiveFraming (domain/framing.ts) — so geometry, render,
  // tooltip, and inspector can never disagree about what it means. A record may
  // carry a stored mat/frame AND this flag; the flag wins everywhere.
  frameIncludedInImage?: boolean;
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
  // Free-standing partitions inside the room (spec §5.2). Room-owned so they
  // move with RoomPlacement.offset and cascade on deleteRoom; endpoints are
  // inline room-local mm (deliberately NOT entries in `vertices`). Defaults to
  // [] via the schema so v2 fixtures need no churn.
  freestandingWalls: FreestandingWall[];
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

// A partition: a straight room-owned segment connected to nothing, with real
// thickness, exposing two derived placeable faces (spec §5.2/§5.3). Endpoints
// are inline room-local mm (same coordinate space as RoomVertex). Faces are
// DERIVED (see domain/geometry/freestandingWalls.ts), never stored.
export type FreestandingWall = {
  id: string;
  roomId: string;
  name: string;
  startXMm: number;
  startYMm: number;
  endXMm: number;
  endYMm: number;
  heightMm: number;
  thicknessMm: number;
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
  // Display/provenance metadata only. Geometry always uses the placement's
  // stored widthMm/heightMm as its image footprint and never resolves this
  // override. A future writer must explicitly rebake stored dimensions.
  displayDimensionsOverride?: Dimensions;
};

// The opening union is split (spec §5.5) so an illegal blocked-zone pairing is
// unrepresentable in TS, not just rejected at runtime: only doors and windows
// carry connectsToObjectId (opening→opening pairing; no writers until slice 4).
export type ConnectableOpeningWallObject = WallObjectBase & {
  kind: "door" | "window";
  blocksPlacement: true;
  connectsToObjectId?: string; // v3; replaces the never-written connectsToWallId
};

export type BlockedZoneWallObject = WallObjectBase & {
  kind: "blocked-zone";
  blocksPlacement: true;
};

export type OpeningWallObject = ConnectableOpeningWallObject | BlockedZoneWallObject;

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
  // Cheap counts for the project manager's per-row meta line — read straight
  // off the raw record (see toProjectSummary), not a full parseProject.
  roomCount: number;
  // Checklist size, not placed-artwork count: the number a "3 rooms · 12
  // works" line means for the whole project, placed or not.
  artworkCount: number;
};
