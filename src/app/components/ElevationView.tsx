import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import type { Vector2 } from "../../domain/geometry/dragResize";
import {
  getNeighborAwareSegments,
  getSpacingSegments
} from "../../domain/placement/arrangeOnWall";
import { getGroupBounds, getIdsIntersectingRect } from "../../domain/placement/groupBounds";
import {
  getEffectivePlacementSizeMm,
  PLACEHOLDER_ARTWORK_HEIGHT_MM,
  PLACEHOLDER_ARTWORK_WIDTH_MM
} from "../../domain/placement/placeArtwork";
import type {
  Artwork,
  ArtworkWallObject,
  DisplayUnit,
  OpeningWallObject,
  WallObject,
  WallObjectBase
} from "../../domain/project";
import { resolveArtworkSnap } from "../../domain/snapping/artworkSnapTargets";
import {
  quantizeXToCleanIncrement,
  quantizeYToCleanIncrement
} from "../../domain/snapping/cleanIncrement";
import type { Guide, SnapTargetIds } from "../../domain/snapping/resolveSnap";
import { formatLength } from "../../domain/units/length";
import {
  getMajorGridIntervalMm,
  getMinorGridIntervalMm,
  getPixelsPerMm
} from "../../domain/units/precision";
import { useAssetImageUrls } from "../hooks/useAssetImageUrls";
import { useContainerSize } from "../hooks/useContainerSize";
import { ARTWORK_DRAG_MIME } from "./ChecklistPanel";
import { ElevationArtwork } from "./ElevationArtwork";
import { ElevationOpening } from "./ElevationOpening";
import { ArtworkTooltipContent, OpeningTooltipContent } from "./PlacementTooltip";
import { isArtworkOutOfWallBounds, wallLocalYToSvgY } from "./elevationArtworkGeometry";
import { GridOverlay } from "./GridOverlay";
import { GroupDimensionLines } from "./GroupDimensionLines";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from "./ui/select";

// Re-exported for backward compatibility — this used to be defined here,
// and nothing outside this file depends on the distinction between "defined
// here" and "defined in elevationArtworkGeometry.ts and re-exported."
export { wallLocalYToSvgY };

const SNAP_THRESHOLD_PX = 10;

// Stable module-level reference so a caller that doesn't pass `getBlob`
// (the pre-wiring default) doesn't retrigger useAssetImageUrls's fetch
// effect on every render — the hook depends on its getBlob argument's
// identity. Rejecting immediately is fine: the hook treats a failed fetch as
// "leave this id unresolved," never as a thrown error.
const NO_OP_GET_BLOB: (key: string) => Promise<Blob> = () =>
  Promise.reject(new Error("ElevationView: no getBlob provided"));

// A pointer-drag move of an existing placement, transient until release
// (docs/plan.md §7: live preview, exactly one store commit on release).
// Mirrors PlanView's DragState shape/naming for the resize-handle drag.
// Generalized over wall object kind (artwork or opening) — `kind` decides
// which store action commits on release, everything else about the drag
// (preview, snapping, sub-threshold no-op) is identical either way.
type MoveDragState = {
  wallObjectId: string;
  kind: WallObject["kind"];
  sizeMm: { widthMm: number; heightMm: number };
  startPointerMm: Vector2;
  startCenterMm: Vector2;
  previewCenterMm: Vector2;
  // Per-axis hysteresis ids: x and y snap independently (centerline in y
  // while the grid holds x), so each axis remembers its own active target.
  previousSnapTargetIds?: SnapTargetIds;
  activeGuides: Guide[];
  // Group drag: when the pressed object belongs to a multi-selection, the whole
  // group translates rigidly. `members` records each member's kind/size and its
  // offset from the group's union-box center; for a group drag startCenterMm /
  // previewCenterMm track that union-box center (and sizeMm is the union box's
  // size, fed to resolveArtworkSnap as one virtual object). Absent for a
  // single-object drag — that path is left exactly as it was.
  members?: {
    id: string;
    kind: WallObject["kind"];
    sizeMm: { widthMm: number; heightMm: number };
    offsetFromGroupCenterMm: Vector2;
  }[];
  startGroupCenterMm?: Vector2;
  // Alt-drag of one member of a multi-selection: the drag moves only the
  // pressed object, but the release must still suppress the trailing click
  // (the same suppressNextSelect mechanism group drags use) so the browser's
  // post-drag click can't collapse the multi-selection to that one member.
  preserveSelection?: boolean;
};

// A pending marquee (rubber-band) selection on the elevation background —
// tracked as two wall-local-mm pointer samples (start + current). toWallLocalMm
// returns y-UP coordinates, matching placements' yMm centers, so the min/max
// rect built from these two samples is already in the space getIdsIntersecting-
// Rect expects. Same ref-based effect discipline as MoveDragState so the
// gesture never resubscribes mid-drag.
type MarqueeState = {
  startMm: Vector2;
  currentMm: Vector2;
};

// Min/max wall-local rect from a marquee's two pointer samples — the shape
// getIdsIntersectingRect consumes. Both samples are already y-up, so no flip.
function marqueeRectMm(marquee: MarqueeState): {
  minXMm: number;
  maxXMm: number;
  minYMm: number;
  maxYMm: number;
} {
  return {
    minXMm: Math.min(marquee.startMm.xMm, marquee.currentMm.xMm),
    maxXMm: Math.max(marquee.startMm.xMm, marquee.currentMm.xMm),
    minYMm: Math.min(marquee.startMm.yMm, marquee.currentMm.yMm),
    maxYMm: Math.max(marquee.startMm.yMm, marquee.currentMm.yMm)
  };
}

// The HTML5-drop preview for a not-yet-placed artwork being dragged in from
// the checklist. Separate from MoveDragState because it has no existing
// wallObjectId/startCenterMm — it's a brand-new placement, not a move — but
// it flows through the exact same resolveArtworkSnap call so a drop can
// never land somewhere the ghost didn't just show.
type DropGhostState = {
  centerMm: Vector2;
  sizeMm: { widthMm: number; heightMm: number };
  previousSnapTargetIds?: SnapTargetIds;
  activeGuides: Guide[];
};

export function ElevationView({
  artworksById,
  draggingArtworkId = null,
  centerlineMm,
  getBlob,
  gridPrecisionFloorMm,
  gridVisible,
  onMoveOpening,
  onMovePlacement,
  onMoveWallObjects,
  onPlaceArtwork,
  onSelectArtwork,
  onSelectOpening,
  onSelectObject,
  onClearSelection,
  onMarqueeSelect,
  selectedArtworkId = null,
  selectedOpeningId = null,
  previewPositionsById,
  arrangeSessionActive = false,
  selectedObjectIds = [],
  snapToGrid = false,
  unit,
  wallHeightMm,
  wallId,
  wallLengthMm,
  wallName,
  wallObjects,
  walls = [],
  onSelectWall
}: {
  gridPrecisionFloorMm: number | null;
  gridVisible: boolean;
  wallName: string;
  wallLengthMm: number;
  wallHeightMm: number;
  centerlineMm: number;
  unit: DisplayUnit;
  // Everything below is new and optional (safe, inert defaults) — App.tsx
  // doesn't pass these yet, that's the next task's wiring. Until then this
  // component renders and behaves exactly as it did before this change.
  wallId?: string;
  wallObjects?: WallObject[];
  // Live arrange-session preview positions (id → center), layered over the
  // committed wallObjects before anything downstream reads them — rendering,
  // snap neighbors, drag start centers, group bounds, marquee hit-testing all
  // see the preview as if it were committed. The in-flight drag preview
  // (previewCenterById) then stacks on top of this layer.
  previewPositionsById?: Record<string, { xMm: number; yMm: number }>;
  // True while an arrange session is live. It switches the dimension lines from
  // neighbour-aware outer segments (idle) to wall-edge outer segments — the
  // arrange modes solve against the wall edges, so during a session the lines
  // must show the values being edited rather than the space beside the works.
  arrangeSessionActive?: boolean;
  artworksById?: Map<string, Artwork>;
  selectedArtworkId?: string | null;
  selectedOpeningId?: string | null;
  getBlob?: (key: string) => Promise<Blob>;
  snapToGrid?: boolean;
  draggingArtworkId?: string | null;
  onPlaceArtwork?: (artworkId: string, wallId: string, xMm: number, yMm: number) => void;
  onMovePlacement?: (wallObjectId: string, xMm: number, yMm: number) => void;
  onMoveOpening?: (wallObjectId: string, xMm: number, yMm: number) => void;
  // Commits a group drag in ONE call — every member's final center, artworks
  // and openings alike (the single-object drag keeps its onMovePlacement/
  // onMoveOpening split; this is the multi-select path only).
  onMoveWallObjects?: (moves: { id: string; xMm: number; yMm: number }[]) => void;
  onSelectArtwork?: (artworkId: string) => void;
  onSelectOpening?: (wallObjectId: string) => void;
  // Multi-select entry points. Selection ids are PLACEMENT ids (wall object
  // ids), never artwork-library ids. All optional/inert until App wires them —
  // click-to-select and the marquee both fall back to today's behavior when
  // these are absent.
  selectedObjectIds?: string[];
  onSelectObject?: (id: string, opts: { additive: boolean }) => void;
  onClearSelection?: () => void;
  onMarqueeSelect?: (ids: string[], additive: boolean) => void;
  // The full wall inventory (in room order) plus a selector, so the elevation
  // chip can double as a wall switcher — the navigation the right panel used
  // to carry. Optional/inert until App wires them.
  walls?: { id: string; name: string; roomName: string }[];
  onSelectWall?: (wallId: string) => void;
}) {
  const [containerRef, containerSize] = useContainerSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [moveDrag, setMoveDrag] = useState<MoveDragState | null>(null);
  const moveDragRef = useRef<MoveDragState | null>(null);
  const [dropGhost, setDropGhost] = useState<DropGhostState | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);

  // Pad the viewBox so the wall reads as a figure on the canvas field
  // rather than bleeding edge-to-edge, and so boundary strokes (centered on
  // the wall edge) aren't half-clipped. All wall-local coordinates are
  // unchanged — only the visible window widens.
  const viewPadMm = Math.max(wallLengthMm, wallHeightMm) * 0.06;
  const viewBox = `${-viewPadMm} ${-viewPadMm} ${wallLengthMm + viewPadMm * 2} ${
    wallHeightMm + viewPadMm * 2
  }`;
  const pixelsPerMm = getPixelsPerMm(containerSize, {
    width: wallLengthMm + viewPadMm * 2,
    height: wallHeightMm + viewPadMm * 2
  });
  const minorGridMm = getMinorGridIntervalMm(unit, pixelsPerMm, {
    // Elevation reads finer than plan: hang heights are an inches/centimeters
    // activity, so a tighter target keeps the lattice on the (6in, 2ft) /
    // (10cm, 1m) rung at typical single-wall zoom.
    targetMinorPx: 7,
    minIntervalMm: gridPrecisionFloorMm
  });
  const majorGridMm = getMajorGridIntervalMm(unit, minorGridMm);
  const centerlineSvgY = wallLocalYToSvgY(wallHeightMm, centerlineMm);
  const snapThresholdMm = pixelsPerMm > 0 ? SNAP_THRESHOLD_PX / pixelsPerMm : 0;

  // Arrange-session previews applied once, up front: every downstream
  // consumer (rendering, snap-neighbor pool, beginMoveDrag start centers,
  // group bounds, marquee hit-testing, dimension lines) derives from this
  // array and therefore sees the preview positions for free.
  const effectiveWallObjects: WallObject[] = (wallObjects ?? []).map((object) => {
    const preview = previewPositionsById?.[object.id];
    return preview ? { ...object, xMm: preview.xMm, yMm: preview.yMm } : object;
  });

  const placements: ArtworkWallObject[] = effectiveWallObjects.filter(
    (object): object is ArtworkWallObject => object.kind === "artwork" && object.wallId === wallId
  );
  const openings: OpeningWallObject[] = effectiveWallObjects.filter(
    (object): object is OpeningWallObject => object.kind !== "artwork" && object.wallId === wallId
  );
  // Every wall object on this wall is a valid snap neighbor for any other —
  // an artwork can align to a door's edge just as readily as to another
  // artwork's (docs/plan.md §2 snap-target priority doesn't distinguish by
  // kind, only centerline > neighbor-center > neighbor-edge > grid).
  const wallObjectsOnThisWall: WallObject[] = [...placements, ...openings];

  const assetIds = placements.map((placement) => artworksById?.get(placement.artworkId)?.assetId);
  const imageUrlsByAssetId = useAssetImageUrls(assetIds, getBlob ?? NO_OP_GET_BLOB, "display");

  // The size to show for a not-yet-placed drop ghost: the real artwork's
  // effective size if the checklist told us which one is being dragged
  // (draggingArtworkId), otherwise the same placeholder size placement
  // itself falls back to (docs/plan.md §1.5: place before dimensions are
  // known).
  function effectiveSizeForArtworkId(artworkId: string | null): { widthMm: number; heightMm: number } {
    const artwork = artworkId ? artworksById?.get(artworkId) : undefined;
    if (artwork) return getEffectivePlacementSizeMm(artwork.dimensions);
    return { widthMm: PLACEHOLDER_ARTWORK_WIDTH_MM, heightMm: PLACEHOLDER_ARTWORK_HEIGHT_MM };
  }

  function toWallLocalMm(clientX: number, clientY: number): Vector2 | null {
    const svg = svgRef.current;
    if (!svg) return null;

    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;

    const transformed = point.matrixTransform(ctm.inverse());
    // The SVG viewBox is already in wall-local mm with x running the same
    // direction as wall-local x (from the wall start), so only y needs the
    // shared y-up/y-down flip — the same function used to place every other
    // elevation element, applied here in the inverse direction (it's
    // self-inverse, since it's just wallHeightMm minus the value).
    return { xMm: transformed.x, yMm: wallLocalYToSvgY(wallHeightMm, transformed.y) };
  }

  // The elevation placement pipeline shared by the move-drag preview and the
  // checklist drop-ghost: alignment snaps (floor/centerline/neighbor) keep
  // priority, then any axis a snap target did NOT capture is quantized to a
  // clean measurement instead of left free. Grid targets are deliberately
  // excluded here (snapToGrid: false to resolveArtworkSnap) — center-on-grid
  // snapping re-creates the 1/16" edge problem, so the quantizer is the new
  // lowest tier. The whole quantization pass is gated on the real snapToGrid
  // preference (OFF = today's alignment-only, free-otherwise behavior), and a
  // held ⌘/Ctrl (precisionBypass) skips ALL snapping for fully free movement.
  function resolveElevationPlacement(
    proposed: Vector2,
    sizeMm: { widthMm: number; heightMm: number },
    neighbors: WallObject[],
    movingKind: WallObject["kind"],
    previousSnapTargetIds: SnapTargetIds | undefined,
    precisionBypass: boolean
  ): { point: Vector2; activeGuides: Guide[]; snapTargetIds: SnapTargetIds } {
    if (precisionBypass) {
      return { point: proposed, activeGuides: [], snapTargetIds: {} };
    }

    const snapResult = resolveArtworkSnap(proposed, {
      centerlineYMm: centerlineMm,
      wallLengthMm,
      wallHeightMm,
      gridIntervalMm: minorGridMm,
      neighbors,
      movingSize: sizeMm,
      movingKind,
      // Grid tier removed for elevation placement — the quantizer replaces it.
      snapToGrid: false,
      thresholdMm: snapThresholdMm,
      previousSnapTargetIds
    });

    // snapToGrid OFF reproduces today's behavior exactly: alignment snaps only,
    // no quantization.
    if (!snapToGrid) return snapResult;

    const incrementMm = gridPrecisionFloorMm ?? minorGridMm;
    const point: Vector2 = { ...snapResult.point };
    // Quantize y first so the (band-filtered) x pass reads the object's settled
    // vertical position; an axis a snap captured is left exactly as snapped.
    if (snapResult.snapTargetIds.y === undefined) {
      point.yMm = quantizeYToCleanIncrement(
        { xMm: proposed.xMm, yMm: proposed.yMm },
        sizeMm,
        incrementMm
      );
    }
    if (snapResult.snapTargetIds.x === undefined) {
      point.xMm = quantizeXToCleanIncrement(
        { xMm: proposed.xMm, yMm: point.yMm },
        sizeMm,
        incrementMm,
        wallLengthMm,
        neighbors
      );
    }

    return {
      point,
      activeGuides: snapResult.activeGuides,
      snapTargetIds: snapResult.snapTargetIds
    };
  }

  useEffect(() => {
    if (!moveDrag) return;

    function onPointerMove(event: PointerEvent) {
      const current = moveDragRef.current;
      if (!current) return;

      const pointerMm = toWallLocalMm(event.clientX, event.clientY);
      if (!pointerMm) return;

      const proposedCenterMm: Vector2 = {
        xMm: current.startCenterMm.xMm + (pointerMm.xMm - current.startPointerMm.xMm),
        yMm: current.startCenterMm.yMm + (pointerMm.yMm - current.startPointerMm.yMm)
      };

      // For a group drag exclude every member from the neighbor pool (the group
      // must never snap to its own members); for a single drag just the one.
      const memberIds = current.members
        ? new Set(current.members.map((member) => member.id))
        : null;
      const neighbors = wallObjectsOnThisWall.filter((wallObject) =>
        memberIds ? !memberIds.has(wallObject.id) : wallObject.id !== current.wallObjectId
      );

      // ⌘/Ctrl held mid-drag → momentary precision bypass (fully free move,
      // Figma convention). Read live off each pointer event so it can toggle
      // during the drag. Alt is untouched (alt-drag = solo-move a group member).
      const precisionBypass = event.metaKey || event.ctrlKey;

      const snapResult = resolveElevationPlacement(
        proposedCenterMm,
        // For a group, sizeMm is the union box and the whole thing resolves as
        // one virtual artwork (no per-kind floor tier — a mixed group has no
        // single kind); a single object keeps its own size and kind-gated floor.
        current.sizeMm,
        neighbors,
        current.members ? "artwork" : current.kind,
        current.previousSnapTargetIds,
        precisionBypass
      );

      setMoveDrag((state) =>
        state
          ? {
              ...state,
              previewCenterMm: snapResult.point,
              previousSnapTargetIds: snapResult.snapTargetIds,
              activeGuides: snapResult.activeGuides
            }
          : state
      );
    }

    function onPointerUp(event: PointerEvent) {
      const current = moveDragRef.current;
      setMoveDrag(null);
      if (!current) return;

      // Sub-threshold release is a no-op — a click-without-real-movement
      // must not produce a phantom undo entry (docs/plan.md §7).
      const movedMm = Math.hypot(
        current.previewCenterMm.xMm - current.startCenterMm.xMm,
        current.previewCenterMm.yMm - current.startCenterMm.yMm
      );
      if (movedMm < 0.5) return;

      // Group drag: one commit carrying every member's final center (both kinds
      // through the single onMoveWallObjects prop). Member center = the snapped
      // group center plus that member's stored offset.
      if (current.members) {
        // Whether or not the commit survives the collision gate, the trailing
        // click must not collapse the multi-selection (see suppressNextSelect).
        suppressNextSelect();
        const moves = current.members.map((member) => ({
          id: member.id,
          xMm: current.previewCenterMm.xMm + member.offsetFromGroupCenterMm.xMm,
          yMm: current.previewCenterMm.yMm + member.offsetFromGroupCenterMm.yMm
        }));
        onMoveWallObjects?.(moves);
        return;
      }

      // Alt-drag of one group member: same single-object commit below, but the
      // trailing click must not collapse the multi-selection it came from.
      if (current.preserveSelection) suppressNextSelect();

      // A drag released with an additive-select modifier still down (⌘/Ctrl
      // precision drag, or Shift held) ends with the browser's trailing click,
      // which would otherwise read as an additive toggle and deselect the
      // object that was just moved.
      if (event.metaKey || event.ctrlKey || event.shiftKey) suppressNextSelect();

      if (current.kind === "artwork") {
        onMovePlacement?.(current.wallObjectId, current.previewCenterMm.xMm, current.previewCenterMm.yMm);
      } else {
        onMoveOpening?.(current.wallObjectId, current.previewCenterMm.xMm, current.previewCenterMm.yMm);
      }
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
    // Same shape as PlanView's drag effect: subscribed once per gesture,
    // reading live state via moveDragRef rather than closing over `moveDrag`.
    // wallLengthMm/wallHeightMm/centerlineMm/minorGridMm/snapToGrid/
    // snapThresholdMm/wallObjectsOnThisWall all derive from the committed
    // project (plus the arrange-session preview layer) and current viewport,
    // none of which can change mid-drag: the transient drag preview never
    // rewrites them, panel edits are impossible while a pointer is captured
    // (the pointer is on the canvas, not the inspector), and the session
    // preview only changes from this very drag's own commits — so they're
    // intentionally left out of the deps.
  }, [moveDrag !== null, onMovePlacement, onMoveOpening, onMoveWallObjects]);

  useEffect(() => {
    moveDragRef.current = moveDrag;
  }, [moveDrag]);

  // The browser fires a `click` on the grabbed element right after a drag's
  // pointerup. For a single object that click merely re-selects it (today's
  // behavior, harmless); after a real GROUP drag the same click would call
  // onSelectObject non-additively and collapse the whole multi-selection to
  // the one grabbed member — so the release marks the very next select to be
  // swallowed. Cleared on a timeout too, in case the release lands where no
  // click follows (pointer left the element mid-drag).
  const suppressNextSelectRef = useRef(false);
  function suppressNextSelect() {
    suppressNextSelectRef.current = true;
    window.setTimeout(() => {
      suppressNextSelectRef.current = false;
    }, 0);
  }
  function consumeSelectSuppression(): boolean {
    const suppressed = suppressNextSelectRef.current;
    suppressNextSelectRef.current = false;
    return suppressed;
  }

  useEffect(() => {
    if (!marquee) return;

    function onPointerMove(event: PointerEvent) {
      const current = marqueeRef.current;
      if (!current) return;

      const pointerMm = toWallLocalMm(event.clientX, event.clientY);
      if (!pointerMm) return;

      setMarquee((state) => (state ? { ...state, currentMm: pointerMm } : state));
    }

    function onPointerUp(event: PointerEvent) {
      const current = marqueeRef.current;
      setMarquee(null);
      if (!current) return;

      const rect = marqueeRectMm(current);
      // A sub-threshold rect is a plain background click, not a drag: clear the
      // selection rather than marquee-select an empty band. The threshold is
      // the same pointer slop the snap plumbing uses (SNAP_THRESHOLD_PX in mm).
      const draggedMm = Math.hypot(rect.maxXMm - rect.minXMm, rect.maxYMm - rect.minYMm);
      if (draggedMm < snapThresholdMm) {
        onClearSelection?.();
        return;
      }

      onMarqueeSelect?.(getIdsIntersectingRect(wallObjectsOnThisWall, rect), event.shiftKey);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
    // Same ref-based discipline as the move-drag effect: subscribed once per
    // gesture, reading the live rect via marqueeRef. snapThresholdMm and
    // wallObjectsOnThisWall derive from the committed project/viewport and
    // can't change mid-gesture, so they're intentionally out of the deps.
  }, [marquee !== null, onClearSelection, onMarqueeSelect]);

  useEffect(() => {
    marqueeRef.current = marquee;
  }, [marquee]);

  function beginMarquee(event: ReactPointerEvent<SVGSVGElement>) {
    // Only true background reaches here: placements/openings stopPropagation in
    // their own pointerdown. Gated on the multi-select handlers being wired so
    // that pre-wiring a background press stays inert (no marquee, no clear),
    // exactly as today. Never start over an in-flight move or HTML5 drop.
    if (!onMarqueeSelect && !onClearSelection) return;
    if (moveDrag || dropGhost) return;

    const startMm = toWallLocalMm(event.clientX, event.clientY);
    if (!startMm) return;

    // Suppress the browser's default press-drag semantics for this gesture:
    // without this, dragging across the svg selects its text nodes (the
    // <title>, the chip label), and the NEXT marquee that starts inside that
    // stale selection becomes a native drag of the selected text — Chrome
    // then fires pointercancel and kills the gesture mid-flight.
    event.preventDefault();
    setMarquee({ startMm, currentMm: startMm });
  }

  function beginMoveDrag(wallObject: WallObject, event: ReactPointerEvent<SVGGElement>) {
    event.stopPropagation();
    const startPointerMm = toWallLocalMm(event.clientX, event.clientY);
    if (!startPointerMm) return;

    // Alt-drag opts out of the group branch: one member moves alone while the
    // multi-selection survives the release (preserveSelection below).
    const altSoloDrag =
      event.altKey &&
      selectedObjectIds.includes(wallObject.id) &&
      selectedObjectIds.length > 1;

    // Group drag: the pressed object is part of a multi-selection. Resolve the
    // live members from this wall (stale ids simply drop out), size the union
    // box, and remember each member's offset from that box's center. Everything
    // downstream then treats the group as one virtual object.
    if (!altSoloDrag && selectedObjectIds.includes(wallObject.id) && selectedObjectIds.length > 1) {
      const groupMembers: WallObject[] = [...placements, ...openings].filter((object) =>
        selectedObjectIds.includes(object.id)
      );
      if (groupMembers.length > 1) {
        const box = getGroupBounds(groupMembers);
        const groupCenterMm: Vector2 = { xMm: box.centerXMm, yMm: box.centerYMm };
        setMoveDrag({
          wallObjectId: wallObject.id,
          kind: wallObject.kind,
          sizeMm: { widthMm: box.widthMm, heightMm: box.heightMm },
          startPointerMm,
          startCenterMm: groupCenterMm,
          previewCenterMm: groupCenterMm,
          previousSnapTargetIds: undefined,
          activeGuides: [],
          members: groupMembers.map((member) => ({
            id: member.id,
            kind: member.kind,
            sizeMm: { widthMm: member.widthMm, heightMm: member.heightMm },
            offsetFromGroupCenterMm: {
              xMm: member.xMm - groupCenterMm.xMm,
              yMm: member.yMm - groupCenterMm.yMm
            }
          })),
          startGroupCenterMm: groupCenterMm
        });
        return;
      }
    }

    setMoveDrag({
      wallObjectId: wallObject.id,
      kind: wallObject.kind,
      sizeMm: { widthMm: wallObject.widthMm, heightMm: wallObject.heightMm },
      startPointerMm,
      startCenterMm: { xMm: wallObject.xMm, yMm: wallObject.yMm },
      previewCenterMm: { xMm: wallObject.xMm, yMm: wallObject.yMm },
      previousSnapTargetIds: undefined,
      activeGuides: [],
      preserveSelection: altSoloDrag
    });
  }

  function handleDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!wallId || !event.dataTransfer.types.includes(ARTWORK_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";

    const pointerMm = toWallLocalMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    const sizeMm = effectiveSizeForArtworkId(draggingArtworkId);
    // A checklist drag-in is always an artwork: eyeline first, floor just below
    // it (see getArtworkSnapTargets' kind-dependent floor rank). ⌘/Ctrl held
    // over the surface bypasses snapping/quantization, same as a move-drag.
    const snapResult = resolveElevationPlacement(
      pointerMm,
      sizeMm,
      wallObjectsOnThisWall,
      "artwork",
      dropGhost?.previousSnapTargetIds,
      event.metaKey || event.ctrlKey
    );

    setDropGhost({
      centerMm: snapResult.point,
      sizeMm,
      previousSnapTargetIds: snapResult.snapTargetIds,
      activeGuides: snapResult.activeGuides
    });
  }

  function handleDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    // Only clear when the pointer actually leaves the surface, not when it
    // moves between child elements within it (those also fire dragleave).
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropGhost(null);
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    const artworkId = event.dataTransfer.getData(ARTWORK_DRAG_MIME);
    setDropGhost(null);
    if (!artworkId || !wallId) return;
    event.preventDefault();

    const pointerMm = toWallLocalMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    const sizeMm = effectiveSizeForArtworkId(artworkId);
    // Must land exactly where the ghost showed — same resolver, same bypass.
    const snapResult = resolveElevationPlacement(
      pointerMm,
      sizeMm,
      wallObjectsOnThisWall,
      "artwork",
      undefined,
      event.metaKey || event.ctrlKey
    );

    onPlaceArtwork?.(artworkId, wallId, snapResult.point.xMm, snapResult.point.yMm);
  }

  const activeGuides = moveDrag?.activeGuides ?? dropGhost?.activeGuides ?? [];

  // Preview center per object being moved, id → center. Covers the single
  // dragged object, or every group member (member center = the snapped group
  // center plus that member's offset). Placements/openings look themselves up
  // here to decide whether to render at their committed center or a preview.
  const previewCenterById = new Map<string, Vector2>();
  if (moveDrag) {
    if (moveDrag.members) {
      for (const member of moveDrag.members) {
        previewCenterById.set(member.id, {
          xMm: moveDrag.previewCenterMm.xMm + member.offsetFromGroupCenterMm.xMm,
          yMm: moveDrag.previewCenterMm.yMm + member.offsetFromGroupCenterMm.yMm
        });
      }
    } else {
      previewCenterById.set(moveDrag.wallObjectId, moveDrag.previewCenterMm);
    }
  }

  // The persistent group annotations (outline + dimension lines) exist only
  // when the whole selection resolves to wall objects on THIS wall — a cross-
  // wall or wall+floor selection keeps per-object outlines only. Members carry
  // the arrange-session preview (already baked into wallObjectsOnThisWall) plus
  // the in-flight drag preview on top, so both annotations track every live
  // movement.
  const applyDragPreview = (wallObject: WallObjectBase): WallObjectBase => {
    const preview = previewCenterById.get(wallObject.id);
    return preview ? { ...wallObject, xMm: preview.xMm, yMm: preview.yMm } : wallObject;
  };
  const selectedMembersOnThisWall = wallObjectsOnThisWall.filter((wallObject) =>
    selectedObjectIds.includes(wallObject.id)
  );
  const selectionAllOnThisWall =
    selectedMembersOnThisWall.length === selectedObjectIds.length;
  // The group OUTLINE bounds the WHOLE selection (artworks + openings alike) and
  // needs 2+ to be worth drawing — a single object already carries its own
  // selected outline.
  const isGroupOutlineEligible =
    selectedMembersOnThisWall.length >= 2 && selectionAllOnThisWall;
  const effectiveOutlineMembers: WallObjectBase[] =
    selectedMembersOnThisWall.map(applyDragPreview);

  // The dimension lines describe what ARRANGE affects. For a multi-selection
  // that's the ARTWORK members only (openings are architecture — arrange never
  // moves them, so they don't get gap lines). A single selection of ANY kind
  // gets its own outer margins (useful to read a lone door/window/work's space
  // on the wall too). "others" for the neighbour-aware outer segments is every
  // effective wall object on this wall that isn't a dimension member.
  const dimensionMemberSource =
    selectedObjectIds.length === 1
      ? selectedMembersOnThisWall
      : selectedMembersOnThisWall.filter((wallObject) => wallObject.kind === "artwork");
  const isDimensionLinesEligible =
    dimensionMemberSource.length >= 1 && selectionAllOnThisWall;
  const effectiveDimensionMembers: WallObjectBase[] =
    dimensionMemberSource.map(applyDragPreview);
  const dimensionMemberIds = new Set(dimensionMemberSource.map((wallObject) => wallObject.id));
  const dimensionOthers: WallObjectBase[] = wallObjectsOnThisWall
    .filter((wallObject) => !dimensionMemberIds.has(wallObject.id))
    .map(applyDragPreview);
  // Idle → neighbour-aware (stop at the nearest window/door/work). Active
  // arrange session → wall-edge segments, matching the values the panel edits.
  const dimensionSegments = arrangeSessionActive
    ? getSpacingSegments(effectiveDimensionMembers, wallLengthMm)
    : getNeighborAwareSegments(effectiveDimensionMembers, dimensionOthers, wallLengthMm);

  // Wall switcher wiring for the chip. Prev/next cycle through every wall in
  // room order (wrapping), and the Select lists them all — grouped by room
  // once more than one room exists.
  const currentWallIndex = walls.findIndex((wall) => wall.id === wallId);
  const canSwitchWalls = walls.length > 0 && currentWallIndex >= 0 && Boolean(onSelectWall);
  const roomNames = [...new Set(walls.map((wall) => wall.roomName))];
  const stepWall = (delta: number) => {
    if (currentWallIndex < 0) return;
    const next = walls[(currentWallIndex + delta + walls.length) % walls.length];
    if (next) onSelectWall?.(next.id);
  };

  return (
    <div
      aria-label="Wall elevation view"
      className="drawing-surface"
      ref={containerRef}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="surface-label">
        {canSwitchWalls ? (
          <div className="surface-label-nav">
            <Button
              aria-label="Previous wall"
              className="surface-label-switch"
              size="icon-sm"
              variant="ghost"
              onClick={() => stepWall(-1)}
            >
              <CaretLeftIcon aria-hidden="true" size={16} />
            </Button>
            <Select
              value={wallId}
              onValueChange={(value) => onSelectWall?.(value)}
            >
              <SelectTrigger aria-label="Select wall" className="surface-label-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roomNames.length > 1
                  ? roomNames.map((roomName) => (
                    <SelectGroup key={roomName}>
                      <SelectLabel>{roomName}</SelectLabel>
                      {walls
                        .filter((wall) => wall.roomName === roomName)
                        .map((wall) => (
                          <SelectItem key={wall.id} value={wall.id}>
                            {wall.name}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  ))
                  : walls.map((wall) => (
                    <SelectItem key={wall.id} value={wall.id}>
                      {wall.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              aria-label="Next wall"
              className="surface-label-switch"
              size="icon-sm"
              variant="ghost"
              onClick={() => stepWall(1)}
            >
              <CaretRightIcon aria-hidden="true" size={16} />
            </Button>
          </div>
        ) : (
          <strong>{wallName}</strong>
        )}
        <span>
          {formatLength(wallLengthMm, { unit })} by{" "}
          {formatLength(wallHeightMm, { unit })}
        </span>
      </div>
      <svg
        className="elevation-svg"
        ref={svgRef}
        viewBox={viewBox}
        role="img"
        onPointerDown={beginMarquee}
      >
        <title>{wallName} elevation</title>
        <rect
          className="wall-fill"
          x="0"
          y="0"
          width={wallLengthMm}
          height={wallHeightMm}
          vectorEffect="non-scaling-stroke"
        />
        {gridVisible ? (
          <GridOverlay
            id="elevation-grid"
            height={wallHeightMm}
            majorSpacingMm={majorGridMm}
            minorSpacingMm={minorGridMm}
            // x=0 is the wall start (already the pattern default); y is
            // anchored to wallHeightMm so lines land counting up from
            // floor level (svg y = wallHeightMm) rather than down from the
            // wall top, per docs/plan.md §5.5.
            originYMm={wallHeightMm}
            width={wallLengthMm}
            x={0}
            y={0}
          />
        ) : null}
        <line
          className="centerline"
          x1="0"
          y1={centerlineSvgY}
          x2={wallLengthMm}
          y2={centerlineSvgY}
          vectorEffect="non-scaling-stroke"
        />
        <line
          className="floor-line"
          x1="0"
          y1={wallHeightMm}
          x2={wallLengthMm}
          y2={wallHeightMm}
          vectorEffect="non-scaling-stroke"
        />
        {placements.map((placement) => {
          const previewCenter = previewCenterById.get(placement.id);
          const center = previewCenter ?? { xMm: placement.xMm, yMm: placement.yMm };
          // A move never resizes, so the object's own size always applies (for a
          // group, moveDrag.sizeMm is the union box, not this member's size).
          const size = { widthMm: placement.widthMm, heightMm: placement.heightMm };
          const artwork = artworksById?.get(placement.artworkId);

          return (
            <ElevationArtwork
              key={placement.id}
              center={center}
              dimensionStatus={artwork?.dimensions.status}
              imageUrl={artwork?.assetId ? imageUrlsByAssetId.get(artwork.assetId) : undefined}
              isOutOfBounds={isArtworkOutOfWallBounds(wallLengthMm, wallHeightMm, center, size)}
              isSelected={selectedArtworkId === placement.artworkId || selectedObjectIds.includes(placement.id)}
              size={size}
              tooltip={
                artwork ? (
                  // No thumbnail here — the artwork itself is on the wall.
                  <ArtworkTooltipContent
                    artwork={artwork}
                    dimensions={placement.displayDimensionsOverride ?? artwork.dimensions}
                    unit={unit}
                  />
                ) : undefined
              }
              tooltipDisabled={Boolean(moveDrag || dropGhost)}
              wallHeightMm={wallHeightMm}
              onPointerDown={(event) => beginMoveDrag(placement, event)}
              onSelect={(event) => {
                if (consumeSelectSuppression()) return;
                if (onSelectObject) {
                  onSelectObject(placement.id, {
                    additive: event.shiftKey || event.metaKey || event.ctrlKey
                  });
                } else {
                  onSelectArtwork?.(placement.artworkId);
                }
              }}
            />
          );
        })}
        {openings.map((opening) => {
          const previewCenter = previewCenterById.get(opening.id);
          const center = previewCenter ?? { xMm: opening.xMm, yMm: opening.yMm };
          const size = { widthMm: opening.widthMm, heightMm: opening.heightMm };

          return (
            <ElevationOpening
              key={opening.id}
              center={center}
              isOutOfBounds={isArtworkOutOfWallBounds(wallLengthMm, wallHeightMm, center, size)}
              isSelected={selectedOpeningId === opening.id || selectedObjectIds.includes(opening.id)}
              kind={opening.kind}
              size={size}
              tooltip={
                <OpeningTooltipContent
                  kind={opening.kind}
                  secondaryMm={opening.heightMm}
                  unit={unit}
                  widthMm={opening.widthMm}
                />
              }
              tooltipDisabled={Boolean(moveDrag || dropGhost)}
              wallHeightMm={wallHeightMm}
              wallObjectId={opening.id}
              onPointerDown={(event) => beginMoveDrag(opening, event)}
              onSelect={(event) => {
                if (consumeSelectSuppression()) return;
                if (onSelectObject) {
                  onSelectObject(opening.id, {
                    additive: event.shiftKey || event.metaKey || event.ctrlKey
                  });
                } else {
                  onSelectOpening?.(opening.id);
                }
              }}
            />
          );
        })}
        {dropGhost ? (
          <ElevationArtwork
            center={dropGhost.centerMm}
            isGhost
            size={dropGhost.sizeMm}
            wallHeightMm={wallHeightMm}
          />
        ) : null}
        {isGroupOutlineEligible && pixelsPerMm > 0
          ? (() => {
              // Persistent group identity: a quiet SOLID outline around the
              // union bounds (visually distinct from the dashed in-progress
              // marquee below), padded a constant 6 screen px so it never
              // hugs the artwork edges regardless of zoom.
              const bounds = getGroupBounds(effectiveOutlineMembers);
              const padMm = 6 / pixelsPerMm;
              return (
                <rect
                  className="selection-group-outline"
                  x={bounds.centerXMm - bounds.widthMm / 2 - padMm}
                  y={
                    wallLocalYToSvgY(wallHeightMm, bounds.centerYMm + bounds.heightMm / 2) -
                    padMm
                  }
                  width={bounds.widthMm + padMm * 2}
                  height={bounds.heightMm + padMm * 2}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })()
          : null}
        {marquee
          ? (() => {
              const rect = marqueeRectMm(marquee);
              // Wall-local y is up; svg y is down. The rect's top edge (maxYMm)
              // maps to the smaller svg y, so anchor the <rect> there and let
              // its positive height run downward. Dashed petrol stroke (see
              // .marquee-rect) — selection is a petrol signal everywhere else
              // in the app, and the dash keeps it distinct from the SOLID
              // group outline that persists after release.
              return (
                <rect
                  className="marquee-rect"
                  x={rect.minXMm}
                  y={wallLocalYToSvgY(wallHeightMm, rect.maxYMm)}
                  width={rect.maxXMm - rect.minXMm}
                  height={rect.maxYMm - rect.minYMm}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })()
          : null}
        {activeGuides.map((guide) => (
          <line
            className="snap-guide"
            key={guide.id}
            x1={guide.axis === "x" ? guide.positionMm : 0}
            y1={guide.axis === "y" ? wallLocalYToSvgY(wallHeightMm, guide.positionMm) : 0}
            x2={guide.axis === "x" ? guide.positionMm : wallLengthMm}
            y2={
              guide.axis === "y" ? wallLocalYToSvgY(wallHeightMm, guide.positionMm) : wallHeightMm
            }
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {isDimensionLinesEligible ? (
          <GroupDimensionLines
            members={effectiveDimensionMembers}
            segments={dimensionSegments}
            pixelsPerMm={pixelsPerMm}
            unit={unit}
            wallHeightMm={wallHeightMm}
          />
        ) : null}
      </svg>
    </div>
  );
}
