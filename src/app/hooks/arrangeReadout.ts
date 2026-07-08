import type { Project, WallObject } from "../../domain/project";
import type { WallWithGeometry } from "../../domain/geometry/walls";
import {
  getArrangeReadoutDetailed,
  getOpenSpaceBounds,
  getSpacingSegments,
  solveEqualArrangement,
  solveEqualArrangementInZone
} from "../../domain/placement/arrangeOnWall";
import type { ArrangeSession } from "../store";

export type ArrangeReadout = {
  mode: "equal" | "inset" | "gap";
  insetAnchor: ArrangeSession["insetAnchor"];
  evenZone: "wall" | "open";
  insetMm: number;
  gapMm: number;
  leftEdgeDistanceMm: number;
  rightEdgeDistanceMm: number;
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
  lastInsetAnchor: ArrangeSession["insetAnchor"];
  lastArrangeMode: ArrangeSession["mode"];
  lastEvenZone: ArrangeSession["evenZone"] | null;
};

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
  lastInsetAnchor,
  lastArrangeMode,
  lastEvenZone
}: UseArrangeReadoutParams): ArrangeReadout | null {
  if (!arrangeWall) return null;

  const detailed = getArrangeReadoutDetailed(arrangeMembers, arrangeWall.lengthMm);
  const equal = solveEqualArrangement(arrangeMembers, arrangeWall.lengthMm);
  // The open-space span the "Open space" zone spreads within. Live, use
  // the session's fixed bounds so previews don't move it; idle, derive it
  // from the committed members and the unselected same-wall objects (the
  // same "others" filter the session uses at begin).
  const openBounds = activeArrangeSession
    ? activeArrangeSession.openZoneBoundsMm
    : getOpenSpaceBounds(
        selectedArtworkMembers,
        wallObjects.filter(
          (wallObject) =>
            wallObject.wallId === arrangeWall.id &&
            !selectedObjectIds.includes(wallObject.id)
        ),
        arrangeWall.lengthMm
      );
  const equalOpen = solveEqualArrangementInZone(
    arrangeMembers,
    openBounds.startMm,
    openBounds.endMm
  );
  // The two single-sided distances the left/right anchors edit and read
  // back: getSpacingSegments returns n+1 segments with segment[0] the
  // left-edge distance and the last the right-edge distance — reuse it
  // rather than re-deriving edges here.
  const segments = getSpacingSegments(arrangeMembers, arrangeWall.lengthMm);
  const leftEdgeDistanceMm = segments[0].toMm - segments[0].fromMm;
  const lastSegment = segments[segments.length - 1];
  const rightEdgeDistanceMm = lastSegment.toMm - lastSegment.fromMm;
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
    insetIsMixed: detailed.insetIsMixed,
    gapIsMixed: detailed.gapIsMixed,
    // The "Equal distance" readout reflects the displayed zone.
    equalSpacingMm: evenZone === "open" ? equalOpen.insetMm : equal.insetMm,
    sessionActive: activeArrangeSession !== null
  };
}
