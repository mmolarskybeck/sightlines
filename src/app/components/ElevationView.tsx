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
import { getMajorGridIntervalMm, getMinorGridIntervalMm } from "../../domain/units/precision";
import {
  clampZoom,
  ELEVATION_ZOOM_LIMITS,
  FIT_VIEWPORT,
  getEffectiveZoom,
  getFitBoundsViewport,
  getViewBox2D,
  panBy,
  pinchZoomPan,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_STEP,
  zoomAtPoint,
  type Viewport2D
} from "../../domain/viewport/viewport2d";
import { useAssetImageUrls } from "../hooks/useAssetImageUrls";
import { useContainerSize } from "../hooks/useContainerSize";
import { ARTWORK_DRAG_MIME } from "./ChecklistPanel";
import { ElevationArtwork } from "./ElevationArtwork";
import { ElevationOpening } from "./ElevationOpening";
import { ArtworkTooltipContent, OpeningTooltipContent } from "./PlacementTooltip";
import { getFitSelectionBoundsSvg, isArtworkOutOfWallBounds, wallLocalYToSvgY } from "./elevationArtworkGeometry";
import { GridOverlay } from "./GridOverlay";
import { GroupDimensionLines } from "./GroupDimensionLines";
import { Button } from "./ui/button";
import { ViewportZoomControls } from "./ViewportZoomControls";
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
// A touch gesture (one-finger pan or two-finger pinch) that moves less than
// this many client px on release is treated as a stationary tap — a background
// tap then clears the selection; beyond it, the release is a pan/pinch.
const TOUCH_TAP_SLOP_PX = 8;

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
  onSelectWall,
  viewport,
  onViewportChange
}: {
  gridPrecisionFloorMm: number | null;
  gridVisible: boolean;
  wallName: string;
  wallLengthMm: number;
  wallHeightMm: number;
  centerlineMm: number;
  unit: DisplayUnit;
  // The manual/fit viewport for this surface (owned by App via useViewport2D,
  // keyed on project id + wall id so a wall switch resets to fit), and the
  // setter every zoom/pan gesture (plus "Fit selected") routes its next
  // viewport through. Mirrors PlanView's viewport/onViewportChange contract.
  viewport: Viewport2D;
  onViewportChange: (v: Viewport2D) => void;
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

  // Space-drag / middle-mouse pan — same idiom as PlanView's M2 wiring.
  // `isSpaceDown` drives the container cursor (grab), `panning` drives it
  // while a pan drag is live (grabbing). Both are mirrored into refs so the
  // capture-phase pointerdown and the window-level pan move handlers read
  // fresh values without resubscribing.
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const spaceHeldRef = useRef(false);
  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);
  // Last pointer client position of the in-flight pan, for incremental deltas.
  const panLastRef = useRef<{ x: number; y: number } | null>(null);
  // Fresh viewport for gesture handlers that were subscribed once (pan moves,
  // wheel) and must not close over a stale prop — same ref-mirror discipline
  // the drag gestures use for their transient state.
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Touch (tablet) gestures: one-finger canvas pan and two-finger pinch-zoom,
  // mirroring PlanView's M5 wiring. Same small state machine keyed off the
  // count of tracked touch pointers (touchPointsRef → touchModeRef →
  // touchPanLastRef / touchPinchRef, with touchMovedPxRef distinguishing tap
  // from pan). `touchTracking` (state) gates the window move/up effect on/off.
  // A single finger that lands on a placement owns its own move-drag — touchMode
  // stays "idle" and these handlers keep out of its way.
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>());
  const touchModeRef = useRef<"idle" | "pan" | "pinch">("idle");
  const touchPanLastRef = useRef<{ x: number; y: number } | null>(null);
  const touchPinchRef = useRef<{
    idA: number;
    idB: number;
    prevMid: { x: number; y: number };
    prevDist: number;
  } | null>(null);
  const touchMovedPxRef = useRef(0);
  // True once a one-finger pan begins on true background — so a stationary
  // release clears the selection (elevation has no svg click handler, so the
  // clear can't ride a trailing click the way it does in plan). Stays false for
  // a finger that started on a placement, so tapping one still just selects it.
  const touchPanTapCandidateRef = useRef(false);
  const [touchTracking, setTouchTracking] = useState(false);

  // Pad the viewBox so the wall reads as a figure on the canvas field
  // rather than bleeding edge-to-edge, and so boundary strokes (centered on
  // the wall edge) aren't half-clipped. All wall-local coordinates are
  // unchanged — only the visible window widens. This padded rect is the
  // FIT extent every gesture measures against; getViewBox2D turns the
  // current viewport (fit or manual pan/zoom) into the concrete viewBox
  // rect + its exact pixels-per-mm, so every downstream consumer (grid,
  // snap threshold, group-outline pad) inherits the zoom automatically.
  const viewPadMm = Math.max(wallLengthMm, wallHeightMm) * 0.06;
  const contentBounds = {
    x: -viewPadMm,
    y: -viewPadMm,
    width: wallLengthMm + viewPadMm * 2,
    height: wallHeightMm + viewPadMm * 2
  };
  const { viewBox: viewBoxBounds, pixelsPerMm } = getViewBox2D(viewport, contentBounds, containerSize);
  const viewBox = `${viewBoxBounds.x} ${viewBoxBounds.y} ${viewBoxBounds.width} ${viewBoxBounds.height}`;
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

  // Same client-px → viewBox-mm conversion as toWallLocalMm, WITHOUT the
  // y-flip: every viewport helper (zoomAtPoint, panBy, getViewBox2D) works in
  // plain SVG userspace (y-down), never wall-local (y-up) — mirrors PlanView's
  // toSvgMm. Used for the wheel-zoom anchor point only; every other gesture
  // (move-drag, marquee) still reads pointer position through toWallLocalMm.
  function toSvgPoint(clientX: number, clientY: number): Vector2 | null {
    const svg = svgRef.current;
    if (!svg) return null;

    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;

    const transformed = point.matrixTransform(ctm.inverse());
    return { xMm: transformed.x, yMm: transformed.y };
  }

  // Zoom the current viewBox about its own center — the [+]/[−] buttons' target
  // point, since there's no cursor to anchor on for a button press. Mirrors
  // PlanView's zoomAtCenter, with ELEVATION_ZOOM_LIMITS.
  function zoomAtCenter(factor: number) {
    onViewportChange(
      zoomAtPoint(
        viewport,
        { xMm: viewBoxBounds.x + viewBoxBounds.width / 2, yMm: viewBoxBounds.y + viewBoxBounds.height / 2 },
        factor,
        contentBounds,
        containerSize,
        ELEVATION_ZOOM_LIMITS
      )
    );
  }

  // Wheel = zoom (ctrl/⌘ or trackpad pinch) or pan (plain / shift-horizontal).
  // Reassigned every render so it always sees the latest viewport/bounds;
  // registered once as a NON-passive native listener (React's onWheel can be
  // passive, which would make preventDefault a no-op) in the effect below.
  // Identical logic to PlanView's M2 wheel handler, just anchored on
  // toSvgPoint (SVG userspace) instead of toSvgMm and ELEVATION_ZOOM_LIMITS
  // instead of PLAN_ZOOM_LIMITS.
  const wheelHandlerRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelHandlerRef.current = (e: WheelEvent) => {
    e.preventDefault();
    // Line-mode wheels (deltaMode 1) report in lines, not pixels — scale up so
    // one detent moves a comparable amount to a pixel-mode wheel.
    const norm = (d: number) => (e.deltaMode === 1 ? d * 16 : d);
    if (e.ctrlKey || e.metaKey) {
      // ctrlKey===true is also how a trackpad pinch arrives in Chrome/Firefox/
      // Safari — same code path, anchored on the cursor's world point.
      const point = toSvgPoint(e.clientX, e.clientY);
      if (!point) return;
      const factor = Math.min(2, Math.max(0.5, Math.exp(-norm(e.deltaY) * WHEEL_ZOOM_SENSITIVITY)));
      onViewportChange(
        zoomAtPoint(viewportRef.current, point, factor, contentBounds, containerSize, ELEVATION_ZOOM_LIMITS)
      );
    } else {
      // Plain wheel pans; shift+wheel pans horizontally on Windows (macOS
      // already flips deltaX for a shifted wheel, so only synthesize when the
      // browser left deltaX at 0).
      const dx = e.shiftKey && e.deltaX === 0 ? norm(e.deltaY) : norm(e.deltaX);
      const dy = e.shiftKey && e.deltaX === 0 ? 0 : norm(e.deltaY);
      onViewportChange(panBy(viewportRef.current, { x: dx, y: dy }, contentBounds, containerSize));
    }
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => wheelHandlerRef.current(e);
    // Safari's non-standard pinch events would otherwise page-zoom the app.
    const onGesture = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGesture);
    el.addEventListener("gesturechange", onGesture);
    el.addEventListener("gestureend", onGesture);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGesture);
      el.removeEventListener("gesturechange", onGesture);
      el.removeEventListener("gestureend", onGesture);
    };
  }, []);

  // Track Space (for the grab cursor + capture-phase pan intercept) and handle
  // ⌘0 / Ctrl+0 = reset to fit. Window-scoped, mirroring PlanView's M2
  // listener; skips edit fields so typing a literal "0" or space in an input
  // (e.g. the wall-switcher Select, though it has no text entry today) is
  // never hijacked. plan/elevation are never both mounted at once (viewMode
  // gates which one App renders), so there's no risk of two of these
  // double-firing on the same keystroke.
  useEffect(() => {
    function isEditable(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable === true
      );
    }

    function onKeyDown(event: KeyboardEvent) {
      if (isEditable(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "0") {
        // Also blocks the browser's own zoom-reset.
        event.preventDefault();
        onViewportChange(FIT_VIEWPORT);
        return;
      }
      if (event.code === "Space" || event.key === " ") {
        if (!spaceHeldRef.current) {
          spaceHeldRef.current = true;
          setIsSpaceDown(true);
        }
        // Stops the page from scrolling / a focused button from activating
        // while space engages pan. e.repeat is ignored for the flag (already
        // set) but still prevented so held-space never scrolls.
        event.preventDefault();
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space" || event.key === " ") {
        spaceHeldRef.current = false;
        setIsSpaceDown(false);
      }
    }

    function onBlur() {
      // ⌘Tab away while holding space would otherwise leave the flag stuck.
      spaceHeldRef.current = false;
      setIsSpaceDown(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [onViewportChange]);

  // Space/middle-mouse pan drag. Subscribed once per gesture (keyed on
  // `panning`), reading the live viewport via viewportRef and applying the
  // negated incremental pointer delta so the drawing tracks the pointer.
  // contentBounds/containerSize are captured by closure — they can't change
  // mid-gesture (no commit, no resize while a button is held). Unlike
  // PlanView's endPan, there's no trailing-click suppression to arm here:
  // ElevationView has no click handler on its svg background (background
  // clear runs off the marquee's own pointerup, which never starts once the
  // capture-phase handler below claims the gesture as a pan), so a foiled
  // pan simply leaves selection state untouched — nothing to suppress.
  useEffect(() => {
    if (!panning) return;

    function onPointerMove(event: PointerEvent) {
      const last = panLastRef.current;
      if (!last) return;
      onViewportChange(
        panBy(
          viewportRef.current,
          { x: -(event.clientX - last.x), y: -(event.clientY - last.y) },
          contentBounds,
          containerSize
        )
      );
      panLastRef.current = { x: event.clientX, y: event.clientY };
    }

    function endPan() {
      panningRef.current = false;
      panLastRef.current = null;
      setPanning(false);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endPan);
    window.addEventListener("pointercancel", endPan);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endPan);
      window.removeEventListener("pointercancel", endPan);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panning, onViewportChange]);

  // Begin a two-finger pinch from the two currently tracked touch pointers.
  // Ends any in-flight one-finger pan (pinch owns the gesture from here).
  function beginPinch() {
    const entries = [...touchPointsRef.current.entries()];
    if (entries.length < 2) return;
    const [idA, a] = entries[0];
    const [idB, b] = entries[1];
    touchModeRef.current = "pinch";
    touchPanLastRef.current = null;
    touchPanTapCandidateRef.current = false;
    touchPinchRef.current = {
      idA,
      idB,
      prevMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      prevDist: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 0)
    };
  }

  // Begin a one-finger canvas pan (touch only). Called from the svg's
  // bubble-phase pointerdown, which only fires for a press on true background
  // (a placement's pointerdown stopPropagation keeps it from reaching here —
  // that touch stays a move-drag instead).
  function beginTouchPan(clientX: number, clientY: number) {
    touchModeRef.current = "pan";
    touchPanLastRef.current = { x: clientX, y: clientY };
    touchPanTapCandidateRef.current = true;
  }

  // Touch move/up/cancel/blur, subscribed once while ≥1 touch is tracked
  // (keyed on `touchTracking`), reading live state via the touch refs — the
  // same discipline the mouse-pan effect uses. viewport is read fresh via
  // viewportRef; contentBounds/containerSize are captured by closure and can't
  // change mid-gesture (no commit, no wall switch while fingers are down).
  useEffect(() => {
    if (!touchTracking) return;

    function onPointerMove(event: PointerEvent) {
      if (event.pointerType !== "touch") return;
      const points = touchPointsRef.current;
      if (!points.has(event.pointerId)) return;
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (touchModeRef.current === "pan") {
        const last = touchPanLastRef.current;
        if (!last) return;
        const dx = event.clientX - last.x;
        const dy = event.clientY - last.y;
        touchMovedPxRef.current += Math.hypot(dx, dy);
        onViewportChange(
          panBy(viewportRef.current, { x: -dx, y: -dy }, contentBounds, containerSize)
        );
        touchPanLastRef.current = { x: event.clientX, y: event.clientY };
        return;
      }

      if (touchModeRef.current === "pinch") {
        const pinch = touchPinchRef.current;
        if (!pinch) return;
        const a = points.get(pinch.idA);
        const b = points.get(pinch.idB);
        if (!a || !b) return;
        const nextMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const nextDist = Math.hypot(a.x - b.x, a.y - b.y);
        const midDelta = { x: nextMid.x - pinch.prevMid.x, y: nextMid.y - pinch.prevMid.y };
        if (pinch.prevDist > 0 && nextDist > 0) {
          const factor = nextDist / pinch.prevDist;
          // World point under the PREVIOUS midpoint, via the live CTM in plain
          // SVG userspace (toSvgPoint, not the y-flipped toWallLocalMm) — the
          // same anchor space the wheel-zoom handler uses.
          const prevMidWorld = toSvgPoint(pinch.prevMid.x, pinch.prevMid.y);
          if (prevMidWorld) {
            touchMovedPxRef.current +=
              Math.hypot(midDelta.x, midDelta.y) + Math.abs(nextDist - pinch.prevDist);
            onViewportChange(
              pinchZoomPan(
                viewportRef.current,
                prevMidWorld,
                factor,
                midDelta,
                contentBounds,
                containerSize,
                ELEVATION_ZOOM_LIMITS
              )
            );
          }
        }
        pinch.prevMid = nextMid;
        pinch.prevDist = nextDist;
      }
    }

    function onPointerUp(event: PointerEvent) {
      if (event.pointerType !== "touch") return;
      const points = touchPointsRef.current;
      if (!points.has(event.pointerId)) return;
      points.delete(event.pointerId);

      if (touchModeRef.current === "pinch") {
        const pinch = touchPinchRef.current;
        // Only a lift of one of the two pinch fingers ends the pinch; a 3rd
        // finger lifting leaves it running. A 2→1 lift never hands off to a new
        // pan — the lone remaining finger idles until a fresh touch-down.
        if (pinch && (event.pointerId === pinch.idA || event.pointerId === pinch.idB)) {
          touchModeRef.current = "idle";
          touchPinchRef.current = null;
        }
      } else if (touchModeRef.current === "pan") {
        touchModeRef.current = "idle";
        touchPanLastRef.current = null;
      }

      if (points.size === 0) {
        // Whole gesture over. A stationary one-finger background tap clears the
        // selection — elevation has no svg click handler, so unlike plan this
        // can't ride a trailing click. A real pan/pinch, or a finger that
        // started on a placement, leaves the selection alone.
        if (
          touchMovedPxRef.current <= TOUCH_TAP_SLOP_PX &&
          touchPanTapCandidateRef.current
        ) {
          onClearSelection?.();
        }
        touchMovedPxRef.current = 0;
        touchPanTapCandidateRef.current = false;
        setTouchTracking(false);
      }
    }

    function onBlur() {
      // Losing the window (⌘Tab, notification) mid-gesture would otherwise
      // strand tracked pointers — reset everything.
      touchPointsRef.current.clear();
      touchModeRef.current = "idle";
      touchPanLastRef.current = null;
      touchPinchRef.current = null;
      touchMovedPxRef.current = 0;
      touchPanTapCandidateRef.current = false;
      setTouchTracking(false);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("blur", onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touchTracking, onViewportChange, onClearSelection]);

  // Capture-phase pan intercept: space-held (left button) or middle-mouse
  // press claims the gesture BEFORE any of ElevationView's own gestures
  // (move-drag via beginMoveDrag, the background marquee via beginMarquee,
  // or a checklist drop-ghost) can start — same precedence PlanView's M2
  // handleSvgPointerDownCapture gives pan over its own resize/room/object
  // drags and marquee. Guarded on spaceHeldRef || button === 1 so an ordinary
  // left press with space up flows through untouched. Right-click (button 2)
  // is never intercepted. stopPropagation here (during the capture phase, on
  // the svg — an ancestor of every placement's own <g>) is what keeps
  // beginMoveDrag/beginMarquee from ever firing for this gesture; it also
  // kills middle-click autoscroll.
  function handleSvgPointerDownCapture(event: ReactPointerEvent<SVGSVGElement>) {
    // Touch pointers feed the pinch/pan state machine (mirrors PlanView). This
    // capture-phase handler fires before any placement's own pointerdown, so
    // every touch is recorded regardless of what it lands on. The 2nd finger
    // claims the gesture as a pinch (unless a move-drag is already in flight, in
    // which case we defer to that edit and just block the finger), stopping
    // propagation so no placement under it starts its own move-drag.
    if (event.pointerType === "touch") {
      const points = touchPointsRef.current;
      const isFirst = points.size === 0;
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (isFirst) {
        touchMovedPxRef.current = 0;
        touchPanTapCandidateRef.current = false;
      }
      setTouchTracking(true);
      if (points.size === 2) {
        event.preventDefault();
        event.stopPropagation();
        if (!moveDragRef.current) beginPinch();
        return;
      }
      if (points.size >= 3) return; // ignore 3rd+ touches
      // A single touch falls through; whether it becomes a pan is decided in
      // beginMarquee (bubble). A finger on a placement never reaches beginMarquee
      // (the placement stopPropagation), so it stays a move-drag.
      return;
    }

    if (spaceHeldRef.current || event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      panningRef.current = true;
      panLastRef.current = { x: event.clientX, y: event.clientY };
      setPanning(true);
    }
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
    // Touch: a single finger on true background pans the canvas instead of
    // marqueeing (the marquee is a mouse-only gesture on tablets). Only the sole
    // tracked touch starts a pan — a pinch's touches were already claimed in the
    // capture handler. Returns unconditionally for touch so a finger never falls
    // through into the marquee path below.
    if (event.pointerType === "touch") {
      if (touchPointsRef.current.size === 1 && touchModeRef.current !== "pinch") {
        beginTouchPan(event.clientX, event.clientY);
      }
      return;
    }

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

  // "Fit selected" bounds — the padded union (SVG-userspace) of every
  // selected artwork/opening ON THIS WALL, drag preview applied (harmless
  // no-op when no drag is live — the button can't be clicked mid-drag
  // anyway, since the pointer is captured). null when nothing on this wall
  // is selected, which also disables the chip's button.
  const selectedSvgBounds = getFitSelectionBoundsSvg(
    wallHeightMm,
    effectiveOutlineMembers.map((wallObject) => ({
      center: { xMm: wallObject.xMm, yMm: wallObject.yMm },
      size: { widthMm: wallObject.widthMm, heightMm: wallObject.heightMm }
    }))
  );

  function handleFitSelected() {
    if (!selectedSvgBounds) return;
    onViewportChange(
      getFitBoundsViewport(
        {
          x: selectedSvgBounds.xMm,
          y: selectedSvgBounds.yMm,
          width: selectedSvgBounds.widthMm,
          height: selectedSvgBounds.heightMm
        },
        contentBounds,
        containerSize,
        ELEVATION_ZOOM_LIMITS
      )
    );
  }

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

  // Pan cursor affordance: grabbing while a pan drag is live, grab while space
  // is merely held ready. Otherwise the surface keeps its default cursor.
  // Mirrors PlanView's surfaceClassName.
  const surfaceClassName = panning
    ? "drawing-surface is-panning"
    : isSpaceDown
      ? "drawing-surface is-pan-ready"
      : "drawing-surface";

  return (
    <div
      aria-label="Wall elevation view"
      className={surfaceClassName}
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
      <ViewportZoomControls
        zoom={getEffectiveZoom(viewport)}
        isFit={viewport.mode === "fit"}
        canZoomIn={
          clampZoom(getEffectiveZoom(viewport) * ZOOM_STEP, contentBounds, containerSize, ELEVATION_ZOOM_LIMITS) !==
          getEffectiveZoom(viewport)
        }
        canZoomOut={
          clampZoom(getEffectiveZoom(viewport) / ZOOM_STEP, contentBounds, containerSize, ELEVATION_ZOOM_LIMITS) !==
          getEffectiveZoom(viewport)
        }
        onZoomIn={() => zoomAtCenter(ZOOM_STEP)}
        onZoomOut={() => zoomAtCenter(1 / ZOOM_STEP)}
        onFit={() => onViewportChange(FIT_VIEWPORT)}
        onFitSelected={handleFitSelected}
        fitSelectedDisabled={selectedSvgBounds === null}
      />
      <svg
        className="elevation-svg"
        ref={svgRef}
        viewBox={viewBox}
        role="img"
        onPointerDown={beginMarquee}
        onPointerDownCapture={handleSvgPointerDownCapture}
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
