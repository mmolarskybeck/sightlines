import type { Artwork, Project, WallObject } from "../../domain/project";
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

// What one side of the "From edges" mode measures against, resolved to
// something the panel can render directly — a plain "wall" tag, or an
// "object" tag carrying the neighbour's display name (an artwork's title, or
// an opening's kind label) and kind, so the panel/caption can say "nearest
// artwork" vs "nearest door" without reaching back into the project itself.
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

// Resolves a raw wall-vs-neighbour detection to display-ready info — pure
// project lookups, kept out of the domain layer (which knows nothing of
// artwork titles or opening-kind copy).
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
  return { type: "object", kind: object.kind, name: getOpeningKindLabel(object.kind) };
}

// The arrange panel's live readout — spacing mode, zone, and the equal-solve
// matching that decides whether the idle layout already reads as "Space
// evenly". null when the selection isn't arrangeable (see arrangeWall in
// App.tsx). A pure per-render derivation (not a hook — calls no React hooks),
// re-run on every call same as the inline IIFE this was extracted from —
// not memoized, so it always reflects the latest (possibly preview-overridden)
// member positions and session state.
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

  const detailed = getArrangeReadoutDetailed(arrangeMembers, arrangeWall.lengthMm);
  const equal = solveEqualArrangement(arrangeMembers, arrangeWall.lengthMm);
  // The unselected same-wall objects — every "beside the group" computation
  // below (the open-space zone, and each side's From-edges boundary) is
  // detectBoundary asking this same question, so it's filtered once here.
  const others = wallObjects.filter(
    (wallObject) =>
      wallObject.wallId === arrangeWall.id && !selectedObjectIds.includes(wallObject.id)
  );
  // The open-space span the "Open space" zone spreads within. Live, use
  // the session's fixed bounds so previews don't move it; idle, derive it
  // from the committed members and `others`.
  const openBounds = activeArrangeSession
    ? activeArrangeSession.openZoneBoundsMm
    : getOpenSpaceBounds(selectedArtworkMembers, others, arrangeWall.lengthMm);
  const equalOpen = solveEqualArrangementInZone(
    arrangeMembers,
    openBounds.startMm,
    openBounds.endMm
  );
  // What "From edges" measures against on each side — the session's frozen
  // detection while live (so the target doesn't hop as the group moves),
  // else the same detector run fresh against the committed layout.
  const leftBoundaryDetection = activeArrangeSession
    ? activeArrangeSession.insetBoundary.left
    : detectBoundary("left", selectedArtworkMembers, others, arrangeWall.lengthMm);
  const rightBoundaryDetection = activeArrangeSession
    ? activeArrangeSession.insetBoundary.right
    : detectBoundary("right", selectedArtworkMembers, others, arrangeWall.lengthMm);
  const leftBoundary = resolveBoundary(leftBoundaryDetection, wallObjects, artworksById);
  const rightBoundary = resolveBoundary(rightBoundaryDetection, wallObjects, artworksById);
  // The two single-sided distances the left/right (and "both") anchors edit
  // and read back — measured from each side's DETECTED boundary rather than
  // always the wall edge, so the field shows what it's actually driving.
  const memberLeftEdgeMm = Math.min(
    ...arrangeMembers.map((member) => member.xMm - member.widthMm / 2)
  );
  const memberRightEdgeMm = Math.max(
    ...arrangeMembers.map((member) => member.xMm + member.widthMm / 2)
  );
  const leftEdgeDistanceMm = memberLeftEdgeMm - leftBoundaryDetection.edgeMm;
  const rightEdgeDistanceMm = rightBoundaryDetection.edgeMm - memberRightEdgeMm;
  // The anchor follows the session when one is open, else the remembered
  // default — the mirror of how `mode` resolves just below.
  const insetAnchor = activeArrangeSession
    ? activeArrangeSession.insetAnchor
    : lastInsetAnchor;
  // Does the idle layout already read as evenly spaced? Whole-wall equal
  // wants uniform gaps AND symmetric insets. Open-zone equal wants uniform
  // gaps and the leftmost left edge at (zone start + zone inset) — its
  // insets are asymmetric by design, so insetIsMixed is NOT required here.
  const matchesWholeWallEqual =
    !detailed.gapIsMixed &&
    !detailed.insetIsMixed &&
    Math.abs(detailed.insetMm - equal.insetMm) < 0.5 &&
    Math.abs(detailed.gapMm - equal.gapMm) < 0.5;
  const matchesOpenZoneEqual =
    !detailed.gapIsMixed &&
    Math.abs(detailed.insetMm - (openBounds.startMm + equalOpen.insetMm)) < 0.5 &&
    Math.abs(detailed.gapMm - equalOpen.gapMm) < 0.5;
  // Which zone (if either) the idle layout matches — whole wall wins ties
  // (the unbounded case, where the two solves are identical).
  const idleEqualZone: "wall" | "open" | null = matchesWholeWallEqual
    ? "wall"
    : matchesOpenZoneEqual
      ? "open"
      : null;
  // The smart default used when nothing has been chosen and no layout
  // matches: open when the group is boxed in by neighbours, else whole
  // wall — the same rule beginArrangeSession applies.
  const smartDefaultZone: "wall" | "open" =
    openBounds.startMm > 0 || openBounds.endMm < arrangeWall.lengthMm
      ? "open"
      : "wall";
  // The panel always shows an active mode — never a blank "choose one"
  // state. With a session open the segment follows the session's mode;
  // idle, a freeform layout reads as "Space evenly" when it matches either
  // the whole-wall or the open-zone equal solve; otherwise it falls back
  // to the last mode the curator used (default "From wall edges"). Showing
  // a mode idle never moves anything — inset/gap seed their field from the
  // current layout readout, and only an edit begins a session.
  const mode: "equal" | "inset" | "gap" = activeArrangeSession
    ? activeArrangeSession.mode
    : idleEqualZone !== null
      ? "equal"
      : lastArrangeMode;
  // Displayed zone: the session's when active, else the idle-matched zone,
  // else the remembered choice or the smart default.
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
    // The "Equal distance" readout reflects the displayed zone.
    equalSpacingMm: evenZone === "open" ? equalOpen.insetMm : equal.insetMm,
    sessionActive: activeArrangeSession !== null
  };
}
