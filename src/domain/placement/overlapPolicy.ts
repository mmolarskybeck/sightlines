import type { WallObject } from "../project";

// Forbidden overlaps cannot be overridden; blockable overlaps can.
export type OverlapRule = "forbidden" | "blockable";

// Only door, window and blocked-zone are architecture — an actual gap or
// obstruction cut into the wall. Wall text and display cases are wall-mounted
// furniture, exactly like artwork (project.ts: wall text "never blocks
// placement... it is not an opening"; a case "never blocks placement" too):
// nothing about hanging a label or a vitrine makes it physically impossible
// to also cut a doorway through the same spot. A pair is a hard, unoverridable
// physical conflict only when BOTH sides are architecture.
export function isBlockingKind(kind: WallObject["kind"]): boolean {
  return kind === "door" || kind === "window" || kind === "blocked-zone";
}

export function getOverlapRule(a: WallObject["kind"], b: WallObject["kind"]): OverlapRule {
  return isBlockingKind(a) && isBlockingKind(b) ? "forbidden" : "blockable";
}

// FLOOR objects are deliberately absent from this module, and that is the whole
// floor overlap policy (floor-supports spec §4): floor placements carry no wall
// bounds and run no collision gate at all in v1 (see placeArtworkOnFloor's
// empty validate-ids list), so support↔artwork is ALLOWED everywhere — which it
// has to be, since a work standing on a pedestal overlaps it by definition —
// and support↔support and support↔case are judged exactly as artwork↔artwork
// is: not at all. Nothing here needs a "support" arm; adding one would imply a
// gate that does not exist.
