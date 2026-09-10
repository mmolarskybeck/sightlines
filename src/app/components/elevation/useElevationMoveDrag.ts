import { type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { Vector2 } from "../../../domain/geometry/dragResize";
import {
  getWallObjectBoundsMm,
  type RectBoundsMm
} from "../../../domain/placement/collision";
import {
  resolveDragBarriers,
  WALL_BARRIER_EDGE_IDS,
  type BarrierObstacle
} from "../../../domain/placement/dragBarriers";
import { getGroupBounds, getIdsIntersectingRect } from "../../../domain/placement/groupBounds";
import { getOverlapRule } from "../../../domain/placement/overlapPolicy";
import type { Artwork, WallObject, WallObjectBase } from "../../../domain/project";
import { resolveArtworkSnap } from "../../../domain/snapping/artworkSnapTargets";
import {
  quantizeXToCleanIncrement,
  quantizeYToCleanIncrement
} from "../../../domain/snapping/cleanIncrement";
import type { Guide, SnapTargetIds } from "../../../domain/snapping/resolveSnap";
import { useDragGesture } from "../../hooks/useDragGesture";
import { shouldCancelMeasurementForViewportClaim } from "../../hooks/planMeasurementPolicy";
import type { ElevationMeasurementGestureRef } from "../../hooks/useElevationMeasurementGestures";
import { marqueeRectMm, type MarqueeState } from "../shared/marqueeRect";
import { getElevationFootprintObjects } from "./elevationArtworkGeometry";

// A pointer-drag move of an existing placement, transient until release
// (docs/plan.md §7: live preview, exactly one store commit on release).
// Mirrors PlanView's DragState shape/naming for the resize-handle drag.
// Generalized over wall object kind (artwork or opening) — `kind` decides
// which store action commits on release, everything else about the drag
// (preview, snapping, sub-threshold no-op) is identical either way.
export type MoveDragState = {
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
  // group translates rigidly. `members` records each member's kind and its
  // offset from the group's union-box center (member size is never read — the
  // group resolves and paints as one virtual object sized by the union box);
  // for a group drag startCenterMm / previewCenterMm track that union-box
  // center (and sizeMm is the union box's size, fed to resolveArtworkSnap as
  // one virtual object). Absent for a single-object drag — that path is left
  // exactly as it was.
  members?: {
    id: string;
    kind: WallObject["kind"];
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
export type DropGhostState = {
  centerMm: Vector2;
  sizeMm: { widthMm: number; heightMm: number };
  previousSnapTargetIds?: SnapTargetIds;
  activeGuides: Guide[];
  // Drag-barrier hysteresis, mirroring MoveDragState.brokenBarrierIds. A fresh
  // ghost starts with an empty set; each dragover frame carries the resolver's
  // returned set back in.
  brokenBarrierIds?: string[];
};


export type ElevationPlacementResolution = {
  point: Vector2;
  activeGuides: Guide[];
  snapTargetIds: SnapTargetIds;
  brokenBarrierIds: string[];
  blocked: boolean;
};

export type ElevationMoveDragInput = {
  // Client → wall-local mm. Stays in ElevationView because the measurement
  // gesture hook (called before this one) needs it too.
  toWallLocalMm: (clientX: number, clientY: number) => Vector2 | null;
  wallObjectsOnThisWall: WallObject[];
  artworksById?: Map<string, Artwork>;
  withResolvedArtworkFootprint: (object: WallObject) => WallObject;
  partitionNeighborShims: WallObjectBase[];
  allowOverlappingPlacement: boolean;
  centerlineMm: number;
  wallLengthMm: number;
  wallHeightMm: number;
  minorGridMm: number;
  snapToGrid: boolean;
  snapThresholdMm: number;
  barrierBreakMm: number;
  selectedObjectIds: string[];
  onMovePlacement?: (wallObjectId: string, xMm: number, yMm: number) => void;
  onMoveOpening?: (wallObjectId: string, xMm: number, yMm: number) => void;
  onMoveWallObjects?: (moves: { id: string; xMm: number; yMm: number }[]) => void;
  onMarqueeSelect?: (ids: string[], additive: boolean) => void;
  onClearSelection?: () => void;
  suppressNextSelect: () => void;
  canvasToolArmed: boolean;
  dropGhost: DropGhostState | null;
  beginTouchPan: (clientX: number, clientY: number) => void;
  beginMousePan: (clientX: number, clientY: number) => void;
  handlePointerDownCapture: (event: ReactPointerEvent<SVGSVGElement>) => boolean;
  measurementActive: boolean;
  measurementGestureRef: ElevationMeasurementGestureRef;
  cancelMeasurementPointerGesture: () => void;
  handleMeasurementPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => boolean;
};

export type ElevationMoveDragResult = {
  moveDrag: MoveDragState | null;
  moveDragRef: RefObject<MoveDragState | null>;
  isMoveDragging: boolean;
  marquee: MarqueeState | null;
  marqueeRef: RefObject<MarqueeState | null>;
  isMarqueeDragging: boolean;
  resolveElevationPlacement: (
    proposed: Vector2,
    sizeMm: { widthMm: number; heightMm: number },
    neighbors: WallObject[],
    movingKind: WallObject["kind"],
    movingKinds: WallObject["kind"][],
    previousSnapTargetIds: SnapTargetIds | undefined,
    precisionBypass: boolean,
    brokenBarrierIds: ReadonlySet<string>
  ) => ElevationPlacementResolution;
  seedBrokenBarrierIds: (boxBoundsMm: RectBoundsMm, neighbors: WallObject[]) => string[];
  beginMarquee: (event: ReactPointerEvent<SVGSVGElement>) => void;
  handleSvgPointerDownCapture: (event: ReactPointerEvent<SVGSVGElement>) => void;
  beginMoveDrag: (wallObject: WallObject, event: ReactPointerEvent<SVGGElement>) => void;
};

// The elevation move-drag / marquee gesture cluster, lifted verbatim out of
// ElevationView. Same closures, same order of operations — only the enclosing
// scope changed.
export function useElevationMoveDrag({
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
}: ElevationMoveDragInput): ElevationMoveDragResult {
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
  // current).
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

      onMarqueeSelect?.(
        getIdsIntersectingRect(
          getElevationFootprintObjects(wallObjectsOnThisWall, artworksById),
          rect
        ),
        event.shiftKey
      );
    }
  });

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
    // Keep the scene inventory image-sized for Phase 4 consumers. This
    // interaction-only list widens the exact neighbor boundary shared by snap,
    // clean-increment quantization and drag barriers.
    const footprintNeighbors = neighbors.map(withResolvedArtworkFootprint);
    const obstacles: BarrierObstacle[] = footprintNeighbors.map((neighbor) => ({
      id: neighbor.id,
      boundsMm: getWallObjectBoundsMm(neighbor),
      hardness: barrierHardnessFor(movingKinds, neighbor.kind)
    }));
    // A partition standing at (or near) this wall ends the hanging zone, so it
    // should capture a drag exactly like a real neighbor: its edges and center
    // become snap targets, and the clean-increment quantizer measures the gap
    // from its edge rather than sailing past it to the wall end. Note where this
    // list is NOT used — `obstacles` above stays wall-objects-only, keeping the
    // projection visual-only for placement legality (USER DECISION).
    const snapNeighbors: WallObjectBase[] = [
      ...footprintNeighbors,
      ...partitionNeighborShims
    ];

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
      neighbors: snapNeighbors,
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
      const incrementMm = minorGridMm;
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
          snapNeighbors
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
      const nb = getWallObjectBoundsMm(withResolvedArtworkFootprint(neighbor));
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


  function beginMarquee(event: ReactPointerEvent<SVGSVGElement>) {
    if (canvasToolArmed) return;
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

    // ⌘/Ctrl + primary-button background drag pans the canvas — the modifier-
    // click sibling of Space/middle-mouse pan, which the user asked for. This
    // deliberately claims the gesture away from the replace-marquee it would
    // otherwise start (that marquee is redundant: a plain background drag
    // already does it, and a plain click still clears). ⌘/Ctrl on an OBJECT
    // press stays the precision/additive-select modifier — those never reach
    // here (they stopPropagation). Shift-background-drag stays the additive
    // marquee. On macOS a Ctrl-click is button 2 / contextmenu, so it never
    // matches button 0; ctrlKey serves Windows/Linux. The trailing click a
    // (even zero-move) pan fires is inert here — elevation has no svg click
    // handler, so a stationary ⌘-press simply leaves the selection intact.
    if ((event.metaKey || event.ctrlKey) && event.button === 0) {
      beginMousePan(event.clientX, event.clientY);
      event.preventDefault();
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

    // Pan/pinch gets first refusal, mirroring PlanView. The first touch is
    // recorded before Measure sees it, so a second touch can promote the
    // gesture to a pinch; that promotion cancels any one-finger measurement in
    // flight (touch only — mouse/pen keep their existing behavior via
    // shouldCancelMeasurementForViewportClaim's pointer-type guard).
    if (handlePointerDownCapture(event)) {
      if (
        shouldCancelMeasurementForViewportClaim(
          event.pointerType,
          measurementGestureRef.current !== null
        )
      ) {
        cancelMeasurementPointerGesture();
      }
      return;
    }

    if (measurementActive) {
      const target = event.target as Element;
      // Measurement handles/body own the more specific interaction. Their
      // target handlers run after capture and must not be mistaken for a new
      // point on the underlying wall.
      if (target.closest(".measurement-overlay")) return;
      if (handleMeasurementPointerDown(event)) return;
      // Rejected measurement presses (Space-pan, secondary buttons) already
      // went through the viewport engine above.
    }
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
        const footprintGroupMembers = groupMembers.map(withResolvedArtworkFootprint);
        const box = getGroupBounds(footprintGroupMembers);
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

    const footprintWallObject = withResolvedArtworkFootprint(wallObject);
    beginMoveDragGesture({
      wallObjectId: wallObject.id,
      kind: wallObject.kind,
      sizeMm: {
        widthMm: footprintWallObject.widthMm,
        heightMm: footprintWallObject.heightMm
      },
      startPointerMm,
      startCenterMm: { xMm: wallObject.xMm, yMm: wallObject.yMm },
      previewCenterMm: { xMm: wallObject.xMm, yMm: wallObject.yMm },
      previousSnapTargetIds: undefined,
      activeGuides: [],
      preserveSelection: altSoloDrag,
      brokenBarrierIds: seedBrokenBarrierIds(
        getWallObjectBoundsMm(footprintWallObject),
        wallObjectsOnThisWall.filter((object) => object.id !== wallObject.id)
      )
    });
  }



  return {
    moveDrag,
    moveDragRef,
    isMoveDragging,
    marquee,
    marqueeRef,
    isMarqueeDragging: isMarqueeragging,
    resolveElevationPlacement,
    seedBrokenBarrierIds,
    beginMarquee,
    handleSvgPointerDownCapture,
    beginMoveDrag
  };
}
