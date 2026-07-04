import type { OpeningWallObject } from "../project";

export type OpeningKind = OpeningWallObject["kind"];

// Curatorial defaults, not architectural code minimums — close enough for a
// first placement that a curator will immediately adjust numerically anyway
// (docs/plan.md §2: tactile and numeric paths always agree).
export const DOOR_WIDTH_MM = 915; // ~36in, a standard single door leaf + frame.
export const DOOR_HEIGHT_MM = 2030; // ~80in, standard door height.
export const WINDOW_WIDTH_MM = 1200;
export const WINDOW_HEIGHT_MM = 1200;
export const BLOCKED_ZONE_WIDTH_MM = 1000;
export const BLOCKED_ZONE_HEIGHT_MM = 1000;

// Title-case label for UI surfaces (inspector headings, placement-warning
// subjects) — never a raw `kind` string, per the same rule that resolves
// warnings to an artwork's title instead of its wallObjectId.
export function getOpeningKindLabel(kind: OpeningKind): string {
  switch (kind) {
    case "door":
      return "Door";
    case "window":
      return "Window";
    case "blocked-zone":
      return "Blocked zone";
  }
}

export function getDefaultOpeningSizeMm(kind: OpeningKind): {
  widthMm: number;
  heightMm: number;
} {
  switch (kind) {
    case "door":
      return { widthMm: DOOR_WIDTH_MM, heightMm: DOOR_HEIGHT_MM };
    case "window":
      return { widthMm: WINDOW_WIDTH_MM, heightMm: WINDOW_HEIGHT_MM };
    case "blocked-zone":
      return { widthMm: BLOCKED_ZONE_WIDTH_MM, heightMm: BLOCKED_ZONE_HEIGHT_MM };
  }
}

// Center-anchored y (docs/plan.md §2): a door's default reaches the floor
// (its bottom edge at y=0, so its center sits at half its own height), while
// a window or blocked zone centers on the wall's centerline like an artwork
// placement would.
export function getDefaultOpeningCenterYMm(
  kind: OpeningKind,
  heightMm: number,
  centerlineYMm: number
): number {
  return kind === "door" ? heightMm / 2 : centerlineYMm;
}

// No clamping to wall bounds here, mirroring createArtworkPlacement — an
// out-of-bounds default (e.g. a door added to a wall shorter than the
// default door width) is a state validatePlacement flags, not one this
// constructor silently fixes.
export function createOpeningPlacement(
  kind: OpeningKind,
  wallId: string,
  xMm: number,
  centerlineYMm: number
): OpeningWallObject {
  const { widthMm, heightMm } = getDefaultOpeningSizeMm(kind);

  return {
    id: crypto.randomUUID(),
    kind,
    blocksPlacement: true,
    wallId,
    xMm,
    yMm: getDefaultOpeningCenterYMm(kind, heightMm, centerlineYMm),
    widthMm,
    heightMm
  };
}
