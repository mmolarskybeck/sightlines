import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import type { Vector2 } from "../../domain/geometry/dragResize";
import {
  getNeighborAwareSegments,
  getSpacingSegments
} from "../../domain/placement/arrangeOnWall";
import {
  getWallObjectBoundsMm,
  type RectBoundsMm
} from "../../domain/placement/collision";
import {
  resolveDragBarriers,
  WALL_BARRIER_EDGE_IDS,
  type BarrierObstacle
} from "../../domain/placement/dragBarriers";
import { getGroupBounds, getIdsIntersectingRect } from "../../domain/placement/groupBounds";
import { getOverlapRule } from "../../domain/placement/overlapPolicy";
import {
  getEffectivePlacementSizeMm,
  PLACEHOLDER_ARTWORK_HEIGHT_MM,
  PLACEHOLDER_ARTWORK_WIDTH_MM
} from "../../domain/placement/placeArtwork";
import { getDefaultOpeningSizeMm, type OpeningKind } from "../../domain/placement/createOpening";
import { effectivePlacementForm } from "../../domain/placement/artworkForm";
import type {
  Artwork,
  DisplayUnit,
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
  ELEVATION_ZOOM_LIMITS,
  FIT_VIEWPORT,
  getEffectiveZoom,
  getFitBoundsViewport,
  getViewBox2D,
  ZOOM_STEP,
  type Viewport2D
} from "../../domain/viewport/viewport2d";
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
import { ElevationArtwork } from "./ElevationArtwork";
import { ElevationOpening } from "./ElevationOpening";
import { ArtworkTooltipContent, OpeningTooltipContent } from "./PlacementTooltip";
import { marqueeRectMm, type MarqueeState } from "./marqueeRect";
import { buildElevationScene } from "../../domain/scene2d/elevationScene";
import { getFitSelectionBoundsSvg, isArtworkOutOfWallBounds, wallLocalYToSvgY } from "./elevationArtworkGeometry";
import { GridOverlay } from "./GridOverlay";
import { GroupDimensionLines } from "./GroupDimensionLines";
import { Button } from "./ui/button";
import { ViewportZoomControls } from "./ViewportZoomControls";
import { WallSwitcher, type WallSwitcherEntry } from "./WallSwitcher";

// Re-exported for backward compatibility — this used to be defined here,
// and nothing outside this file depends on the distinction between "defined
// here" and "defined in elevationArtworkGeometry.ts and re-exported."
export { wallLocalYToSvgY };

const SNAP_THRESHOLD_PX = 10;

// The macOS-window "shove past a barrier" distance, in screen pixels. Set at
// ~5× the snap threshold so the two gestures read as different intents: a snap
// is a nudge into alignment, a barrier break is a deliberate push. Kept in
// screen px (converted to mm per current zoom, like snapThresholdMm) so the
// feel is zoom-independent — the same finger-travel pops a barrier whether
// zoomed way in or fit to the whole wall.
const BARRIER_BREAK_PX = 48;

// Stable module-level reference so a caller that doesn't pass `getBlob`
// (the pre-wiring default) doesn't retrigger useAssetImageUrls's fetch
// effect on every render — the hook depends on its getBlob argument's
// identity. Rejecting immediately is fine: the hook treats a failed fetch as
// "leave this id unresolved," never as a thrown error.
const NO_OP_GET_BLOB: (key: string) => Promise<Blob> = () =>
  Promise.reject(new Error("ElevationView: no getBlob provided"));

// Stable empty fallback for the store-connected wallObjects slice, so a null
// project (pre-boot) never yields a fresh [] that would defeat the selector's
// referential-equality re-render guard.
const EMPTY_WALL_OBJECTS: WallObject[] = [];

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
  // Drag-barrier hysteresis (see dragBarriers.ts): the set of obstacle / wall-
  // edge ids this drag has already "popped" past (or started overlapping).
  // Carried frame-to-frame so a broken barrier stays broken until the object
  // separates from it, and re-arms once it does.
  brokenBarrierIds?: string[];
};


// The HTML5-drop preview for a not-yet-placed artwork being dragged in from
// the checklist. Separate from MoveDragState because it has no existing
// wallObjectId/startCenterMm — it's a brand-new placement, not a move — but
// it flows through the exact same resolveElevationPlacement call (snap →
// quantize → drag barriers) so a drop can never land somewhere the ghost didn't
// just show: same resolver, same broken-barrier set threaded frame-to-frame,
// same final point handed to the commit.
type DropGhostState = {
  centerMm: Vector2;
  sizeMm: { widthMm: number; heightMm: number };
  previousSnapTargetIds?: SnapTargetIds;
  activeGuides: Guide[];
  // Drag-barrier hysteresis, mirroring MoveDragState.brokenBarrierIds. A fresh
  // ghost starts with an empty set; each dragover frame carries the resolver's
  // returned set back in.
  brokenBarrierIds?: string[];
};

type OpeningToolGhostState = {
  centerMm: Vector2;
  sizeMm: { widthMm: number; heightMm: number };
  activeGuides: Guide[];
};

export function ElevationView({
  allowOverlappingPlacement = false,
  activeTool = null,
  artworksById,
  draggingArtworkId = null,
  centerlineMm,
  centerlineVisible = true,
  getBlob,
  gridPrecisionFloorMm,
  gridVisible,
  onMoveOpening,
  onMovePlacement,
  onMoveWallObjects,
  onToolChange,
  onPlaceOpeningOnElevation,
  onPlaceArtwork,
  onMarqueeSelect,
  selectedArtworkId = null,
  selectedOpeningId = null,
  previewPositionsById,
  arrangeSessionMode = null,
  selectedObjectIds = [],
  snapToGrid = false,
  unit,
  wallHeightMm,
  wallId,
  wallLengthMm,
  wallName,
  walls = [],
  viewport,
  onViewportChange
}: {
  gridPrecisionFloorMm: number | null;
  gridVisible: boolean;
  activeTool?: OpeningKind | null;
  wallName: string;
  wallLengthMm: number;
  wallHeightMm: number;
  centerlineMm: number;
  // Elevation-only "eyeline" visibility toggle (mirrors gridVisible). Purely
  // visual — the centerline alignment SNAP in resolveElevationPlacement stays
  // unconditional regardless of this flag, matching how snapToGrid stays
  // independent of gridVisible. Defaults true so every existing call site
  // (including tests) that doesn't pass it keeps rendering the line exactly
  // as before this toggle existed.
  centerlineVisible?: boolean;
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
  // Live arrange-session preview positions (id → center), layered over the
  // committed wallObjects before anything downstream reads them — rendering,
  // snap neighbors, drag start centers, group bounds, marquee hit-testing all
  // see the preview as if it were committed. The in-flight drag preview
  // (previewCenterById) then stacks on top of this layer.
  previewPositionsById?: Record<string, { xMm: number; yMm: number }>;
  // The live arrange session's mode, null when no session is open (mirrors
  // ArrangeSession["mode"]). Idle, and during an "inset" ("From edges")
  // session, dimension lines stay neighbour-aware — the panel's fields now
  // measure to the same detected boundary (wall or nearest neighbour), so the
  // lines match. During "equal"/"gap" sessions the lines switch to wall-edge
  // outer segments instead, since those modes' Calculated readouts are still
  // wall-only.
  arrangeSessionMode?: "equal" | "inset" | "gap" | null;
  artworksById?: Map<string, Artwork>;
  selectedArtworkId?: string | null;
  selectedOpeningId?: string | null;
  getBlob?: (key: string) => Promise<Blob>;
  snapToGrid?: boolean;
  // The curator's "Allow overlap" preference. Governs drag-barrier hardness for
  // any pair that involves an artwork (getOverlapRule → "blockable"): OFF makes
  // those barriers HARD (the drag clamps flush, matching the commit gate that
  // would reject the overlap); ON makes them YIELDING (a deliberate shove pops
  // through, and the commit accepts it). Opening×opening pairs are "forbidden"
  // and stay hard regardless. Defaults false so pre-wiring behaves as the gate.
  allowOverlappingPlacement?: boolean;
  draggingArtworkId?: string | null;
  onPlaceArtwork?: (artworkId: string, wallId: string, xMm: number, yMm: number) => void;
  onMovePlacement?: (wallObjectId: string, xMm: number, yMm: number) => void;
  onMoveOpening?: (wallObjectId: string, xMm: number, yMm: number) => void;
  // Commits a group drag in ONE call — every member's final center, artworks
  // and openings alike (the single-object drag keeps its onMovePlacement/
  // onMoveOpening split; this is the multi-select path only).
  onMoveWallObjects?: (moves: { id: string; xMm: number; yMm: number }[]) => void;
  onToolChange?: (tool: OpeningKind | null) => void;
  onPlaceOpeningOnElevation?: (
    kind: OpeningKind,
    wallId: string,
    xMm: number,
    yMm: number
  ) => void;
  // Multi-select ids the inspector/marquee scope to. A derived selection
  // value (App owns the derivation), so it stays a prop; the bare select/clear
  // actions are read from the store in the body.
  selectedObjectIds?: string[];
  onMarqueeSelect?: (ids: string[], additive: boolean) => void;
  // The full wall inventory (in room order), so the elevation chip can double
  // as a wall switcher. App-derived (wallsForSwitcher memo), so it stays a
  // prop; onSelectWall is read from the store below.
  walls?: WallSwitcherEntry[];
}) {
  const [containerRef, containerSize] = useContainerSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  // Store-connected passthroughs. App forwarded each of these verbatim (a bare
  // `prop={storeAction}`, and wallObjects={project.wallObjects}), so reading
  // them from the store here cuts the umbilical without moving ownership — the
  // store already owns them. Action selectors return stable references (no
  // re-render); the wallObjects slice re-renders on project change exactly as
  // the old prop did, falling back to a stable module-level empty array pre-
  // boot so the selector result never changes identity spuriously.
  const wallObjects = useAppStore((state) => state.project?.wallObjects ?? EMPTY_WALL_OBJECTS);
  const onSelectArtwork = useAppStore((state) => state.selectArtwork);
  const onSelectOpening = useAppStore((state) => state.selectOpening);
  const onSelectObject = useAppStore((state) => state.selectObject);
  const onClearSelection = useAppStore((state) => state.clearObjectSelection);
  const onSelectWall = useAppStore((state) => state.selectWall);
  const [dropGhost, setDropGhost] = useState<DropGhostState | null>(null);
  const [openingToolGhost, setOpeningToolGhost] = useState<OpeningToolGhostState | null>(null);
  const openingToolSnapTargetIdsRef = useRef<SnapTargetIds | undefined>(undefined);

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
  const snapThresholdMm = pixelsPerMm > 0 ? SNAP_THRESHOLD_PX / pixelsPerMm : 0;
  const barrierBreakMm = pixelsPerMm > 0 ? BARRIER_BREAK_PX / pixelsPerMm : 0;

  // The moveDrag state machine: pointer-drag move of an existing placement,
  // transient until release (docs/plan.md §7: live preview, exactly one store
  // commit on release). Collapsed via useDragGesture from the extracted copies
  // in PlanView and ElevationView.
  const { drag: moveDrag, dragRef: moveDragRef, beginDrag: beginMoveDragGesture, isDragging: isMoveDragging } = useDragGesture<MoveDragState>({
    onMove: (current, event) => {
      const pointerMm = toWallLocalMm(event.clientX, event.clientY);
      if (!pointerMm) return null;

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

      // Barriers need the REAL moving kinds (a group carrying an opening must
      // get that opening's stricter barriers); the SNAP call still passes
      // "artwork" for a group per the size rationale above. Member entries carry
      // their own kind, so no store lookup is needed here.
      const movingKinds: WallObject["kind"][] = current.members
        ? current.members.map((member) => member.kind)
        : [current.kind];

      const snapResult = resolveElevationPlacement(
        proposedCenterMm,
        // For a group, sizeMm is the union box and the whole thing resolves as
        // one virtual artwork (no per-kind floor tier — a mixed group has no
        // single kind); a single object keeps its own size and kind-gated floor.
        current.sizeMm,
        neighbors,
        current.members ? "artwork" : current.kind,
        movingKinds,
        current.previousSnapTargetIds,
        precisionBypass,
        new Set(current.brokenBarrierIds)
      );

      // A hard barrier that couldn't be resolved from here (wedged between two,
      // or clamping off one shoved the rect into another) → hold the preview at
      // the last legal position rather than commit an illegal one. Everything
      // else (including the freshly re-armed broken set) stays put too.
      if (snapResult.blocked) return { ...current };

      return {
        ...current,
        previewCenterMm: snapResult.point,
        previousSnapTargetIds: snapResult.snapTargetIds,
        activeGuides: snapResult.activeGuides,
        brokenBarrierIds: snapResult.brokenBarrierIds
      };
    },
    onRelease: (current, event) => {
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
  });

  // The marquee state machine: a pending rubber-band (marquee) selection on the
  // elevation background, tracked as two wall-local-mm pointer samples (start +
  // current). Collapsed via useDragGesture from the extracted copies in PlanView
  // and ElevationView.
  const { drag: marquee, dragRef: marqueeRef, beginDrag: beginMarqueeGesture, isDragging: isMarqueeragging } = useDragGesture<MarqueeState>({
    onMove: (current, event) => {
      const pointerMm = toWallLocalMm(event.clientX, event.clientY);
      if (!pointerMm) return null;

      return { ...current, currentMm: pointerMm };
    },
    onRelease: (current, event) => {
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
  });

  // The shared 2D viewport gesture engine (pan / zoom / pinch / wheel /
  // keyboard), formerly a ~350-line copy inline here and in PlanView. It works
  // EXCLUSIVELY in SVG userspace (y-down); the elevation y-flip stays in this
  // view's own toWallLocalMm below. A single finger's pan-start is delegated
  // back to this view's bubble-phase background handler (beginMarquee →
  // beginTouchPan), and a stationary background tap clears the selection via
  // onGestureEnd (elevation has no svg click handler, so unlike plan the clear
  // can't ride a trailing click).
  const {
    isSpaceDown,
    panning,
    toSvgPoint,
    zoomAtCenter,
    canZoomIn,
    canZoomOut,
    handlePointerDownCapture,
    beginTouchPan
  } = useSvgViewportGestures({
    svgRef,
    viewport,
    onViewportChange,
    contentBounds,
    containerSize,
    zoomLimits: ELEVATION_ZOOM_LIMITS,
    // A 2nd finger landing over an in-flight move-drag blocks rather than
    // starting a pinch — defer to that edit (preserves the old capture guard).
    isPinchBlocked: () => Boolean(moveDragRef.current),
    onGestureEnd: ({ kind, isTap, startedOnBackground }) => {
      if (kind === "touch" && isTap && startedOnBackground) {
        onClearSelection?.();
      }
    }
  });

  // Arrange-session previews applied once, up front: every downstream
  // consumer (rendering, snap-neighbor pool, beginMoveDrag start centers,
  // group bounds, marquee hit-testing, dimension lines) derives from this
  // array and therefore sees the preview positions for free.
  const effectiveWallObjects: WallObject[] = (wallObjects ?? []).map((object) => {
    const preview = previewPositionsById?.[object.id];
    return preview ? { ...object, xMm: preview.xMm, yMm: preview.yMm } : object;
  });

  // The static drawing (this-wall filter/kind split, out-of-bounds flags,
  // artwork joins, floor/centerline positions) — ONE derivation, shared with
  // the PNG/PDF export builders, so an export can never disagree with the
  // canvas. Built from effectiveWallObjects so arrange-session previews flow
  // through for free; the in-flight drag preview (previewCenterById) stacks
  // on top at render time. Everything gestural stays in this component.
  const elevationScene = buildElevationScene(effectiveWallObjects, {
    wallId,
    wallLengthMm,
    wallHeightMm,
    centerlineMm,
    artworksById
  });
  // Every wall object on this wall is a valid snap neighbor for any other —
  // an artwork can align to a door's edge just as readily as to another
  // artwork's (docs/plan.md §2 snap-target priority doesn't distinguish by
  // kind, only centerline > neighbor-center > neighbor-edge > grid).
  const wallObjectsOnThisWall: WallObject[] = [
    ...elevationScene.artworks.map((entry) => entry.object),
    ...elevationScene.openings.map((entry) => entry.object)
  ];

  const assetIds = elevationScene.artworks.map((entry) => entry.artwork?.assetId);
  const imageUrlsByAssetId = useAssetImageUrls(assetIds, getBlob ?? NO_OP_GET_BLOB, "display");

  // The dragged artwork's image aspect, so a partial/unknown-dimension work's
  // drop ghost is sized at its true proportions (matching what placeArtwork
  // bakes) instead of the raw placeholder box. Only the currently-dragged
  // artwork is loaded, keyed off draggingArtworkId's asset.
  const draggingArtworkAspect = useArtworkAspect(
    draggingArtworkId ? artworksById?.get(draggingArtworkId)?.assetId : undefined
  );

  // The size to show for a not-yet-placed drop ghost: the real artwork's
  // effective size if the checklist told us which one is being dragged
  // (draggingArtworkId), otherwise the same placeholder size placement
  // itself falls back to (docs/plan.md §1.5: place before dimensions are
  // known).
  function effectiveSizeForArtworkId(artworkId: string | null): { widthMm: number; heightMm: number } {
    const artwork = artworkId ? artworksById?.get(artworkId) : undefined;
    if (artwork) {
      // The aspect only applies to the artwork we actually loaded it for.
      const aspect = artworkId === draggingArtworkId ? draggingArtworkAspect : undefined;
      return getEffectivePlacementSizeMm(artwork.dimensions, aspect);
    }
    return { widthMm: PLACEHOLDER_ARTWORK_WIDTH_MM, heightMm: PLACEHOLDER_ARTWORK_HEIGHT_MM };
  }

  function toWallLocalMm(clientX: number, clientY: number): Vector2 | null {
    // The client→SVG-userspace step is the hook's shared CTM conversion; only
    // the y-flip is elevation-specific and stays here.
    const svgPoint = toSvgPoint(clientX, clientY);
    if (!svgPoint) return null;

    // The SVG viewBox is already in wall-local mm with x running the same
    // direction as wall-local x (from the wall start), so only y needs the
    // shared y-up/y-down flip — the same function used to place every other
    // elevation element, applied here in the inverse direction (it's
    // self-inverse, since it's just wallHeightMm minus the value).
    return { xMm: svgPoint.xMm, yMm: wallLocalYToSvgY(wallHeightMm, svgPoint.yMm) };
  }

  // Per-neighbor barrier hardness for a moving object/group. The barrier is only
  // as soft as the STRICTEST rule allows across every moving kind vs this
  // neighbor's kind (a mixed group's union box uses the harshest member — the
  // union-box over-approximation is accepted; per-member resolution is a
  // non-goal): any "forbidden" pair (opening×opening) is always HARD; a
  // "blockable" pair (anything involving an artwork) is HARD when overlap isn't
  // allowed and YIELDING when it is. That keeps the drag feel in lockstep with
  // the commit gate — a barrier is hard exactly when a release there would be
  // rejected.
  function barrierHardnessFor(
    movingKinds: WallObject["kind"][],
    neighborKind: WallObject["kind"]
  ): BarrierObstacle["hardness"] {
    let hard = false;
    for (const movingKind of movingKinds) {
      const rule = getOverlapRule(movingKind, neighborKind);
      if (rule === "forbidden") return "hard";
      if (rule === "blockable" && !allowOverlappingPlacement) hard = true;
    }
    return hard ? "hard" : "yielding";
  }

  // The elevation placement pipeline shared by the move-drag preview and the
  // checklist drop-ghost. Three composed passes (docs: dragBarriers.ts):
  //   1. alignment snaps (floor/centerline/neighbor) keep priority;
  //   2. any axis a snap target did NOT capture is quantized to a clean
  //      measurement instead of left free — grid targets are deliberately
  //      excluded (snapToGrid: false to resolveArtworkSnap) since center-on-grid
  //      snapping re-creates the 1/16" edge problem, so the quantizer is the new
  //      lowest tier, gated on the real snapToGrid preference; then
  //   3. drag barriers clamp the snapped/quantized point flush against
  //      obstacles and the wall edges (macOS-window feel), popping soft barriers
  //      only on a deliberate shove past barrierBreakMm.
  // A held ⌘/Ctrl (precisionBypass) skips snapping AND quantization for a fully
  // free move — but still runs the barrier pass with includeYielding:false, so
  // HARD barriers survive the precision drag (otherwise a ⌘-drag would sail into
  // a forbidden overlap and simply die at the commit gate on release).
  function resolveElevationPlacement(
    proposed: Vector2,
    sizeMm: { widthMm: number; heightMm: number },
    neighbors: WallObject[],
    // The kind fed to resolveArtworkSnap: a group passes "artwork" (one virtual
    // object, no per-kind floor tier — see the onMove call site).
    movingKind: WallObject["kind"],
    // The REAL moving kinds, for barrier hardness only: a singleton for a solo
    // drag, every member's kind for a group (so a group carrying an opening gets
    // that opening's stricter barriers even though it snaps as "artwork").
    movingKinds: WallObject["kind"][],
    previousSnapTargetIds: SnapTargetIds | undefined,
    precisionBypass: boolean,
    brokenBarrierIds: ReadonlySet<string>
  ): {
    point: Vector2;
    activeGuides: Guide[];
    snapTargetIds: SnapTargetIds;
    brokenBarrierIds: string[];
    blocked: boolean;
  } {
    const obstacles: BarrierObstacle[] = neighbors.map((neighbor) => ({
      id: neighbor.id,
      boundsMm: getWallObjectBoundsMm(neighbor),
      hardness: barrierHardnessFor(movingKinds, neighbor.kind)
    }));

    if (precisionBypass) {
      // Free move, but hard barriers still apply (yielding + wall container are
      // skipped by includeYielding:false). No guides / snap ids under precision.
      const barriers = resolveDragBarriers({
        proposedCenterMm: proposed,
        movingSizeMm: sizeMm,
        obstacles,
        wallSizeMm: { lengthMm: wallLengthMm, heightMm: wallHeightMm },
        breakThresholdMm: barrierBreakMm,
        brokenBarrierIds,
        includeYielding: false
      });
      return {
        point: barriers.point,
        activeGuides: [],
        snapTargetIds: {},
        brokenBarrierIds: barriers.brokenBarrierIds,
        blocked: barriers.blocked
      };
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

    // snapToGrid OFF reproduces the pre-quantizer behavior: alignment snaps
    // only. Either way `point` then feeds the barrier pass below.
    const point: Vector2 = { ...snapResult.point };
    if (snapToGrid) {
      const incrementMm = gridPrecisionFloorMm ?? minorGridMm;
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
    }

    // Final pass: settle flush against obstacles / wall edges. Yielding barriers
    // are in play (includeYielding) so a normal drag can pop a soft one with a
    // deliberate shove; the wall container keeps the object on-wall.
    const barriers = resolveDragBarriers({
      proposedCenterMm: point,
      movingSizeMm: sizeMm,
      obstacles,
      wallSizeMm: { lengthMm: wallLengthMm, heightMm: wallHeightMm },
      breakThresholdMm: barrierBreakMm,
      brokenBarrierIds,
      includeYielding: true
    });

    return {
      point: barriers.point,
      activeGuides: snapResult.activeGuides,
      snapTargetIds: snapResult.snapTargetIds,
      brokenBarrierIds: barriers.brokenBarrierIds,
      blocked: barriers.blocked
    };
  }

  const openingToolSize = activeTool ? getDefaultOpeningSizeMm(activeTool) : null;

  // Opening insertion uses the same live snap/barrier resolver as an elevation
  // move. The only difference is that the preview starts from the pointer and
  // the committed result creates a new wall object instead of moving one.
  function resolveOpeningTool(proposed: Vector2) {
    if (!activeTool || !openingToolSize) return null;
    const result = resolveElevationPlacement(
      proposed,
      openingToolSize,
      wallObjectsOnThisWall,
      activeTool,
      [activeTool],
      openingToolSnapTargetIdsRef.current,
      false,
      new Set()
    );
    openingToolSnapTargetIdsRef.current = result.snapTargetIds;
    return result;
  }

  function handleOpeningToolPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!activeTool || !openingToolSize || moveDrag || marquee || dropGhost) return;
    const pointerMm = toWallLocalMm(event.clientX, event.clientY);
    if (!pointerMm) return;

    const result = resolveOpeningTool(pointerMm);
    if (!result) return;
    setOpeningToolGhost({
      centerMm: result.point,
      sizeMm: openingToolSize,
      activeGuides: result.activeGuides
    });
  }

  function handleOpeningToolPointerLeave() {
    setOpeningToolGhost(null);
    openingToolSnapTargetIdsRef.current = undefined;
  }

  function handleOpeningToolClick(event: ReactMouseEvent<SVGSVGElement>) {
    if (!activeTool || !openingToolSize || !wallId || !onPlaceOpeningOnElevation) return;
    if (moveDrag || marquee) return;

    const pointerMm = toWallLocalMm(event.clientX, event.clientY);
    if (!pointerMm) return;
    const result = resolveOpeningTool(pointerMm);
    if (!result || result.blocked) return;

    const kind = activeTool;
    onToolChange?.(null);
    void onPlaceOpeningOnElevation(kind, wallId, result.point.xMm, result.point.yMm);
  }

  useEffect(() => {
    setOpeningToolGhost(null);
    openingToolSnapTargetIdsRef.current = undefined;
  }, [activeTool, wallId]);

  useEffect(() => {
    if (!activeTool) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onToolChange?.(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTool, onToolChange]);

  // Pre-seed the broken-barrier set at grab time with every neighbor the moving
  // object/group already overlaps and every wall edge it already overhangs. This
  // is the legacy-data escape hatch: an object stored overlapping (or hanging
  // off the wall) can be dragged out smoothly instead of being yanked flush the
  // instant resolution runs, and each barrier re-arms the moment the object
  // clears it (dragBarriers.ts step 4). The tests here mirror that rebuild
  // exactly — STRICT overlap (edge-touch doesn't count) and the same edge ids.
  function seedBrokenBarrierIds(
    boxBoundsMm: RectBoundsMm,
    neighbors: WallObject[]
  ): string[] {
    const ids: string[] = [];
    for (const neighbor of neighbors) {
      const nb = getWallObjectBoundsMm(neighbor);
      if (
        boxBoundsMm.leftMm < nb.rightMm &&
        boxBoundsMm.rightMm > nb.leftMm &&
        boxBoundsMm.bottomMm < nb.topMm &&
        boxBoundsMm.topMm > nb.bottomMm
      ) {
        ids.push(neighbor.id);
      }
    }
    if (boxBoundsMm.leftMm < 0) ids.push(WALL_BARRIER_EDGE_IDS.left);
    if (boxBoundsMm.rightMm > wallLengthMm) ids.push(WALL_BARRIER_EDGE_IDS.right);
    if (boxBoundsMm.bottomMm < 0) ids.push(WALL_BARRIER_EDGE_IDS.bottom);
    if (boxBoundsMm.topMm > wallHeightMm) ids.push(WALL_BARRIER_EDGE_IDS.top);
    return ids;
  }


  // The browser fires a `click` on the grabbed element right after a drag's
  // pointerup. For a single object that click merely re-selects it (today's
  // behavior, harmless); after a real GROUP drag the same click would call
  // onSelectObject non-additively and collapse the whole multi-selection to
  // Select suppression: when a pointer release triggers a trailing click that
  // must not collapse a multi-selection (group drags, etc.), mark it here so
  // the click handler can skip the selection.
  const { suppressNextSelect, consumeSelectSuppression, suppressNextSelectRef } =
    useSelectSuppression();


  function beginMarquee(event: ReactPointerEvent<SVGSVGElement>) {
    if (activeTool) return;
    // Touch: a finger on true background pans the canvas instead of marqueeing
    // (the marquee is a mouse-only gesture on tablets). A pinch's 2nd finger was
    // already claimed (stopPropagation) in the capture handler, so it never
    // reaches here; the hook decides tap-vs-pan on release. Returns
    // unconditionally for touch so a finger never falls through into the marquee
    // path below.
    if (event.pointerType === "touch") {
      beginTouchPan(event.clientX, event.clientY);
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
    beginMarqueeGesture({ startMm, currentMm: startMm });
  }

  function handleSvgPointerDownCapture(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerType !== "touch") {
      event.currentTarget.focus({ preventScroll: true });
    }
    handlePointerDownCapture(event);
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
      const groupMembers: WallObject[] = wallObjectsOnThisWall.filter((object) =>
        selectedObjectIds.includes(object.id)
      );
      if (groupMembers.length > 1) {
        const box = getGroupBounds(groupMembers);
        const groupCenterMm: Vector2 = { xMm: box.centerXMm, yMm: box.centerYMm };
        // Seed against the union box vs every non-member neighbor.
        const memberIds = new Set(groupMembers.map((member) => member.id));
        const groupNeighbors = wallObjectsOnThisWall.filter(
          (object) => !memberIds.has(object.id)
        );
        beginMoveDragGesture({
          wallObjectId: wallObject.id,
          kind: wallObject.kind,
          sizeMm: { widthMm: box.widthMm, heightMm: box.heightMm },
          startPointerMm,
          startCenterMm: groupCenterMm,
          previewCenterMm: groupCenterMm,
          previousSnapTargetIds: undefined,
          activeGuides: [],
          brokenBarrierIds: seedBrokenBarrierIds(
            {
              leftMm: box.centerXMm - box.widthMm / 2,
              rightMm: box.centerXMm + box.widthMm / 2,
              bottomMm: box.centerYMm - box.heightMm / 2,
              topMm: box.centerYMm + box.heightMm / 2
            },
            groupNeighbors
          ),
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

    beginMoveDragGesture({
      wallObjectId: wallObject.id,
      kind: wallObject.kind,
      sizeMm: { widthMm: wallObject.widthMm, heightMm: wallObject.heightMm },
      startPointerMm,
      startCenterMm: { xMm: wallObject.xMm, yMm: wallObject.yMm },
      previewCenterMm: { xMm: wallObject.xMm, yMm: wallObject.yMm },
      previousSnapTargetIds: undefined,
      activeGuides: [],
      preserveSelection: altSoloDrag,
      brokenBarrierIds: seedBrokenBarrierIds(
        getWallObjectBoundsMm(wallObject),
        wallObjectsOnThisWall.filter((object) => object.id !== wallObject.id)
      )
    });
  }

  // Shared by the HTML5 dragover handler and the touch-drag subscription: given
  // client coordinates and the dragged artwork, resolve the placement and paint
  // the drop ghost. No-ops with no wall selected. Caller has gated on an active
  // drag; bypassSnap comes from ⌘/Ctrl on the mouse path, false on touch.
  // A floor work never hangs on a wall (USER DECISION), so it's not droppable in
  // elevation at all. Elevation has no danger-ghost vocabulary for a drop (a
  // wall artwork always resolves somewhere), so the closest existing affordance
  // is to refuse the drop outright: paint no ghost and commit nothing (the
  // dragover handler also flips the cursor to no-drop). An unresolved id reads
  // as a wall work, matching the plan-view default.
  function isFloorWork(artworkId: string | null): boolean {
    const artwork = artworkId ? artworksById?.get(artworkId) : undefined;
    return artwork ? effectivePlacementForm(artwork) === "floor" : false;
  }

  function updateArtworkDropGhost(
    clientX: number,
    clientY: number,
    artworkId: string | null,
    bypassSnap: boolean
  ) {
    if (!wallId) return;
    // A floor work can't hang here — refuse it (no ghost).
    if (isFloorWork(artworkId)) {
      setDropGhost(null);
      return;
    }
    const pointerMm = toWallLocalMm(clientX, clientY);
    if (!pointerMm) return;

    const sizeMm = effectiveSizeForArtworkId(artworkId);
    // A checklist drag-in is always an artwork: eyeline first, floor just below
    // it (see getArtworkSnapTargets' kind-dependent floor rank). ⌘/Ctrl held
    // over the surface bypasses snapping/quantization, same as a move-drag. The
    // broken-barrier set carries frame-to-frame like a move-drag's (a fresh
    // ghost starts empty), and neighbors are every object on the wall.
    const snapResult = resolveElevationPlacement(
      pointerMm,
      sizeMm,
      wallObjectsOnThisWall,
      "artwork",
      ["artwork"],
      dropGhost?.previousSnapTargetIds,
      bypassSnap,
      new Set(dropGhost?.brokenBarrierIds)
    );

    // A blocked resolve (dropped-into an unresolvable hard overlap) still paints
    // the best-effort ghost — unlike a move it has no "last legal" preview to
    // hold, and the commit gate is the final backstop on drop.
    setDropGhost({
      centerMm: snapResult.point,
      sizeMm,
      previousSnapTargetIds: snapResult.snapTargetIds,
      activeGuides: snapResult.activeGuides,
      brokenBarrierIds: snapResult.brokenBarrierIds
    });
  }

  // Shared by the HTML5 drop handler and the touch-drag subscription: commit the
  // placement. Guards wallId (this view needs it to place); the caller has
  // already validated the artworkId resolves to a known artwork.
  function completeArtworkDrop(
    clientX: number,
    clientY: number,
    artworkId: string,
    bypassSnap: boolean
  ) {
    if (!wallId) return;
    // A floor work is not droppable on a wall — refuse the commit (see
    // isFloorWork). The ghost was already suppressed, so this is a no-op release.
    if (isFloorWork(artworkId)) return;
    const pointerMm = toWallLocalMm(clientX, clientY);
    if (!pointerMm) return;

    const sizeMm = effectiveSizeForArtworkId(artworkId);
    // Must land exactly where the ghost showed — same resolver, same bypass, and
    // the SAME broken-barrier set the ghost last carried (read off the closed-
    // over dropGhost, still the last rendered value here even though handleDrop
    // has queued setDropGhost(null)). Without threading it, the final resolve
    // could re-arm a barrier the ghost had already popped and snap the drop back.
    const snapResult = resolveElevationPlacement(
      pointerMm,
      sizeMm,
      wallObjectsOnThisWall,
      "artwork",
      ["artwork"],
      undefined,
      bypassSnap,
      new Set(dropGhost?.brokenBarrierIds)
    );

    onPlaceArtwork?.(artworkId, wallId, snapResult.point.xMm, snapResult.point.yMm);
  }

  function handleDragOver(event: ReactDragEvent<HTMLDivElement>) {
    // iPadOS Safari hides custom MIME types during dragover/drop, so fall back
    // to the app-level drag state (draggingArtworkId), and further to the
    // module-level drag session for when WebKit's event ordering leaves that
    // state already cleared by the time dragover/drop fires.
    if (
      !wallId ||
      (!event.dataTransfer.types.includes(ARTWORK_DRAG_MIME) &&
        !draggingArtworkId &&
        !peekArtworkDragSession())
    )
      return;
    event.preventDefault();
    // A floor work can't hang here: show the no-drop cursor instead of "copy",
    // the closest existing affordance to a rejected elevation drop.
    event.dataTransfer.dropEffect = isFloorWork(draggingArtworkId) ? "none" : "copy";
    updateArtworkDropGhost(
      event.clientX,
      event.clientY,
      draggingArtworkId,
      event.metaKey || event.ctrlKey
    );
  }

  function handleDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    // Only clear when the pointer actually leaves the surface, not when it
    // moves between child elements within it (those also fire dragleave).
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropGhost(null);
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>) {
    const artworkId =
      event.dataTransfer.getData(ARTWORK_DRAG_MIME) || draggingArtworkId || peekArtworkDragSession();
    consumeArtworkDragSession();
    setDropGhost(null);
    if (!artworkId || !wallId) return;
    if (!artworksById?.get(artworkId)) return;
    event.preventDefault();
    completeArtworkDrop(event.clientX, event.clientY, artworkId, event.metaKey || event.ctrlKey);
  }

  // The touch/pen drag path (iOS/iPadOS, where HTML5 DnD is unavailable/
  // unreliable) reaches this drop target through the module-level session rather
  // than DOM drag events. The handlers close over live state/props, so route
  // them through a ref refreshed each render and subscribe once.
  const touchDropRef = useRef({
    updateGhost: updateArtworkDropGhost,
    complete: completeArtworkDrop,
    isValidArtwork: (id: string) => Boolean(artworksById?.get(id))
  });
  touchDropRef.current = {
    updateGhost: updateArtworkDropGhost,
    complete: completeArtworkDrop,
    isValidArtwork: (id: string) => Boolean(artworksById?.get(id))
  };

  useEffect(() => {
    return subscribeArtworkTouchDrag((dragEvent) => {
      const container = containerRef.current;
      const handlers = touchDropRef.current;
      if (!container) return;
      if (dragEvent.type === "cancel") {
        setDropGhost(null);
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
        else setDropGhost(null);
        return;
      }
      // drop: always clear the ghost; place only if it landed inside and the id
      // still resolves to a known artwork (mirrors the HTML5 drop guard).
      setDropGhost(null);
      if (inside && handlers.isValidArtwork(dragEvent.artworkId)) {
        handlers.complete(dragEvent.clientX, dragEvent.clientY, dragEvent.artworkId, false);
      }
    });
    // containerRef is stable; the effect subscribes once for the component's life.
  }, [containerRef]);

  const activeGuides =
    moveDrag?.activeGuides ?? dropGhost?.activeGuides ?? openingToolGhost?.activeGuides ?? [];

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
  // Idle, or an active "From edges"/"Between works" session → neighbour-aware
  // (stop at the nearest window/door/work — "From edges" measures to that same
  // detected boundary, and "Between works" re-spaces about a fixed centre so
  // its outer edges close on the neighbours; either way the lines should show
  // the space actually beside the works, per-side falling back to the wall
  // edge when nothing is there — see getNeighborAwareSegments). Only an active
  // "Space evenly" session → wall-edge segments, matching that mode's still
  // wall-only Calculated readout (it solves the whole-wall/open-zone spread).
  const dimensionSegments =
    arrangeSessionMode === "equal"
      ? getSpacingSegments(effectiveDimensionMembers, wallLengthMm)
      : getNeighborAwareSegments(effectiveDimensionMembers, dimensionOthers, wallLengthMm);

  // Wall switcher wiring for the chip. Prev/next cycle through every placeable
  // surface in room order (each room's perimeter walls then its partition
  // faces, wrapping at the ends), and the WallSwitcher menu lists them all —
  // grouped by room, faces sectioned under "Partitions", once more than one
  // room exists.
  const currentWallIndex = walls.findIndex((wall) => wall.id === wallId);
  const canSwitchWalls = walls.length > 0 && currentWallIndex >= 0 && Boolean(onSelectWall);
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
            <WallSwitcher
              walls={walls}
              currentWallId={wallId ?? ""}
              onSelectWall={(value) => onSelectWall?.(value)}
            />
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
        canZoomIn={canZoomIn}
        canZoomOut={canZoomOut}
        onZoomIn={() => zoomAtCenter(ZOOM_STEP)}
        onZoomOut={() => zoomAtCenter(1 / ZOOM_STEP)}
        onFit={() => onViewportChange(FIT_VIEWPORT)}
        onFitSelected={handleFitSelected}
        fitSelectedDisabled={selectedSvgBounds === null}
      />
      <svg
        className={activeTool ? "elevation-svg tool-armed" : "elevation-svg"}
        ref={svgRef}
        viewBox={viewBox}
        role="img"
        tabIndex={0}
        onClick={handleOpeningToolClick}
        onPointerDown={beginMarquee}
        onPointerDownCapture={handleSvgPointerDownCapture}
        onPointerLeave={handleOpeningToolPointerLeave}
        onPointerMove={handleOpeningToolPointerMove}
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
        {centerlineVisible ? (
          <line
            className="centerline"
            x1="0"
            y1={elevationScene.centerlineSvgY}
            x2={wallLengthMm}
            y2={elevationScene.centerlineSvgY}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <line
          className="floor-line"
          x1="0"
          y1={elevationScene.floorLineSvgY}
          x2={wallLengthMm}
          y2={elevationScene.floorLineSvgY}
          vectorEffect="non-scaling-stroke"
        />
        {elevationScene.artworks.map(({ object: placement, artwork, centerMm, sizeMm, outOfBounds }) => {
          const previewCenter = previewCenterById.get(placement.id);
          const center = previewCenter ?? centerMm;
          // A move never resizes, so the object's own size always applies (for a
          // group, moveDrag.sizeMm is the union box, not this member's size).
          const size = sizeMm;

          return (
            <ElevationArtwork
              key={placement.id}
              center={center}
              dimensionStatus={artwork?.dimensions.status}
              frame={artwork?.frame}
              matWidthMm={artwork?.matWidthMm}
              imageUrl={artwork?.assetId ? imageUrlsByAssetId.get(artwork.assetId) : undefined}
              isOutOfBounds={
                // The scene's flag is the at-rest answer; a live drag preview
                // re-checks the same predicate at the preview center.
                previewCenter
                  ? isArtworkOutOfWallBounds(wallLengthMm, wallHeightMm, center, size)
                  : outOfBounds
              }
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
              onPointerDown={(event) => {
                if (activeTool) {
                  event.stopPropagation();
                  return;
                }
                beginMoveDrag(placement, event);
              }}
              onSelect={(event) => {
                if (activeTool) return;
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
        {elevationScene.openings.map(({ object: opening, centerMm, sizeMm, outOfBounds }) => {
          const previewCenter = previewCenterById.get(opening.id);
          const center = previewCenter ?? centerMm;
          const size = sizeMm;

          return (
            <ElevationOpening
              key={opening.id}
              center={center}
              isOutOfBounds={
                previewCenter
                  ? isArtworkOutOfWallBounds(wallLengthMm, wallHeightMm, center, size)
                  : outOfBounds
              }
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
              onPointerDown={(event) => {
                if (activeTool) {
                  event.stopPropagation();
                  return;
                }
                beginMoveDrag(opening, event);
              }}
              onSelect={(event) => {
                if (activeTool) return;
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
        {openingToolGhost && activeTool ? (
          <ElevationOpening
            center={openingToolGhost.centerMm}
            isGhost
            kind={activeTool}
            size={openingToolGhost.sizeMm}
            wallHeightMm={wallHeightMm}
            wallObjectId="opening-tool-ghost"
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
