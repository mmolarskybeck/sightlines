import {
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
import { resizeWallPreservingAngles } from "../../domain/geometry/editRoom";
import { getFloorBounds } from "../../domain/geometry/walls";
import {
  getFloorObjectPlanRect,
  getFloorWalls,
  getWallObjectPlanRect,
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
  type WallObject
} from "../../domain/project";
import { getGridSnapTargets } from "../../domain/snapping/gridSnapTargets";
import {
  resolvePlanPlacement,
  WALL_CAPTURE_PX,
  type PlanPlacement
} from "../../domain/snapping/planSnapTargets";
import { resolveSnap, type Guide, type SnapTarget, type SnapTargetIds } from "../../domain/snapping/resolveSnap";
import {
  getMajorGridIntervalMm,
  getMinorGridIntervalMm,
  getPixelsPerMm
} from "../../domain/units/precision";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../domain/units/unitSystem";
import { useAssetImageUrls } from "../hooks/useAssetImageUrls";
import { useContainerSize } from "../hooks/useContainerSize";
import { ARTWORK_DRAG_MIME } from "./ChecklistPanel";
import { GridOverlay } from "./GridOverlay";
import { ArtworkTooltipContent, OpeningTooltipContent } from "./PlacementTooltip";
import { PlanObject } from "./PlanObject";
import { PlanToolbar, type PlanTool } from "./PlanToolbar";
import { RoomResizeHandles, type ResizeHandleTarget } from "./RoomResizeHandles";

const HANDLE_SCREEN_SIZE_PX = 16;
const SNAP_THRESHOLD_PX = 10;

// Stable module-level reference so a caller that doesn't pass `getBlob`
// doesn't retrigger useAssetImageUrls' effect on every render (same idiom as
// ElevationView's NO_OP_GET_BLOB).
const NO_OP_GET_BLOB: (key: string) => Promise<Blob> = () =>
  Promise.reject(new Error("PlanView: no getBlob provided"));

type DragState = {
  roomId: string;
  targetWallId: string;
  axis: Vector2;
  startLengthMm: number;
  startPointerMm: Vector2;
  // The wall's own moving edge (its endVertexId, in floor coordinates) at
  // drag start — snapping targets this point, not the pointer, so wherever
  // inside the handle the user grabbed never leaks into the committed
  // length. See getMovingWallEdgeWorldPointMm.
  edgeStartMm: Vector2;
  previewLengthMm: number;
  // A wall-resize drag only ever snaps along the wall's own single axis, so
  // one id is enough here — it maps into that axis's slot of resolveSnap's
  // per-axis previousSnapTargetIds.
  previousSnapTargetId?: string;
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

export function PlanView({
  artworksById,
  draggingArtworkId = null,
  getBlob,
  gridPrecisionFloorMm,
  gridVisible,
  onCommitPlanMove,
  onCommitWallLength,
  onPlaceArtwork,
  onPlaceArtworkOnFloor,
  onPlaceOpeningFromPlan,
  onSelectArtwork,
  onSelectOpening,
  project,
  selectedArtworkId,
  selectedOpeningId,
  selectedWallId,
  snapToGrid
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
  onCommitWallLength: (wallId: string, lengthMm: number) => Promise<void>;
  onPlaceArtwork?: (artworkId: string, wallId: string, xMm: number, yMm: number) => void;
  onPlaceArtworkOnFloor?: (artworkId: string, xMm: number, yMm: number) => void;
  onPlaceOpeningFromPlan?: (kind: PlanTool, placement: PlanPlacement) => Promise<void>;
  onSelectArtwork?: (artworkId: string) => void;
  onSelectOpening?: (wallObjectId: string) => void;
  project: Project;
  selectedArtworkId?: string | null;
  selectedOpeningId?: string | null;
  selectedWallId: string | null;
  snapToGrid: boolean;
}) {
  const [containerRef, containerSize] = useContainerSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  // A move of an existing placed object, and the HTML5 drop preview for a
  // checklist artwork. Both flow through resolvePlanPlacement, so preview and
  // commit can never disagree.
  const [objectDrag, setObjectDrag] = useState<ObjectDragState | null>(null);
  const objectDragRef = useRef<ObjectDragState | null>(null);
  const [dropGhost, setDropGhost] = useState<DropGhostState | null>(null);
  const dropSnapTargetIdsRef = useRef<SnapTargetIds | undefined>(undefined);

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
  const viewBoxBounds = {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2
  };
  const viewBox = `${viewBoxBounds.x} ${viewBoxBounds.y} ${viewBoxBounds.width} ${viewBoxBounds.height}`;
  const pixelsPerMm = getPixelsPerMm(containerSize, viewBoxBounds);
  // The viewBox is letterboxed inside the full-size canvas (default
  // "xMidYMid meet"), but SVG userspace outside the viewBox still renders —
  // and the grid patterns tile in userspace — so sizing the grid rect to the
  // whole container (in mm, centered on the viewBox center) fills the entire
  // visible workspace instead of leaving bare margins beside the letterboxed
  // viewBox. Falls back to the viewBox itself on first render, before the
  // container is measured.
  const gridBounds =
    pixelsPerMm > 0
      ? {
          x: viewBoxBounds.x + (viewBoxBounds.width - containerSize.width / pixelsPerMm) / 2,
          y: viewBoxBounds.y + (viewBoxBounds.height - containerSize.height / pixelsPerMm) / 2,
          width: containerSize.width / pixelsPerMm,
          height: containerSize.height / pixelsPerMm
        }
      : viewBoxBounds;
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
  const handleSizeMm = pixelsPerMm > 0 ? HANDLE_SCREEN_SIZE_PX / pixelsPerMm : 0;
  const snapThresholdMm = pixelsPerMm > 0 ? SNAP_THRESHOLD_PX / pixelsPerMm : 0;
  const gridSnapTargets = getGridSnapTargets(minorGridMm, {
    minXMm: viewBoxBounds.x,
    maxXMm: viewBoxBounds.x + viewBoxBounds.width,
    minYMm: viewBoxBounds.y,
    maxYMm: viewBoxBounds.y + viewBoxBounds.height
  });

  const displayedProject =
    drag !== null
      ? resizeWallPreservingAngles(project, drag.targetWallId, drag.previewLengthMm).project
      : project;

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
    if (!activeTool || !movingSize || drag) return;

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
    const target = event.target as Element | null;
    // The ghost itself carries the `.plan-object` class too (so it shares
    // PlanObject's rendering), and it sits directly under the pointer at the
    // moment of a placement click — excluding `.is-ghost` here is what lets
    // that click through to actually commit instead of being mistaken for a
    // click on a real, already-placed object.
    if (target?.closest(".resize-handle, .plan-object:not(.is-ghost)")) {
      suppressNextToolClickRef.current = true;
    }
  }

  function handleSvgClick(event: ReactMouseEvent<SVGSVGElement>) {
    if (suppressNextToolClickRef.current) {
      suppressNextToolClickRef.current = false;
      return;
    }
    if (!activeTool || !movingSize || !onPlaceOpeningFromPlan || drag) return;

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
        current.axis
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
      void onCommitWallLength(current.targetWallId, current.previewLengthMm);
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
      startLengthMm: target.startLengthMm,
      startPointerMm: { xMm: startPointerMm.x, yMm: startPointerMm.y },
      edgeStartMm: getMovingWallEdgeWorldPointMm(project, target.targetWallId),
      previewLengthMm: target.startLengthMm,
      previousSnapTargetId: undefined,
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
  }, [objectDrag !== null, onCommitPlanMove]);

  useEffect(() => {
    objectDragRef.current = objectDrag;
  }, [objectDrag]);

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

  return (
    <div
      className="drawing-surface"
      aria-label="Plan view"
      ref={containerRef}
      onDragLeave={handleArtworkDragLeave}
      onDragOver={handleArtworkDragOver}
      onDrop={handleArtworkDrop}
    >
      <PlanToolbar activeTool={activeTool} onToolChange={handleToolChange} />
      <svg
        className={activeTool ? "plan-svg tool-armed" : "plan-svg"}
        ref={svgRef}
        viewBox={viewBox}
        role="img"
        onClick={handleSvgClick}
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
            points={placement.room.vertices
              .map(
                (vertex) =>
                  `${vertex.xMm + placement.offsetXMm},${vertex.yMm + placement.offsetYMm}`
              )
              .join(" ")}
          />
        ))}
        {gridVisible ? (
          <GridOverlay
            id="plan-grid"
            height={gridBounds.height}
            majorSpacingMm={majorGridMm}
            minorSpacingMm={minorGridMm}
            width={gridBounds.width}
            x={gridBounds.x}
            y={gridBounds.y}
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

              return (
                <line
                  className={
                    wall.id === selectedWallId ? "wall-line active" : "wall-line"
                  }
                  key={wall.id}
                  x1={start.xMm + placement.offsetXMm}
                  y1={start.yMm + placement.offsetYMm}
                  x2={end.xMm + placement.offsetXMm}
                  y2={end.yMm + placement.offsetYMm}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {handleSizeMm > 0 ? (
              <RoomResizeHandles
                activeDrag={
                  drag && drag.roomId === placement.roomId
                    ? { targetWallId: drag.targetWallId, previewLengthMm: drag.previewLengthMm }
                    : null
                }
                handleSizeMm={handleSizeMm}
                placement={placement}
                unit={wallUnit}
                onBeginDrag={beginDrag}
              />
            ) : null}
          </g>
        ))}
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
          const tooltipsDisabled = Boolean(drag || objectDrag || dropGhost || activeTool);
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
                const isDragging = objectDrag?.objectId === wallObject.id;
                const planRect = isDragging ? objectDrag.previewPlanRect : restRect;
                // While dragging, reflect whether the live preview has left the
                // wall (dashed floor look) so the cue matches the pending
                // commit; at rest a wall object is never floor-placed.
                const isFloorPlaced =
                  isDragging && objectDrag.previewPlacement.anchor === "floor";
                const isSelected =
                  wallObject.kind === "artwork"
                    ? wallObject.artworkId === selectedArtworkId
                    : wallObject.id === selectedOpeningId;

                return (
                  <PlanObject
                    isFloorPlaced={isFloorPlaced}
                    isSelected={isSelected}
                    key={wallObject.id}
                    kind={wallObject.kind}
                    planRect={planRect}
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
                    onSelect={() =>
                      wallObject.kind === "artwork"
                        ? onSelectArtwork?.(wallObject.artworkId)
                        : onSelectOpening?.(wallObject.id)
                    }
                  />
                );
              })}
              {displayedProject.floorObjects.map((floorObject) => {
                const restRect = getFloorObjectPlanRect(floorObject);
                const isDragging = objectDrag?.objectId === floorObject.id;
                const planRect = isDragging ? objectDrag.previewPlanRect : restRect;
                // A floor object reads floor-placed at rest; while dragging it
                // follows the preview (a floor→wall drag drops the dashed look).
                const isFloorPlaced = isDragging
                  ? objectDrag.previewPlacement.anchor === "floor"
                  : true;
                const isSelected =
                  floorObject.kind === "artwork"
                    ? floorObject.artworkId === selectedArtworkId
                    : floorObject.id === selectedOpeningId;

                return (
                  <PlanObject
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
                    onSelect={() =>
                      floorObject.kind === "artwork"
                        ? onSelectArtwork?.(floorObject.artworkId)
                        : onSelectOpening?.(floorObject.id)
                    }
                  />
                );
              })}
            </>
          );
        })()}
        {toolGhost ? (
          <PlanObject isGhost kind={activeTool ?? "door"} planRect={toolGhost.planRect} />
        ) : null}
        {dropGhost ? <PlanObject isGhost kind="artwork" planRect={dropGhost.planRect} /> : null}
        {(
          objectDrag?.activeGuides ??
          dropGhost?.activeGuides ??
          drag?.activeGuides ??
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
      </svg>
    </div>
  );
}

function getPlanViewPaddingMm(bounds: { width: number; height: number }): number {
  const largestDimensionMm = Math.max(bounds.width, bounds.height);

  return Math.max(900, largestDimensionMm * 0.14);
}
