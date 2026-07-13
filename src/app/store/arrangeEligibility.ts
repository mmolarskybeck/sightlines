import type { ArtworkWallObject, Project } from "../../domain/project";

// Arrangement requires 2+ wall-mounted artworks on one wall and no floor member.
export type ArrangeEligibility =
  | { eligible: true; members: ArtworkWallObject[]; wallId: string }
  | {
      eligible: false;
      reason: "floorMember" | "noArtworks" | "singleArtwork" | "multipleWalls";
    };

export function getArrangeEligibility(
  project: Project,
  selectedObjectIds: string[]
): ArrangeEligibility {
  const hasFloorMember = project.floorObjects.some((floorObject) =>
    selectedObjectIds.includes(floorObject.id)
  );
  if (hasFloorMember) return { eligible: false, reason: "floorMember" };

  const members = project.wallObjects.filter(
    (wallObject): wallObject is ArtworkWallObject =>
      wallObject.kind === "artwork" && selectedObjectIds.includes(wallObject.id)
  );
  if (members.length === 0) return { eligible: false, reason: "noArtworks" };
  if (members.length === 1) return { eligible: false, reason: "singleArtwork" };

  const wallIds = new Set(members.map((member) => member.wallId));
  if (wallIds.size > 1) return { eligible: false, reason: "multipleWalls" };

  return { eligible: true, members, wallId: members[0].wallId };
}
