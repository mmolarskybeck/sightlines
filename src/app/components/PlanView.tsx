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
import { unitLeftNormal } from "../../domain/geometry/vector";
import type { ResizeAnchor } from "../../domain/geometry/editRoom";
import { applyPlanPreview, type PlanPreview } from "../../domain/geometry/planPreview";
import {
  getFloorBounds,
  getPlacedRoomBounds,
  getRoomBounds,
  getWallGeometry
} from "../../domain/geometry/walls";
import {
  getFloorObjectPlanRect,
  getFloorWalls,
  getWallObjectPlanRect,
  planRectIntersectsRect,
  projectPointToWall,
  WALL_OBJECT_PLAN_DEPTH_MM,
  type PlanRect
} from "../../domain/geometry/planObjects";
import { buildPlanScene, svgPolygonPoints } from "../../domain/scene2d/planScene";
import { getDefaultOpeningSizeMm, type OpeningKind } from "../../domain/placement/createOpening";
import {
  effectiveFloorDepthMm,
  effectivePlacementForm,
  type PlacementForm
} from "../../domain/placement/artworkForm";
import {
  getEffectivePlacementSizeMm,
  PLACEHOLDER_ARTWORK_HEIGHT_MM,
  PLACEHOLDER_ARTWORK_WIDTH_MM
} from "../../domain/placement/placeArtwork";
import {
  DEFAULT_FLOOR_OBJECT_DEPTH_MM,
  type Artwork,
  type FreestandingWall,
  type WallObject
} from "../../domain/project";
import {
  parseFaceWallId,
  roomIdContainingPoint,
  type FloorPartition
} from "../../domain/geometry/freestandingWalls";
import { isPointInPolygon, isSimplePolygon, segmentsIntersect, type Point } from "../../domain/geometry/polygon";
import {
  canCloseOnWall,
  snapDrawPointToRooms,
  type DrawRoomSnap
} from "../../domain/geometry/drawSnapping";
import { canMoveRoomVertex, moveRoomWall } from "../../domain/geometry/reshapeRoom";
import { getGridSnapTargets } from "../../domain/snapping/gridSnapTargets";
import { getPartitionMoveSnapTargets } from "../../domain/snapping/partitionSnapTargets";
import {
  getPartitionClearances,
  partitionAxisForWorldAxis,
  type PartitionClearances,
  type SideClearance
} from "../../domain/geometry/partitionSpacing";
import {
  floatPolicyForKind,
  resolvePlanPlacement,
  WALL_CAPTURE_PX,
  type FloatPolicy,
  type PlanPlacement,
  type ResolvedPlacement
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
  FIT_VIEWPORT,
  getEffectiveZoom,
  getViewBox2D,
  PLAN_ZOOM_LIMITS,
  ZOOM_STEP,
  type Viewport2D
} from "../../domain/viewport/viewport2d";
import { getScopeUnits, unitSystemFromDisplayUnit } from "../../domain/units/unitSystem";
import { useArtworkAspect } from "../hooks/useArtworkAspect";
import { useAssetImageUrls } from "../hooks/useAssetImageUrls";
import { useContainerSize } from "../hooks/useContainerSize";
import { useDragGesture } from "../hooks/useDragGesture";
import { useSelectSuppression } from "../hooks/useSelectSuppression";
import { useSvgViewportGestures } from "../hooks/useSvgViewportGestures";
import { useAppStore } from "../store";
import { ARTWORK_DRAG_MIME } from "./ChecklistPanel";
import {
  consumeArtworkDragSession,
  peekArtworkDragSession,
  subscribeArtworkTouchDrag
} from "./artworkDragSession";
import { GridOverlay } from "./GridOverlay";
import { marqueeRectMm, type MarqueeState } from "./marqueeRect";
import { type ResizeHandleTarget } from "./RoomResizeHandles";
import { ViewportZoomControls } from "./ViewportZoomControls";
import { PlanStructureLayer } from "./plan/PlanStructureLayer";
import { PlacedObjectsLayer } from "./plan/PlacedObjectsLayer";
import { PlanHandlesLayer } from "./plan/PlanHandlesLayer";
import { PlanOverlaysLayer } from "./plan/PlanOverlaysLayer";
import { PartitionDimensionLines } from "./plan/PartitionDimensionLines";
import type {
  DragState,
  DrawState,
  DropGhostState,
  ObjectDragState,
  PartitionDragState,
  PartitionDrawState,
  RectDrawState,
  RoomDragState,
  ToolGhostState,
  VertexDragState,
  WallDragState
} from "./plan/types";

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
// Click within this many screen px of the polygon's first vertex closes the
// loop (needs ≥3 points); mirrors the wall-object capture radius feel.
const CLOSE_HANDLE_PX = 12;
// Consecutive draw points closer than this (floor mm) collapse to a
// zero-length wall — ignore the click, same floor the constructor rejects at.
const MIN_DRAW_SPACING_MM = 10;
const DRAW_EPS = 1e-6;
// A partition centerline shorter than this (floor mm) reads as an accidental
// click, not a drawn wall — the create drag ignores it (same floor the
// constructor rejects at).
const PARTITION_MIN_LENGTH_MM = 100;
// A rectangle-room drag whose either axis falls below this (floor mm) reads as
// an accidental click rather than a room — well above pointer jitter, at or
// below every common grid precision, and the smallest plausible room dimension.
const RECT_ROOM_MIN_SIZE_MM = 500;
// Fit view never frames a window smaller than this on either axis — an empty
// or near-empty floor (or a single tiny room) would otherwise fit-zoom to a
// window a couple meters wide, reading as absurdly zoomed-in. ~30ft.
const MIN_PLAN_FIT_EXTENT_MM = 9144;

// Stable module-level reference so a caller that doesn't pass `getBlob`
// doesn't retrigger useAssetImageUrls' effect on every render (same idiom as
// ElevationView's NO_OP_GET_BLOB).
const NO_OP_GET_BLOB: (key: string) => Promise<Blob> = () =>
  Promise.reject(new Error("PlanView: no getBlob provided"));

export function PlanView({
  activeTool,
  drawRoomActive = false,
  onDrawRoomChange,
  onAddPolygonRoom,
  reshapeRoomId = null,
  onReshapeRoomChange,
  drawRectActive = false,
  onDrawRectChange,
  onAddRectangleRoom,
  partitionToolActive = false,
  onPartitionToolChange,
  onAddFreestandingWall,
  selectedFreestandingWallId = null,
  onMoveFreestandingWall,
  onMoveFreestandingWallEndpoint,
  artworksById,
  draggingArtworkId = null,
  getBlob,
  gridPrecisionFloorMm,
  gridVisible,
  onCommitPlanMove,
  onCommitPlanMoveGroup,
  onPlaceArtwork,
  onPlaceArtworkOnFloor,
  onMarqueeSelect,
  onToolChange,
  selectedArtworkId,
  selectedOpeningId,
  selectedObjectIds = [],
  selectedRoomId = null,
  selectedWallId,
  snapToGrid,
  viewport,
  onViewportChange
}: {
  // Which insertion tool (door/window/blocked-zone) is armed — lifted up
  // into App's view-toolbar strip (the old floating PlanToolbar palette is
  // gone), so PlanView is a controlled component here: it reads the armed
  // kind and reports intent via onToolChange, exactly like PlanToolbar used
  // to, but this component now owns the ghost preview and click-to-place
  // commit that arming enables.
  activeTool: OpeningKind | null;
  // Polygon-room draw mode — armed alongside activeTool in App's toolbar and
  // mutually exclusive with it. The armed flag is lifted (App owns the toolbar
  // toggle); the transient point list, preview, and snapping live here.
  drawRoomActive?: boolean;
  // Reports a draw arm/disarm up to App (Escape/Enter-close disarm from here).
  onDrawRoomChange?: (active: boolean) => void;
  // Commits the closed polygon in ONE store edit; App wires it to addPolygonRoom.
  onAddPolygonRoom?: (pointsFloorMm: Point[]) => void;
  // Slice 2 (reshape): which room's vertex/split handles show, lifted the
  // same way as drawRoomActive — armed by RoomInspector's "Edit shape"
  // button, mutually exclusive with activeTool/drawRoomActive in App.
  reshapeRoomId?: string | null;
  // Reports an arm/toggle/exit up to App (Escape and the double-click
  // shortcut both call this from here).
  onReshapeRoomChange?: (roomId: string | null) => void;
  // Rectangle-room draw tool — armed alongside the other tools in App's
  // toolbar, mutually exclusive with them. Press at one corner, drag to the
  // opposite corner, release to create an axis-aligned room. The armed flag is
  // lifted (App owns the toggle); the transient two-corner state, preview, and
  // grid snapping live here. Disarms after one commit (and on Escape/cancel).
  drawRectActive?: boolean;
  // Reports an arm/disarm up to App (release and Escape both disarm from here).
  onDrawRectChange?: (active: boolean) => void;
  // Commits the drawn rectangle in ONE store edit; App wires it to
  // addDrawnRectangleRoom. Min-corner origin, absolute width/depth.
  onAddRectangleRoom?: (rect: {
    offsetXMm: number;
    offsetYMm: number;
    widthMm: number;
    depthMm: number;
  }) => void;
  // Partition (free-standing wall) tool — armed alongside the other tools in
  // App's toolbar, mutually exclusive with them. Drag draws the centerline;
  // release commits via onAddFreestandingWall. Editing (select/move/re-angle)
  // is always available, independent of the armed tool.
  partitionToolActive?: boolean;
  onPartitionToolChange?: (active: boolean) => void;
  onAddFreestandingWall?: (startFloorMm: Point, endFloorMm: Point) => void;
  selectedFreestandingWallId?: string | null;
  onMoveFreestandingWall?: (wallId: string, deltaFloorMm: Point) => void;
  onMoveFreestandingWallEndpoint?: (
    wallId: string,
    end: "start" | "end",
    nextFloorMm: Point
  ) => void;
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
  onPlaceArtwork?: (artworkId: string, wallId: string, xMm: number, yMm: number) => void;
  // Floor works (effective form "floor") land here instead of onPlaceArtwork:
  // the plan drop resolves a floor center, and this commits via the store's
  // placeArtworkOnFloor. Optional/inert until App wires it.
  onPlaceArtworkOnFloor?: (artworkId: string, xMm: number, yMm: number) => void;
  // A rubber-band marquee committed on release: ids are PLACEMENT ids (wall/
  // floor object ids), never artwork-library ids, and `additive` reflects a
  // held shift. Composes App-owned selection state, so it stays a prop while
  // the bare selection actions (select/clear) are read from the store below.
  onMarqueeSelect?: (ids: string[], additive: boolean) => void;
  // Reports an arm/disarm/toggle of the insertion tool up to App, which owns
  // activeTool (planMode) — so this stays a prop even though the bare store
  // actions below don't.
  onToolChange: (tool: OpeningKind | null) => void;
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
  // Store-connected passthroughs. App used to forward all of these verbatim
  // (a bare `prop={storeAction}` or `project={project}`), so reading them
  // straight from the store here cuts ~15 wires off the call site without
  // relocating any ownership: the store already owns them, App was only a
  // conduit. Each action selector returns a stable reference (actions are
  // defined once in createAppStore), so these never trigger a re-render; only
  // the `project` slice does, exactly as the old prop did. Anything App still
  // wraps in an arrow (composing a view preference like allowOverlappingPlacement,
  // or the derived selection ids) stays a prop above — that's genuinely
  // App-owned composition, not a passthrough.
  const project = useAppStore((state) => state.project)!;
  const onMoveRoomVertex = useAppStore((state) => state.moveRoomVertex);
  const onMoveRoomWall = useAppStore((state) => state.moveRoomWall);
  const onSplitWall = useAppStore((state) => state.splitWall);
  const onDeleteRoomVertex = useAppStore((state) => state.deleteRoomVertex);
  const onSelectFreestandingWall = useAppStore((state) => state.selectFreestandingWall);
  const onCommitWallLength = useAppStore((state) => state.resizeWall);
  const onMoveRoom = useAppStore((state) => state.moveRoom);
  const onPlaceOpeningFromPlan = useAppStore((state) => state.placeOpeningFromPlan);
  const onSelectArtwork = useAppStore((state) => state.selectArtwork);
  const onSelectOpening = useAppStore((state) => state.selectOpening);
  const onSelectRoom = useAppStore((state) => state.selectRoom);
  const onSelectWall = useAppStore((state) => state.selectWall);
  const onSelectObject = useAppStore((state) => state.selectObject);
  const onClearSelection = useAppStore((state) => state.clearObjectSelection);
  // Wall-resize drag (a rectangle room's RoomResizeHandles). onMove/onRelease
  // close over toSvgMm/gridSnapTargets/snapThresholdMm/snapToGrid/project,
  // all declared further down this component body — safe, since these
  // closures only ever run later, from a window pointer event, by which time
  // every one of those consts has already been initialized for this render.
  const {
    drag,
    dragRef,
    beginDrag: startDrag
  } = useDragGesture<DragState>({
    onMove: (current, event) => {
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;

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

      return { ...current, previewLengthMm, previousSnapTargetId: snapTargetId, activeGuides };
    },
    onRelease: (current) => {
      if (Math.abs(current.previewLengthMm - current.startLengthMm) < 0.5) return;
      void onCommitWallLength(current.targetWallId, current.previewLengthMm, current.anchor);
    }
  });
  // Whole-room move drag (the selected room's floor polygon as move
  // affordance). Same deferred-closure note as `drag` above: onMove/onRelease
  // reference gridSnapTargets/snapThresholdMm/snapToGrid/onMoveRoom, all
  // declared further down this component body.
  const {
    drag: roomDrag,
    dragRef: roomDragRef,
    beginDrag: startRoomDrag
  } = useDragGesture<RoomDragState>({
    onMove: (current, event) => {
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;

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

      return {
        ...current,
        previewOffsetMm: {
          xMm: current.startOffsetMm.xMm + cornerDeltaMm.xMm,
          yMm: current.startOffsetMm.yMm + cornerDeltaMm.yMm
        },
        previousSnapTargetIds: snapTargetIds,
        activeGuides
      };
    },
    onRelease: (current) => {
      // Sub-threshold release is a click, not a move — must not commit (and
      // so land a phantom undo entry), same guard as the object/group drags.
      const movedMm = Math.hypot(
        current.previewOffsetMm.xMm - current.startOffsetMm.xMm,
        current.previewOffsetMm.yMm - current.startOffsetMm.yMm
      );
      if (movedMm < 0.5) return;

      void onMoveRoom?.(current.roomId, current.previewOffsetMm.xMm, current.previewOffsetMm.yMm);
    }
  });
  // A move of an existing placed object (single or group), and the HTML5 drop
  // preview for a checklist artwork. Both flow through resolvePlanPlacement,
  // so preview and commit can never disagree. Same deferred-closure note as
  // `drag`/`roomDrag` above: onMove/onRelease reference floorWallsForTool/
  // project/gridSnapTargets/snapThresholdMm/snapToGrid/captureDistanceMm/
  // onCommitPlanMove/onCommitPlanMoveGroup/suppressNextSelect, all declared
  // further down this component body.
  const {
    drag: objectDrag,
    dragRef: objectDragRef,
    beginDrag: startObjectDrag
  } = useDragGesture<ObjectDragState>({
    onMove: (current, event) => {
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;

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

        return {
          ...current,
          previewGroupCenterMm: snappedGroupCenterMm,
          previewRectById,
          previousSnapTargetIds: snapTargetIds,
          activeGuides
        };
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
        floatPolicy: current.floatPolicy,
        // Live preview's current wall, so hysteresis tracks the drag.
        currentAnchorWallId: current.currentAnchorWallId,
        captureDistanceMm,
        gridTargets: gridSnapTargets,
        snapToGrid,
        thresholdMm: snapThresholdMm,
        previousSnapTargetIds: current.previousSnapTargetIds,
        rotationDeg: current.rotationDeg
      });

      return {
        ...current,
        previewPlanRect: result.planRect,
        previewPlacement: result.placement,
        currentAnchorWallId:
          result.placement.anchor === "wall" ? result.placement.wallId : null,
        previousSnapTargetIds: result.snapTargetIds,
        activeGuides: result.activeGuides
      };
    },
    onRelease: (current) => {
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

      // A rejected preview (artwork dragged off every wall — wall-only) commits
      // nothing: the object stays exactly where it was, on its wall or its old
      // floor spot. The trailing click still re-selects it via onClick.
      if (current.previewPlacement.anchor === "none") return;

      onCommitPlanMove?.(current.objectId, current.previewPlacement);
    }
  });
  const [dropGhost, setDropGhost] = useState<DropGhostState | null>(null);
  const dropSnapTargetIdsRef = useRef<SnapTargetIds | undefined>(undefined);
  // Rubber-band marquee selection on the plan background. Same deferred-
  // closure note as the machines above: onMove references toSvgMm, onRelease
  // references snapThresholdMm/idsIntersectingMarquee/onMarqueeSelect/
  // suppressNextToolClickRef, all declared further down this component body.
  const {
    drag: marquee,
    dragRef: marqueeRef,
    beginDrag: startMarquee
  } = useDragGesture<MarqueeState>({
    onMove: (current, event) => {
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;
      return { ...current, currentMm: pointerMm };
    },
    onRelease: (current, event) => {
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
  });

  // Which tool is armed lives in App now (activeTool prop, lifted alongside
  // the toolbar buttons that toggle it) — deliberately NOT in the store, same
  // reasoning as the drag/marquee state above: it's transient UI, not
  // something undo history or persistence should ever see. What stays local
  // here is the live ghost and the hysteresis id threaded across pointer
  // moves (the same discipline as the wall-resize drag's previousSnapTargetId,
  // just keyed on hover instead of a pointer-capture gesture) — both reset
  // whenever activeTool changes so a re-arm (or disarm) starts clean.

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

  // Polygon-room draw state. Latest value mirrored into a ref so the scoped
  // keyboard handler (Enter/Backspace/Escape) reads live points without
  // resubscribing on every appended vertex — same discipline as the drags.
  const [draw, setDraw] = useState<DrawState | null>(null);
  const drawRef = useRef<DrawState | null>(null);
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  // Reshape mode's vertex drag. `selectedVertexId` is separate: a plain click
  // (no movement) still "selects" a vertex for the Delete/Backspace merge
  // shortcut, whether or not this gesture also turns into a drag. Same
  // deferred-closure note as `drag` above: onMove/onRelease reference
  // project/gridSnapTargets/snapThresholdMm/snapToGrid/onMoveRoomVertex, all
  // declared further down this component body.
  const {
    drag: vertexDrag,
    dragRef: vertexDragRef,
    beginDrag: startVertexDrag
  } = useDragGesture<VertexDragState>({
    onMove: (current, event) => {
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;

      const placement = project.floor.rooms.find(
        (candidate) => candidate.roomId === current.roomId
      );
      if (!placement) return null;

      const deltaMm: Vector2 = {
        xMm: pointerMm.xMm - current.startPointerMm.xMm,
        yMm: pointerMm.yMm - current.startPointerMm.yMm
      };
      const proposedLocalMm: Vector2 = {
        xMm: current.startLocalMm.xMm + deltaMm.xMm,
        yMm: current.startLocalMm.yMm + deltaMm.yMm
      };

      let snappedLocalMm = proposedLocalMm;
      let snapTargetIds = current.previousSnapTargetIds;
      let activeGuides: Guide[] = [];
      if (snapToGrid) {
        // gridSnapTargets are in floor space; add the room's placement offset
        // before snapping, then subtract it back off — the same grab-offset
        // convention roomDrag's corner snap uses.
        const proposedFloorMm: Vector2 = {
          xMm: proposedLocalMm.xMm + placement.offsetXMm,
          yMm: proposedLocalMm.yMm + placement.offsetYMm
        };
        const snap = resolveSnap(proposedFloorMm, gridSnapTargets, {
          thresholdMm: snapThresholdMm,
          previousSnapTargetIds: current.previousSnapTargetIds
        });
        snappedLocalMm = {
          xMm: snap.point.xMm - placement.offsetXMm,
          yMm: snap.point.yMm - placement.offsetYMm
        };
        snapTargetIds = snap.snapTargetIds;
        activeGuides = snap.activeGuides;
      }

      const valid = canMoveRoomVertex(placement.room, current.vertexId, snappedLocalMm);

      return {
        ...current,
        previewLocalMm: snappedLocalMm,
        valid,
        previousSnapTargetIds: snapTargetIds,
        activeGuides
      };
    },
    onRelease: (current) => {
      const movedMm = Math.hypot(
        current.previewLocalMm.xMm - current.startLocalMm.xMm,
        current.previewLocalMm.yMm - current.startLocalMm.yMm
      );
      // Sub-threshold release is a click (already handled by selecting the
      // vertex on pointerdown), not a move — no commit. An invalid final
      // position REVERTS: displayedProject falls back to the committed
      // project the instant vertexDrag goes null above, so "revert" costs
      // nothing extra here — just don't call onMoveRoomVertex.
      if (movedMm < 0.5 || !current.valid) return;

      void onMoveRoomVertex?.(current.roomId, current.vertexId, current.previewLocalMm);
    }
  });
  // A selected non-rectangle's wall slide (WallSlideHandles chips →
  // moveRoomWall). Same deferred-closure note as `drag` above: onMove
  // references `project` and `toSvgMm`, declared further down this component
  // body — safe, since onMove only ever runs later, from a window pointer
  // event.
  const {
    drag: wallDrag,
    dragRef: wallDragRef,
    beginDrag: startWallDrag
  } = useDragGesture<WallDragState>({
    onMove: (current, event) => {
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;

      const deltaMm: Vector2 = {
        xMm: pointerMm.xMm - current.startPointerMm.xMm,
        yMm: pointerMm.yMm - current.startPointerMm.yMm
      };
      // Constrain the pointer delta to the wall's own perpendicular — project
      // it onto the unit normal captured at drag start, so a diagonal mouse
      // movement only ever drives the wall along its normal, never sideways.
      const offsetMm = deltaMm.xMm * current.normal.xMm + deltaMm.yMm * current.normal.yMm;

      // Live preview validity: run the actual domain op against the
      // committed project (not the store) purely to see whether it throws —
      // same idiom as canMoveRoomVertex gating the vertex-drag preview.
      let valid = true;
      try {
        moveRoomWall(project, current.roomId, current.wallId, offsetMm);
      } catch {
        valid = false;
      }

      return { ...current, previewOffsetMm: offsetMm, valid };
    },
    onRelease: (current) => {
      // Sub-threshold release is a click, not a move — no commit. An invalid
      // final offset REVERTS: displayedProject falls back to the pre-drag
      // project the instant wallDrag goes null above, so "revert" costs
      // nothing extra here — just don't call onMoveRoomWall.
      if (Math.abs(current.previewOffsetMm) < 0.5 || !current.valid) return;

      void onMoveRoomWall?.(current.roomId, current.wallId, current.previewOffsetMm);
    }
  });
  // The wall edge the pointer is hovering, when it belongs to the selected
  // non-rectangle room — teaches the wall→chip link (the wall lights up and its
  // WallSlideHandles chip gets the stronger treatment). Cheap: only set while
  // hovering an eligible edge, cleared on leave.
  const [hoveredWallId, setHoveredWallId] = useState<string | null>(null);
  // Partition create-drag — same deferred-closure note as `drag` above:
  // onMove references toSvgMm/snapDrawPoint/partitionDrawInvalid, and
  // onRelease references onAddFreestandingWall/onPartitionToolChange, all
  // declared further down this component body.
  //
  // Escape disarms the partition tool mid-draw (see the keydown handler
  // below, which calls onPartitionToolChange?.(false)); the old hand-rolled
  // version cancelled the gesture outright by nulling this state directly,
  // which tore the window listeners down on the spot. useDragGesture has no
  // such imperative cancel, so cancellation is expressed as a commit-time
  // gate instead: onRelease reads the live `partitionToolActive` prop (fresh
  // every render, same as every other closure here) and skips the commit —
  // and skips it silently, since RENDER already hides the whole preview layer
  // behind `{partitionToolActive ? ... : null}` the instant Escape fires, so
  // there is nothing left on screen for the lingering listeners to animate.
  // The one observable difference from the original: the window listeners
  // stay subscribed until the pointer actually lifts (instead of tearing
  // down at the keypress) — inert, since nothing renders and nothing commits
  // in that window.
  const {
    drag: partitionDraw,
    dragRef: partitionDrawRef,
    beginDrag: startPartitionDraw
  } = useDragGesture<PartitionDrawState>({
    onMove: (current, event) => {
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;
      const endMm = snapDrawPoint(pointerMm, current.startMm, event.shiftKey);
      return { ...current, endMm, invalid: partitionDrawInvalid(current.startMm, endMm) };
    },
    onRelease: (current) => {
      onPartitionToolChange?.(false);
      if (!current.endMm || current.invalid || !partitionToolActive) return;
      onAddFreestandingWall?.(current.startMm, current.endMm);
    }
  });
  // Rectangle-room create-drag — same deferred-closure and Escape-as-commit-gate
  // discipline as the partition machine above. onMove snaps each corner via
  // snapDrawPoint(pointerMm, null, …): passing prev=null gives a pure grid snap,
  // so Shift's H/V axis-lock is structurally inert here — correct, since locking
  // a corner to the start's axis would degenerate the rectangle to a line.
  // onRelease disarms FIRST (after both commit and cancel — disarm-after-one),
  // then commits min-corner origin + absolute size, but only while still armed
  // (the !drawRectActive gate is the Escape-cancel path, exactly like partition).
  const {
    drag: rectDraw,
    dragRef: rectDrawRef,
    beginDrag: startRectDraw
  } = useDragGesture<RectDrawState>({
    onMove: (current, event) => {
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;
      const endMm = snapDrawPoint(pointerMm, null, event.shiftKey);
      return { ...current, endMm, invalid: rectDrawInvalid(current.startMm, endMm) };
    },
    onRelease: (current) => {
      onDrawRectChange?.(false);
      if (!current.endMm || current.invalid || !drawRectActive) return;
      onAddRectangleRoom?.({
        offsetXMm: Math.min(current.startMm.xMm, current.endMm.xMm),
        offsetYMm: Math.min(current.startMm.yMm, current.endMm.yMm),
        widthMm: Math.abs(current.endMm.xMm - current.startMm.xMm),
        depthMm: Math.abs(current.endMm.yMm - current.startMm.yMm)
      });
    }
  });
  // Partition edit-drag (whole-body move, or one endpoint re-drag) — same
  // deferred-closure note as the machines above: onMove references
  // gridSnapTargets/snapThresholdMm/snapToGrid/snapDrawPoint, onRelease
  // references onMoveFreestandingWall/onMoveFreestandingWallEndpoint, all
  // declared further down this component body.
  const {
    drag: partitionDrag,
    dragRef: partitionDragRef,
    beginDrag: startPartitionDrag
  } = useDragGesture<PartitionDragState>({
    onMove: (current, event) => {
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;
      const deltaMm = {
        xMm: pointerMm.xMm - current.startPointerMm.xMm,
        yMm: pointerMm.yMm - current.startPointerMm.yMm
      };

      if (current.mode === "move") {
        // Do not let a nearby snap target turn a click (or tiny pointer jitter)
        // into a move. The same screen-scaled threshold drives the dimension
        // axis latch, and only raw pointer travel may activate an axis.
        const latchThresholdMm = snapThresholdMm / 2;
        const movedAxes = getPartitionMovedAxes(current.movedAxes, deltaMm, latchThresholdMm);
        if (!movedAxes.x && !movedAxes.y) {
          return { ...current, movedAxes };
        }

        // Snap the MIDPOINT, not an endpoint: wall-aware targets (equidistant-
        // between-walls + sibling-partition alignment) rank above grid and stay
        // active even with grid snap OFF; snapping to an equidistant target
        // lands the partition exactly where "center between walls" would.
        const origMid = {
          xMm: (current.startFloorMm.xMm + current.endFloorMm.xMm) / 2,
          yMm: (current.startFloorMm.yMm + current.endFloorMm.yMm) / 2
        };
        const proposedMid = { xMm: origMid.xMm + deltaMm.xMm, yMm: origMid.yMm + deltaMm.yMm };

        const placement = project.floor.rooms.find((candidate) =>
          candidate.room.freestandingWalls.some((wall) => wall.id === current.wallId)
        );
        const partition = placement?.room.freestandingWalls.find(
          (wall) => wall.id === current.wallId
        );
        const partitionTargets: SnapTarget[] =
          placement && partition
            ? getPartitionMoveSnapTargets({
                room: placement.room,
                placementOffsetMm: { xMm: placement.offsetXMm, yMm: placement.offsetYMm },
                partition,
                proposedMidFloorMm: proposedMid
              })
            : [];

        const snap = resolveSnap(
          proposedMid,
          [...partitionTargets, ...(snapToGrid ? gridSnapTargets : [])],
          { thresholdMm: snapThresholdMm, previousSnapTargetIds: current.previousSnapTargetIds }
        );
        const appliedDelta = {
          xMm: snap.point.xMm - origMid.xMm,
          yMm: snap.point.yMm - origMid.yMm
        };
        // Clip the snap guides to the containing room's floor-space bbox (padded
        // ~200mm so they read just beyond the walls) rather than the full
        // viewBox. An x-guide (vertical) is bounded on y and vice versa.
        const guidePadMm = 200;
        const roomBox = placement ? getPlacedRoomBounds(placement) : null;
        const activeGuides = roomBox
          ? snap.activeGuides.map((guide) => ({
              ...guide,
              extentMm:
                guide.axis === "x"
                  ? { startMm: roomBox.minY - guidePadMm, endMm: roomBox.maxY + guidePadMm }
                  : { startMm: roomBox.minX - guidePadMm, endMm: roomBox.maxX + guidePadMm }
            }))
          : snap.activeGuides;
        return {
          ...current,
          previewStartFloorMm: {
            xMm: current.startFloorMm.xMm + appliedDelta.xMm,
            yMm: current.startFloorMm.yMm + appliedDelta.yMm
          },
          previewEndFloorMm: {
            xMm: current.endFloorMm.xMm + appliedDelta.xMm,
            yMm: current.endFloorMm.yMm + appliedDelta.yMm
          },
          activeGuides,
          movedAxes,
          previousSnapTargetIds: snap.snapTargetIds
        };
      }

      // Endpoint drag. Precedence: Shift H/V lock > wall-kiss > grid. Wall-kiss
      // reuses snapDrawPointToRooms so the endpoint latches onto real room
      // perimeter, excluding the dragged partition's OWN faces (it can't cling
      // to the slab it belongs to). Shift then locks the run to the anchor.
      const anchor = current.mode === "start" ? current.endFloorMm : current.startFloorMm;
      const kissWalls = floorWallsForTool.filter((wall) => {
        const parsed = parseFaceWallId(wall.id);
        return parsed === null || parsed.freestandingWallId !== current.wallId;
      });
      const kiss = snapDrawPointToRooms(pointerMm, kissWalls, snapThresholdMm);
      let moved: Vector2 = kiss
        ? { xMm: kiss.pointMm.xMm, yMm: kiss.pointMm.yMm }
        : snapDrawPoint({ xMm: pointerMm.xMm, yMm: pointerMm.yMm }, anchor, false);
      if (event.shiftKey) {
        const dx = Math.abs(pointerMm.xMm - anchor.xMm);
        const dy = Math.abs(pointerMm.yMm - anchor.yMm);
        moved =
          dx >= dy ? { xMm: moved.xMm, yMm: anchor.yMm } : { xMm: anchor.xMm, yMm: moved.yMm };
      }
      return current.mode === "start"
        ? { ...current, previewStartFloorMm: moved, activeGuides: [], previousSnapTargetIds: undefined }
        : { ...current, previewEndFloorMm: moved, activeGuides: [], previousSnapTargetIds: undefined };
    },
    onRelease: (current) => {
      if (current.mode === "move") {
        if (!current.movedAxes.x && !current.movedAxes.y) return;
        const delta = {
          xMm: current.previewStartFloorMm.xMm - current.startFloorMm.xMm,
          yMm: current.previewStartFloorMm.yMm - current.startFloorMm.yMm
        };
        if (Math.hypot(delta.xMm, delta.yMm) < 0.5) return;
        onMoveFreestandingWall?.(current.wallId, delta);
        return;
      }
      const next =
        current.mode === "start" ? current.previewStartFloorMm : current.previewEndFloorMm;
      const original = current.mode === "start" ? current.startFloorMm : current.endFloorMm;
      if (Math.hypot(next.xMm - original.xMm, next.yMm - original.yMm) < 0.5) return;
      onMoveFreestandingWallEndpoint?.(current.wallId, current.mode, next);
    }
  });

  const [selectedVertexId, setSelectedVertexId] = useState<string | null>(null);
  const selectedVertexIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedVertexIdRef.current = selectedVertexId;
  }, [selectedVertexId]);
  useEffect(() => {
    // Disarming (or re-arming on a different room) clears any vertex selection,
    // so a stale vertex can't be the target of a later Delete keypress.
    setSelectedVertexId(null);
  }, [reshapeRoomId]);

  const bounds = getFloorBounds(project.floor);
  const padding = getPlanViewPaddingMm(bounds);
  // The fit extent every gesture measures against: the padded floor bounds,
  // clamped to a sane minimum window (see clampFitExtent) so an empty floor
  // or a lone tiny room doesn't fit-zoom in absurdly tight.
  // getViewBox2D turns the current viewport (fit or manual pan/zoom) into the
  // concrete viewBox rect + its exact pixels-per-mm, so `viewBoxBounds` below
  // is the ZOOMED window — every downstream consumer (grid, snap targets,
  // px→mm constants, guide extents) inherits the zoom automatically.
  const contentBounds = clampFitExtent(bounds, padding);
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

  // The project to render during a drag — one PlanPreview layer per live
  // gesture (wall resize, room move, reshape-mode vertex drag, reshape-mode
  // wall slide), composed by the domain layer in the same order this view
  // used to hand-splice them. See planPreview.ts for the fallback/validity
  // semantics of each layer. useMemo (keyed on the committed project plus
  // every drag state, all of which are null/reference-stable when their
  // gesture isn't live) preserves the pre-refactor guarantee that rendering
  // with nothing in flight yields the exact `project` reference, not a copy.
  const displayedProject = useMemo(() => {
    const preview: PlanPreview = {
      wallResize: drag
        ? { wallId: drag.targetWallId, lengthMm: drag.previewLengthMm, anchor: drag.anchor }
        : undefined,
      roomMove: roomDrag
        ? {
            roomId: roomDrag.roomId,
            offsetXMm: roomDrag.previewOffsetMm.xMm,
            offsetYMm: roomDrag.previewOffsetMm.yMm
          }
        : undefined,
      vertexMove: vertexDrag
        ? {
            roomId: vertexDrag.roomId,
            vertexId: vertexDrag.vertexId,
            xMm: vertexDrag.previewLocalMm.xMm,
            yMm: vertexDrag.previewLocalMm.yMm
          }
        : undefined,
      wallSlide: wallDrag
        ? { roomId: wallDrag.roomId, wallId: wallDrag.wallId, offsetMm: wallDrag.previewOffsetMm }
        : undefined
    };
    return applyPlanPreview(project, preview);
  }, [project, drag, roomDrag, vertexDrag, wallDrag]);

  // The shared 2D viewport gesture engine (pan / zoom / pinch / wheel /
  // keyboard), formerly a ~350-line copy inline here and in ElevationView. It
  // works EXCLUSIVELY in SVG userspace (y-down) — plan floor coordinates are
  // already y-down, so there is no flip anywhere. A single finger's pan-start is
  // delegated back to this view's bubble-phase background handler (beginMarquee
  // → beginTouchPan), and the post-gesture trailing-click suppression stays
  // view-owned (armSuppressNextToolClick), reproduced via onGestureEnd.
  const gestures = useSvgViewportGestures({
    svgRef,
    viewport,
    onViewportChange,
    contentBounds,
    containerSize,
    zoomLimits: PLAN_ZOOM_LIMITS,
    // A 2nd finger landing over ANY in-flight single-finger edit (wall resize,
    // room move, or object/group move) blocks rather than starting a pinch —
    // defer to that edit (preserves the old capture guard).
    isPinchBlocked: () =>
      Boolean(
        dragRef.current ||
          roomDragRef.current ||
          objectDragRef.current ||
          vertexDragRef.current ||
          wallDragRef.current
      ),
    onGestureEnd: (info) => {
      // A space/middle mouse-pan always fires a trailing `click` on the svg; a
      // real touch pan/pinch (moved past slop, so !isTap) does too. Both must
      // arm the suppression so that click can't clear the selection or place a
      // tool. A stationary touch tap (isTap) leaves the flag be, so its native
      // click still selects/places/clears exactly as today.
      if (info.kind === "mouse-pan" || !info.isTap) armSuppressNextToolClick();
    }
  });
  const { isSpaceDown, panning, zoomAtCenter, canZoomIn, canZoomOut, beginTouchPan } = gestures;
  // The hook's toSvgPoint is byte-identical to the old local toSvgMm; alias it
  // so every existing call site stays untouched.
  const toSvgMm = gestures.toSvgPoint;

  // The arm+auto-reset idiom for the trailing-click suppression flag: a real
  // pan/pinch/marquee release fires a trailing `click` on the svg, and this
  // marks the very next handleSvgClick to be swallowed. The setTimeout(0) is
  // the safety net for a release that lands where no click follows (pointer
  // left the svg mid-gesture).
  function armSuppressNextToolClick() {
    suppressNextToolClickRef.current = true;
    window.setTimeout(() => {
      suppressNextToolClickRef.current = false;
    }, 0);
  }

  // Only the committed project's walls matter for tool placement — a tool
  // can't be armed mid wall-resize-drag anyway (see the drag guard in the
  // pointer/click handlers below), so there's no live-preview geometry to
  // reconcile here the way displayedProject does for rendering.
  const floorWallsForTool = useMemo(() => getFloorWalls(project.floor), [project.floor]);
  // The door/window armed tools capture the nearest wall at any distance, so
  // their candidate set excludes partition faces — openings on partitions are
  // disallowed in v1 (spec §6.1). Blocked zones ARE allowed on faces, so they
  // keep the full set. Object drags/group moves keep faces regardless.
  const openingToolWalls = useMemo(
    () =>
      activeTool === "blocked-zone"
        ? floorWallsForTool
        : floorWallsForTool.filter((wall) => parseFaceWallId(wall.id) === null),
    [floorWallsForTool, activeTool]
  );

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

  // The static plan drawing (room polygons/walls, partition slabs, opening-
  // connection glyphs, placed object rects) — ONE derivation, shared with the
  // PNG/PDF export builders, so an export can never disagree with the canvas.
  // Built from displayedProject so every live drag preview that flows through
  // the project override (wall resize, room move, reshape, partition edits)
  // renders for free; the object-drag preview rects layer on top at render
  // time via the same getRenderedWallObjectPlanRect the builder uses.
  // Everything gestural (handles, ghosts, guides, marquee) stays inline below.
  const planScene = useMemo(
    () =>
      buildPlanScene(displayedProject, {
        artworksById,
        minWallObjectDepthMm: wallObjectMinDepthMm
      }),
    [displayedProject, artworksById, wallObjectMinDepthMm]
  );

  // Live four-sided clearance dimension lines for the selected partition, or
  // the actively dragged one (whichever is live) — both normal (face) gaps and
  // both span (end-cap) gaps, so dragging on either axis always shows all four
  // true clear distances. During a drag we build a temporary partition from the
  // preview endpoints (floor → room-local by subtracting the placement offset)
  // so the numbers track the pointer; the room perimeter and sibling partitions
  // are committed geometry, so we cast against `project`. The result is lifted
  // back to floor space for the render-only component.
  const partitionClearancesFloor = useMemo<{
    clearances: PartitionClearances;
    partition: FreestandingWall;
  } | null>(() => {
    const activeWallId = partitionDrag?.wallId ?? selectedFreestandingWallId;
    if (!activeWallId) return null;

    const placement = project.floor.rooms.find((candidate) =>
      candidate.room.freestandingWalls.some((wall) => wall.id === activeWallId)
    );
    const committed = placement?.room.freestandingWalls.find((wall) => wall.id === activeWallId);
    if (!placement || !committed) return null;

    const offset = { xMm: placement.offsetXMm, yMm: placement.offsetYMm };
    const partition =
      partitionDrag && partitionDrag.wallId === activeWallId
        ? {
            ...committed,
            startXMm: partitionDrag.previewStartFloorMm.xMm - offset.xMm,
            startYMm: partitionDrag.previewStartFloorMm.yMm - offset.yMm,
            endXMm: partitionDrag.previewEndFloorMm.xMm - offset.xMm,
            endYMm: partitionDrag.previewEndFloorMm.yMm - offset.yMm
          }
        : committed;

    const local = getPartitionClearances(placement.room, partition);
    const liftSide = (side: SideClearance): SideClearance => ({
      originMm: { xMm: side.originMm.xMm + offset.xMm, yMm: side.originMm.yMm + offset.yMm },
      dirUnit: side.dirUnit,
      hit: side.hit
        ? {
            ...side.hit,
            pointMm: {
              xMm: side.hit.pointMm.xMm + offset.xMm,
              yMm: side.hit.pointMm.yMm + offset.yMm
            }
          }
        : null
    });
    return {
      clearances: {
        normal: { plus: liftSide(local.normal.plus), minus: liftSide(local.normal.minus) },
        span: { plus: liftSide(local.span.plus), minus: liftSide(local.span.minus) }
      },
      // Direction-only — the mask mapping is translation-invariant, so the
      // room-local `partition` serves without lifting to floor space.
      partition
    };
  }, [partitionDrag, selectedFreestandingWallId, project.floor.rooms]);

  function disarmTool() {
    onToolChange(null);
  }

  // Whenever the armed tool changes — App toggling a toolbar button, the
  // Escape handler below disarming it, or the single-shot disarm after a
  // placement commits — drop the stale ghost/hysteresis so the next arm (or
  // a re-arm of a different kind) starts clean. This lived inline in a
  // combined setActiveTool+reset call before activeTool was lifted into App;
  // syncing off the prop here is the controlled-component equivalent.
  useEffect(() => {
    setToolGhost(null);
    toolSnapTargetIdsRef.current = undefined;
  }, [activeTool]);

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
      walls: openingToolWalls,
      wallObjects: project.wallObjects,
      movingSize,
      movingKind: activeTool,
      floatPolicy: activeTool === "blocked-zone" ? "float" : "capture-any",
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

  // Arming/disarming draw mode starts a fresh gesture or discards the pending
  // one — no store write ever happens for the discarded points (see DrawState).
  useEffect(() => {
    setDraw(
      drawRoomActive
        ? { points: [], cursorMm: null, invalid: false, closing: false, snap: null }
        : null
    );
  }, [drawRoomActive]);

  // Enter closes (≥3 points), Backspace pops the last point, Escape cancels the
  // whole draw. Scoped to while draw mode is armed so it never competes with
  // App's global handlers; reads live points via drawRef.
  useEffect(() => {
    if (!drawRoomActive) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onDrawRoomChange?.(false);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        attemptCloseDraw();
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        setDraw((state) =>
          state
            ? { ...state, points: state.points.slice(0, -1), invalid: false, closing: false, snap: null }
            : state
        );
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // Subscribed once per arm (keyed on drawRoomActive), reading live points
    // via drawRef — same discipline as the drag effects, so the handler set is
    // deliberately not resubscribed on every appended vertex.
  }, [drawRoomActive]);

  // Edit-shape mode is armed explicitly for every room (RoomInspector's "Edit
  // shape" button / a plan double-click set reshapeRoomId). Escape disarms it;
  // Delete/Backspace removes the selected vertex (merges its two walls). Scoped
  // to while it's armed, same idiom as the draw-mode handler above — reads the
  // live selection via selectedVertexIdRef so it isn't resubscribed on every
  // vertex click.
  useEffect(() => {
    if (!reshapeRoomId) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onReshapeRoomChange?.(null);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        const vertexId = selectedVertexIdRef.current;
        if (!vertexId || !onDeleteRoomVertex || !reshapeRoomId) return;
        event.preventDefault();
        setSelectedVertexId(null);
        void onDeleteRoomVertex(reshapeRoomId, vertexId);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reshapeRoomId, onReshapeRoomChange, onDeleteRoomVertex]);

  // Escape disarms the partition tool (mirrors the draw-mode handler), scoped
  // to while it's armed so it never competes with App's global handlers.
  useEffect(() => {
    if (!partitionToolActive) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onPartitionToolChange?.(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [partitionToolActive, onPartitionToolChange]);

  // Escape disarms the rectangle-room tool (same shape as the partition handler
  // above); the release gate then skips the commit if a drag was in flight.
  useEffect(() => {
    if (!drawRectActive) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onDrawRectChange?.(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawRectActive, onDrawRectChange]);

  // Snap a draw point: grid + axis-lock to the previous point's x/y (so
  // consecutive walls line up), with Shift forcing an exact H/V segment.
  function snapDrawPoint(pointerMm: Vector2, prev: Vector2 | null, shiftKey: boolean): Vector2 {
    let result: Vector2 = pointerMm;
    if (snapToGrid) {
      const targets: SnapTarget[] = [...gridSnapTargets];
      if (prev) {
        targets.push(
          { id: "draw-prev-x", kind: "grid", axis: "x", point: { xMm: prev.xMm, yMm: 0 } },
          { id: "draw-prev-y", kind: "grid", axis: "y", point: { xMm: 0, yMm: prev.yMm } }
        );
      }
      result = resolveSnap(pointerMm, targets, { thresholdMm: snapThresholdMm }).point;
    }
    if (shiftKey && prev) {
      const dx = Math.abs(pointerMm.xMm - prev.xMm);
      const dy = Math.abs(pointerMm.yMm - prev.yMm);
      // Lock the minor axis to the previous point, keep the (snapped) major one.
      result =
        dx >= dy ? { xMm: result.xMm, yMm: prev.yMm } : { xMm: prev.xMm, yMm: result.yMm };
    }
    return result;
  }

  // The draw candidate: existing-room snapping takes PRECEDENCE over grid +
  // axis-lock (§6.3), so a new room latches onto a placed room and can share a
  // wall exactly. When nothing is in range it falls back to snapDrawPoint's
  // grid + previous-point behavior. Shift's H/V lock still applies afterward —
  // to whichever base point won — exactly as it applies to the grid-snapped
  // result. Returns the snap so the indicator and close-on-wall test can use it.
  function snapDrawCandidate(
    pointerMm: Vector2,
    prev: Vector2 | null,
    shiftKey: boolean
  ): { point: Vector2; snap: DrawRoomSnap | null } {
    const snap = snapDrawPointToRooms(pointerMm, floorWallsForTool, snapThresholdMm);
    if (!snap) {
      return { point: snapDrawPoint(pointerMm, prev, shiftKey), snap: null };
    }
    let point: Vector2 = { xMm: snap.pointMm.xMm, yMm: snap.pointMm.yMm };
    if (shiftKey && prev) {
      const dx = Math.abs(pointerMm.xMm - prev.xMm);
      const dy = Math.abs(pointerMm.yMm - prev.yMm);
      point =
        dx >= dy ? { xMm: point.xMm, yMm: prev.yMm } : { xMm: prev.xMm, yMm: point.yMm };
    }
    return { point, snap };
  }

  // Does clicking this room-snapped candidate close the loop onto its wall
  // (§6.3)? Requires ≥3 points, an edge/vertex snap onto a perimeter wall whose
  // segment also carries points[0], and the closed polygon staying valid
  // (no self-intersection). Mirrors attemptCloseDraw's simple-polygon gate.
  function drawCloseOnWall(points: Vector2[], candidate: Vector2, snap: DrawRoomSnap | null): boolean {
    if (!snap || points.length < 3) return false;
    const wall = floorWallsForTool.find((candidateWall) => candidateWall.id === snap.wallId);
    if (!wall) return false;
    if (!canCloseOnWall(points, candidate, wall)) return false;
    if (drawSegmentInvalid(points, candidate)) return false;
    return isSimplePolygon([...points, candidate]);
  }

  // Would the new segment (last point → candidate) cross the placed path? The
  // segment adjacent to it legitimately shares the last vertex, so only a
  // collinear backtrack over that one counts; every earlier segment uses the
  // full intersection test.
  function drawSegmentInvalid(points: Vector2[], candidate: Vector2): boolean {
    const n = points.length;
    if (n === 0) return false;
    const last = points[n - 1];
    for (let i = 0; i < n - 1; i += 1) {
      const s1 = points[i];
      const s2 = points[i + 1];
      if (i === n - 2) {
        const crossV =
          (s1.xMm - last.xMm) * (candidate.yMm - last.yMm) -
          (s1.yMm - last.yMm) * (candidate.xMm - last.xMm);
        const dot =
          (s1.xMm - last.xMm) * (candidate.xMm - last.xMm) +
          (s1.yMm - last.yMm) * (candidate.yMm - last.yMm);
        if (Math.abs(crossV) <= DRAW_EPS && dot > DRAW_EPS) return true;
      } else if (segmentsIntersect(last, candidate, s1, s2)) {
        return true;
      }
    }
    return false;
  }

  function closeRadiusMm(): number {
    return pixelsPerMm > 0 ? CLOSE_HANDLE_PX / pixelsPerMm : 0;
  }

  function isWithinClose(points: Vector2[], pointerMm: Vector2): boolean {
    if (points.length < 3) return false;
    return (
      Math.hypot(pointerMm.xMm - points[0].xMm, pointerMm.yMm - points[0].yMm) <=
      closeRadiusMm()
    );
  }

  function attemptCloseDraw() {
    const current = drawRef.current;
    if (!current || current.points.length < 3) return;
    if (!isSimplePolygon(current.points)) {
      setDraw((state) => (state ? { ...state, invalid: true } : state));
      return;
    }
    onAddPolygonRoom?.(current.points.map((point) => ({ xMm: point.xMm, yMm: point.yMm })));
    onDrawRoomChange?.(false);
  }

  function handleDrawPointerMove(event: ReactPointerEvent<SVGRectElement>) {
    const current = drawRef.current;
    if (!current) return;
    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    if (isWithinClose(current.points, pointerMm)) {
      setDraw((state) =>
        state
          ? { ...state, cursorMm: state.points[0], invalid: false, closing: true, snap: null }
          : state
      );
      return;
    }

    const prev = current.points.at(-1) ?? null;
    const { point: candidate, snap } = snapDrawCandidate(pointerMm, prev, event.shiftKey);
    // A room-snapped candidate on a wall carrying points[0] previews as a
    // close, not a rubber-band vertex — same `closing` affordance as the
    // near-first-vertex path so the user sees the click will finish the room.
    const willClose = drawCloseOnWall(current.points, candidate, snap);
    const invalid = !willClose && drawSegmentInvalid(current.points, candidate);
    setDraw((state) =>
      state ? { ...state, cursorMm: candidate, invalid, closing: willClose, snap } : state
    );
  }

  function handleDrawClick(event: ReactMouseEvent<SVGRectElement>) {
    // Own the click entirely so the svg's handleSvgClick (background clear /
    // tool place) never also runs while drawing.
    event.stopPropagation();
    // A space/middle-mouse pan fires a trailing click on this capture rect;
    // swallow it so a pan never drops a spurious vertex (same flag the svg
    // click handler consumes for placement clicks).
    if (suppressNextToolClickRef.current) {
      suppressNextToolClickRef.current = false;
      return;
    }
    const current = drawRef.current;
    if (!current) return;
    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    if (isWithinClose(current.points, pointerMm)) {
      attemptCloseDraw();
      return;
    }

    const prev = current.points.at(-1) ?? null;
    const { point: candidate, snap } = snapDrawCandidate(pointerMm, prev, event.shiftKey);
    // Closing onto an existing wall (§6.3): append the on-wall candidate and
    // commit in one shot — same path as attemptCloseDraw — so the shared wall
    // emerges as coincident geometry. Checked before the min-spacing guard so a
    // close that lands near the previous vertex still completes.
    if (drawCloseOnWall(current.points, candidate, snap)) {
      const closedPoints = [...current.points, candidate];
      onAddPolygonRoom?.(closedPoints.map((point) => ({ xMm: point.xMm, yMm: point.yMm })));
      onDrawRoomChange?.(false);
      return;
    }
    if (
      prev &&
      Math.hypot(candidate.xMm - prev.xMm, candidate.yMm - prev.yMm) < MIN_DRAW_SPACING_MM
    ) {
      return;
    }
    if (drawSegmentInvalid(current.points, candidate)) {
      setDraw((state) => (state ? { ...state, invalid: true } : state));
      return;
    }
    setDraw((state) =>
      state
        ? {
            points: [...state.points, candidate],
            cursorMm: candidate,
            invalid: false,
            closing: false,
            snap
          }
        : state
    );
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
    if (event.pointerType !== "touch") {
      event.currentTarget.focus({ preventScroll: true });
    }

    // The touch pinch/pan bookkeeping and the space/middle-mouse pan claim now
    // live in the hook. It returns true ONLY when it CONSUMED the event (a pinch
    // claim — including the blocked-pinch case — or a space/middle pan claim),
    // in which case the view's own capture-tail below must not run. On false (a
    // 1st touch, a 3rd+ touch, or an ordinary left press) the tail still runs,
    // so a press on an object still arms suppressNextToolClickRef exactly as a
    // mouse press did.
    if (gestures.handlePointerDownCapture(event)) return;

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
      walls: openingToolWalls,
      wallObjects: project.wallObjects,
      movingSize,
      movingKind: activeTool,
      floatPolicy: activeTool === "blocked-zone" ? "float" : "capture-any",
      currentAnchorWallId: null,
      captureDistanceMm,
      gridTargets: gridSnapTargets,
      snapToGrid,
      thresholdMm: snapThresholdMm,
      previousSnapTargetIds: toolSnapTargetIdsRef.current
    });

    // Door/window/blocked-zone tools never reject (float or capture-any), so
    // "none" is unreachable here — this guard just narrows the type for the
    // store call, which only accepts a committable PlanPlacement.
    if (result.placement.anchor === "none") return;

    const kind = activeTool;
    // Single-shot: disarm immediately so the tool never lingers armed after
    // a placement, matching WallInspector's "Add to this wall" buttons
    // (one click, one object) rather than a rubber-stamp mode.
    disarmTool();
    void onPlaceOpeningFromPlan(kind, result.placement);
  }

  function beginDrag(
    roomId: string,
    target: ResizeHandleTarget,
    event: ReactPointerEvent<SVGRectElement>
  ) {
    // toSvgMm is byte-identical to the old inline createSVGPoint/getScreenCTM/
    // matrixTransform(inverse()) sequence — both are SVG-userspace mm, and
    // both bail (here: silently return) when the svg has no CTM yet.
    const startPointerMm = toSvgMm(event.clientX, event.clientY);
    if (!startPointerMm) return;

    startDrag({
      roomId,
      targetWallId: target.targetWallId,
      axis: target.axis,
      anchor: target.anchor,
      startLengthMm: target.startLengthMm,
      startPointerMm,
      edgeStartMm: getMovingWallEdgeWorldPointMm(project, target.targetWallId, target.anchor),
      previewLengthMm: target.startLengthMm,
      previousSnapTargetId: undefined,
      activeGuides: []
    });
  }

  function beginRoomDrag(roomId: string, event: ReactPointerEvent<SVGPolygonElement>) {
    const placement = project.floor.rooms.find((candidate) => candidate.roomId === roomId);
    if (!placement) return;

    const startPointerMm = toSvgMm(event.clientX, event.clientY);
    if (!startPointerMm) return;

    const bounds = getRoomBounds(placement.room);
    const startOffsetMm: Vector2 = { xMm: placement.offsetXMm, yMm: placement.offsetYMm };

    startRoomDrag({
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

  function beginVertexDrag(
    roomId: string,
    vertexId: string,
    event: ReactPointerEvent<SVGRectElement>
  ) {
    event.stopPropagation();
    const placement = project.floor.rooms.find((candidate) => candidate.roomId === roomId);
    const vertex = placement?.room.vertices.find((candidate) => candidate.id === vertexId);
    if (!placement || !vertex) return;

    const startPointerMm = toSvgMm(event.clientX, event.clientY);
    if (!startPointerMm) return;

    // A plain click (no drag) still "selects" the vertex, for the
    // Delete/Backspace merge shortcut below.
    setSelectedVertexId(vertexId);
    startVertexDrag({
      roomId,
      vertexId,
      startPointerMm,
      startLocalMm: { xMm: vertex.xMm, yMm: vertex.yMm },
      previewLocalMm: { xMm: vertex.xMm, yMm: vertex.yMm },
      valid: true,
      previousSnapTargetIds: undefined,
      activeGuides: []
    });
  }

  // Splits at the CLICKED point along the wall (projected/clamped onto it),
  // not always the midpoint the "+" handle visually sits on — per the spec,
  // clicked position is preferred when it differs from the handle's own
  // position. Uses the committed project's wall geometry (floorWallsForTool):
  // a split is a single click, never in flight during a vertex drag.
  function handleSplitWallClick(wallId: string, event: ReactMouseEvent<SVGElement>) {
    if (!onSplitWall) return;
    const wall = floorWallsForTool.find((candidate) => candidate.id === wallId);
    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!wall || !pointerMm) return;

    const projection = projectPointToWall(pointerMm, wall);
    void onSplitWall(wallId, projection.xAlongMm);
  }

  function beginWallDrag(roomId: string, wallId: string, event: ReactPointerEvent<SVGElement>) {
    event.stopPropagation();
    const placement = project.floor.rooms.find((candidate) => candidate.roomId === roomId);
    const wall = placement?.room.walls.find((candidate) => candidate.id === wallId);
    if (!placement || !wall) return;

    const startPointerMm = toSvgMm(event.clientX, event.clientY);
    if (!startPointerMm) return;

    const geometry = getWallGeometry(placement.room, wall);
    if (geometry.lengthMm === 0) return;
    // Left-normal of the wall's start→end axis — the exact convention
    // moveRoomWall itself uses, so a positive previewOffsetMm here previews
    // precisely the direction the domain op will commit.
    const normal: Vector2 = unitLeftNormal(geometry.start, geometry.end);

    startWallDrag({
      roomId,
      wallId,
      startPointerMm,
      normal,
      previewOffsetMm: 0,
      valid: true
    });
  }

  function partitionDrawInvalid(startMm: Vector2, endMm: Vector2): boolean {
    const lengthMm = Math.hypot(endMm.xMm - startMm.xMm, endMm.yMm - startMm.yMm);
    if (lengthMm < PARTITION_MIN_LENGTH_MM) return true;
    const midpoint = {
      xMm: (startMm.xMm + endMm.xMm) / 2,
      yMm: (startMm.yMm + endMm.yMm) / 2
    };
    return roomIdContainingPoint(project, midpoint) === null;
  }

  // A rectangle whose either side is below the minimum reads as a stray click,
  // not a room. No room-containment check (unlike partitions): rooms may overlap
  // on creation, and this also lets the FIRST room be drawn on an empty floor.
  function rectDrawInvalid(startMm: Vector2, endMm: Vector2): boolean {
    return (
      Math.abs(endMm.xMm - startMm.xMm) < RECT_ROOM_MIN_SIZE_MM ||
      Math.abs(endMm.yMm - startMm.yMm) < RECT_ROOM_MIN_SIZE_MM
    );
  }

  // Begin a partition centerline drag from the capture overlay (armed tool).
  function beginPartitionDraw(event: ReactPointerEvent<SVGRectElement>) {
    event.stopPropagation();
    if (suppressNextToolClickRef.current) {
      suppressNextToolClickRef.current = false;
      return;
    }
    const startMm = toSvgMm(event.clientX, event.clientY);
    if (!startMm) return;
    const snapped = snapDrawPoint(startMm, null, event.shiftKey);
    startPartitionDraw({ startMm: snapped, endMm: null, invalid: true });
  }

  // Begin a rectangle-room drag from the capture overlay (armed tool). Grid-snap
  // the first corner; prev=null keeps it a pure grid snap (see the machine note).
  function beginRectDraw(event: ReactPointerEvent<SVGRectElement>) {
    event.stopPropagation();
    if (suppressNextToolClickRef.current) {
      suppressNextToolClickRef.current = false;
      return;
    }
    const startMm = toSvgMm(event.clientX, event.clientY);
    if (!startMm) return;
    const snapped = snapDrawPoint(startMm, null, event.shiftKey);
    startRectDraw({ startMm: snapped, endMm: null, invalid: true });
  }

  // Begin a partition edit drag: whole-body move, or one endpoint re-drag.
  function beginPartitionDrag(
    partition: FloorPartition,
    mode: "move" | "start" | "end",
    event: ReactPointerEvent<SVGElement>
  ) {
    event.stopPropagation();
    const startPointerMm = toSvgMm(event.clientX, event.clientY);
    if (!startPointerMm) return;
    onSelectFreestandingWall?.(partition.wallId);
    startPartitionDrag({
      wallId: partition.wallId,
      mode,
      startPointerMm,
      startFloorMm: partition.startMm,
      endFloorMm: partition.endMm,
      previewStartFloorMm: partition.startMm,
      previewEndFloorMm: partition.endMm,
      activeGuides: [],
      movedAxes: { x: false, y: false },
      previousSnapTargetIds: undefined
    });
  }

  // The browser fires a `click` on the grabbed element right after a drag's
  // pointerup. For a single object that click merely re-selects it (today's
  // behavior, harmless); after a real GROUP drag the same click would call
  // onSelectObject non-additively and collapse the whole multi-selection to
  // Select suppression: when a pointer release triggers a trailing click that
  // must not collapse a multi-selection (group drags, marquee selection, etc.),
  // mark it here so the click handler can skip the selection.
  const { suppressNextSelect, consumeSelectSuppression, suppressNextSelectRef } =
    useSelectSuppression();

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
          // Artwork renders offset to the viewer's side (spec §5.3); picking
          // must follow what's on screen, not the wall centerline.
          getWallObjectPlanRect(
            wall,
            object,
            effectiveWallObjectDepthMm,
            object.kind === "artwork"
          ),
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

  function beginMarquee(event: ReactPointerEvent<SVGSVGElement>) {
    // Touch: a finger on true background pans the canvas instead of marqueeing
    // (the marquee is a mouse-only gesture on tablets). A pinch's 2nd finger was
    // already claimed (stopPropagation) in the capture handler, so it never
    // reaches here; beginTouchPan self-guards (exactly one pointer, no live
    // pinch), and the hook decides tap-vs-pan on release. Returns unconditionally
    // for touch so a finger never falls through into the marquee path below.
    if (event.pointerType === "touch") {
      beginTouchPan(event.clientX, event.clientY);
      return;
    }

    // Only true background reaches here: PlanObject and the resize handles
    // stopPropagation in their own pointerdown. (This is a separate mechanism
    // from onPointerDownCapture, which fires in the capture phase to flag a
    // click as started-on-an-object — that handler stays untouched.)
    //
    // Bail when a tool is armed: a marquee drag would fight click-to-place.
    // Stay inert until App wires the multi-select handlers (same gate as
    // elevation). Never start over an in-flight gesture. Draw mode owns the
    // whole surface via its capture overlay, so a marquee must not start there.
    if (activeTool || drawRoomActive || partitionToolActive || drawRectActive) return;
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
    startMarquee({ startMm, currentMm: startMm });
  }

  // The float policy for a moving placed object. For every kind but artwork it's
  // kind-only; an artwork's depends on its effective form (a floor work moves
  // floor-only, a wall work rejects off the wall), so we resolve the object's
  // artworkId (wall or floor object) and read the form. An unresolved artwork
  // falls back to the wall-only default (floatPolicyForKind's own fallback).
  function floatPolicyForMovingObject(kind: WallObject["kind"], objectId: string): FloatPolicy {
    if (kind !== "artwork") return floatPolicyForKind(kind);
    const placed =
      project.wallObjects.find((object) => object.id === objectId) ??
      project.floorObjects.find((object) => object.id === objectId);
    const artworkId = placed?.kind === "artwork" ? placed.artworkId : null;
    return floatPolicyForKind("artwork", artworkFormFor(artworkId));
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
        startObjectDrag({
          objectId: params.objectId,
          kind: params.kind,
          floatPolicy: floatPolicyForMovingObject(params.kind, params.objectId),
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

    startObjectDrag({
      objectId: params.objectId,
      kind: params.kind,
      floatPolicy: floatPolicyForMovingObject(params.kind, params.objectId),
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

  // The dragged artwork's image aspect, so a partial/unknown-dimension work's
  // drop preview is sized at its true proportions (matching what placeArtwork
  // bakes) instead of the raw placeholder box. Only the currently-dragged
  // artwork is loaded, keyed off draggingArtworkId's asset.
  const draggingArtworkAspect = useArtworkAspect(
    draggingArtworkId ? artworksById?.get(draggingArtworkId)?.assetId : undefined
  );

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
      // The aspect only applies to the artwork we actually loaded it for.
      const aspect = artworkId === draggingArtworkId ? draggingArtworkAspect : undefined;
      const { widthMm, heightMm } = getEffectivePlacementSizeMm(artwork.dimensions, aspect);
      return {
        widthMm,
        heightMm,
        // Floor footprint depth for a floor-work drop — shared with the store
        // commit and 3D via effectiveFloorDepthMm; ignored for a wall drop.
        depthMm: effectiveFloorDepthMm(artwork.dimensions)
      };
    }
    return {
      widthMm: PLACEHOLDER_ARTWORK_WIDTH_MM,
      heightMm: PLACEHOLDER_ARTWORK_HEIGHT_MM,
      depthMm: DEFAULT_FLOOR_OBJECT_DEPTH_MM
    };
  }

  // The effective placement form of the artwork under a drag — governs whether
  // the drop captures a wall (wall work) or lands on the floor (floor work). An
  // unresolved id (placeholder drag before the payload is known) reads as a wall
  // work, the conservative default (matches floatPolicyForKind's own fallback).
  function artworkFormFor(artworkId: string | null): PlacementForm {
    const artwork = artworkId ? artworksById?.get(artworkId) : undefined;
    return artwork ? effectivePlacementForm(artwork) : "wall";
  }

  function resolveArtworkDrop(
    pointerMm: Vector2,
    dims: ReturnType<typeof effectiveArtworkDims>,
    // ⌘/Ctrl (mouse) or an explicit request bypasses snapping/quantization:
    // kill the grid tier and drop the neighbor threshold to zero so the point
    // lands exactly under the pointer. Touch drags pass false — they have no
    // modifier and read best fully snapped.
    bypassSnap: boolean,
    // The dragged work's effective form: a wall work rejects off every wall
    // (resolves to `{ anchor: "none" }`), a floor work goes straight to the
    // floor stage and never captures a wall (floor-only).
    form: PlacementForm
  ) {
    return resolvePlanPlacement(pointerMm, {
      walls: floorWallsForTool,
      wallObjects: project.wallObjects,
      movingSize: dims,
      movingKind: "artwork",
      floatPolicy: floatPolicyForKind("artwork", form),
      currentAnchorWallId: null,
      captureDistanceMm,
      gridTargets: gridSnapTargets,
      snapToGrid: bypassSnap ? false : snapToGrid,
      thresholdMm: bypassSnap ? 0 : snapThresholdMm,
      previousSnapTargetIds: dropSnapTargetIdsRef.current
    });
  }

  // Shared by the HTML5 dragover handler and the touch-drag subscription: given
  // client coordinates and the artwork being dragged, resolve the placement and
  // paint the drop ghost. Assumes the caller has already gated on an active
  // drag; it always draws (the drop target is known to be under the pointer).
  function updateArtworkDropGhost(
    clientX: number,
    clientY: number,
    artworkId: string | null,
    bypassSnap: boolean
  ) {
    const pointerMm = toSvgMm(clientX, clientY);
    if (!pointerMm) return;

    const result = resolveArtworkDrop(
      pointerMm,
      effectiveArtworkDims(artworkId),
      bypassSnap,
      artworkFormFor(artworkId)
    );
    dropSnapTargetIdsRef.current = result.snapTargetIds;
    setDropGhost({
      planRect: result.planRect,
      placement: result.placement,
      activeGuides: result.activeGuides
    });
  }

  function clearArtworkDropGhost() {
    setDropGhost(null);
    dropSnapTargetIdsRef.current = undefined;
  }

  // Shared by the HTML5 drop handler and the touch-drag subscription: commit
  // the placement. Caller has already resolved and validated the artworkId.
  function completeArtworkDrop(
    clientX: number,
    clientY: number,
    artworkId: string,
    bypassSnap: boolean
  ) {
    const pointerMm = toSvgMm(clientX, clientY);
    if (!pointerMm) return;

    const placement = resolveArtworkDrop(
      pointerMm,
      effectiveArtworkDims(artworkId),
      bypassSnap,
      artworkFormFor(artworkId)
    ).placement;
    // A floor work lands on the floor (floor-only policy always resolves a floor
    // center) via the store's placeArtworkOnFloor path.
    if (placement.anchor === "floor") {
      onPlaceArtworkOnFloor?.(artworkId, placement.xMm, placement.yMm);
      return;
    }
    // A wall work is wall-only: only a wall capture commits. `anchor: "none"`
    // (no wall in range) is a rejected drop — a no-op, matching the danger ghost
    // the user saw.
    if (placement.anchor !== "wall") return;
    const wall = floorWallsForTool.find((candidate) => candidate.id === placement.wallId);
    // A wall-dropped artwork hangs at the wall's centerline (its own default,
    // or the project default) — plan view chooses no y itself.
    const yMm = wall?.defaultCenterlineHeightMm ?? project.defaultCenterlineHeightMm;
    onPlaceArtwork?.(artworkId, placement.wallId, placement.xMm, yMm);
  }

  function handleArtworkDragOver(event: ReactDragEvent<HTMLDivElement>) {
    // iPadOS Safari hides custom MIME types during dragover/drop, so fall back
    // to the app-level drag state (draggingArtworkId), and further to the
    // module-level drag session for when WebKit's event ordering leaves that
    // state already cleared by the time dragover/drop fires.
    if (
      !event.dataTransfer.types.includes(ARTWORK_DRAG_MIME) &&
      !draggingArtworkId &&
      !peekArtworkDragSession()
    )
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    updateArtworkDropGhost(
      event.clientX,
      event.clientY,
      draggingArtworkId,
      event.metaKey || event.ctrlKey
    );
  }

  function handleArtworkDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    // Only clear when the pointer actually leaves the surface, not when it
    // crosses between child elements (which also fire dragleave).
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    clearArtworkDropGhost();
  }

  function handleArtworkDrop(event: ReactDragEvent<HTMLDivElement>) {
    const artworkId =
      event.dataTransfer.getData(ARTWORK_DRAG_MIME) || draggingArtworkId || peekArtworkDragSession();
    consumeArtworkDragSession();
    clearArtworkDropGhost();
    if (!artworkId) return;
    if (!artworksById?.get(artworkId)) return;
    event.preventDefault();
    completeArtworkDrop(event.clientX, event.clientY, artworkId, event.metaKey || event.ctrlKey);
  }

  // The touch/pen drag path (iOS/iPadOS, where HTML5 DnD is unavailable/
  // unreliable) reaches the drop target through the module-level session rather
  // than DOM drag events. The handlers close over live state/props, so route
  // them through a ref refreshed each render and subscribe once — re-running the
  // subscription on every render would churn the shared listener Set.
  const touchDropRef = useRef({
    updateGhost: updateArtworkDropGhost,
    complete: completeArtworkDrop,
    clearGhost: clearArtworkDropGhost,
    isValidArtwork: (id: string) => Boolean(artworksById?.get(id))
  });
  touchDropRef.current = {
    updateGhost: updateArtworkDropGhost,
    complete: completeArtworkDrop,
    clearGhost: clearArtworkDropGhost,
    isValidArtwork: (id: string) => Boolean(artworksById?.get(id))
  };

  useEffect(() => {
    return subscribeArtworkTouchDrag((dragEvent) => {
      const container = containerRef.current;
      const handlers = touchDropRef.current;
      if (!container) return;
      if (dragEvent.type === "cancel") {
        handlers.clearGhost();
        return;
      }
      const rect = container.getBoundingClientRect();
      const inside =
        dragEvent.clientX >= rect.left &&
        dragEvent.clientX <= rect.right &&
        dragEvent.clientY >= rect.top &&
        dragEvent.clientY <= rect.bottom;
      if (dragEvent.type === "move") {
        // Touch has no modifier keys, so never bypass snapping.
        if (inside) handlers.updateGhost(dragEvent.clientX, dragEvent.clientY, dragEvent.artworkId, false);
        else handlers.clearGhost();
        return;
      }
      // drop: always clear the ghost; place only if it landed inside and the id
      // still resolves to a known artwork (mirrors the HTML5 drop guard).
      handlers.clearGhost();
      if (inside && handlers.isValidArtwork(dragEvent.artworkId)) {
        handlers.complete(dragEvent.clientX, dragEvent.clientY, dragEvent.artworkId, false);
      }
    });
    // containerRef is stable; the effect subscribes once for the component's life.
  }, [containerRef]);

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
      <ViewportZoomControls
        zoom={getEffectiveZoom(viewport)}
        isFit={viewport.mode === "fit"}
        canZoomIn={canZoomIn}
        canZoomOut={canZoomOut}
        onZoomIn={() => zoomAtCenter(ZOOM_STEP)}
        onZoomOut={() => zoomAtCenter(1 / ZOOM_STEP)}
        onFit={() => onViewportChange(FIT_VIEWPORT)}
      />
      <svg
        className={
          activeTool || drawRoomActive || partitionToolActive || drawRectActive
            ? "plan-svg tool-armed"
            : "plan-svg"
        }
        ref={svgRef}
        viewBox={viewBox}
        role="img"
        tabIndex={0}
        onClick={handleSvgClick}
        onPointerDown={beginMarquee}
        onPointerDownCapture={handleSvgPointerDownCapture}
        onPointerLeave={handleToolPointerLeave}
        onPointerMove={handleToolPointerMove}
      >
        <title>{project.title} plan</title>
        {/* Room interiors render below the grid (the grid must stay visible
            on the room's "paper"), walls and handles above it. */}
        {planScene.rooms.map((room) => (
          <polygon
            className="room-fill"
            key={room.roomId}
            points={svgPolygonPoints(room.polygonMm)}
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
        {/* Room walls (+ hover/hit strokes), the per-room hit polygons, and
            the partition slabs — the static structure the user clicks to
            select rooms/walls/partitions. Render-only; every handler stays
            defined in this component and is threaded through. */}
        <PlanStructureLayer
          rooms={planScene.rooms}
          partitions={planScene.partitions}
          selectedRoomId={selectedRoomId}
          reshapeRoomId={reshapeRoomId}
          selectedWallId={selectedWallId}
          hoveredWallId={hoveredWallId}
          selectedFreestandingWallId={selectedFreestandingWallId}
          activeTool={activeTool}
          drawRoomActive={drawRoomActive}
          drawRectActive={drawRectActive}
          partitionToolActive={partitionToolActive}
          partitionDrag={partitionDrag}
          suppressNextToolClickRef={suppressNextToolClickRef}
          setHoveredWallId={setHoveredWallId}
          onSelectWall={onSelectWall}
          onSelectRoom={onSelectRoom}
          onReshapeRoomChange={onReshapeRoomChange}
          onSelectFreestandingWall={onSelectFreestandingWall}
          beginRoomDrag={beginRoomDrag}
          beginPartitionDrag={beginPartitionDrag}
        />
        {/* Live partition clearance dimension lines — shown while a partition
            is selected or being dragged; render-only, muted drafting ink. */}
        {partitionClearancesFloor ? (
          <PartitionDimensionLines
            clearances={partitionClearancesFloor.clearances}
            partition={partitionClearancesFloor.partition}
            visibleWorldAxes={
              // At rest (no drag) or during an endpoint re-drag, show all four
              // gaps. During a MOVE drag show only the latched axes — both false
              // until the first threshold crossing, so nothing shows until the
              // partition has actually travelled.
              partitionDrag && partitionDrag.mode === "move"
                ? partitionDrag.movedAxes
                : { x: true, y: true }
            }
            handleSizeMm={handleSizeMm}
            unit={wallUnit}
          />
        ) : null}
        {/* Placed objects: opening-connection glyphs, wall-anchored object
            rects, and floor-placed object rects. Reads the live objectDrag
            preview + selection ids; tooltipsDisabled is derived here from the
            in-flight gesture/armed-tool state this component owns. */}
        <PlacedObjectsLayer
          openingConnections={planScene.openingConnections}
          wallObjects={planScene.wallObjects}
          floorObjects={planScene.floorObjects}
          pixelsPerMm={pixelsPerMm}
          objectDrag={objectDrag}
          tooltipsDisabled={Boolean(
            drag ||
              objectDrag ||
              dropGhost ||
              activeTool ||
              roomDrag ||
              drawRoomActive ||
              drawRectActive ||
              vertexDrag
          )}
          artworksById={artworksById}
          thumbnailUrlsByAssetId={thumbnailUrlsByAssetId}
          unit={project.unit}
          wallObjectMinDepthMm={wallObjectMinDepthMm}
          objectHitMinMm={objectHitMinMm}
          selectedArtworkId={selectedArtworkId}
          selectedOpeningId={selectedOpeningId}
          selectedObjectIds={selectedObjectIds}
          consumeSelectSuppression={consumeSelectSuppression}
          beginObjectDrag={beginObjectDrag}
          onSelectObject={onSelectObject}
          onSelectArtwork={onSelectArtwork}
          onSelectOpening={onSelectOpening}
        />
        {/* Selection decorations: the selected room's wash/outline/handle set
            + live length labels, then the selected partition's face labels and
            endpoint handles. Both paint above placed objects, at rest nothing.
            committedRooms is the pre-drag baseline the reshape diff measures. */}
        <PlanHandlesLayer
          rooms={planScene.rooms}
          partitions={planScene.partitions}
          committedRooms={project.floor.rooms}
          selectedRoomId={selectedRoomId}
          selectedFreestandingWallId={selectedFreestandingWallId}
          reshapeRoomId={reshapeRoomId}
          handleSizeMm={handleSizeMm}
          wallUnit={wallUnit}
          hoveredWallId={hoveredWallId}
          selectedVertexId={selectedVertexId}
          drag={drag}
          vertexDrag={vertexDrag}
          wallDrag={wallDrag}
          partitionDrag={partitionDrag}
          beginDrag={beginDrag}
          beginWallDrag={beginWallDrag}
          beginVertexDrag={beginVertexDrag}
          handleSplitWallClick={handleSplitWallClick}
          beginPartitionDrag={beginPartitionDrag}
        />
        {/* Gestural overlays: the polygon-room draw preview + capture rect, the
            partition- and rectangle-draw previews, the armed-tool/drop ghosts,
            the snap guides, and the in-progress marquee. activeGuides picks the
            single live gesture's guides in the same precedence as before. */}
        <PlanOverlaysLayer
          drawRoomActive={drawRoomActive}
          draw={draw}
          partitionToolActive={partitionToolActive}
          partitionDraw={partitionDraw}
          drawRectActive={drawRectActive}
          rectDraw={rectDraw}
          toolGhost={toolGhost}
          dropGhost={dropGhost}
          marquee={marquee}
          activeGuides={
            objectDrag?.activeGuides ??
            dropGhost?.activeGuides ??
            drag?.activeGuides ??
            roomDrag?.activeGuides ??
            partitionDrag?.activeGuides ??
            toolGhost?.activeGuides ??
            []
          }
          activeTool={activeTool}
          viewBox={viewBoxBounds}
          handleSizeMm={handleSizeMm}
          wallUnit={wallUnit}
          wallObjectMinDepthMm={wallObjectMinDepthMm}
          floorWalls={floorWallsForTool}
          handleDrawClick={handleDrawClick}
          handleDrawPointerMove={handleDrawPointerMove}
          beginPartitionDraw={beginPartitionDraw}
          beginRectDraw={beginRectDraw}
        />
      </svg>
    </div>
  );
}

function getPlanViewPaddingMm(bounds: { width: number; height: number }): number {
  const largestDimensionMm = Math.max(bounds.width, bounds.height);

  return Math.max(900, largestDimensionMm * 0.14);
}

// Whole-partition moves latch each axis from pointer travel, never from the
// potentially larger correction introduced by snapping. Exported for the
// focused interaction regression tests alongside clampFitExtent below.
export function getPartitionMovedAxes(
  current: { x: boolean; y: boolean },
  pointerDeltaMm: Vector2,
  thresholdMm: number
): { x: boolean; y: boolean } {
  return {
    x: current.x || Math.abs(pointerDeltaMm.xMm) > thresholdMm,
    y: current.y || Math.abs(pointerDeltaMm.yMm) > thresholdMm
  };
}

// The padded floor bounds, expanded (never shrunk) so neither axis is
// narrower than MIN_PLAN_FIT_EXTENT_MM — grown symmetrically around the
// floor bounds' own center, which is the origin for an empty floor (see
// getFloorBounds). Exported only for unit testing; not a shared utility.
export function clampFitExtent(
  bounds: { minX: number; minY: number; width: number; height: number },
  padding: number
): { x: number; y: number; width: number; height: number } {
  const rawWidth = bounds.width + padding * 2;
  const rawHeight = bounds.height + padding * 2;
  const width = Math.max(MIN_PLAN_FIT_EXTENT_MM, rawWidth);
  const height = Math.max(MIN_PLAN_FIT_EXTENT_MM, rawHeight);
  const centerX = bounds.minX + bounds.width / 2;
  const centerY = bounds.minY + bounds.height / 2;

  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height
  };
}
