import type { ArtworkWallObject, Project } from "../../domain/project";

// The single source of truth for "can this selection be arranged": no
// floor-placed member, at least two ARTWORK wall-objects (openings are
// architecture, never members — see beginArrangeSession), all on the same
// wall. Previously computed independently in App.tsx (feeding the disabled-
// reason ladder) and arrangeSlice's beginArrangeSession guard (a silent
// no-op) — this is the one place the facts get derived; each reason maps to
// exactly one of App's disabled-copy strings, kept there since they're
// user-facing UI copy, not domain facts.
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
