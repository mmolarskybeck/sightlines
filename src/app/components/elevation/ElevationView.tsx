import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject
} from "react";
import type { Vector2 } from "../../../domain/geometry/dragResize";
import { getGroupBounds } from "../../../domain/placement/groupBounds";
import { type InsertToolKind } from "../../../domain/placement/createOpening";
import { WALL_TEXT_DEFAULT_NAME } from "../../../domain/placement/createWallText";
import {
  effectiveFraming,
  getPlacementFootprintMm,
  withArtworkFootprintFromMap
} from "../../../domain/framing";
import type {
  Artwork,
  ArtworkFloorObject,
  CaseFloorObject,
  DisplayUnit,
  FloorObject,
  ReferenceMeasurement,
  WallObject,
  WallObjectBase
} from "../../../domain/project";
import { getFloorWalls } from "../../../domain/geometry/planObjects";
import { getRoomPlaceableWalls } from "../../../domain/geometry/placeableWalls";
import { getFloorPartitions } from "../../../domain/geometry/freestandingWalls";
import {
  partitionProfileNeighborShims,
  selectElevationPartitions,
  selectVisiblePartitionProfiles
} from "../../../domain/placement/partitionNeighbors";
import { isPointInPolygon } from "../../../domain/geometry/polygon";
import type { Guide } from "../../../domain/snapping/resolveSnap";
import { formatLength } from "../../../domain/units/length";
import { getMajorGridIntervalMm, getMinorGridIntervalMm } from "../../../domain/units/precision";
import { type MeasureCandidateSources } from "../../../domain/measurement/measurement";
import {
  ELEVATION_ZOOM_LIMITS,
  FIT_VIEWPORT,
  getEffectiveZoom,
  getFitBoundsViewport,
  getViewBox2D,
  ZOOM_STEP,
  type Viewport2D
} from "../../../domain/viewport/viewport2d";
import { useAssetImageUrls } from "../../hooks/useAssetImageUrls";
import { useContainerSize } from "../../hooks/useContainerSize";
import { getNudgeStepMm } from "../../hooks/nudgeStep";
import { useSelectSuppression } from "../../hooks/useSelectSuppression";
import { useSvgViewportGestures } from "../../hooks/useSvgViewportGestures";
import { useElevationMeasurementGestures } from "../../hooks/useElevationMeasurementGestures";
import { useElevationOpeningTool } from "../../hooks/useElevationOpeningTool";
import { useElevationArtworkDrop } from "../../hooks/useElevationArtworkDrop";
import {
  type MeasurementToolAction,
  type MeasurementToolState
} from "../../hooks/useMeasurementTool";
import { useAppStore } from "../../store";
import { ElevationArtwork } from "./ElevationArtwork";
import { ElevationOpening } from "./ElevationOpening";
import { ElevationCase, ElevationFloorCaseGhost } from "./ElevationCase";
import { ElevationPartitionProfile } from "./ElevationPartitionProfile";
import { ElevationSuspendedArtworkGhost } from "./ElevationSuspendedArtworkGhost";
import { ElevationMonitorGhost } from "./ElevationMonitorGhost";
import { ElevationWallText } from "./ElevationWallText";
import {
  ArtworkTooltipContent,
  CaseTooltipContent,
  OpeningTooltipContent,
  WallTextTooltipContent
} from "../shared/PlacementTooltip";
import { marqueeRectMm } from "../shared/marqueeRect";
import { buildElevationScene } from "../../../domain/scene2d/elevationScene";
import {
  getElevationFootprintObjects,
  getFitSelectionBoundsSvg,
  isArtworkOutOfWallBounds,
  wallLocalYToSvgY
} from "./elevationArtworkGeometry";
import { GridOverlay } from "../shared/GridOverlay";
import { GroupDimensionLines } from "./GroupDimensionLines";
import { VerticalGapDimensionLines } from "./VerticalGapDimensionLines";
import { buildElevationDimensionModel } from "./elevationDimensionModel";
import { MeasurementOverlay, type MeasurementEndpoint } from "../measurement/MeasurementOverlay";
import { ViewportZoomControls } from "../shared/ViewportZoomControls";
import { type WallSwitcherEntry } from "./WallSwitcher";
import { WallSwitcherChip, canSwitchWalls } from "./WallSwitcherChip";
import {
  useElevationMoveDrag,
  type DropGhostState,
  type MoveDragState
} from "./useElevationMoveDrag";

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
const EMPTY_REFERENCE_MEASUREMENTS: ReferenceMeasurement[] = [];
// Stable empty fallback for the store-connected floorObjects slice (see the
// wallObjects rationale above) — floor cases in front of this wall become the
// elevation ghost outlines.
const EMPTY_FLOOR_OBJECTS: FloorObject[] = [];

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
  ghostsVisible = true,
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
  onViewportChange,
  measurementActive = false,
  measurementState = null,
  onMeasurementDispatch,
  exportMode = false,
  onSvgElementChange
}: {
  gridPrecisionFloorMm: number | null;
  gridVisible: boolean;
  activeTool?: InsertToolKind | null;
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
  // Elevation-only "ghosts" visibility toggle. Hides the DASHED projected band
  // — floor-case ghosts, suspended-artwork ghosts, and partitions standing
  // clear of this wall — and drops those same shapes out of the synthetic
  // dimension "others" pool, so a hidden ghost can't bound a gap line it no
  // longer draws. SOLID abutting partition profiles are exempt: that slab is
  // architecture meeting the wall, not a projection, so it keeps both its paint
  // and its dimension participation. Canvas only — the PDF export builders read
  // the scene directly and always draw everything. Defaults true so every call
  // site that doesn't pass it (tests, exports) behaves as before this toggle.
  ghostsVisible?: boolean;
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
  onToolChange?: (tool: InsertToolKind | null) => void;
  onPlaceOpeningOnElevation?: (
    kind: InsertToolKind,
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
  measurementActive?: boolean;
  measurementState?: MeasurementToolState | null;
  onMeasurementDispatch?: (action: MeasurementToolAction) => void;
  // Snapshot rendering mode (docs/export-spec.md §10.2): suppresses selection
  // outlines, hover, ghosts, snap guides, marquee, and temporary/reference
  // measurements, while keeping structure, placements, and dimension lines
  // exactly as displayed. Strictly additive — default false changes nothing.
  exportMode?: boolean;
  onSvgElementChange?: (element: SVGSVGElement | null) => void;
}) {
  const [containerRef, containerSize] = useContainerSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    onSvgElementChange?.(svgRef.current);
  }, [onSvgElementChange]);
  // Store-connected passthroughs. App forwarded each of these verbatim (a bare
  // `prop={storeAction}`, and wallObjects={project.wallObjects}), so reading
  // them from the store here cuts the umbilical without moving ownership — the
  // store already owns them. Action selectors return stable references (no
  // re-render); the wallObjects slice re-renders on project change exactly as
  // the old prop did, falling back to a stable module-level empty array pre-
  // boot so the selector result never changes identity spuriously.
  const wallObjects = useAppStore((state) => state.project?.wallObjects ?? EMPTY_WALL_OBJECTS);
  // Floor objects + the floor plan feed the freestanding-case ghosts: cases in
  // the room this wall bounds project onto the wall face as alignment outlines.
  // Read from the store for the same reason as wallObjects (the store owns them).
  const floorObjects = useAppStore((state) => state.project?.floorObjects ?? EMPTY_FLOOR_OBJECTS);
  const floorRooms = useAppStore((state) => state.project?.floor.rooms ?? null);
  const selection = useAppStore((state) => state.selection);
  const referenceMeasurements = useAppStore(
    (state) => state.project?.referenceMeasurements ?? EMPTY_REFERENCE_MEASUREMENTS
  );
  const onSelectMeasurement = useAppStore((state) => state.selectMeasurement);
  const onUpdateReferenceMeasurement = useAppStore((state) => state.updateReferenceMeasurement);
  const onSelectArtwork = useAppStore((state) => state.selectArtwork);
  const onSelectOpening = useAppStore((state) => state.selectOpening);
  const onSelectObject = useAppStore((state) => state.selectObject);
  const onClearSelection = useAppStore((state) => state.clearObjectSelection);
  // The wall switcher and its prev/next steppers are navigation: stepping
  // through elevations to look at them must not leave Delete armed on whichever
  // wall you land on.
  const onSelectWall = useAppStore((state) => state.focusWallContext);
  const [dropGhost, setDropGhost] = useState<DropGhostState | null>(null);
  const [openingToolGhost, setOpeningToolGhost] = useState<OpeningToolGhostState | null>(null);
  const [measurementSnappedEndpoint, setMeasurementSnappedEndpoint] =
    useState<MeasurementEndpoint | null>(null);
  const measurementGestureRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startedDrawing: boolean;
    refining?: MeasurementEndpoint;
  } | null>(null);
  const canvasToolArmed = Boolean(activeTool || measurementActive);

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

  // The viewport engine's pinch guard has to read the move-drag state, but the
  // move-drag hook is called later (it needs elevationScene-derived inputs).
  // This box holds that hook's ref; the guard only ever runs from an event, by
  // which time the assignment below has happened.
  const moveDragRefBox = useRef<RefObject<MoveDragState | null> | null>(null);

  // The shared 2D viewport gesture engine (pan / zoom / pinch / wheel /
  // keyboard). It works EXCLUSIVELY in SVG userspace (y-down); the elevation
  // y-flip stays in this view's own toWallLocalMm below. A single finger's
  // pan-start is delegated back to this view's bubble-phase background handler
  // (beginMarquee → beginTouchPan), and a stationary background tap clears the
  // selection via onGestureEnd (elevation has no svg click handler, so unlike
  // plan the clear can't ride a trailing click).
  const {
    isSpaceDown,
    panning,
    toSvgPoint,
    zoomAtCenter,
    canZoomIn,
    canZoomOut,
    handlePointerDownCapture,
    beginTouchPan,
    beginMousePan
  } = useSvgViewportGestures({
    svgRef,
    viewport,
    onViewportChange,
    contentBounds,
    containerSize,
    zoomLimits: ELEVATION_ZOOM_LIMITS,
    // A 2nd finger landing over an in-flight move-drag blocks rather than
    // starting a pinch — defer to that edit (preserves the old capture guard).
    isPinchBlocked: () => Boolean(moveDragRefBox.current?.current),
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

  // Freestanding floor objects whose ghost may project onto THIS wall: the
  // wall's floor-space endpoints (from getFloorWalls, which lifts room/partition
  // walls into floor coordinates) plus the case and artwork floor objects in the
  // room this wall bounds. The room filter (point-in-polygon on the room this
  // wall belongs to) keeps an object behind the wall in a neighbouring room from
  // ghosting through it — the builder's projection then drops anything not
  // actually overlapping the wall extent. undefined/absent inputs simply yield
  // no ghosts.
  //
  // ONE gate for both kinds on purpose: a suspended board hung on the far side
  // of a wall must be excluded by exactly the same point-in-polygon test the
  // cases already pass, not by a parallel rule that could drift looser. Floor
  // artworks are handed over unfiltered by height — buildElevationScene owns the
  // "only suspended ones ghost" rule so the canvas and any export agree.
  //
  // Free-standing PARTITIONS ride along here too (same wall endpoints, same
  // projection), on their own room gate — see below.
  const floorGhostInputs = useMemo(() => {
    if (!wallId || !floorRooms) return null;
    const floorWall = getFloorWalls({ rooms: floorRooms }).find((wall) => wall.id === wallId);
    if (!floorWall) return null;
    const room = floorRooms.find((placement) =>
      getRoomPlaceableWalls(placement.room).some((wall) => wall.id === wallId)
    );
    const polygonMm = room
      ? room.room.vertices.map((vertex) => ({
          xMm: vertex.xMm + room.offsetXMm,
          yMm: vertex.yMm + room.offsetYMm
        }))
      : null;
    const inThisRoom = (object: FloorObject): boolean =>
      !polygonMm || isPointInPolygon({ xMm: object.xMm, yMm: object.yMm }, polygonMm);
    const floorCases = floorObjects.filter(
      (object): object is CaseFloorObject => object.kind === "case" && inThisRoom(object)
    );
    const floorArtworks = floorObjects.filter(
      (object): object is ArtworkFloorObject => object.kind === "artwork" && inThisRoom(object)
    );
    // Partitions gate on room ownership + own-face exclusion, not on the
    // point-in-polygon test the floor objects need — see
    // selectElevationPartitions, which the two PDF paths share.
    const partitions = room
      ? selectElevationPartitions(getFloorPartitions({ rooms: floorRooms }), {
          roomId: room.roomId,
          wallId
        })
      : [];
    if (floorCases.length === 0 && floorArtworks.length === 0 && partitions.length === 0) {
      return null;
    }
    return {
      floorCases,
      floorArtworks,
      partitions,
      wallStartFloorMm: floorWall.startFloorMm,
      wallEndFloorMm: floorWall.endFloorMm
    };
  }, [wallId, floorRooms, floorObjects]);

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
    artworksById,
    ...(floorGhostInputs ?? {})
  });
  // ONE gate for the "Ghosts" toggle, applied to the scene OUTPUT rather than
  // its inputs: the scene has to keep building partition profiles either way so
  // the abutting ones survive, and filtering here means the render passes and
  // the synthetic dimension "others" below read the same arrays — a ghost can
  // never be invisible yet still bound a gap line, or vice versa.
  const visibleFloorCaseGhosts = ghostsVisible ? elevationScene.floorCaseGhosts : [];
  const visibleSuspendedArtworkGhosts = ghostsVisible
    ? elevationScene.suspendedArtworkGhosts
    : [];
  // Box monitors ride the same one gate as the other two ghost families.
  const visibleMonitorGhosts = ghostsVisible ? elevationScene.monitorGhosts : [];
  // Abutting slabs are architecture, not projection: they stay in every state.
  const visiblePartitionProfiles = selectVisiblePartitionProfiles(
    elevationScene.partitionProfiles,
    ghostsVisible
  );
  // The projected partitions that act as SPACING NEIGHBORS on this wall —
  // derived once from the visibility-gated profile set and shared by the two
  // things a neighbor does on this canvas: bound a dimension line (below) and
  // capture a drag (resolveElevationPlacement). Deriving them from
  // `visiblePartitionProfiles` rather than the raw scene is the point: a dashed
  // ghost the curator has switched OFF must not silently grab a drag, while an
  // abutting slab — which survives the toggle — always participates.
  //
  // They are deliberately absent from the barrier/obstacle pass: partition
  // projection is a drawing, not a placement restriction (USER DECISION), so a
  // work may legally hang across one.
  const partitionNeighborShims = partitionProfileNeighborShims(
    visiblePartitionProfiles,
    wallHeightMm,
    wallId ?? ""
  );
  // Every wall object on this wall is a valid snap neighbor for any other —
  // an artwork can align to a door's edge just as readily as to another
  // artwork's (docs/plan.md §2 snap-target priority doesn't distinguish by
  // kind, only centerline > neighbor-center > neighbor-edge > grid). Wall
  // texts and cases join the same pool: they already drag/select through
  // this view's shared machinery (beginMoveDrag, onSelectObject below), so
  // they need to be visible to it — snap neighbors, measurement points,
  // marquee hit-testing, and dimension lines all derive from this array.
  const wallObjectsOnThisWall: WallObject[] = [
    ...elevationScene.artworks.map((entry) => entry.object),
    ...elevationScene.openings.map((entry) => entry.object),
    ...elevationScene.wallTexts.map((entry) => entry.object),
    ...elevationScene.cases.map((entry) => entry.object)
  ];

  const measurementSources = useMemo<MeasureCandidateSources>(() => {
    const points: Array<NonNullable<MeasureCandidateSources["points"]>[number]> = [
      { id: "wall-top-left", kind: "vertex", point: { xMm: 0, yMm: wallHeightMm } },
      { id: "wall-top-right", kind: "vertex", point: { xMm: wallLengthMm, yMm: wallHeightMm } },
      { id: "wall-bottom-left", kind: "vertex", point: { xMm: 0, yMm: 0 } },
      { id: "wall-bottom-right", kind: "vertex", point: { xMm: wallLengthMm, yMm: 0 } },
      { id: "wall-center", kind: "center", point: { xMm: wallLengthMm / 2, yMm: wallHeightMm / 2 } }
    ];
    const segments: Array<NonNullable<MeasureCandidateSources["segments"]>[number]> = [
      { id: "wall-left", kind: "edge", start: { xMm: 0, yMm: 0 }, end: { xMm: 0, yMm: wallHeightMm } },
      { id: "wall-right", kind: "edge", start: { xMm: wallLengthMm, yMm: 0 }, end: { xMm: wallLengthMm, yMm: wallHeightMm } },
      { id: "floorline", kind: "datum", start: { xMm: 0, yMm: 0 }, end: { xMm: wallLengthMm, yMm: 0 } },
      { id: "wall-top", kind: "edge", start: { xMm: 0, yMm: wallHeightMm }, end: { xMm: wallLengthMm, yMm: wallHeightMm } }
    ];
    if (centerlineVisible) {
      segments.push({
        id: "centerline",
        kind: "datum",
        start: { xMm: 0, yMm: centerlineMm },
        end: { xMm: wallLengthMm, yMm: centerlineMm }
      });
    }
    for (const object of wallObjectsOnThisWall) {
      const footprint = withArtworkFootprintFromMap(object, artworksById);
      const left = footprint.xMm - footprint.widthMm / 2;
      const right = footprint.xMm + footprint.widthMm / 2;
      const bottom = footprint.yMm - footprint.heightMm / 2;
      const top = footprint.yMm + footprint.heightMm / 2;
      points.push(
        { id: `${object.id}:bottom-left`, kind: "vertex", point: { xMm: left, yMm: bottom } },
        { id: `${object.id}:bottom-right`, kind: "vertex", point: { xMm: right, yMm: bottom } },
        { id: `${object.id}:top-left`, kind: "vertex", point: { xMm: left, yMm: top } },
        { id: `${object.id}:top-right`, kind: "vertex", point: { xMm: right, yMm: top } },
        { id: `${object.id}:center`, kind: "center", point: { xMm: footprint.xMm, yMm: footprint.yMm } }
      );
      segments.push(
        { id: `${object.id}:left`, kind: "edge", start: { xMm: left, yMm: bottom }, end: { xMm: left, yMm: top } },
        { id: `${object.id}:right`, kind: "edge", start: { xMm: right, yMm: bottom }, end: { xMm: right, yMm: top } },
        { id: `${object.id}:bottom`, kind: "edge", start: { xMm: left, yMm: bottom }, end: { xMm: right, yMm: bottom } },
        { id: `${object.id}:top`, kind: "edge", start: { xMm: left, yMm: top }, end: { xMm: right, yMm: top } }
      );
    }
    return { points, segments };
  }, [artworksById, centerlineMm, centerlineVisible, wallHeightMm, wallLengthMm, wallObjectsOnThisWall]);

  const {
    handleMeasurementPointerDown,
    handleMeasurementPointerMove,
    handleMeasurementPointerUp,
    cancelMeasurementPointerGesture,
    beginMeasurementRefinement,
    handleMeasurementEndpointKeyDown,
    handleMeasureSurfaceKeyDown
  } = useElevationMeasurementGestures({
    measurementActive,
    measurementState,
    onMeasurementDispatch,
    measurementGestureRef,
    setMeasurementSnappedEndpoint,
    measurementSources,
    toWallLocalMm,
    svgRef,
    isSpaceDown,
    snapThresholdMm,
    minorGridMm,
    gridVisible,
    snapToGrid,
    gridPrecisionFloorMm,
    unit,
    wallId,
    wallLengthMm,
    wallHeightMm,
    viewBoxBounds
  });

  const withResolvedArtworkFootprint = (object: WallObject): WallObject =>
    withArtworkFootprintFromMap(object, artworksById);
  const assetIds = elevationScene.artworks.map((entry) => entry.artwork?.assetId);
  const imageUrlsByAssetId = useAssetImageUrls(assetIds, getBlob ?? NO_OP_GET_BLOB, "display");

  // The browser fires a `click` on the grabbed element right after a drag's
  // pointerup. For a single object that click merely re-selects it (today's
  // behavior, harmless); after a real GROUP drag the same click would call
  // onSelectObject non-additively and collapse the whole multi-selection to
  // Select suppression: when a pointer release triggers a trailing click that
  // must not collapse a multi-selection (group drags, etc.), mark it here so
  // the click handler can skip the selection.
  const { suppressNextSelect, consumeSelectSuppression } =
    useSelectSuppression();


  const {
    moveDrag,
    moveDragRef,
    marquee,
    resolveElevationPlacement,
    beginMarquee,
    handleSvgPointerDownCapture,
    beginMoveDrag
  } = useElevationMoveDrag({
    toWallLocalMm,
    wallObjectsOnThisWall,
    artworksById,
    withResolvedArtworkFootprint,
    partitionNeighborShims,
    allowOverlappingPlacement,
    centerlineMm,
    wallLengthMm,
    wallHeightMm,
    minorGridMm,
    snapToGrid,
    snapThresholdMm,
    barrierBreakMm,
    selectedObjectIds,
    onMovePlacement,
    onMoveOpening,
    onMoveWallObjects,
    onMarqueeSelect,
    onClearSelection,
    suppressNextSelect,
    canvasToolArmed,
    dropGhost,
    beginTouchPan,
    beginMousePan,
    handlePointerDownCapture,
    measurementActive,
    measurementGestureRef,
    cancelMeasurementPointerGesture,
    handleMeasurementPointerDown
  });
  moveDragRefBox.current = moveDragRef;

  const { handleDragOver, handleDragLeave, handleDrop } = useElevationArtworkDrop({
    wallId,
    artworksById,
    draggingArtworkId,
    onPlaceArtwork,
    containerRef,
    toWallLocalMm,
    wallObjectsOnThisWall,
    dropGhost,
    setDropGhost,
    resolveElevationPlacement
  });


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



  const { handleOpeningToolPointerMove, handleOpeningToolPointerLeave, handleOpeningToolClick } =
    useElevationOpeningTool({
      activeTool,
      wallId,
      onToolChange,
      onPlaceOpeningOnElevation,
      setOpeningToolGhost,
      toWallLocalMm,
      wallObjectsOnThisWall,
      resolveElevationPlacement,
      moveDrag,
      marquee,
      dropGhost
    });


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
  const effectiveOutlineMembers: WallObjectBase[] = getElevationFootprintObjects(
    selectedMembersOnThisWall.map((wallObject) => applyDragPreview(wallObject) as WallObject),
    artworksById
  );

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

  // The dimension-line derivations live in elevationDimensionModel.ts (pure,
  // no React) — same computations, same order, called plainly each render.
  const {
    isDimensionLinesEligible,
    effectiveDimensionMembers,
    dimensionSegments,
    verticalGapDimensions
  } = buildElevationDimensionModel({
    selectedObjectIds,
    selectedMembersOnThisWall,
    selectionAllOnThisWall,
    applyDragPreview,
    artworksById,
    wallObjectsOnThisWall,
    visibleFloorCaseGhosts,
    visibleSuspendedArtworkGhosts,
    visibleMonitorGhosts,
    partitionNeighborShims,
    wallId,
    wallLengthMm,
    arrangeSessionMode
  });

  // Wall switcher wiring for the chip — see WallSwitcherChip, which the open-
  // wall empty state renders too so the switcher survives navigating to a wall
  // with no surface to draw.
  const showWallSwitcher = canSwitchWalls(walls, wallId) && Boolean(onSelectWall);

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
      {showWallSwitcher ? (
        <WallSwitcherChip
          walls={walls}
          unit={unit}
          currentWallId={wallId ?? ""}
          onSelectWall={(value) => onSelectWall?.(value)}
        />
      ) : (
        <div className="surface-label">
          <strong>{wallName}</strong>
          <span>
            {formatLength(wallLengthMm, { unit })} by{" "}
            {formatLength(wallHeightMm, { unit })}
          </span>
        </div>
      )}
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
        className={canvasToolArmed ? "elevation-svg tool-armed" : "elevation-svg"}
        ref={svgRef}
        viewBox={viewBox}
        role="img"
        tabIndex={0}
        onKeyDown={handleMeasureSurfaceKeyDown}
        onClick={handleOpeningToolClick}
        onPointerDown={beginMarquee}
        onPointerDownCapture={handleSvgPointerDownCapture}
        onPointerLeave={handleOpeningToolPointerLeave}
        onPointerMove={(event) => {
          if (handleMeasurementPointerMove(event)) return;
          handleOpeningToolPointerMove(event);
        }}
        onPointerUp={(event) => {
          handleMeasurementPointerUp(event);
        }}
        onPointerCancel={() => {
          const gesture = measurementGestureRef.current;
          measurementGestureRef.current = null;
          if (gesture?.refining) onMeasurementDispatch?.({ type: "cancel-refinement" });
        }}
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
        {/* Freestanding-case ghosts paint first (behind the wall objects) so
            they never occlude wall-hung work — non-interactive alignment aids. */}
        {visibleFloorCaseGhosts.map((ghost) => (
          <ElevationFloorCaseGhost
            key={ghost.object.id}
            heightMm={ghost.heightMm}
            wallHeightMm={wallHeightMm}
            xMaxMm={ghost.xMaxMm}
            xMinMm={ghost.xMinMm}
          />
        ))}
        {/* Suspended floor artwork (a board hung from ceiling wires) gets the
            same treatment: behind the wall objects, inert, dashed — it belongs
            to no wall, it is only shown so its floating volume in front of this
            one is visible. */}
        {visibleSuspendedArtworkGhosts.map((ghost) => (
          <ElevationSuspendedArtworkGhost
            key={ghost.object.id}
            baseHeightMm={ghost.baseHeightMm}
            heightMm={ghost.heightMm}
            wallHeightMm={wallHeightMm}
            xMaxMm={ghost.xMaxMm}
            xMinMm={ghost.xMinMm}
          />
        ))}
        {/* Box monitors standing in front of this wall: the same behind-the-
            wall-objects paint slot, inert and dashed, but standing on the floor
            line (pedestal + cabinet) rather than floating. */}
        {visibleMonitorGhosts.map((ghost) => (
          <ElevationMonitorGhost
            key={ghost.object.id}
            monitorHeightMm={ghost.monitorHeightMm}
            pedestalHeightMm={ghost.pedestalHeightMm}
            wallHeightMm={wallHeightMm}
            xMaxMm={ghost.xMaxMm}
            xMinMm={ghost.xMinMm}
          />
        ))}
        {/* Partitions standing CLEAR of this wall join the ghost band: quiet,
            dashed, behind the wall objects. The abutting ones are drawn much
            later, after the wall objects — see below. */}
        {visiblePartitionProfiles
          .filter((profile) => !profile.abutting)
          .map((profile) => (
            <ElevationPartitionProfile
              key={profile.partition.wallId}
              abutting={false}
              heightMm={profile.heightMm}
              wallHeightMm={wallHeightMm}
              xMaxMm={profile.xMaxMm}
              xMinMm={profile.xMinMm}
            />
          ))}
        {elevationScene.artworks.map(({ object: placement, artwork, centerMm, sizeMm, outOfBounds }) => {
          const previewCenter = previewCenterById.get(placement.id);
          const center = previewCenter ?? centerMm;
          // A move never resizes, so the object's own size always applies (for a
          // group, moveDrag.sizeMm is the union box, not this member's size).
          const size = sizeMm;
          // Single interpreter of frameIncludedInImage: a flagged work is handed
          // no band, so ElevationArtwork paints none (frame is in the photo).
          const framing = effectiveFraming(artwork);

          return (
            <ElevationArtwork
              key={placement.id}
              center={center}
              dimensionStatus={artwork?.dimensions.status}
              frame={framing.frame}
              matWidthMm={framing.matWidthMm}
              imageUrl={artwork?.assetId ? imageUrlsByAssetId.get(artwork.assetId) : undefined}
              isOutOfBounds={
                // The scene's flag is the at-rest answer; a live drag preview
                // re-checks the same predicate at the preview center.
                previewCenter
                  ? isArtworkOutOfWallBounds(
                      wallLengthMm,
                      wallHeightMm,
                      center,
                      getPlacementFootprintMm(placement, artwork)
                    )
                  : outOfBounds
              }
              isSelected={
                !exportMode &&
                (selectedArtworkId === placement.artworkId || selectedObjectIds.includes(placement.id))
              }
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
              tooltipDisabled={exportMode || Boolean(moveDrag || dropGhost)}
              wallHeightMm={wallHeightMm}
              onPointerDown={(event) => {
                if (canvasToolArmed) {
                  event.stopPropagation();
                  return;
                }
                beginMoveDrag(placement, event);
              }}
              onSelect={(event) => {
                if (canvasToolArmed) return;
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
              isSelected={
                !exportMode &&
                (selectedOpeningId === opening.id || selectedObjectIds.includes(opening.id))
              }
              kind={opening.kind}
              // Handing only — an elevation can't honestly show swing depth,
              // which is why the pre-a1ebe03 swing arc was removed. A doorway
              // (no leaf) still draws as the bare outline it always has.
              leaf={opening.kind === "door" ? opening.leaf : undefined}
              size={size}
              tooltip={
                <OpeningTooltipContent
                  kind={opening.kind}
                  secondaryMm={opening.heightMm}
                  unit={unit}
                  widthMm={opening.widthMm}
                />
              }
              tooltipDisabled={exportMode || Boolean(moveDrag || dropGhost)}
              wallHeightMm={wallHeightMm}
              wallObjectId={opening.id}
              onPointerDown={(event) => {
                if (canvasToolArmed) {
                  event.stopPropagation();
                  return;
                }
                beginMoveDrag(opening, event);
              }}
              onSelect={(event) => {
                if (canvasToolArmed) return;
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
        {elevationScene.wallTexts.map(({ object: wallText, centerMm, sizeMm, outOfBounds }) => {
          const previewCenter = previewCenterById.get(wallText.id);
          const center = previewCenter ?? centerMm;
          const size = sizeMm;

          return (
            <ElevationWallText
              key={wallText.id}
              center={center}
              isOutOfBounds={
                previewCenter
                  ? isArtworkOutOfWallBounds(wallLengthMm, wallHeightMm, center, size)
                  : outOfBounds
              }
              isSelected={!exportMode && selectedObjectIds.includes(wallText.id)}
              size={size}
              tooltip={
                <WallTextTooltipContent
                  name={wallText.name ?? WALL_TEXT_DEFAULT_NAME}
                  widthMm={wallText.widthMm}
                  heightMm={wallText.heightMm}
                  unit={unit}
                />
              }
              tooltipDisabled={exportMode || Boolean(moveDrag || dropGhost)}
              wallHeightMm={wallHeightMm}
              onPointerDown={(event) => {
                if (canvasToolArmed) {
                  event.stopPropagation();
                  return;
                }
                beginMoveDrag(wallText, event);
              }}
              onSelect={(event) => {
                if (canvasToolArmed) return;
                if (consumeSelectSuppression()) return;
                if (onSelectObject) {
                  onSelectObject(wallText.id, {
                    additive: event.shiftKey || event.metaKey || event.ctrlKey
                  });
                } else {
                  onSelectOpening?.(wallText.id);
                }
              }}
            />
          );
        })}
        {elevationScene.cases.map(({ object: displayCase, centerMm, sizeMm, outOfBounds }) => {
          const previewCenter = previewCenterById.get(displayCase.id);
          const center = previewCenter ?? centerMm;
          const size = sizeMm;

          return (
            <ElevationCase
              key={displayCase.id}
              center={center}
              isOutOfBounds={
                previewCenter
                  ? isArtworkOutOfWallBounds(wallLengthMm, wallHeightMm, center, size)
                  : outOfBounds
              }
              isSelected={
                !exportMode &&
                (selectedOpeningId === displayCase.id || selectedObjectIds.includes(displayCase.id))
              }
              pixelsPerMm={pixelsPerMm}
              size={size}
              tooltip={
                <CaseTooltipContent
                  secondaryMm={displayCase.heightMm}
                  unit={unit}
                  widthMm={displayCase.widthMm}
                />
              }
              tooltipDisabled={exportMode || Boolean(moveDrag || dropGhost)}
              wallHeightMm={wallHeightMm}
              onPointerDown={(event) => {
                if (canvasToolArmed) {
                  event.stopPropagation();
                  return;
                }
                beginMoveDrag(displayCase, event);
              }}
              onSelect={(event) => {
                if (canvasToolArmed) return;
                if (consumeSelectSuppression()) return;
                if (onSelectObject) {
                  onSelectObject(displayCase.id, {
                    additive: event.shiftKey || event.metaKey || event.ctrlKey
                  });
                } else {
                  onSelectOpening?.(displayCase.id);
                }
              }}
            />
          );
        })}
        {/* ABUTTING partitions paint over the wall objects: the slab meets this
            wall, so the surface behind it genuinely isn't hangable and work
            drawn there should read as covered. Still before the drafting
            overlays (dimension lines, guides, measurements) below, which must
            stay readable on top of everything. */}
        {visiblePartitionProfiles
          .filter((profile) => profile.abutting)
          .map((profile) => (
            <ElevationPartitionProfile
              key={profile.partition.wallId}
              abutting
              heightMm={profile.heightMm}
              wallHeightMm={wallHeightMm}
              xMaxMm={profile.xMaxMm}
              xMinMm={profile.xMinMm}
            />
          ))}
        {!exportMode && dropGhost ? (
          <ElevationArtwork
            center={dropGhost.centerMm}
            isGhost
            size={dropGhost.sizeMm}
            wallHeightMm={wallHeightMm}
          />
        ) : null}
        {!exportMode && openingToolGhost && activeTool ? (
          activeTool === "wall-text" ? (
            <ElevationWallText
              center={openingToolGhost.centerMm}
              isGhost
              size={openingToolGhost.sizeMm}
              wallHeightMm={wallHeightMm}
            />
          ) : activeTool === "case" ? (
            <ElevationCase
              center={openingToolGhost.centerMm}
              isGhost
              pixelsPerMm={pixelsPerMm}
              size={openingToolGhost.sizeMm}
              wallHeightMm={wallHeightMm}
            />
          ) : (
            <ElevationOpening
              center={openingToolGhost.centerMm}
              isGhost
              kind={activeTool}
              size={openingToolGhost.sizeMm}
              wallHeightMm={wallHeightMm}
              wallObjectId="opening-tool-ghost"
            />
          )
        ) : null}
        {!exportMode && isGroupOutlineEligible && pixelsPerMm > 0
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
        {!exportMode && marquee
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
        {!exportMode &&
          activeGuides.map((guide) => (
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
        {isDimensionLinesEligible ? (
          <VerticalGapDimensionLines
            gaps={verticalGapDimensions}
            wallLengthMm={wallLengthMm}
            wallHeightMm={wallHeightMm}
            pixelsPerMm={pixelsPerMm}
            unit={unit}
          />
        ) : null}
        {!exportMode &&
          referenceMeasurements
            .filter((item) => item.kind === "elevation" && item.wallId === wallId && item.visible)
            .map((item) => {
            const selected = selection.kind === "measurement" && selection.measurementId === item.id;
            const outOfBounds = [item.start, item.end].some(
              (point) => point.xMm < 0 || point.xMm > wallLengthMm || point.yMm < 0 || point.yMm > wallHeightMm
            );
            return (
              <MeasurementOverlay
                key={item.id}
                a={{ xMm: item.start.xMm, yMm: wallLocalYToSvgY(wallHeightMm, item.start.yMm) }}
                b={{ xMm: item.end.xMm, yMm: wallLocalYToSvgY(wallHeightMm, item.end.yMm) }}
                unit={unit}
                pixelsPerMm={pixelsPerMm}
                reference
                locked={item.locked}
                outOfBounds={outOfBounds}
                selected={selected}
                onBodyPointerDown={() => onSelectMeasurement(item.id)}
                onEndpointKeyDown={(endpoint, event) => {
                  if (item.locked || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
                  event.preventDefault();
                  const step = getNudgeStepMm({
                    unit,
                    snapToGrid,
                    gridPrecisionFloorMm,
                    shiftKey: event.shiftKey,
                    altKey: event.altKey
                  });
                  const point = endpoint === "a" ? item.start : item.end;
                  const next = {
                    xMm: point.xMm + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
                    yMm: point.yMm + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0)
                  };
                  void onUpdateReferenceMeasurement(item.id, endpoint === "a" ? { start: next } : { end: next });
                }}
              />
            );
          })}
        {!exportMode &&
        measurementActive &&
        measurementState &&
        measurementState.context.kind === "elevation" &&
        measurementState.context.wallId === wallId &&
        measurementState.phase !== "armed-empty" ? (
          <MeasurementOverlay
            a={{
              xMm: measurementState.start.xMm,
              yMm: wallLocalYToSvgY(wallHeightMm, measurementState.start.yMm)
            }}
            b={{
              xMm:
                measurementState.phase === "drawing"
                  ? measurementState.preview.xMm
                  : measurementState.end.xMm,
              yMm: wallLocalYToSvgY(
                wallHeightMm,
                measurementState.phase === "drawing"
                  ? measurementState.preview.yMm
                  : measurementState.end.yMm
              )
            }}
            pixelsPerMm={pixelsPerMm}
            selected={measurementState.phase !== "drawing"}
            snappedEndpoint={measurementSnappedEndpoint}
            unit={unit}
            onBodyPointerDown={() => {}}
            onEndpointKeyDown={handleMeasurementEndpointKeyDown}
            onEndpointPointerDown={beginMeasurementRefinement}
          />
        ) : null}
      </svg>
    </div>
  );
}
