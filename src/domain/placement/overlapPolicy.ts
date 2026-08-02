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
