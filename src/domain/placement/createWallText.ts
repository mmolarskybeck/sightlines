import {
  DEFAULT_FLOOR_CASE_HEIGHT_MM,
  DEFAULT_FLOOR_CASE_WIDTH_MM,
  type WallTextWallObject
} from "../project";
import { newId } from "../id";
import {
  getDefaultOpeningSizeMm,
  type InsertToolKind,
  type OpeningKind
} from "./createOpening";

// Curatorial default, immediately adjustable in the inspector — a landscape
// didactic panel a bit wider than tall (docs/plan.md §2: tactile and numeric
// paths agree). Wall text centers on the wall's centerline like an artwork.
export const WALL_TEXT_WIDTH_MM = 600;
export const WALL_TEXT_HEIGHT_MM = 400;

export const WALL_TEXT_DEFAULT_NAME = "Wall text";

export function getDefaultWallTextSizeMm(): { widthMm: number; heightMm: number } {
  return { widthMm: WALL_TEXT_WIDTH_MM, heightMm: WALL_TEXT_HEIGHT_MM };
}

// One size lookup for every armed Insert tool, so the plan/elevation ghost
// previews don't have to special-case wall text at each call site.
export function getDefaultInsertToolSizeMm(kind: InsertToolKind): {
  widthMm: number;
  heightMm: number;
} {
  if (kind === "wall-text") return getDefaultWallTextSizeMm();
  // The armed case ghost defaults to the freestanding footprint (widthMm along,
  // heightMm carried for completeness); the plan preview shrinks to the wall
  // footprint only when the pointer captures a wall (see PlanView).
  if (kind === "case") {
    return { widthMm: DEFAULT_FLOOR_CASE_WIDTH_MM, heightMm: DEFAULT_FLOOR_CASE_HEIGHT_MM };
  }
  return getDefaultOpeningSizeMm(kind as OpeningKind);
}

// Wall text does not pair, mirror, or block placement, so its constructor is a
// plain record — no free-slot search or twin-wall logic (that's opening-only).
// yMm defaults to the wall's centerline unless the caller pins it (elevation
// click supplies the pointer's y).
export function createWallTextPlacement(
  wallId: string,
  xMm: number,
  centerYMm: number
): WallTextWallObject {
  const { widthMm, heightMm } = getDefaultWallTextSizeMm();
  return {
    id: newId(),
    kind: "wall-text",
    name: WALL_TEXT_DEFAULT_NAME,
    wallId,
    xMm,
    yMm: centerYMm,
    widthMm,
    heightMm
  };
}
