import {
  DEFAULT_FLOOR_CASE_DEPTH_MM,
  DEFAULT_FLOOR_CASE_HEIGHT_MM,
  DEFAULT_FLOOR_CASE_WIDTH_MM,
  DEFAULT_WALL_CASE_CENTER_Y_MM,
  DEFAULT_WALL_CASE_DEPTH_MM,
  DEFAULT_WALL_CASE_HEIGHT_MM,
  DEFAULT_WALL_CASE_WIDTH_MM,
  type CaseFloorObject,
  type CaseWallObject
} from "../project";
import { newId } from "../id";

// Factory helpers for the two display-case kinds (spec: one armed "Case" insert
// tool that creates a wall case on a wall click and a floor case on an open-
// floor click). Modeled on createOpening.ts: apply the curatorial defaults and
// no clamping — an out-of-bounds default is validatePlacement's to flag, not
// this constructor's to silently fix.

// A freestanding vitrine at a free floor-space center. rotationDeg is 0 for a
// fresh placement; wallYMm carries a harmless default (there is no case↔wall
// conversion — that machinery is artwork-specific — so it is never read).
export function createFloorCase(xMm: number, yMm: number): CaseFloorObject {
  return {
    id: newId(),
    kind: "case",
    xMm,
    yMm,
    widthMm: DEFAULT_FLOOR_CASE_WIDTH_MM,
    depthMm: DEFAULT_FLOOR_CASE_DEPTH_MM,
    rotationDeg: 0,
    heightMm: DEFAULT_FLOOR_CASE_HEIGHT_MM,
    wallYMm: DEFAULT_WALL_CASE_CENTER_Y_MM
  };
}

// A wall vitrine cantilevered off `wallId` at wall-local x = `xMm`, mounted at
// the fixed waist-height center (deliberately lower than the artwork
// centerline — real wall vitrines sit below hung work). `depthMm` is the
// box's protrusion from the wall face.
export function createWallCase(wallId: string, xMm: number): CaseWallObject {
  return {
    id: newId(),
    kind: "case",
    wallId,
    xMm,
    yMm: DEFAULT_WALL_CASE_CENTER_Y_MM,
    widthMm: DEFAULT_WALL_CASE_WIDTH_MM,
    heightMm: DEFAULT_WALL_CASE_HEIGHT_MM,
    depthMm: DEFAULT_WALL_CASE_DEPTH_MM
  };
}
