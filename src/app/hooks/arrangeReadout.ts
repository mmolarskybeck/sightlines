import type { Artwork, Project, WallObject } from "../../domain/project";
import { withArtworkFootprintFromMap } from "../../domain/framing";
import type { WallWithGeometry } from "../../domain/geometry/walls";
import { getOpeningKindLabel } from "../../domain/placement/createOpening";
import {
  detectBoundary,
  getArrangeReadoutDetailed,
  getOpenSpaceBounds,
  solveEqualArrangement,
  solveEqualArrangementInZone,
  type BoundaryDetection
} from "../../domain/placement/arrangeOnWall";
import type { ArrangeSession } from "../store";

// Display-ready target for one side of "From edges."
export type ArrangeBoundary =
  | { type: "wall" }
  | { type: "object"; name: string; kind: WallObject["kind"] };

export type ArrangeReadout = {
  mode: "equal" | "inset" | "gap";
  insetAnchor: ArrangeSession["insetAnchor"];
  evenZone: "wall" | "open";
  insetMm: number;
  gapMm: number;
  leftEdgeDistanceMm: number;
  rightEdgeDistanceMm: number;
  leftBoundary: ArrangeBoundary;
  rightBoundary: ArrangeBoundary;
  insetIsMixed: boolean;
  gapIsMixed: boolean;
  equalSpacingMm: number;
  sessionActive: boolean;
};

export type UseArrangeReadoutParams = {
  arrangeWall: WallWithGeometry | null;
  arrangeMembers: WallObject[];
  activeArrangeSession: ArrangeSession | null;
  selectedArtworkMembers: WallObject[];
  wallObjects: Project["wallObjects"];
  selectedObjectIds: string[];
  artworksById: Map<string, Artwork>;
  lastInsetAnchor: ArrangeSession["insetAnchor"];
  lastArrangeMode: ArrangeSession["mode"];
  lastEvenZone: ArrangeSession["evenZone"] | null;
};

// Keep display-name lookups out of the geometry domain.
function resolveBoundary(
  detection: BoundaryDetection,
  wallObjects: Project["wallObjects"],
  artworksById: Map<string, Artwork>
): ArrangeBoundary {
  if (detection.type === "wall") return { type: "wall" };
  const object = wallObjects.find((wallObject) => wallObject.id === detection.objectId);
  if (!object) return { type: "wall" };
  if (object.kind === "artwork") {
    return {
      type: "object",
      kind: "artwork",
      name: artworksById.get(object.artworkId)?.title || "Untitled artwork"
    };
  }
  const name =
    object.kind === "wall-text"
      ? "Wall text"
      : object.kind === "case"
        ? "Display case"
        : getOpeningKindLabel(object.kind);
  return { type: "object", kind: object.kind, name };
}

// Derives the current arrange readout, including live preview positions.
export function deriveArrangeReadout({
  arrangeWall,
  arrangeMembers,
  activeArrangeSession,
  selectedArtworkMembers,
  wallObjects,
  selectedObjectIds,
  artworksById,
  lastInsetAnchor,
  lastArrangeMode,
  lastEvenZone
}: UseArrangeReadoutParams): ArrangeReadout | null {
  if (!arrangeWall) return null;

  const withResolvedArtworkFootprint = (wallObject: WallObject): WallObject =>
    withArtworkFootprintFromMap(wallObject, artworksById);
  const footprintArrangeMembers = arrangeMembers.map(withResolvedArtworkFootprint);
  const footprintSelectedArtworkMembers = selectedArtworkMembers.map(
    withResolvedArtworkFootprint
  );
  const detailed = getArrangeReadoutDetailed(
    footprintArrangeMembers,
    arrangeWall.lengthMm
  );
  const equal = solveEqualArrangement(footprintArrangeMembers, arrangeWall.lengthMm);
  // All boundary calculations share the same unselected wall objects.
  const others = wallObjects
    .filter(
      (wallObject) =>
        wallObject.wallId === arrangeWall.id && !selectedObjectIds.includes(wallObject.id)
    )
    .map(withResolvedArtworkFootprint);
  // Freeze open-space bounds during a live preview.
  const openBounds = activeArrangeSession
    ? activeArrangeSession.openZoneBoundsMm
    : getOpenSpaceBounds(footprintSelectedArtworkMembers, others, arrangeWall.lengthMm);
  const equalOpen = solveEqualArrangementInZone(
    footprintArrangeMembers,
    openBounds.startMm,
    openBounds.endMm
  );
  // Freeze edge targets during a live preview so they cannot jump.
  const leftBoundaryDetection = activeArrangeSession
    ? activeArrangeSession.insetBoundary.left
    : detectBoundary(
        "left",
        footprintSelectedArtworkMembers,
        others,
        arrangeWall.lengthMm
      );
  const rightBoundaryDetection = activeArrangeSession
    ? activeArrangeSession.insetBoundary.right
    : detectBoundary(
        "right",
        footprintSelectedArtworkMembers,
        others,
        arrangeWall.lengthMm
      );
  const leftBoundary = resolveBoundary(leftBoundaryDetection, wallObjects, artworksById);
  const rightBoundary = resolveBoundary(rightBoundaryDetection, wallObjects, artworksById);
  // Measure from detected boundaries, which may be neighbouring objects.
  const memberLeftEdgeMm = Math.min(
    ...footprintArrangeMembers.map((member) => member.xMm - member.widthMm / 2)
  );
  const memberRightEdgeMm = Math.max(
    ...footprintArrangeMembers.map((member) => member.xMm + member.widthMm / 2)
  );
  const leftEdgeDistanceMm = memberLeftEdgeMm - leftBoundaryDetection.edgeMm;
  const rightEdgeDistanceMm = rightBoundaryDetection.edgeMm - memberRightEdgeMm;
  // A live session overrides the remembered anchor.
  const insetAnchor = activeArrangeSession
    ? activeArrangeSession.insetAnchor
    : lastInsetAnchor;
  // Whole-wall equality requires symmetric insets; open-zone equality does not.
  const matchesWholeWallEqual =
    !detailed.gapIsMixed &&
    !detailed.insetIsMixed &&
    Math.abs(detailed.insetMm - equal.insetMm) < 0.5 &&
    Math.abs(detailed.gapMm - equal.gapMm) < 0.5;
  const matchesOpenZoneEqual =
    !detailed.gapIsMixed &&
    Math.abs(detailed.insetMm - (openBounds.startMm + equalOpen.insetMm)) < 0.5 &&
    Math.abs(detailed.gapMm - equalOpen.gapMm) < 0.5;
  // Whole wall wins when both equal solves match.
  const idleEqualZone: "wall" | "open" | null = matchesWholeWallEqual
    ? "wall"
    : matchesOpenZoneEqual
      ? "open"
      : null;
  // Default to open space only when neighbours bound the group.
  const smartDefaultZone: "wall" | "open" =
    openBounds.startMm > 0 || openBounds.endMm < arrangeWall.lengthMm
      ? "open"
      : "wall";
  // Idle mode reflects an equal layout or the last choice; displaying it alone
  // never starts a session or moves artwork.
  const mode: "equal" | "inset" | "gap" = activeArrangeSession
    ? activeArrangeSession.mode
    : idleEqualZone !== null
      ? "equal"
      : lastArrangeMode;
  // Prefer live, matched, remembered, then derived zone state.
  const evenZone: "wall" | "open" = activeArrangeSession
    ? activeArrangeSession.evenZone
    : idleEqualZone ?? lastEvenZone ?? smartDefaultZone;
  return {
    mode,
    insetAnchor,
    evenZone,
    insetMm: detailed.insetMm,
    gapMm: detailed.gapMm,
    leftEdgeDistanceMm,
    rightEdgeDistanceMm,
    leftBoundary,
    rightBoundary,
    insetIsMixed: detailed.insetIsMixed,
    gapIsMixed: detailed.gapIsMixed,
    // Equal distance follows the displayed zone.
    equalSpacingMm: evenZone === "open" ? equalOpen.insetMm : equal.insetMm,
    sessionActive: activeArrangeSession !== null
  };
}
