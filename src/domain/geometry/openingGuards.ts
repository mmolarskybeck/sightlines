import type { ConnectableOpeningWallObject, WallObject } from "../project";

// Type guard for the wall objects that can participate in a shared opening
// (doors and windows). Lives in a leaf module so both the geometry status
// code and the placement analysis code can import it without a cycle.
export function isConnectableOpening(
  wallObject: WallObject | undefined
): wallObject is ConnectableOpeningWallObject {
  return wallObject?.kind === "door" || wallObject?.kind === "window";
}
