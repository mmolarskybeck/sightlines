// Shared placement-related message constants, split out of placementSlice.ts
// so openingPlacementSlice.ts can import the values without creating a
// circular VALUE dependency between the two slice files (placementSlice.ts
// imports createOpeningPlacementSlice from openingPlacementSlice.ts).

// Artwork overlaps require the caller's explicit allowOverlap preference.
export const OVERLAP_BLOCKED_MESSAGE =
  'Can’t place it there. It would overlap another object on this wall. Turn on "Allow overlap" in view options to allow it.';

// Non-artwork overlaps cannot be overridden.
export const FORBIDDEN_OVERLAP_MESSAGE =
  "Can’t place it there. Doors, windows and blocked zones can’t overlap each other.";

// A door or window on a wall two rooms share is ONE opening, stored as one half
// per room. An edit that cannot keep both halves together is refused outright
// rather than quietly leaving two facing alcoves behind, so these say which
// half could not follow and why.
// Worded to fit a move, a resize and a group drag alike — every one of them
// fails for the same reason, and none of them committed anything.
export const SHARED_OPENING_SLOT_BLOCKED_MESSAGE =
  "This opening is shared with the room next door, and something on the other side is in the way.";

export const SHARED_OPENING_OFF_BOUNDARY_MESSAGE =
  "This opening is shared with the room next door, so it can’t leave the wall the two rooms share.";

export function sharedOpeningRefusalMessage(
  reason: "slot-occupied" | "off-boundary" | "not-aligned"
): string {
  return reason === "slot-occupied"
    ? SHARED_OPENING_SLOT_BLOCKED_MESSAGE
    : SHARED_OPENING_OFF_BOUNDARY_MESSAGE;
}
