import type { Point } from "./polygon";
import type { RoomPlacement } from "../project";

// One placement's floor polygon in floor-space millimetres. Mirrors
// scene3d's transformPoint (rotation then offset); winding is irrelevant to
// point-in-polygon so it is left as authored.
export function roomFloorPolygon(placement: RoomPlacement): Point[] {
  const rad = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return placement.room.vertices.map((vertex) => ({
    xMm: vertex.xMm * cos - vertex.yMm * sin + placement.offsetXMm,
    yMm: vertex.xMm * sin + vertex.yMm * cos + placement.offsetYMm
  }));
}
