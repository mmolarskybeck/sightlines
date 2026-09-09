import { Box3, MathUtils, Plane, Vector2, Vector3 } from "three";
import { effectiveFraming, getArtworkOuterDimensionsMm } from "../../../domain/framing";
import { parseFaceWallId } from "../../../domain/geometry/freestandingWalls";
import {
  wallInwardNormal,
  type Room3d,
  type Scene3d,
  type WallArtwork3d,
  type WallPanel3d
} from "../../../domain/geometry/scene3d";
import { type Artwork, type SavedViewPose } from "../../../domain/project";
import { fitDistance } from "./cameraFit";
import {
  eyeLevelArtworkDistanceMm,
  eyeLevelWallDistanceMm,
  sightlineOccluders,
  type CameraPose,
  type SightlineSegment
} from "./cameraNav";
import { MM_TO_WORLD } from "./coordinates";
import { CAMERA_FOV_DEG } from "./sceneConstants";

// Entry framing: above and outside the room, looking down at ~40° elevation
// from a corner (spec §4.2).
export const FIT_ELEVATION_DEG = 40;
export const FIT_AZIMUTH_DEG = 45;

// Preset flights are quick enough to stay an instrument, slow enough to keep
// spatial continuity.
export const FLIGHT_MS = 600;

// Every selectable wall surface in a room: perimeter walls plus partition
// faces (spec §7.1). Eye-level lookup and camera framing both scan this.
export function roomWallPanels(room: Room3d): WallPanel3d[] {
  return [...room.walls, ...room.freestandingWalls.flatMap((partition) => partition.faces)];
}

// World-space bounding box of one room's floor + wall heights, including its
// freestanding partitions. Empty (isEmpty()) when the room has no geometry.
export function roomBounds(room: Room3d): Box3 {
  const box = new Box3();
  // Seed with the room's own height, not 0: a room whose walls are all open
  // emits no panels, and reducing over an empty list would flatten the box onto
  // the floor plane and wreck the camera fit.
  const maxWallHeightMm = room.walls.reduce(
    (max, wall) => Math.max(max, wall.heightMm),
    room.heightMm
  );
  for (const point of room.floorPolygon) {
    box.expandByPoint(
      new Vector3(point.xMm * MM_TO_WORLD, 0, point.yMm * MM_TO_WORLD)
    );
    box.expandByPoint(
      new Vector3(
        point.xMm * MM_TO_WORLD,
        maxWallHeightMm * MM_TO_WORLD,
        point.yMm * MM_TO_WORLD
      )
    );
  }

  // A partition can be taller than the room's walls, and its endpoints can sit
  // outside the room polygon (advisory, spec §6.4) — so frame by its cap
  // outline and heightMm explicitly, or the fit derived from floors alone could
  // clip it.
  for (const partition of room.freestandingWalls) {
    const { start, end, heightMm } = partition.capOutline;
    for (const point of [start, end]) {
      box.expandByPoint(new Vector3(point.xMm * MM_TO_WORLD, 0, point.yMm * MM_TO_WORLD));
      box.expandByPoint(
        new Vector3(point.xMm * MM_TO_WORLD, heightMm * MM_TO_WORLD, point.yMm * MM_TO_WORLD)
      );
    }
  }

  return box;
}

// World-space bounding box of the union of every room. null when there is
// nothing to frame.
export function sceneBounds(scene: Scene3d): Box3 | null {
  const box = new Box3();
  let hasPoint = false;

  for (const room of scene.rooms) {
    const bounds = roomBounds(room);
    if (bounds.isEmpty()) continue;
    box.union(bounds);
    hasPoint = true;
  }

  return hasPoint ? box : null;
}

// The fitted overview pose: the union of all room floor polygons framed from
// a corner at ~40° elevation, solved against the real frustum (cameraFit.ts).
export function overviewPose(scene: Scene3d, aspect: number): CameraPose | null {
  const bounds = sceneBounds(scene);
  if (!bounds) return null;

  const target = bounds.getCenter(new Vector3());
  const elevation = MathUtils.degToRad(FIT_ELEVATION_DEG);
  const azimuth = MathUtils.degToRad(FIT_AZIMUTH_DEG);
  const direction = new Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth)
  );
  const distance = fitDistance(bounds, direction, CAMERA_FOV_DEG, aspect);
  const position = target.clone().addScaledVector(direction, distance);
  return { position, target };
}

// Every candidate occluder in the scene, floor-space: perimeter walls carry
// their inward normal (single-sided — seen from outside they're already
// back-face culled, WallPanel's dollhouse note), partition slabs are opaque
// from both sides so they carry none.
export function sceneSightlineSegments(scene: Scene3d): SightlineSegment[] {
  return scene.rooms.flatMap((room) => [
    ...room.walls.map((wall) => ({
      id: wall.wallId,
      start: wall.start,
      end: wall.end,
      facing: wallInwardNormal(wall)
    })),
    ...room.freestandingWalls.map((partition) => ({
      id: partition.freestandingWallId,
      start: partition.capOutline.start,
      end: partition.capOutline.end
    }))
  ]);
}

// A standing viewpoint facing the SELECTED thing (spec §4.2): the whole wall
// framed in the frustum when the wall drove the preset, the work plus
// breathing room when a specific artwork did — camera level at the project's
// eye height either way. The standoff comes from the framing fit alone;
// anything crossing the sightline (partition slabs, interior-facing walls in
// an L-shaped room) is returned for the render layer to GHOST rather than the
// camera creeping closer — position is framing's job, visibility is
// ghosting's. The fit may stand outside the room; the dollhouse back-face
// culling already opens that view.
export function eyeLevelView(
  scene: Scene3d,
  wall: WallPanel3d,
  artwork: WallArtwork3d | null,
  eyeHeightMm: number,
  aspect: number
): { pose: CameraPose; ghostedIds: ReadonlySet<string> } {
  const { xMm: normalX, yMm: normalY } = wallInwardNormal(wall);
  const wallLengthMm = Math.hypot(
    wall.end.xMm - wall.start.xMm,
    wall.end.yMm - wall.start.yMm
  );

  let targetFloor: { xMm: number; yMm: number };
  let targetHeightMm: number;
  let distanceMm: number;
  if (artwork) {
    const ux = (wall.end.xMm - wall.start.xMm) / wallLengthMm;
    const uy = (wall.end.yMm - wall.start.yMm) / wallLengthMm;
    targetFloor = {
      xMm: wall.start.xMm + ux * artwork.xMm,
      yMm: wall.start.yMm + uy * artwork.xMm
    };
    // Aim at the work's actual hang point — a slight upward gaze at a
    // high-hung work is the natural standing read.
    targetHeightMm = artwork.yMm;
    distanceMm = eyeLevelArtworkDistanceMm(artwork.widthMm, artwork.heightMm);
  } else {
    targetFloor = {
      xMm: (wall.start.xMm + wall.end.xMm) / 2,
      yMm: (wall.start.yMm + wall.end.yMm) / 2
    };
    targetHeightMm = eyeHeightMm;
    distanceMm = eyeLevelWallDistanceMm(
      wallLengthMm,
      wall.heightMm,
      eyeHeightMm,
      MathUtils.degToRad(CAMERA_FOV_DEG),
      aspect
    );
  }

  const cameraFloor = {
    xMm: targetFloor.xMm + normalX * distanceMm,
    yMm: targetFloor.yMm + normalY * distanceMm
  };
  const pose: CameraPose = {
    target: new Vector3(
      targetFloor.xMm * MM_TO_WORLD,
      targetHeightMm * MM_TO_WORLD,
      targetFloor.yMm * MM_TO_WORLD
    ),
    position: new Vector3(
      cameraFloor.xMm * MM_TO_WORLD,
      eyeHeightMm * MM_TO_WORLD,
      cameraFloor.yMm * MM_TO_WORLD
    )
  };

  // Belt-and-braces exclusion: the viewed wall sits AT the target (t≈1, which
  // the occluder test already rejects), and a viewed partition face's own
  // slab sits behind the ray start.
  const faceRef = parseFaceWallId(wall.wallId);
  const exclude = new Set(
    faceRef ? [wall.wallId, faceRef.freestandingWallId] : [wall.wallId]
  );
  const ghostedIds = new Set(
    sightlineOccluders(cameraFloor, targetFloor, sceneSightlineSegments(scene), exclude)
  );
  return { pose, ghostedIds };
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// A stored Saved-view pose (plain world-space numbers) as a live CameraPose.
export function toCameraPose(pose: SavedViewPose): CameraPose {
  return {
    position: new Vector3(pose.position.x, pose.position.y, pose.position.z),
    target: new Vector3(pose.target.x, pose.target.y, pose.target.z)
  };
}

// Honour the app's motion rules: a pose open is a cut, not a flight, when the
// user prefers reduced motion (spec §4.3).
export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export const FLOOR_PLANE = new Plane(new Vector3(0, 1, 0), 0);

// Cursor position -> NDC on the canvas, for raycasts driven by native events.
export function cursorNdc(canvas: HTMLCanvasElement, clientX: number, clientY: number): Vector2 {
  const rect = canvas.getBoundingClientRect();
  return new Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
}

// Eye-level target wall priority (spec §4.2): selected wall, then the wall
// holding the selected artwork placement, then the longest wall, then the
// first.
// A selected ARTWORK takes precedence over the wall context: the wall context
// lingers from placement, but a picked work is what the user is judging — eye
// level frames it, not its wall's midpoint. Wall selection frames the whole
// wall; with nothing selected, the longest wall stands in.
export function pickEyeLevelWall(
  scene: Scene3d,
  selectedWallId: string | null,
  selectedObjectIds: string[],
  selectedArtworkId: string | null
): { wall: WallPanel3d; artwork: WallArtwork3d | null } | null {
  const walls = scene.rooms.flatMap(roomWallPanels);
  if (walls.length === 0) return null;

  for (const wall of walls) {
    const artwork = wall.artworks.find(
      (candidate) =>
        selectedObjectIds.includes(candidate.objectId) ||
        candidate.artworkId === selectedArtworkId
    );
    if (artwork) return { wall, artwork };
  }

  if (selectedWallId) {
    const wall = walls.find((w) => w.wallId === selectedWallId);
    if (wall) return { wall, artwork: null };
  }

  const longest = walls.reduce((best, wall) => {
    const length = Math.hypot(
      wall.end.xMm - wall.start.xMm,
      wall.end.yMm - wall.start.yMm
    );
    const bestLength = Math.hypot(
      best.end.xMm - best.start.xMm,
      best.end.yMm - best.start.yMm
    );
    return length > bestLength ? wall : best;
  }, walls[0]);
  return { wall: longest, artwork: null };
}

// The eye-level standoff (eyeLevelArtworkDistanceMm, cameraNav.ts) must clear
// the RENDERED mesh, which ArtworkPlane widens by mat+frame at its own render
// boundary (framingLayout) from the artwork record — scene3d's WallArtwork3d
// stays image-sized per the framing contract (deriveScene3d does not import
// framing.ts). So the standoff widens here, at the one place the focused
// artwork's record is resolved for this purpose, rather than in scene3d or in
// eyeLevelView itself: nothing else consumes scene3d's artwork dims besides
// ArtworkPlane's own self-widening, so widening scene3d's persisted-shaped
// data would move the seam for no other consumer. Pulled out as a pure
// function (identity when unframed) so the widening is unit-testable without
// a three.js/DOM harness.
export function resolveEyeLevelStandoffArtwork(
  artwork: WallArtwork3d | null,
  artworksById: ReadonlyMap<string, Artwork>
): WallArtwork3d | null {
  if (!artwork) return null;

  const record = artworksById.get(artwork.artworkId);
  // effectiveFraming is the single interpreter of frameIncludedInImage: a
  // flagged work returns empty bands, so the standoff clears the image-sized
  // mesh ArtworkPlane actually draws for it.
  const { matWidthMm, frame } = effectiveFraming(record);
  const outer = getArtworkOuterDimensionsMm(
    artwork.widthMm,
    artwork.heightMm,
    matWidthMm,
    frame
  );

  if (outer.widthMm === artwork.widthMm && outer.heightMm === artwork.heightMm) {
    return artwork;
  }

  return { ...artwork, ...outer };
}

export function wallFocusTarget(wall: WallPanel3d): Vector3 {
  return new Vector3(
    ((wall.start.xMm + wall.end.xMm) / 2) * MM_TO_WORLD,
    (wall.heightMm / 2) * MM_TO_WORLD,
    ((wall.start.yMm + wall.end.yMm) / 2) * MM_TO_WORLD
  );
}

// A selected wall / artwork / floor object focuses on a point (clamped-distance
// flight); a selected ROOM frames its whole bounding box instead (spec §4.2).
export type FocusSelection =
  | { kind: "point"; point: Vector3 }
  | { kind: "room"; room: Room3d };

export function resolveFocusSelection(
  scene: Scene3d,
  selectedRoomId: string | null,
  selectedWallId: string | null,
  selectedObjectIds: string[],
  selectedArtworkId: string | null
): FocusSelection | null {
  const walls = scene.rooms.flatMap(roomWallPanels);
  const selectedWall = selectedWallId
    ? walls.find((wall) => wall.wallId === selectedWallId)
    : undefined;
  if (selectedWall) return { kind: "point", point: wallFocusTarget(selectedWall) };

  const artworkWall = walls.find((wall) =>
    wall.artworks.some(
      (artwork) =>
        selectedObjectIds.includes(artwork.objectId) ||
        artwork.artworkId === selectedArtworkId
    )
  );
  if (artworkWall) return { kind: "point", point: wallFocusTarget(artworkWall) };

  const floorObject = scene.floorObjects.find(
    (object) =>
      selectedObjectIds.includes(object.objectId) ||
      object.artworkId === selectedArtworkId
  );
  if (floorObject) {
    return {
      kind: "point",
      point: new Vector3(
        floorObject.xMm * MM_TO_WORLD,
        floorObject.heightMm * 0.5 * MM_TO_WORLD,
        floorObject.yMm * MM_TO_WORLD
      )
    };
  }

  const selectedRoom = selectedRoomId
    ? scene.rooms.find((room) => room.roomId === selectedRoomId)
    : undefined;
  return selectedRoom ? { kind: "room", room: selectedRoom } : null;
}
