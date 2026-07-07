import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  computeEdgeSnappedLengthMm,
  getMovingWallEdgeWorldPointMm,
  proposeMovingEdgePointMm,
  type Vector2
} from "../../domain/geometry/dragResize";
import { resizeWallPreservingAngles, type ResizeAnchor } from "../../domain/geometry/editRoom";
import { getFloorBounds, getRoomBounds } from "../../domain/geometry/walls";
import {
  getFloorObjectPlanRect,
  getFloorWalls,
  getWallObjectPlanRect,
  planRectIntersectsRect,
  WALL_OBJECT_PLAN_DEPTH_MM,
  type PlanRect
} from "../../domain/geometry/planObjects";
import { getDefaultOpeningSizeMm } from "../../domain/placement/createOpening";
import {
  getEffectivePlacementSizeMm,
  PLACEHOLDER_ARTWORK_HEIGHT_MM,
  PLACEHOLDER_ARTWORK_WIDTH_MM
} from "../../domain/placement/placeArtwork";
import {
  DEFAULT_FLOOR_OBJECT_DEPTH_MM,
  type Artwork,
  type Dimensions,
  type Project,
  type RoomPlacement,
  type WallObject
} from "../../domain/project";
import { getGridSnapTargets } from "../../domain/snapping/gridSnapTargets";
import {
  resolvePlanPlacement,
  WALL_CAPTURE_PX,
  type PlanPlacement
} from "../../domain/snapping/planSnapTargets";
import {
  getPlanGroupCenterMm,
  resolvePlanGroupMemberMove,
  type PlanGroupMember
} from "../../domain/snapping/planGroupMove";
import { resolveSnap, type Guide, type SnapTarget, type SnapTargetIds } from "../../domain/snapping/resolveSnap";
import {
  getMajorGridIntervalMm,
  getMinorGridIntervalMm
} from "../../domain/units/precision";
import {
  clampZoom,
  FIT_VIEWPORT,
  getEffectiveZoom,
  getViewBox2D,
  panBy,
  pinchZoomPan,
  PLAN_ZOOM_LIMITS,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_STEP,
  zoomAtPoint,
  type Viewport2D
} from "../../domain/viewport/viewport2d";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../domain/units/unitSystem";
import { useAssetImageUrls } from "../hooks/useAssetImageUrls";
import { useContainerSize } from "../hooks/useContainerSize";
import { ARTWORK_DRAG_MIME } from "./ChecklistPanel";
import { GridOverlay } from "./GridOverlay";
import { ArtworkTooltipContent, OpeningTooltipContent } from "./PlacementTooltip";
import { PlanObject } from "./PlanObject";
import { PlanToolbar, type PlanTool } from "./PlanToolbar";
import { RoomResizeHandles, type ResizeHandleTarget } from "./RoomResizeHandles";
import { ViewportZoomControls } from "./ViewportZoomControls";

// On-screen size of a selected room's wall-midpoint resize handles — small
// and square (the design language has no pills), since they only ever render
// for the one selected room rather than floating outside every room at rest.
const SELECTED_HANDLE_PX = 10;
const SNAP_THRESHOLD_PX = 10;
// Wall objects render at their true model depth once it's on-screen large
// enough to read as a rect; below that, clamp to a visible floor (doors/
// windows are thin by design and would otherwise vanish to a hairline when
// zoomed out).
const MIN_WALL_OBJECT_DEPTH_PX = 9;
// Every plan object gets an invisible hit pad at least this big on both axes
// so small objects (esp. thin wall objects) stay clickable at any zoom.
const MIN_OBJECT_HIT_PX = 20;
// A touch gesture (one-finger pan or two-finger pinch) that moves less than
// this many client px on release is treated as a stationary tap — the trailing
// click still selects/places/clears; beyond it, the click is suppressed.
const TOUCH_TAP_SLOP_PX = 8;

// Stable module-level reference so a caller that doesn't pass `getBlob`
// doesn't retrigger useAssetImageUrls' effect on every render (same idiom as
// ElevationView's NO_OP_GET_BLOB).
const NO_OP_GET_BLOB: (key: string) => Promise<Blob> = () =>
  Promise.reject(new Error("PlanView: no getBlob provided"));

type DragState = {
  roomId: string;
  targetWallId: string;
  axis: Vector2;
  // Which vertex of the target wall stays fixed in world space — determines
  // both which handle wall this drag was started from (RoomResizeHandles
  // picks the handle whose target wall actually moves for a given anchor)
  // and the sign of the length delta (see computeDraggedLengthMm).
  anchor: ResizeAnchor;
  startLengthMm: number;
  startPointerMm: Vector2;
  // The wall's own moving edge (in floor coordinates) at drag start —
  // snapping targets this point, not the pointer, so wherever inside the
  // handle the user grabbed never leaks into the committed length. See
  // getMovingWallEdgeWorldPointMm.
  edgeStartMm: Vector2;
  previewLengthMm: number;
  // A wall-resize drag only ever snaps along the wall's own single axis, so
  // one id is enough here — it maps into that axis's slot of resolveSnap's
  // per-axis previousSnapTargetIds.
  previousSnapTargetId?: string;
  activeGuides: Guide[];
};

// A pointer-drag move of a whole room, transient until release: live preview
// via displayedProject's offset override, exactly one onMoveRoom commit on
// release. Mirrors the wall-resize DragState's discipline (effect keyed on
// whether a drag is active, latest values read via a ref) rather than
// reusing ObjectDragState, since a room move has no wall re-anchoring or
// floor/wall conversion to resolve — just a translated offset.
type RoomDragState = {
  roomId: string;
  startPointerMm: Vector2;
  startOffsetMm: Vector2;
  // The room's bounding-box top-left corner in world space at drag start —
  // grid snapping targets this corner (not the raw pointer), the same
  // grab-offset-cancelling trick the wall-resize drag's edgeStartMm uses.
  startMinCornerMm: Vector2;
  previewOffsetMm: Vector2;
  previousSnapTargetIds?: SnapTargetIds;
  activeGuides: Guide[];
};

// The click-to-place preview for an armed palette tool — parallels
// ElevationView's DropGhostState, but there's no HTML5 drag gesture here:
// this follows plain pointer hover over the plan SVG and commits on click.
type ToolGhostState = {
  planRect: PlanRect;
  placement: PlanPlacement;
  activeGuides: Guide[];
};

// A pointer-drag move of an existing placed object (wall-anchored or floor-
// placed), transient until release: live preview, exactly one commitPlanMove
// on release (that single action handles same-wall / re-anchor / wall↔floor
// atomically). Mirrors ElevationView's MoveDragState and PlanView's own
// wall-resize DragState — the effect reads the latest values from a ref and
// omits them from deps, so the drag never resubscribes mid-gesture.
type ObjectDragState = {
  objectId: string;
  kind: WallObject["kind"];
  // artwork | blocked-zone → true; door | window → false (never float).
  canFloat: boolean;
  movingSize: { widthMm: number; heightMm: number; depthMm: number };
  // The rotation to preview a floated result at: the wall's floor-space angle
  // for a wall object (so a wall→floor preview keeps its orientation, matching
  // commitPlanMove), or the floor object's own rotation.
  rotationDeg: number;
  startPointerMm: Vector2;
  startCenterMm: Vector2;
  // The wall the live preview is currently anchored to (null when floating),
  // threaded back into resolvePlanPlacement so its cross-boundary hysteresis
  // tracks the drag rather than the object's committed wall.
  currentAnchorWallId: string | null;
  previewPlanRect: PlanRect;
  previewPlacement: PlanPlacement;
  previousSnapTargetIds?: SnapTargetIds;
  activeGuides: Guide[];
  // Group drag: a rigid, translation-only move of a multi-selection.
  // resolvePlanPlacement is skipped entirely (no mid-group wall re-anchoring —
  // deliberate); the pointer delta is optionally grid-snapped on the group's
  // box center, then applied to every member. Wall members stay glued to their
  // own wall, floor members translate. Absent for a single-object drag — that
  // path (previewPlanRect/previewPlacement/currentAnchorWallId) is untouched.
  members?: PlanGroupMember[];
  startGroupCenterMm?: Vector2;
  previewGroupCenterMm?: Vector2;
  // Per-member preview rects, id → PlanRect, recomputed each move — the group
  // counterpart to the single object's previewPlanRect.
  previewRectById?: Map<string, PlanRect>;
};

// The HTML5-drop preview for an artwork dragged in from the checklist —
// mirrors ElevationView's DropGhostState, flowing through the same
// resolvePlanPlacement call as the commit so a drop can never land where the
// ghost didn't just show.
type DropGhostState = {
  planRect: PlanRect;
  placement: PlanPlacement;
  activeGuides: Guide[];
};

// A pending marquee (rubber-band) selection on the plan background — tracked
// as two floor-mm pointer samples (start + current). Mirrors ElevationView's
// MarqueeState, but plan floor coordinates are plain SVG coordinates (y-down,
// no y-flip anywhere), so the min/max rect built from the two samples is valid
// regardless of drag direction. Same ref-based effect discipline as the drag
// states so the gesture never resubscribes mid-drag.
type MarqueeState = {
  startMm: Vector2;
  currentMm: Vector2;
};

// Min/max floor-mm rect from a marquee's two pointer samples — the shape both
// planRectIntersectsRect and the rendered <rect> consume. No y-flip: plan is
// already y-down, so the smaller sample is always the top-left.
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

// World-space (offset-applied) vertex loop for a room's polygon — shared by
// the floor fill, the floor hit target, and the selected-room outline/wash,
// so all four always trace the exact same boundary.
function roomPolygonPoints(placement: RoomPlacement): string {
  return placement.room.vertices
    .map((vertex) => `${vertex.xMm + placement.offsetXMm},${vertex.yMm + placement.offsetYMm}`)
    .join(" ");
}

export function PlanView({
  artworksById,
  draggingArtworkId = null,
  getBlob,
  gridPrecisionFloorMm,
  gridVisible,
  onCommitPlanMove,
  onCommitPlanMoveGroup,
  onCommitWallLength,
  onMoveRoom,
  onPlaceArtwork,
  onPlaceArtworkOnFloor,
  onPlaceOpeningFromPlan,
  onSelectArtwork,
  onSelectOpening,
  onSelectObject,
  onClearSelection,
  onMarqueeSelect,
  onSelectRoom,
  onSelectWall,
  project,
  selectedArtworkId,
  selectedOpeningId,
  selectedObjectIds = [],
  selectedRoomId = null,
  selectedWallId,
  snapToGrid,
  viewport,
  onViewportChange
}: {
  artworksById?: Map<string, Artwork>;
  // Which artwork the checklist is mid-drag, so a plan dragover can size its
  // ghost — HTML5 dragover can't read the payload, so App threads this the
  // same way it does for ElevationView.
  draggingArtworkId?: string | null;
  // Resolves asset blob keys for artwork tooltip thumbnails (same contract as
  // ElevationView's getBlob, but at the thumbnail tier).
  getBlob?: (key: string) => Promise<Blob>;
  gridPrecisionFloorMm: number | null;
  gridVisible: boolean;
  // THE single commit for a plan object move — handles same-wall move,
  // re-anchor, and wall↔floor conversion atomically (one undo entry).
  onCommitPlanMove?: (objectId: string, placement: PlanPlacement) => void;
  // Commits a plan group drag in ONE call: wall members carry a new wall-local
  // x (yMm omitted); floor members carry a new floor center (xMm + yMm). The
  // single-object move keeps onCommitPlanMove; this is the multi-select path.
  onCommitPlanMoveGroup?: (moves: { id: string; xMm: number; yMm?: number }[]) => void;
  onCommitWallLength: (wallId: string, lengthMm: number, anchor: ResizeAnchor) => Promise<void>;
  // Commits a room-move drag on release. Optional/inert until App wires it —
  // same "stay inert absent" convention as onCommitPlanMove above; the grip
  // still drags and previews live either way, it just never commits.
  onMoveRoom?: (roomId: string, offsetXMm: number, offsetYMm: number) => Promise<void>;
  onPlaceArtwork?: (artworkId: string, wallId: string, xMm: number, yMm: number) => void;
  onPlaceArtworkOnFloor?: (artworkId: string, xMm: number, yMm: number) => void;
  onPlaceOpeningFromPlan?: (kind: PlanTool, placement: PlanPlacement) => Promise<void>;
  onSelectArtwork?: (artworkId: string) => void;
  onSelectOpening?: (wallObjectId: string) => void;
  // Multi-select entry points. Selection ids are PLACEMENT ids (wall/floor
  // object ids), never artwork-library ids. Optional/inert until App wires
  // them — click-to-select falls back to today's onSelectArtwork/onSelectOpening
  // and a background click does nothing when these are absent.
  onSelectObject?: (id: string, opts: { additive: boolean }) => void;
  onClearSelection?: () => void;
  // A rubber-band marquee committed on release: ids are PLACEMENT ids (wall/
  // floor object ids), never artwork-library ids, and `additive` reflects a
  // held shift. Optional/inert until App wires it, exactly like onSelectObject/
  // onClearSelection above.
  onMarqueeSelect?: (ids: string[], additive: boolean) => void;
  // Click-to-select a room's floor (its interior hit polygon) — optional/
  // inert until App wires it, same convention as onSelectWall below.
  onSelectRoom?: (roomId: string) => void;
  // Click-to-select for a wall line, same contract as ElevationView's
  // onSelectWall: optional/inert until App wires it, so the wall stays
  // unclickable (today's behavior) when this prop is absent.
  onSelectWall?: (wallId: string) => void;
  project: Project;
  selectedArtworkId?: string | null;
  selectedOpeningId?: string | null;
  selectedObjectIds?: string[];
  // Which room shows its selection-scoped outline/wash/resize-handles — at
  // rest (null) the canvas shows nothing but the drawing itself.
  selectedRoomId?: string | null;
  selectedWallId: string | null;
  snapToGrid: boolean;
  // The manual/fit viewport for this surface (owned by App via useViewport2D),
  // and the setter every zoom/pan gesture routes its next viewport through.
  viewport: Viewport2D;
  onViewportChange: (v: Viewport2D) => void;
}) {
  const [containerRef, containerSize] = useContainerSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [roomDrag, setRoomDrag] = useState<RoomDragState | null>(null);
  const roomDragRef = useRef<RoomDragState | null>(null);
  // A move of an existing placed object, and the HTML5 drop preview for a
  // checklist artwork. Both flow through resolvePlanPlacement, so preview and
  // commit can never disagree.
  const [objectDrag, setObjectDrag] = useState<ObjectDragState | null>(null);
  const objectDragRef = useRef<ObjectDragState | null>(null);
  const [dropGhost, setDropGhost] = useState<DropGhostState | null>(null);
  const dropSnapTargetIdsRef = useRef<SnapTargetIds | undefined>(undefined);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);

  // Space-drag / middle-mouse pan. `isSpaceDown` drives the container cursor
  // (grab), `panning` drives it while a pan drag is live (grabbing). Both are
  // mirrored into refs so the capture-phase pointerdown and the window-level
  // pan move handlers read fresh values without resubscribing.
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
  // layered over the existing mouse/space gestures. A small explicit state
  // machine keyed off the number of tracked touch pointers:
  //   • touchPointsRef  — every live touch pointer's latest client position.
  //   • touchModeRef    — which gesture currently owns the viewport.
  //   • touchPanLastRef — last client position of a one-finger pan (deltas).
  //   • touchPinchRef   — the two pinch pointer ids + previous midpoint/spread.
  //   • touchMovedPxRef — total client-px travelled this gesture (tap vs pan).
  // `touchTracking` (state) keys the window move/up effect on/off, mirroring
  // how `panning` gates the mouse-pan effect. An object drag started by a
  // single finger owns itself (its own handlers) — touchMode stays "idle" and
  // these handlers stay out of its way.
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
  const [touchTracking, setTouchTracking] = useState(false);

  // Transient UI state, not store/view-prefs: which palette tool is armed,
  // its live ghost, and the hysteresis id threaded across pointer moves (the
  // same discipline as the wall-resize drag's previousSnapTargetId, just
  // keyed on hover instead of a pointer-capture gesture). Reset whenever the
  // tool disarms so re-arming starts clean.
  const [activeTool, setActiveTool] = useState<PlanTool | null>(null);

  // Thumbnails for placed-artwork tooltips (thumbnail tier — the plan rect is
  // too small to justify display-tier blobs the way elevation does).
  const placedArtworkAssetIds = [
    ...project.wallObjects.map((object) =>
      object.kind === "artwork" ? artworksById?.get(object.artworkId)?.assetId : undefined
    ),
    ...project.floorObjects.map((object) =>
      object.kind === "artwork" ? artworksById?.get(object.artworkId)?.assetId : undefined
    )
  ];
  const thumbnailUrlsByAssetId = useAssetImageUrls(
    placedArtworkAssetIds,
    getBlob ?? NO_OP_GET_BLOB
  );
  const [toolGhost, setToolGhost] = useState<ToolGhostState | null>(null);
  const toolSnapTargetIdsRef = useRef<SnapTargetIds | undefined>(undefined);
  // Set on pointerdown-capture when the gesture starts on a resize handle or
  // an existing plan object, so the click that follows (native click fires
  // even when the underlying pointerdown/up were consumed elsewhere) doesn't
  // also commit a placement underneath it.
  const suppressNextToolClickRef = useRef(false);

  const bounds = getFloorBounds(project.floor);
  const padding = getPlanViewPaddingMm(bounds);
  // The fit extent every gesture measures against: the padded floor bounds.
  // getViewBox2D turns the current viewport (fit or manual pan/zoom) into the
  // concrete viewBox rect + its exact pixels-per-mm, so `viewBoxBounds` below
  // is the ZOOMED window — every downstream consumer (grid, snap targets,
  // px→mm constants, guide extents) inherits the zoom automatically.
  const contentBounds = {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2
  };
  const { viewBox: viewBoxBounds, pixelsPerMm } = getViewBox2D(
    viewport,
    contentBounds,
    containerSize
  );
  const viewBox = `${viewBoxBounds.x} ${viewBoxBounds.y} ${viewBoxBounds.width} ${viewBoxBounds.height}`;
  const minorGridMm = getMinorGridIntervalMm(project.unit, pixelsPerMm, {
    // Plan reads in feet/meters: room layout is a whole-feet activity, so a
    // coarser target than the shared default keeps the plan lattice on the
    // (1ft, 5ft) / (20cm, 1m) rung at typical whole-floor zoom.
    targetMinorPx: 12,
    minIntervalMm: gridPrecisionFloorMm
  });
  const majorGridMm = getMajorGridIntervalMm(project.unit, minorGridMm);
  // Grid intervals above stay on project.unit (family-based). The resize
  // handle labels show a wall length, so they read in the wall scope's unit.
  const wallUnit = getScopeUnits(
    unitSystemFromDisplayUnit(project.unit),
    "wall"
  ).displayUnit;
  const handleSizeMm = pixelsPerMm > 0 ? SELECTED_HANDLE_PX / pixelsPerMm : 0;
  const snapThresholdMm = pixelsPerMm > 0 ? SNAP_THRESHOLD_PX / pixelsPerMm : 0;
  const gridSnapTargets = getGridSnapTargets(minorGridMm, {
    minXMm: viewBoxBounds.x,
    maxXMm: viewBoxBounds.x + viewBoxBounds.width,
    minYMm: viewBoxBounds.y,
    maxYMm: viewBoxBounds.y + viewBoxBounds.height
  });

  const resizePreviewProject =
    drag !== null
      ? resizeWallPreservingAngles(project, drag.targetWallId, drag.previewLengthMm, drag.anchor)
          .project
      : project;
  // A room-move drag overrides its placement's offset directly — no domain
  // helper needed (unlike the wall resize above, a translation doesn't touch
  // any other room's geometry) — layered on top of the resize preview so the
  // two gestures never fight, even though only one can be in flight at once.
  const displayedProject = roomDrag
    ? {
        ...resizePreviewProject,
        floor: {
          rooms: resizePreviewProject.floor.rooms.map((candidate) =>
            candidate.roomId === roomDrag.roomId
              ? {
                  ...candidate,
                  offsetXMm: roomDrag.previewOffsetMm.xMm,
                  offsetYMm: roomDrag.previewOffsetMm.yMm
                }
              : candidate
          )
        }
      }
    : resizePreviewProject;

  // Shared by the wall-resize drag effect below and the palette-tool pointer
  // handlers — both need the same client-px → viewBox-mm conversion.
  function toSvgMm(clientX: number, clientY: number): Vector2 | null {
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
  // point, since there's no cursor to anchor on for a button press.
  function zoomAtCenter(factor: number) {
    onViewportChange(
      zoomAtPoint(
        viewport,
        { xMm: viewBoxBounds.x + viewBoxBounds.width / 2, yMm: viewBoxBounds.y + viewBoxBounds.height / 2 },
        factor,
        contentBounds,
        containerSize,
        PLAN_ZOOM_LIMITS
      )
    );
  }

  // Wheel = zoom (ctrl/⌘ or trackpad pinch) or pan (plain / shift-horizontal).
  // Reassigned every render so it always sees the latest viewport/bounds;
  // registered once as a NON-passive native listener (React's onWheel can be
  // passive, which would make preventDefault a no-op) in the effect below.
  const wheelHandlerRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelHandlerRef.current = (e: WheelEvent) => {
    e.preventDefault();
    // Line-mode wheels (deltaMode 1) report in lines, not pixels — scale up so
    // one detent moves a comparable amount to a pixel-mode wheel.
    const norm = (d: number) => (e.deltaMode === 1 ? d * 16 : d);
    if (e.ctrlKey || e.metaKey) {
      // ctrlKey===true is also how a trackpad pinch arrives in Chrome/Firefox/
      // Safari — same code path, anchored on the cursor's world point.
      const point = toSvgMm(e.clientX, e.clientY);
      if (!point) return;
      const factor = Math.min(2, Math.max(0.5, Math.exp(-norm(e.deltaY) * WHEEL_ZOOM_SENSITIVITY)));
      onViewportChange(
        zoomAtPoint(viewportRef.current, point, factor, contentBounds, containerSize, PLAN_ZOOM_LIMITS)
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
  // ⌘0 / Ctrl+0 = reset to fit. Window-scoped, mirroring PlanView's other
  // window listeners; skips edit fields so typing a literal "0" or space in an
  // input is never hijacked.
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
  // mid-gesture (no commit, no resize while a button is held).
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
      // A left-button (space) pan fires a trailing `click` on the svg just like
      // a marquee does; without this, handleSvgClick's no-tool branch would
      // read it as a background click and clear the selection. Same suppress
      // flag + setTimeout safety net the marquee uses. (Middle-button pan fires
      // auxclick, not click, so this is harmless there.)
      suppressNextToolClickRef.current = true;
      window.setTimeout(() => {
        suppressNextToolClickRef.current = false;
      }, 0);
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
    touchPinchRef.current = {
      idA,
      idB,
      prevMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      prevDist: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 0)
    };
  }

  // Begin a one-finger canvas pan (touch only). Called from the svg's
  // bubble-phase pointerdown, which only fires for a press on true background
  // (an object's pointerdown stopPropagation keeps it from reaching here — that
  // touch stays an object drag instead).
  function beginTouchPan(clientX: number, clientY: number) {
    touchModeRef.current = "pan";
    touchPanLastRef.current = { x: clientX, y: clientY };
  }

  // Touch move/up/cancel/blur, subscribed once while ≥1 touch is tracked
  // (keyed on `touchTracking`), reading live state via the touch refs — the
  // same discipline the mouse-pan effect uses. viewport is read fresh via
  // viewportRef; contentBounds/containerSize are captured by closure and can't
  // change mid-gesture (no commit, no resize while fingers are down).
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
          // World point under the PREVIOUS midpoint, via the live CTM (same
          // anchor discipline the wheel-zoom handler uses).
          const prevMidWorld = toSvgMm(pinch.prevMid.x, pinch.prevMid.y);
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
                PLAN_ZOOM_LIMITS
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
        // Whole gesture over. A real pan/pinch arms the same trailing-click
        // suppression the space-pan and marquee paths use so the click doesn't
        // clear the selection or place a tool; a stationary tap leaves it be so
        // the native click still selects/places/clears exactly as today.
        if (touchMovedPxRef.current > TOUCH_TAP_SLOP_PX) {
          suppressNextToolClickRef.current = true;
          window.setTimeout(() => {
            suppressNextToolClickRef.current = false;
          }, 0);
        }
        touchMovedPxRef.current = 0;
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
  }, [touchTracking, onViewportChange]);

  // Only the committed project's walls matter for tool placement — a tool
  // can't be armed mid wall-resize-drag anyway (see the drag guard in the
  // pointer/click handlers below), so there's no live-preview geometry to
  // reconcile here the way displayedProject does for rendering.
  const floorWallsForTool = useMemo(() => getFloorWalls(project.floor), [project.floor]);

  const movingSize = useMemo(() => {
    if (!activeTool) return null;
    const { widthMm, heightMm } = getDefaultOpeningSizeMm(activeTool);
    const depthMm =
      activeTool === "blocked-zone" ? DEFAULT_FLOOR_OBJECT_DEPTH_MM : WALL_OBJECT_PLAN_DEPTH_MM;
    return { widthMm, heightMm, depthMm };
  }, [activeTool]);

  const captureDistanceMm = pixelsPerMm > 0 ? WALL_CAPTURE_PX / pixelsPerMm : 0;
  const wallObjectMinDepthMm =
    pixelsPerMm > 0 ? MIN_WALL_OBJECT_DEPTH_PX / pixelsPerMm : 0;
  const objectHitMinMm = pixelsPerMm > 0 ? MIN_OBJECT_HIT_PX / pixelsPerMm : 0;

  function disarmTool() {
    setActiveTool(null);
    setToolGhost(null);
    toolSnapTargetIdsRef.current = undefined;
  }

  function handleToolChange(tool: PlanTool | null) {
    setActiveTool(tool);
    setToolGhost(null);
    toolSnapTargetIdsRef.current = undefined;
  }

  useEffect(() => {
    if (!activeTool) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") disarmTool();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // Scoped to only listen while a tool is armed, so it never competes with
    // App.tsx's global undo/redo keydown handler (that one is gated on
    // Cmd/Ctrl, this one on Escape — but no sense listening when there's
    // nothing to cancel).
  }, [activeTool]);

  function handleToolPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!activeTool || !movingSize || drag || roomDrag) return;

    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    const result = resolvePlanPlacement(pointerMm, {
      walls: floorWallsForTool,
      wallObjects: project.wallObjects,
      movingSize,
      movingKind: activeTool,
      canFloat: activeTool === "blocked-zone",
      currentAnchorWallId: null,
      captureDistanceMm,
      gridTargets: gridSnapTargets,
      snapToGrid,
      thresholdMm: snapThresholdMm,
      previousSnapTargetIds: toolSnapTargetIdsRef.current
    });

    toolSnapTargetIdsRef.current = result.snapTargetIds;
    setToolGhost({
      planRect: result.planRect,
      placement: result.placement,
      activeGuides: result.activeGuides
    });
  }

  function handleToolPointerLeave() {
    setToolGhost(null);
  }

  // A resize handle's pointerdown stops its own propagation (so it doesn't
  // also start a room-resize's sibling behavior), but the native `click`
  // that follows a pointerdown/pointerup pair still fires on — and bubbles
  // from — that same element regardless. Marking the gesture here in the
  // capture phase (before any handler's stopPropagation can run) lets the
  // click handler below recognize "this click started on something else"
  // and skip placing, without needing RoomResizeHandles/PlanObject to know
  // anything about the plan-view tool.
  function handleSvgPointerDownCapture(event: ReactPointerEvent<SVGSVGElement>) {
    // Touch pointers feed the pinch/pan state machine. This capture-phase
    // handler always fires first (before any object's own pointerdown), so
    // every touch is recorded here regardless of what it lands on. The 2nd
    // finger claims the gesture as a pinch (unless an object drag is already in
    // flight, in which case we defer to that edit and just block the finger),
    // stopping propagation so no object under it starts its own drag.
    if (event.pointerType === "touch") {
      const points = touchPointsRef.current;
      const isFirst = points.size === 0;
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (isFirst) touchMovedPxRef.current = 0;
      setTouchTracking(true);
      if (points.size === 2) {
        event.preventDefault();
        event.stopPropagation();
        // Defer to ANY in-flight single-finger edit (wall resize, room move, or
        // object/group move) — don't pinch over it, just block the 2nd finger.
        if (!dragRef.current && !roomDragRef.current && !objectDragRef.current) {
          beginPinch();
        }
        return;
      }
      if (points.size >= 3) return; // ignore 3rd+ touches
      // A single touch: fall through so a press on an object still arms
      // suppressNextToolClickRef (the object-tap path), exactly like a mouse
      // press. Whether it becomes a pan is decided in beginMarquee (bubble).
    }

    // Space-held (left button) or middle-mouse press = pan, intercepted in the
    // capture phase BEFORE any gesture (marquee, room/object/handle drag,
    // click-to-place) can claim it. Guarded on `spaceHeldRef || button === 1`
    // so an ordinary left press with space up flows through untouched — every
    // existing gesture behaves exactly as before. Right-click (button 2) is
    // never intercepted. stopPropagation/preventDefault keep the marquee's own
    // pointerdown from also firing and kill middle-click autoscroll.
    if (spaceHeldRef.current || event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      panningRef.current = true;
      panLastRef.current = { x: event.clientX, y: event.clientY };
      setPanning(true);
      return;
    }

    const target = event.target as Element | null;
    // The ghost itself carries the `.plan-object` class too (so it shares
    // PlanObject's rendering), and it sits directly under the pointer at the
    // moment of a placement click — excluding `.is-ghost` here is what lets
    // that click through to actually commit instead of being mistaken for a
    // click on a real, already-placed object.
    //
    // Assigned (not just set) so the flag is per-gesture: an object's own
    // click stops propagation, so a flag set by an object press was never
    // consumed by handleSvgClick and would silently swallow the NEXT svg
    // click — a placement, a wall select, or a background clear. Recomputing
    // here clears that stale state at the start of every gesture. The one
    // setter that runs AFTER pointerdown — the marquee's pointerup — is safe:
    // its trailing click arrives before any next pointerdown could reset this.
    // .room-hit is deliberately absent here: an unselected room's hit
    // polygon must NOT stopPropagation on pointerdown (a drag over it has to
    // still start the marquee — see the room-hit rendering below), so
    // marking it here would suppress the click that's supposed to select the
    // room. The selected room's hit polygon DOES stopPropagation (it starts
    // a room-move drag instead), but its trailing click merely re-selects
    // the same already-selected room — a harmless no-op, the same precedent
    // PlanObject's own drag-then-click re-select relies on.
    suppressNextToolClickRef.current = Boolean(
      target?.closest(".resize-handle, .plan-object:not(.is-ghost)")
    );
  }

  function handleSvgClick(event: ReactMouseEvent<SVGSVGElement>) {
    if (suppressNextToolClickRef.current) {
      suppressNextToolClickRef.current = false;
      return;
    }
    if (drag) return;
    // A background click with no tool armed clears the current selection (the
    // plan counterpart to elevation's marquee click-clear). Object clicks never
    // reach here — PlanObject stops propagation, and the capture-phase suppress
    // catches a click that merely started on an object but landed elsewhere.
    if (!activeTool) {
      onClearSelection?.();
      return;
    }
    if (!movingSize || !onPlaceOpeningFromPlan) return;

    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    const result = resolvePlanPlacement(pointerMm, {
      walls: floorWallsForTool,
      wallObjects: project.wallObjects,
      movingSize,
      movingKind: activeTool,
      canFloat: activeTool === "blocked-zone",
      currentAnchorWallId: null,
      captureDistanceMm,
      gridTargets: gridSnapTargets,
      snapToGrid,
      thresholdMm: snapThresholdMm,
      previousSnapTargetIds: toolSnapTargetIdsRef.current
    });

    const kind = activeTool;
    // Single-shot: disarm immediately so the tool never lingers armed after
    // a placement, matching WallInspector's "Add to this wall" buttons
    // (one click, one object) rather than a rubber-stamp mode.
    disarmTool();
    void onPlaceOpeningFromPlan(kind, result.placement);
  }

  useEffect(() => {
    if (!drag) return;

    function onPointerMove(event: PointerEvent) {
      const current = dragRef.current;
      if (!current) return;

      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return;

      // Snap the wall's moving edge, not the raw pointer — the handle can be
      // grabbed anywhere within its 16px hit target, and that grab offset
      // must not leak into the committed length even when the pointer lands
      // exactly on a grid line.
      const proposedEdgeMm = proposeMovingEdgePointMm(
        current.edgeStartMm,
        current.startPointerMm,
        pointerMm
      );

      // A handle only ever moves along its target wall's own axis, so only
      // grid lines perpendicular to that axis are relevant — snapping the
      // other coordinate would be meaningless for this drag and could
      // trigger on incidental hand-tremor alignment.
      let snappedEdgeMm = proposedEdgeMm;
      let snapTargetId: string | undefined;
      let activeGuides: Guide[] = [];

      if (snapToGrid) {
        const isXAxis = Math.abs(current.axis.xMm) >= Math.abs(current.axis.yMm);
        const dragAxis = isXAxis ? "x" : "y";
        const relevantTargets: SnapTarget[] = gridSnapTargets.filter(
          (target) => target.axis === dragAxis
        );
        const snapResult = resolveSnap(proposedEdgeMm, relevantTargets, {
          thresholdMm: snapThresholdMm,
          // Single-axis drag: the remembered id lives in the drag axis's
          // slot of the per-axis hysteresis map.
          previousSnapTargetIds:
            dragAxis === "x"
              ? { x: current.previousSnapTargetId }
              : { y: current.previousSnapTargetId }
        });

        snappedEdgeMm = snapResult.point;
        snapTargetId = snapResult.snapTargetIds[dragAxis];
        activeGuides = snapResult.activeGuides;
      }

      const previewLengthMm = computeEdgeSnappedLengthMm(
        current.startLengthMm,
        current.edgeStartMm,
        snappedEdgeMm,
        current.axis,
        current.anchor
      );

      setDrag((state) =>
        state
          ? { ...state, previewLengthMm, previousSnapTargetId: snapTargetId, activeGuides }
          : state
      );
    }

    function onPointerUp() {
      const current = dragRef.current;
      setDrag(null);
      if (!current) return;

      if (Math.abs(current.previewLengthMm - current.startLengthMm) < 0.5) return;
      void onCommitWallLength(current.targetWallId, current.previewLengthMm, current.anchor);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
    // Subscribed once per drag gesture (keyed on whether a drag is active,
    // not on every in-flight preview update) — onPointerMove/onPointerUp
    // read the latest state via dragRef rather than closing over `drag`.
    // gridSnapTargets/snapToGrid/snapThresholdMm are captured by closure
    // here too: they derive from the committed project's bounds and grid
    // interval, which can't change mid-drag (the live preview never
    // rewrites viewBoxBounds), so they're safe to leave out of the deps
    // rather than resubscribing on every render.
  }, [drag !== null, onCommitWallLength]);

  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  function beginDrag(
    roomId: string,
    target: ResizeHandleTarget,
    event: ReactPointerEvent<SVGRectElement>
  ) {
    const svg = svgRef.current;
    if (!svg) return;

    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;

    const startPointerMm = point.matrixTransform(ctm.inverse());

    setDrag({
      roomId,
      targetWallId: target.targetWallId,
      axis: target.axis,
      anchor: target.anchor,
      startLengthMm: target.startLengthMm,
      startPointerMm: { xMm: startPointerMm.x, yMm: startPointerMm.y },
      edgeStartMm: getMovingWallEdgeWorldPointMm(project, target.targetWallId, target.anchor),
      previewLengthMm: target.startLengthMm,
      previousSnapTargetId: undefined,
      activeGuides: []
    });
  }

  useEffect(() => {
    if (!roomDrag) return;

    function onPointerMove(event: PointerEvent) {
      const current = roomDragRef.current;
      if (!current) return;

      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return;

      const deltaMm: Vector2 = {
        xMm: pointerMm.xMm - current.startPointerMm.xMm,
        yMm: pointerMm.yMm - current.startPointerMm.yMm
      };
      const proposedMinCornerMm: Vector2 = {
        xMm: current.startMinCornerMm.xMm + deltaMm.xMm,
        yMm: current.startMinCornerMm.yMm + deltaMm.yMm
      };

      let snappedMinCornerMm = proposedMinCornerMm;
      let snapTargetIds = current.previousSnapTargetIds;
      let activeGuides: Guide[] = [];
      if (snapToGrid) {
        // gridSnapTargets are already all kind:"grid" — resolveSnap resolves
        // both axes independently against them in one call, the same idiom
        // objectDrag's group-drag branch uses for its box-center snap.
        const snap = resolveSnap(proposedMinCornerMm, gridSnapTargets, {
          thresholdMm: snapThresholdMm,
          previousSnapTargetIds: current.previousSnapTargetIds
        });
        snappedMinCornerMm = snap.point;
        snapTargetIds = snap.snapTargetIds;
        activeGuides = snap.activeGuides;
      }

      const cornerDeltaMm: Vector2 = {
        xMm: snappedMinCornerMm.xMm - current.startMinCornerMm.xMm,
        yMm: snappedMinCornerMm.yMm - current.startMinCornerMm.yMm
      };

      setRoomDrag((state) =>
        state
          ? {
              ...state,
              previewOffsetMm: {
                xMm: current.startOffsetMm.xMm + cornerDeltaMm.xMm,
                yMm: current.startOffsetMm.yMm + cornerDeltaMm.yMm
              },
              previousSnapTargetIds: snapTargetIds,
              activeGuides
            }
          : state
      );
    }

    function onPointerUp() {
      const current = roomDragRef.current;
      setRoomDrag(null);
      if (!current) return;

      // Sub-threshold release is a click, not a move — must not commit (and
      // so land a phantom undo entry), same guard as the object/group drags.
      const movedMm = Math.hypot(
        current.previewOffsetMm.xMm - current.startOffsetMm.xMm,
        current.previewOffsetMm.yMm - current.startOffsetMm.yMm
      );
      if (movedMm < 0.5) return;

      void onMoveRoom?.(current.roomId, current.previewOffsetMm.xMm, current.previewOffsetMm.yMm);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
    // Same ref-based discipline as the wall-resize drag effect above:
    // subscribed once per gesture, reading live state via roomDragRef rather
    // than closing over `roomDrag`. gridSnapTargets/snapToGrid/snapThresholdMm
    // derive from the committed project/viewport and can't change mid-drag,
    // so they're intentionally left out of the deps.
  }, [roomDrag !== null, onMoveRoom]);

  useEffect(() => {
    roomDragRef.current = roomDrag;
  }, [roomDrag]);

  function beginRoomDrag(roomId: string, event: ReactPointerEvent<SVGPolygonElement>) {
    const placement = project.floor.rooms.find((candidate) => candidate.roomId === roomId);
    if (!placement) return;

    const startPointerMm = toSvgMm(event.clientX, event.clientY);
    if (!startPointerMm) return;

    const bounds = getRoomBounds(placement.room);
    const startOffsetMm: Vector2 = { xMm: placement.offsetXMm, yMm: placement.offsetYMm };

    setRoomDrag({
      roomId,
      startPointerMm,
      startOffsetMm,
      startMinCornerMm: {
        xMm: bounds.minX + startOffsetMm.xMm,
        yMm: bounds.minY + startOffsetMm.yMm
      },
      previewOffsetMm: startOffsetMm,
      previousSnapTargetIds: undefined,
      activeGuides: []
    });
  }

  useEffect(() => {
    if (!objectDrag) return;

    function onPointerMove(event: PointerEvent) {
      const current = objectDragRef.current;
      if (!current) return;

      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return;

      // Group drag: rigid translation, no per-object re-anchoring. Snap the
      // whole group's box center to the grid (grid tier only), then apply the
      // snapped delta to every member — wall members reproject onto their own
      // wall, floor members translate.
      if (current.members && current.startGroupCenterMm) {
        const rawDeltaMm: Vector2 = {
          xMm: pointerMm.xMm - current.startPointerMm.xMm,
          yMm: pointerMm.yMm - current.startPointerMm.yMm
        };
        const proposedGroupCenterMm: Vector2 = {
          xMm: current.startGroupCenterMm.xMm + rawDeltaMm.xMm,
          yMm: current.startGroupCenterMm.yMm + rawDeltaMm.yMm
        };

        let snappedGroupCenterMm = proposedGroupCenterMm;
        let snapTargetIds = current.previousSnapTargetIds;
        let activeGuides: Guide[] = [];
        if (snapToGrid) {
          // gridSnapTargets are already all kind:"grid" — no filtering needed.
          const snap = resolveSnap(proposedGroupCenterMm, gridSnapTargets, {
            thresholdMm: snapThresholdMm,
            previousSnapTargetIds: current.previousSnapTargetIds
          });
          snappedGroupCenterMm = snap.point;
          snapTargetIds = snap.snapTargetIds;
          activeGuides = snap.activeGuides;
        }

        const deltaMm: Vector2 = {
          xMm: snappedGroupCenterMm.xMm - current.startGroupCenterMm.xMm,
          yMm: snappedGroupCenterMm.yMm - current.startGroupCenterMm.yMm
        };
        const previewRectById = new Map<string, PlanRect>(
          current.members.map((member) => [
            member.id,
            resolvePlanGroupMemberMove(member, deltaMm).rect
          ])
        );

        setObjectDrag((state) =>
          state
            ? {
                ...state,
                previewGroupCenterMm: snappedGroupCenterMm,
                previewRectById,
                previousSnapTargetIds: snapTargetIds,
                activeGuides
              }
            : state
        );
        return;
      }

      // Move the object's own center by the pointer delta, not the raw pointer
      // — wherever inside the object the user grabbed must not leak into the
      // committed center.
      const proposedCenterMm: Vector2 = {
        xMm: current.startCenterMm.xMm + (pointerMm.xMm - current.startPointerMm.xMm),
        yMm: current.startCenterMm.yMm + (pointerMm.yMm - current.startPointerMm.yMm)
      };

      const result = resolvePlanPlacement(proposedCenterMm, {
        walls: floorWallsForTool,
        // Exclude the moving object so it never snaps to its own old position.
        wallObjects: project.wallObjects.filter((object) => object.id !== current.objectId),
        movingSize: current.movingSize,
        movingKind: current.kind,
        canFloat: current.canFloat,
        // Live preview's current wall, so hysteresis tracks the drag.
        currentAnchorWallId: current.currentAnchorWallId,
        captureDistanceMm,
        gridTargets: gridSnapTargets,
        snapToGrid,
        thresholdMm: snapThresholdMm,
        previousSnapTargetIds: current.previousSnapTargetIds,
        rotationDeg: current.rotationDeg
      });

      setObjectDrag((state) =>
        state
          ? {
              ...state,
              previewPlanRect: result.planRect,
              previewPlacement: result.placement,
              currentAnchorWallId:
                result.placement.anchor === "wall" ? result.placement.wallId : null,
              previousSnapTargetIds: result.snapTargetIds,
              activeGuides: result.activeGuides
            }
          : state
      );
    }

    function onPointerUp() {
      const current = objectDragRef.current;
      setObjectDrag(null);
      if (!current) return;

      // Group drag: sub-threshold release is a click (no commit, no phantom
      // undo); else one commit carrying every member's translated result.
      if (current.members && current.startGroupCenterMm && current.previewGroupCenterMm) {
        const deltaMm: Vector2 = {
          xMm: current.previewGroupCenterMm.xMm - current.startGroupCenterMm.xMm,
          yMm: current.previewGroupCenterMm.yMm - current.startGroupCenterMm.yMm
        };
        if (Math.hypot(deltaMm.xMm, deltaMm.yMm) < 0.5) return;

        // Whether or not the commit survives the collision gate, the click
        // that trails the release must not collapse the multi-selection to
        // the one grabbed member (see suppressNextSelect).
        suppressNextSelect();
        const moves = current.members.map(
          (member) => resolvePlanGroupMemberMove(member, deltaMm).commit
        );
        onCommitPlanMoveGroup?.(moves);
        return;
      }

      // Sub-threshold release is a click, not a move — it must not commit (and
      // so land a phantom undo entry); the object's onClick still selects it.
      const movedMm = Math.hypot(
        current.previewPlanRect.centerXMm - current.startCenterMm.xMm,
        current.previewPlanRect.centerYMm - current.startCenterMm.yMm
      );
      if (movedMm < 0.5) return;

      onCommitPlanMove?.(current.objectId, current.previewPlacement);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
    // Subscribed once per gesture (keyed on whether a drag is active), reading
    // live state via objectDragRef rather than closing over `objectDrag` —
    // same discipline as the wall-resize drag effect above.
    // floorWallsForTool/project.wallObjects/gridSnapTargets/snapToGrid/
    // snapThresholdMm/captureDistanceMm derive from the committed project and
    // viewport, which can't change mid-drag (nothing commits until release),
    // so they're intentionally left out of the deps.
  }, [objectDrag !== null, onCommitPlanMove, onCommitPlanMoveGroup]);

  useEffect(() => {
    objectDragRef.current = objectDrag;
  }, [objectDrag]);

  // The browser fires a `click` on the grabbed element right after a drag's
  // pointerup. For a single object that click merely re-selects it (today's
  // behavior, harmless); after a real GROUP drag the same click would call
  // onSelectObject non-additively and collapse the whole multi-selection to
  // the one grabbed member — so the release marks the very next select to be
  // swallowed. Cleared on a timeout too, in case the release lands where no
  // click follows. Same idiom as ElevationView's.
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

  // Placement ids whose (possibly rotated) plan rects intersect the marquee.
  // The committed project is correct here — no drag can be in flight during a
  // marquee (beginMarquee bails when one is). Wall objects need their FloorWall
  // for the wall-line projection (objects whose wall vanished drop out, same as
  // beginObjectDrag); floor objects carry their own center/rotation.
  function idsIntersectingMarquee(marqueeRect: {
    minXMm: number;
    maxXMm: number;
    minYMm: number;
    maxYMm: number;
  }): string[] {
    const wallsById = new Map(floorWallsForTool.map((wall) => [wall.id, wall]));
    const ids: string[] = [];

    // Deliberately viewport-dependent: this must capture the same on-screen
    // extent the object is rendered with, including the min-depth clamp, or a
    // marquee could visibly enclose an object without selecting it.
    const effectiveWallObjectDepthMm = Math.max(WALL_OBJECT_PLAN_DEPTH_MM, wallObjectMinDepthMm);
    for (const object of project.wallObjects) {
      const wall = wallsById.get(object.wallId);
      if (!wall) continue;
      if (
        planRectIntersectsRect(
          getWallObjectPlanRect(wall, object, effectiveWallObjectDepthMm),
          marqueeRect
        )
      ) {
        ids.push(object.id);
      }
    }
    for (const object of project.floorObjects) {
      if (planRectIntersectsRect(getFloorObjectPlanRect(object), marqueeRect)) {
        ids.push(object.id);
      }
    }

    return ids;
  }

  useEffect(() => {
    if (!marquee) return;

    function onPointerMove(event: PointerEvent) {
      const current = marqueeRef.current;
      if (!current) return;

      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return;

      setMarquee((state) => (state ? { ...state, currentMm: pointerMm } : state));
    }

    function onPointerUp(event: PointerEvent) {
      const current = marqueeRef.current;
      setMarquee(null);
      if (!current) return;

      const rect = marqueeRectMm(current);
      // A sub-threshold rect is a plain background click, not a drag. Unlike
      // elevation (which clears the selection here), PlanView must do NOTHING:
      // the browser fires a `click` on the svg right after this pointerup, and
      // handleSvgClick's no-tool branch already calls onClearSelection for that
      // background click — clearing here too would be redundant.
      const draggedMm = Math.hypot(rect.maxXMm - rect.minXMm, rect.maxYMm - rect.minYMm);
      if (draggedMm < snapThresholdMm) return;

      // A real marquee. CRITICALLY suppress the trailing background click: the
      // browser fires `click` on the svg right after pointerup, and handleSvg-
      // Click's no-tool branch calls onClearSelection — which would instantly
      // wipe the selection this marquee just made. suppressNextToolClickRef is
      // the same flag handleSvgClick already consumes for placement clicks; the
      // window.setTimeout(..., 0) is the safety net for a release that lands
      // where no click follows (pointer left the svg mid-drag), same idiom as
      // suppressNextSelect.
      suppressNextToolClickRef.current = true;
      window.setTimeout(() => {
        suppressNextToolClickRef.current = false;
      }, 0);
      onMarqueeSelect?.(idsIntersectingMarquee(rect), event.shiftKey);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
    // Same ref-based discipline as the drag effects above: subscribed once per
    // gesture, reading the live rect via marqueeRef. snapThresholdMm and the
    // committed project geometry idsIntersectingMarquee reads derive from the
    // committed project/viewport and can't change mid-gesture, so they're
    // intentionally out of the deps.
  }, [marquee !== null, onMarqueeSelect]);

  useEffect(() => {
    marqueeRef.current = marquee;
  }, [marquee]);

  function beginMarquee(event: ReactPointerEvent<SVGSVGElement>) {
    // Touch: a single finger on true background pans the canvas instead of
    // marqueeing (the marquee is a mouse-only gesture on tablets). Only the
    // sole tracked touch starts a pan — a pinch's touches were already claimed
    // in the capture handler. Returns unconditionally for touch so a finger
    // never falls through into the marquee path below.
    if (event.pointerType === "touch") {
      if (touchPointsRef.current.size === 1 && touchModeRef.current !== "pinch") {
        beginTouchPan(event.clientX, event.clientY);
      }
      return;
    }

    // Only true background reaches here: PlanObject and the resize handles
    // stopPropagation in their own pointerdown. (This is a separate mechanism
    // from onPointerDownCapture, which fires in the capture phase to flag a
    // click as started-on-an-object — that handler stays untouched.)
    //
    // Bail when a tool is armed: a marquee drag would fight click-to-place.
    // Stay inert until App wires the multi-select handlers (same gate as
    // elevation). Never start over an in-flight gesture.
    if (activeTool) return;
    if (!onMarqueeSelect && !onClearSelection) return;
    if (drag || objectDrag || dropGhost || roomDrag) return;

    const startMm = toSvgMm(event.clientX, event.clientY);
    if (!startMm) return;

    // Suppress the browser's default press-drag semantics for this gesture:
    // without this, dragging across the svg selects its text nodes (the
    // <title>), and the NEXT marquee that starts inside that stale selection
    // becomes a native drag of the selected text — Chrome then fires
    // pointercancel and kills the gesture mid-flight.
    event.preventDefault();
    setMarquee({ startMm, currentMm: startMm });
  }

  function beginObjectDrag(
    params: {
      objectId: string;
      kind: WallObject["kind"];
      startCenterMm: Vector2;
      movingSize: { widthMm: number; heightMm: number; depthMm: number };
      rotationDeg: number;
      currentPlacement: PlanPlacement;
      initialPlanRect: PlanRect;
    },
    event: ReactPointerEvent<SVGGElement>
  ) {
    const startPointerMm = toSvgMm(event.clientX, event.clientY);
    if (!startPointerMm) return;

    // Group drag: the pressed object is part of a multi-selection. Resolve live
    // members from BOTH wall objects (world center via getWallObjectPlanRect —
    // stale ids or objects whose wall vanished drop out) and floor objects.
    if (selectedObjectIds.includes(params.objectId) && selectedObjectIds.length > 1) {
      const wallsById = new Map(floorWallsForTool.map((wall) => [wall.id, wall]));
      const members: PlanGroupMember[] = [];

      for (const object of project.wallObjects) {
        if (!selectedObjectIds.includes(object.id)) continue;
        const wall = wallsById.get(object.wallId);
        if (!wall) continue;
        const rest = getWallObjectPlanRect(wall, object);
        members.push({
          id: object.id,
          anchor: "wall",
          wall,
          worldCenterMm: { xMm: rest.centerXMm, yMm: rest.centerYMm },
          widthMm: object.widthMm,
          depthMm: WALL_OBJECT_PLAN_DEPTH_MM
        });
      }
      for (const object of project.floorObjects) {
        if (!selectedObjectIds.includes(object.id)) continue;
        members.push({
          id: object.id,
          anchor: "floor",
          centerMm: { xMm: object.xMm, yMm: object.yMm },
          widthMm: object.widthMm,
          depthMm: object.depthMm,
          rotationDeg: object.rotationDeg
        });
      }

      if (members.length > 1) {
        const groupCenterMm = getPlanGroupCenterMm(members);
        const previewRectById = new Map<string, PlanRect>(
          members.map((member) => [
            member.id,
            resolvePlanGroupMemberMove(member, { xMm: 0, yMm: 0 }).rect
          ])
        );
        setObjectDrag({
          objectId: params.objectId,
          kind: params.kind,
          canFloat: params.kind === "artwork" || params.kind === "blocked-zone",
          movingSize: params.movingSize,
          rotationDeg: params.rotationDeg,
          startPointerMm,
          startCenterMm: params.startCenterMm,
          currentAnchorWallId: null,
          previewPlanRect: params.initialPlanRect,
          previewPlacement: params.currentPlacement,
          previousSnapTargetIds: undefined,
          activeGuides: [],
          members,
          startGroupCenterMm: groupCenterMm,
          previewGroupCenterMm: groupCenterMm,
          previewRectById
        });
        return;
      }
    }

    setObjectDrag({
      objectId: params.objectId,
      kind: params.kind,
      canFloat: params.kind === "artwork" || params.kind === "blocked-zone",
      movingSize: params.movingSize,
      rotationDeg: params.rotationDeg,
      startPointerMm,
      startCenterMm: params.startCenterMm,
      currentAnchorWallId:
        params.currentPlacement.anchor === "wall" ? params.currentPlacement.wallId : null,
      previewPlanRect: params.initialPlanRect,
      previewPlacement: params.currentPlacement,
      previousSnapTargetIds: undefined,
      activeGuides: []
    });
  }

  // The effective footprint of an artwork being dragged from the checklist:
  // its real size if we know which one (draggingArtworkId), otherwise the same
  // placeholder placement itself falls back to. depthMm feeds a floor-drop
  // preview; it's ignored for a wall drop.
  function effectiveArtworkDims(artworkId: string | null): {
    widthMm: number;
    heightMm: number;
    depthMm: number;
  } {
    const artwork = artworkId ? artworksById?.get(artworkId) : undefined;
    if (artwork) {
      const { widthMm, heightMm } = getEffectivePlacementSizeMm(artwork.dimensions);
      return {
        widthMm,
        heightMm,
        depthMm: artwork.dimensions.depthMm ?? DEFAULT_FLOOR_OBJECT_DEPTH_MM
      };
    }
    return {
      widthMm: PLACEHOLDER_ARTWORK_WIDTH_MM,
      heightMm: PLACEHOLDER_ARTWORK_HEIGHT_MM,
      depthMm: DEFAULT_FLOOR_OBJECT_DEPTH_MM
    };
  }

  function resolveArtworkDrop(pointerMm: Vector2, dims: ReturnType<typeof effectiveArtworkDims>) {
    return resolvePlanPlacement(pointerMm, {
      walls: floorWallsForTool,
      wallObjects: project.wallObjects,
      movingSize: dims,
      movingKind: "artwork",
      canFloat: true,
      currentAnchorWallId: null,
      captureDistanceMm,
      gridTargets: gridSnapTargets,
      snapToGrid,
      thresholdMm: snapThresholdMm,
      previousSnapTargetIds: dropSnapTargetIdsRef.current
    });
  }

  function handleArtworkDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes(ARTWORK_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";

    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    const result = resolveArtworkDrop(pointerMm, effectiveArtworkDims(draggingArtworkId));
    dropSnapTargetIdsRef.current = result.snapTargetIds;
    setDropGhost({
      planRect: result.planRect,
      placement: result.placement,
      activeGuides: result.activeGuides
    });
  }

  function handleArtworkDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    // Only clear when the pointer actually leaves the surface, not when it
    // crosses between child elements (which also fire dragleave).
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropGhost(null);
    dropSnapTargetIdsRef.current = undefined;
  }

  function handleArtworkDrop(event: ReactDragEvent<HTMLDivElement>) {
    const artworkId = event.dataTransfer.getData(ARTWORK_DRAG_MIME);
    setDropGhost(null);
    dropSnapTargetIdsRef.current = undefined;
    if (!artworkId) return;
    event.preventDefault();

    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    const placement = resolveArtworkDrop(pointerMm, effectiveArtworkDims(artworkId)).placement;
    if (placement.anchor === "wall") {
      const wall = floorWallsForTool.find((candidate) => candidate.id === placement.wallId);
      // A wall-dropped artwork hangs at the wall's centerline (its own default,
      // or the project default) — plan view chooses no y itself.
      const yMm = wall?.defaultCenterlineHeightMm ?? project.defaultCenterlineHeightMm;
      onPlaceArtwork?.(artworkId, placement.wallId, placement.xMm, yMm);
    } else {
      onPlaceArtworkOnFloor?.(artworkId, placement.xMm, placement.yMm);
    }
  }

  // Pan cursor affordance: grabbing while a pan drag is live, grab while space
  // is merely held ready. Otherwise the surface keeps its default/tool cursor.
  const surfaceClassName = panning
    ? "drawing-surface is-panning"
    : isSpaceDown
      ? "drawing-surface is-pan-ready"
      : "drawing-surface";

  return (
    <div
      className={surfaceClassName}
      aria-label="Plan view"
      ref={containerRef}
      onDragLeave={handleArtworkDragLeave}
      onDragOver={handleArtworkDragOver}
      onDrop={handleArtworkDrop}
    >
      <PlanToolbar activeTool={activeTool} onToolChange={handleToolChange} />
      <ViewportZoomControls
        zoom={getEffectiveZoom(viewport)}
        isFit={viewport.mode === "fit"}
        canZoomIn={
          clampZoom(getEffectiveZoom(viewport) * ZOOM_STEP, contentBounds, containerSize, PLAN_ZOOM_LIMITS) !==
          getEffectiveZoom(viewport)
        }
        canZoomOut={
          clampZoom(getEffectiveZoom(viewport) / ZOOM_STEP, contentBounds, containerSize, PLAN_ZOOM_LIMITS) !==
          getEffectiveZoom(viewport)
        }
        onZoomIn={() => zoomAtCenter(ZOOM_STEP)}
        onZoomOut={() => zoomAtCenter(1 / ZOOM_STEP)}
        onFit={() => onViewportChange(FIT_VIEWPORT)}
      />
      <svg
        className={activeTool ? "plan-svg tool-armed" : "plan-svg"}
        ref={svgRef}
        viewBox={viewBox}
        role="img"
        onClick={handleSvgClick}
        onPointerDown={beginMarquee}
        onPointerDownCapture={handleSvgPointerDownCapture}
        onPointerLeave={handleToolPointerLeave}
        onPointerMove={handleToolPointerMove}
      >
        <title>{project.title} plan</title>
        {/* Room interiors render below the grid (the grid must stay visible
            on the room's "paper"), walls and handles above it. */}
        {displayedProject.floor.rooms.map((placement) => (
          <polygon
            className="room-fill"
            key={placement.roomId}
            points={roomPolygonPoints(placement)}
          />
        ))}
        {gridVisible ? (
          <GridOverlay
            id="plan-grid"
            height={viewBoxBounds.height}
            majorSpacingMm={majorGridMm}
            minorSpacingMm={minorGridMm}
            width={viewBoxBounds.width}
            x={viewBoxBounds.x}
            y={viewBoxBounds.y}
          />
        ) : null}
        {displayedProject.floor.rooms.map((placement) => (
          <g key={placement.roomId}>
            {placement.room.walls.map((wall) => {
              const start = placement.room.vertices.find(
                (vertex) => vertex.id === wall.startVertexId
              );
              const end = placement.room.vertices.find(
                (vertex) => vertex.id === wall.endVertexId
              );
              if (!start || !end) return null;

              const x1 = start.xMm + placement.offsetXMm;
              const y1 = start.yMm + placement.offsetYMm;
              const x2 = end.xMm + placement.offsetXMm;
              const y2 = end.yMm + placement.offsetYMm;

              return (
                <Fragment key={wall.id}>
                  <line
                    className={
                      wall.id === selectedWallId ? "wall-line active" : "wall-line"
                    }
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    vectorEffect="non-scaling-stroke"
                  />
                  {/* Invisible, wide hit target painted on top of the visible
                      line so it owns the click — wall-anchored doors/windows
                      render in a later section of this svg, so they still
                      paint above this and keep winning clicks by paint order
                      alone, no z-ordering code needed. */}
                  <line
                    className="wall-hit"
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    vectorEffect="non-scaling-stroke"
                    onClick={(event) => {
                      // TRAP 1 — armed placement tool: doors/windows are
                      // click-placed ON walls via handleSvgClick's tool
                      // branch. Swallowing this click would break
                      // click-to-place entirely, so with a tool armed the
                      // wall is inert and the click bubbles through to the
                      // svg handler.
                      if (activeTool) return;
                      event.stopPropagation();
                      // TRAP 2 — a marquee that starts AND ends on this
                      // wall's hit stroke fires its trailing click here
                      // instead of on the svg, so handleSvgClick never
                      // consumes the suppression flag. Consuming it here
                      // keeps that click from hijacking the fresh marquee
                      // selection into a wall select (selectWall drops
                      // multi-select by design).
                      if (suppressNextToolClickRef.current) {
                        suppressNextToolClickRef.current = false;
                        return;
                      }
                      onSelectWall?.(wall.id);
                    }}
                  />
                </Fragment>
              );
            })}
          </g>
        ))}
        {/* Transparent hit polygon per room, painted after the walls so it
            sits above the wall lines but still below placed objects (next
            block) — those must keep winning their own clicks by paint order.
            At rest a room is otherwise unclickable chrome; this is the only
            surface that turns a plain floor click into a selection. */}
        {displayedProject.floor.rooms.map((placement) => {
          const isSelected = placement.roomId === selectedRoomId;
          return (
            <polygon
              className={isSelected ? "room-hit selected" : "room-hit"}
              key={placement.roomId}
              points={roomPolygonPoints(placement)}
              onPointerDown={(event) => {
                // Unselected: let the pointerdown bubble untouched — a drag
                // from here must still be able to start the background
                // marquee (marquee-selecting placements inside a room is an
                // existing feature this must not break). Selected: this
                // polygon IS the move affordance now (the old corner grip is
                // gone), so it claims the gesture the same way a resize
                // handle does.
                if (!isSelected) return;
                event.stopPropagation();
                beginRoomDrag(placement.roomId, event);
              }}
              onClick={(event) => {
                // Mirrors the wall-hit TRAP comments above: an armed tool
                // must click through to place, and a marquee's trailing
                // click (suppressNextToolClickRef, set by the marquee's own
                // pointerup) must not be reinterpreted as a room select.
                if (activeTool) return;
                event.stopPropagation();
                if (suppressNextToolClickRef.current) {
                  suppressNextToolClickRef.current = false;
                  return;
                }
                onSelectRoom?.(placement.roomId);
              }}
            />
          );
        })}
        {/* Placed objects render above walls/handles' room grouping but
            below drag guides — matching the elevation-view convention that
            geometry (walls/rooms) reads as structure and placements sit on
            top of it. Wall-anchored objects need their FloorWall for the
            wall-line-relative projection; floor-placed objects (later
            phases) carry their own center/rotation already. */}
        {(() => {
          const floorWalls = getFloorWalls(displayedProject.floor);
          const floorWallsById = new Map(floorWalls.map((wall) => [wall.id, wall]));
          // Any in-flight gesture suppresses hover tooltips: they'd sit on top
          // of the very geometry the user is trying to read while dragging,
          // resizing, or aiming an armed placement tool.
          const tooltipsDisabled = Boolean(
            drag || objectDrag || dropGhost || activeTool || roomDrag
          );
          const artworkTooltip = (
            artworkId: string,
            displayDimensionsOverride?: Dimensions
          ) => {
            const artwork = artworksById?.get(artworkId);
            if (!artwork) return undefined;
            return (
              <ArtworkTooltipContent
                artwork={artwork}
                dimensions={displayDimensionsOverride ?? artwork.dimensions}
                thumbnailUrl={
                  artwork.assetId ? thumbnailUrlsByAssetId.get(artwork.assetId) : undefined
                }
                unit={project.unit}
              />
            );
          };

          return (
            <>
              {displayedProject.wallObjects.map((wallObject) => {
                const wall = floorWallsById.get(wallObject.wallId);
                if (!wall) return null;

                const restRect = getWallObjectPlanRect(wall, wallObject);
                // Preview position, generalized over single and group drags: a
                // group member reads its own rect from previewRectById, a single
                // dragged object reads previewPlanRect, everything else rests.
                const groupPreviewRect = objectDrag?.members
                  ? objectDrag.previewRectById?.get(wallObject.id)
                  : undefined;
                const planRect =
                  groupPreviewRect ??
                  (objectDrag && !objectDrag.members && objectDrag.objectId === wallObject.id
                    ? objectDrag.previewPlanRect
                    : restRect);
                // A single drag reflects whether the live preview left the wall
                // (dashed floor look); a group drag is translation-only so a
                // wall member stays on its wall; at rest never floor-placed.
                const isFloorPlaced =
                  objectDrag != null &&
                  !objectDrag.members &&
                  objectDrag.objectId === wallObject.id &&
                  objectDrag.previewPlacement.anchor === "floor";
                const isSelected =
                  (wallObject.kind === "artwork"
                    ? wallObject.artworkId === selectedArtworkId
                    : wallObject.id === selectedOpeningId) ||
                  selectedObjectIds.includes(wallObject.id);
                // On-screen depth floor so thin doors/windows stay visible when
                // zoomed out — only while still wall-anchored (a floated preview
                // already carries its real floor-object depth).
                const renderedPlanRect = isFloorPlaced
                  ? planRect
                  : { ...planRect, depthMm: Math.max(planRect.depthMm, wallObjectMinDepthMm) };

                return (
                  <PlanObject
                    hitMinSizeMm={objectHitMinMm}
                    isFloorPlaced={isFloorPlaced}
                    isSelected={isSelected}
                    key={wallObject.id}
                    kind={wallObject.kind}
                    planRect={renderedPlanRect}
                    tooltip={
                      wallObject.kind === "artwork" ? (
                        artworkTooltip(wallObject.artworkId, wallObject.displayDimensionsOverride)
                      ) : (
                        <OpeningTooltipContent
                          kind={wallObject.kind}
                          secondaryMm={wallObject.heightMm}
                          unit={project.unit}
                          widthMm={wallObject.widthMm}
                        />
                      )
                    }
                    tooltipDisabled={tooltipsDisabled}
                    onBeginDrag={(event) =>
                      beginObjectDrag(
                        {
                          objectId: wallObject.id,
                          kind: wallObject.kind,
                          startCenterMm: {
                            xMm: restRect.centerXMm,
                            yMm: restRect.centerYMm
                          },
                          movingSize: {
                            widthMm: wallObject.widthMm,
                            heightMm: wallObject.heightMm,
                            // The eventual floor footprint depth if this drags
                            // off the wall; unused while it stays on a wall.
                            depthMm: DEFAULT_FLOOR_OBJECT_DEPTH_MM
                          },
                          // Preview a floated result at the wall's angle so a
                          // wall→floor drag keeps its orientation (matching
                          // commitPlanMove).
                          rotationDeg: restRect.angleDeg,
                          currentPlacement: {
                            anchor: "wall",
                            wallId: wallObject.wallId,
                            xMm: wallObject.xMm
                          },
                          initialPlanRect: restRect
                        },
                        event
                      )
                    }
                    onSelect={(event) => {
                      if (consumeSelectSuppression()) return;
                      if (onSelectObject) {
                        onSelectObject(wallObject.id, {
                          additive: event.shiftKey || event.metaKey || event.ctrlKey
                        });
                      } else if (wallObject.kind === "artwork") {
                        onSelectArtwork?.(wallObject.artworkId);
                      } else {
                        onSelectOpening?.(wallObject.id);
                      }
                    }}
                  />
                );
              })}
              {displayedProject.floorObjects.map((floorObject) => {
                const restRect = getFloorObjectPlanRect(floorObject);
                const groupPreviewRect = objectDrag?.members
                  ? objectDrag.previewRectById?.get(floorObject.id)
                  : undefined;
                const planRect =
                  groupPreviewRect ??
                  (objectDrag && !objectDrag.members && objectDrag.objectId === floorObject.id
                    ? objectDrag.previewPlanRect
                    : restRect);
                // A floor object reads floor-placed at rest and under a group
                // drag (translation-only keeps it on the floor); a single drag
                // follows the preview (a floor→wall drag drops the dashed look).
                const isFloorPlaced =
                  objectDrag && !objectDrag.members && objectDrag.objectId === floorObject.id
                    ? objectDrag.previewPlacement.anchor === "floor"
                    : true;
                const isSelected =
                  (floorObject.kind === "artwork"
                    ? floorObject.artworkId === selectedArtworkId
                    : floorObject.id === selectedOpeningId) ||
                  selectedObjectIds.includes(floorObject.id);

                return (
                  <PlanObject
                    hitMinSizeMm={objectHitMinMm}
                    isFloorPlaced={isFloorPlaced}
                    isSelected={isSelected}
                    key={floorObject.id}
                    kind={floorObject.kind}
                    planRect={planRect}
                    tooltip={
                      floorObject.kind === "artwork" ? (
                        artworkTooltip(floorObject.artworkId, floorObject.displayDimensionsOverride)
                      ) : (
                        // A floor blocked zone's footprint reads width × depth
                        // (its plan axes), not width × height.
                        <OpeningTooltipContent
                          kind={floorObject.kind}
                          secondaryMm={floorObject.depthMm}
                          unit={project.unit}
                          widthMm={floorObject.widthMm}
                        />
                      )
                    }
                    tooltipDisabled={tooltipsDisabled}
                    onBeginDrag={(event) =>
                      beginObjectDrag(
                        {
                          objectId: floorObject.id,
                          kind: floorObject.kind,
                          startCenterMm: { xMm: floorObject.xMm, yMm: floorObject.yMm },
                          movingSize: {
                            widthMm: floorObject.widthMm,
                            heightMm: floorObject.heightMm,
                            depthMm: floorObject.depthMm
                          },
                          rotationDeg: floorObject.rotationDeg,
                          currentPlacement: {
                            anchor: "floor",
                            xMm: floorObject.xMm,
                            yMm: floorObject.yMm
                          },
                          initialPlanRect: restRect
                        },
                        event
                      )
                    }
                    onSelect={(event) => {
                      if (consumeSelectSuppression()) return;
                      if (onSelectObject) {
                        onSelectObject(floorObject.id, {
                          additive: event.shiftKey || event.metaKey || event.ctrlKey
                        });
                      } else if (floorObject.kind === "artwork") {
                        onSelectArtwork?.(floorObject.artworkId);
                      } else {
                        onSelectOpening?.(floorObject.id);
                      }
                    }}
                  />
                );
              })}
            </>
          );
        })()}
        {/* The selected room's outline/wash/handles paint in their own layer
            ABOVE placed objects — at rest a room shows none of this (no
            outline, no wash, no handles), so this block renders at most once,
            for whichever room selectedRoomId names. */}
        {(() => {
          const selectedPlacement = displayedProject.floor.rooms.find(
            (placement) => placement.roomId === selectedRoomId
          );
          if (!selectedPlacement || handleSizeMm <= 0) return null;

          return (
            <g>
              <polygon
                className="room-selection-wash"
                points={roomPolygonPoints(selectedPlacement)}
              />
              <polygon
                className="room-selection-outline"
                points={roomPolygonPoints(selectedPlacement)}
                vectorEffect="non-scaling-stroke"
              />
              <RoomResizeHandles
                activeDrag={
                  drag && drag.roomId === selectedPlacement.roomId
                    ? {
                        targetWallId: drag.targetWallId,
                        anchor: drag.anchor,
                        previewLengthMm: drag.previewLengthMm
                      }
                    : null
                }
                handleSizeMm={handleSizeMm}
                placement={selectedPlacement}
                unit={wallUnit}
                onBeginDrag={beginDrag}
              />
            </g>
          );
        })()}
        {toolGhost ? (
          <PlanObject
            isGhost
            kind={activeTool ?? "door"}
            planRect={
              toolGhost.placement.anchor === "wall"
                ? {
                    ...toolGhost.planRect,
                    depthMm: Math.max(toolGhost.planRect.depthMm, wallObjectMinDepthMm)
                  }
                : toolGhost.planRect
            }
          />
        ) : null}
        {dropGhost ? (
          <PlanObject
            isGhost
            kind="artwork"
            planRect={
              dropGhost.placement.anchor === "wall"
                ? {
                    ...dropGhost.planRect,
                    depthMm: Math.max(dropGhost.planRect.depthMm, wallObjectMinDepthMm)
                  }
                : dropGhost.planRect
            }
          />
        ) : null}
        {(
          objectDrag?.activeGuides ??
          dropGhost?.activeGuides ??
          drag?.activeGuides ??
          roomDrag?.activeGuides ??
          toolGhost?.activeGuides ??
          []
        ).map((guide) => (
          <line
            className="snap-guide"
            key={guide.id}
            x1={guide.axis === "x" ? guide.positionMm : viewBoxBounds.x}
            y1={guide.axis === "y" ? guide.positionMm : viewBoxBounds.y}
            x2={guide.axis === "x" ? guide.positionMm : viewBoxBounds.x + viewBoxBounds.width}
            y2={
              guide.axis === "y" ? guide.positionMm : viewBoxBounds.y + viewBoxBounds.height
            }
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {marquee
          ? (() => {
              // Plan is y-down (no flip), so the min/max rect maps straight to
              // the <rect>. Dashed petrol stroke (.marquee-rect) — the same
              // in-progress marquee look elevation uses.
              const rect = marqueeRectMm(marquee);
              return (
                <rect
                  className="marquee-rect"
                  x={rect.minXMm}
                  y={rect.minYMm}
                  width={rect.maxXMm - rect.minXMm}
                  height={rect.maxYMm - rect.minYMm}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })()
          : null}
      </svg>
    </div>
  );
}

function getPlanViewPaddingMm(bounds: { width: number; height: number }): number {
  const largestDimensionMm = Math.max(bounds.width, bounds.height);

  return Math.max(900, largestDimensionMm * 0.14);
}
