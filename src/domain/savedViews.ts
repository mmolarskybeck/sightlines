// Pure helpers for Saved views (spec §8): degenerate-pose detection, room-id
// resolution from a stored camera pose, and live room-label resolution. No
// React, no three.js — poses arrive as plain world-space numbers.

import type { Point } from "./geometry/polygon";
import { isPointInPolygon } from "./geometry/polygon";
import type { Project, RoomPlacement, SavedView, SavedViewPose } from "./project";

// The 3D scene maps floor-space millimetres to world units at 1 unit = 1 metre,
// with plan (xMm, yMm) → world (x, z) (see components/three/coordinates.ts's
// MM_TO_WORLD and the axis-mapping note in geometry/scene3d.ts). A stored pose
// is in world units, so its ground-plane (x, z) converts straight back to floor
// millimetres by this factor.
const WORLD_UNITS_TO_MM = 1000;

// Camera and target are "effectively coincident" within this distance (world
// units = metres). A micron is far below any pose the interactive rig produces
// yet safely above float noise from lookAt/orbit math.
const COINCIDENT_EPSILON_M = 1e-6;

function isFiniteVec3(vec: { x: number; y: number; z: number }): boolean {
  return (
    Number.isFinite(vec.x) && Number.isFinite(vec.y) && Number.isFinite(vec.z)
  );
}

// A pose is degenerate only when its camera data is numerically invalid (spec
// §8.4): non-finite position or target components, or a camera and target that
// effectively coincide (no view direction). Geometry edits and room deletion do
// NOT make a pose degenerate — a valid bookmark always renders the current
// project, even if the result is now sparse. Lens parameters are not stored, so
// the "invalid field-of-view/clipping" case cannot occur here.
export function isDegeneratePose(pose: SavedViewPose): boolean {
  if (!isFiniteVec3(pose.position) || !isFiniteVec3(pose.target)) return true;
  const dx = pose.position.x - pose.target.x;
  const dy = pose.position.y - pose.target.y;
  const dz = pose.position.z - pose.target.z;
  return Math.hypot(dx, dy, dz) <= COINCIDENT_EPSILON_M;
}

// One placement's floor polygon in floor-space millimetres. Mirrors
// scene3d's transformPoint (rotation then offset); winding is irrelevant to
// point-in-polygon so it is left as authored.
function roomFloorPolygon(placement: RoomPlacement): Point[] {
  const rad = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return placement.room.vertices.map((vertex) => ({
    xMm: vertex.xMm * cos - vertex.yMm * sin + placement.offsetXMm,
    yMm: vertex.xMm * sin + vertex.yMm * cos + placement.offsetYMm
  }));
}

// The id of the first room whose floor polygon contains a world-space
// ground-plane point (x, z), or undefined when the point sits outside every
// room. Point-in-polygon runs in floor-space millimetres.
export function roomIdAtGroundPoint(
  point: { x: number; z: number },
  rooms: readonly RoomPlacement[]
): string | undefined {
  const floorPoint: Point = {
    xMm: point.x * WORLD_UNITS_TO_MM,
    yMm: point.z * WORLD_UNITS_TO_MM
  };
  for (const placement of rooms) {
    if (isPointInPolygon(floorPoint, roomFloorPolygon(placement))) {
      return placement.roomId;
    }
  }
  return undefined;
}

// The room id to store on a Saved view for a pose (spec §8.2): the room
// containing the camera, or — when the camera is outside every room — the room
// containing the target; undefined when both lie outside every room.
export function resolveSavedViewRoomId(
  pose: SavedViewPose,
  rooms: readonly RoomPlacement[]
): string | undefined {
  return (
    roomIdAtGroundPoint(pose.position, rooms) ??
    roomIdAtGroundPoint(pose.target, rooms)
  );
}

// The live room label for a Saved view (spec §8.3): the containing room's
// current name in the CURRENT project, looked up fresh every call so renames
// are reflected. Undefined when the stored id no longer resolves (room deleted)
// — the label is then simply omitted from the composed "room label · title".
export function resolveSavedViewRoomLabel(
  project: Project,
  savedView: SavedView
): string | undefined {
  if (savedView.roomId === undefined) return undefined;
  const placement = project.floor.rooms.find(
    (candidate) => candidate.roomId === savedView.roomId
  );
  return placement?.room.name;
}

// The default title a Saved view carries until renamed (spec §8.2): `Saved
// view ${ordinal}`. Also the discriminator the collection pane and the Export
// dialog share for the "show a subtitle only once renamed" rule.
export function defaultSavedViewTitle(savedView: SavedView): string {
  return `Saved view ${savedView.ordinal}`;
}

// The composed presentation of a Saved view, resolved LIVE against the current
// project — the one place every consumer (Export dialog, PDF, collection pane)
// derives the "room label · title" line, the default-title fallback, and the
// "renamed away from default" flag from, so they can never drift.
export function composeSavedViewLabel(
  project: Project,
  savedView: SavedView
): {
  roomLabel: string | undefined;
  // "room label · title" when a room resolves, otherwise the bare title.
  composedLabel: string;
  defaultTitle: string;
  // True once the user has renamed the view away from its default title — the
  // gate for showing the redundant "Saved view n" subtitle.
  isRenamed: boolean;
} {
  const roomLabel = resolveSavedViewRoomLabel(project, savedView);
  const composedLabel = roomLabel
    ? `${roomLabel} · ${savedView.title}`
    : savedView.title;
  const defaultTitle = defaultSavedViewTitle(savedView);
  return {
    roomLabel,
    composedLabel,
    defaultTitle,
    isRenamed: savedView.title.trim() !== defaultTitle
  };
}
