import type { Vector2 } from "../../../domain/geometry/dragResize";
import type { ResizeAnchor } from "../../../domain/geometry/editRoom";
import type { PlanRect } from "../../../domain/geometry/planObjects";
import type { FloatPolicy, ResolvedPlacement } from "../../../domain/snapping/planSnapTargets";
import type { Guide, SnapTargetIds } from "../../../domain/snapping/resolveSnap";
import type { PlanGroupMember } from "../../../domain/snapping/planGroupMove";
import type { DrawRoomSnap } from "../../../domain/geometry/drawSnapping";
import type { WallObject } from "../../../domain/project";

// The transient, never-persisted gesture states that back PlanView's live
// drag/draw previews. They live here (rather than inline in PlanView) so the
// render-only layer components in this directory can type the preview slices
// they paint without reaching back into PlanView. STATE STILL LIVES IN
// PlanView — these are only the shapes; every useState/useDragGesture that
// holds them stays in the orchestration component.

export type DragState = {
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
export type RoomDragState = {
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
export type ToolGhostState = {
  planRect: PlanRect;
  // Door/window/blocked-zone tools never reject (they float or capture at any
  // distance), but the resolver's result is a ResolvedPlacement, so the field
  // carries the wider type; the "none" case is simply never reached here.
  placement: ResolvedPlacement;
  activeGuides: Guide[];
};

// A pointer-drag move of an existing placed object (wall-anchored or floor-
// placed), transient until release: live preview, exactly one commitPlanMove
// on release (that single action handles same-wall / re-anchor / wall↔floor
// atomically). Mirrors ElevationView's MoveDragState and PlanView's own
// wall-resize DragState — the effect reads the latest values from a ref and
// omits them from deps, so the drag never resubscribes mid-gesture.
export type ObjectDragState = {
  objectId: string;
  kind: WallObject["kind"];
  // Per-kind fall-through behavior when no wall captures (floatPolicyForKind):
  // artwork rejects (wall-only), blocked-zone floats, door/window capture-any.
  floatPolicy: FloatPolicy;
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
  // May be `{ anchor: "none" }` for an artwork dragged off all walls: the live
  // preview shows the danger token and release is a no-op.
  previewPlacement: ResolvedPlacement;
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
export type DropGhostState = {
  planRect: PlanRect;
  // `{ anchor: "none" }` when the artwork isn't over a wall — the ghost paints
  // in the danger style and the drop is refused (artwork is wall-only).
  placement: ResolvedPlacement;
  activeGuides: Guide[];
};

// The in-progress polygon-room draw gesture, transient until close/cancel and
// deliberately NOT in the store (same reasoning as the drag/marquee states):
// no store write happens until the loop closes, so undo removes the whole room
// in one step and Escape mid-draw costs nothing. `points` are floor-space mm.
export type DrawState = {
  points: Vector2[];
  // The snapped rubber-band endpoint following the cursor (null before the
  // pointer has moved over the surface).
  cursorMm: Vector2 | null;
  // The current segment (last point → cursor) would self-intersect, or a close
  // attempt failed its simple-polygon test — render the danger token.
  invalid: boolean;
  // Cursor is within the close radius of the first vertex (≥3 points), so the
  // preview shows the closing segment instead of a rubber band. Also set when
  // the cursor is room-snapped onto a wall that would close the loop (§6.3),
  // so the same affordance reads for both close paths.
  closing: boolean;
  // The cursor is latched onto an existing room's perimeter geometry (§6.3) —
  // drives the snap indicator. Transient, never written to the store.
  snap: DrawRoomSnap | null;
};

// Reshape mode's vertex drag, transient until release — mirrors RoomDragState's
// discipline exactly (ref-mirrored state, one commit on pointer-up), with one
// addition: `valid` tracks whether the CURRENT preview position keeps the
// room a simple polygon (canMoveRoomVertex, the same predicate moveRoomVertex
// commits against), so the render layer can paint the danger token live and
// pointer-up can revert instead of committing when the drag ends invalid.
export type VertexDragState = {
  roomId: string;
  vertexId: string;
  startPointerMm: Vector2;
  startLocalMm: Vector2;
  previewLocalMm: Vector2;
  valid: boolean;
  previousSnapTargetIds?: SnapTargetIds;
  activeGuides: Guide[];
};

// Reshape mode's whole-wall body drag — CAD "offset/re-intersect" (Sims-
// style): slide the wall along its own perpendicular. Same discipline as
// VertexDragState (ref-mirrored state, one commit on pointer-up, `valid`
// tracks whether the CURRENT preview offset keeps moveRoomWall from
// throwing, so the outline can paint the danger token live and pointer-up can
// revert instead of commit). Unlike a vertex drag, the axis is fixed at drag
// start (the wall's own left-normal, captured once) rather than free 2D
// movement — every pointer delta gets projected onto it.
export type WallDragState = {
  roomId: string;
  wallId: string;
  startPointerMm: Vector2;
  normal: Vector2;
  previewOffsetMm: number;
  valid: boolean;
};

// The in-progress partition (free-standing wall) draw — a single centerline
// segment dragged inside a room, transient until release (no store write until
// then, so undo removes the partition in one step). Floor-space mm.
export type PartitionDrawState = {
  startMm: Vector2;
  endMm: Vector2 | null;
  invalid: boolean;
};

// A rectangle-room create drag: the two grid-snapped corners, transient until
// release (no store write until then, so undo removes the room in one step).
// Floor-space mm.
export type RectDrawState = {
  startMm: Vector2;
  endMm: Vector2 | null;
  invalid: boolean;
};

// A partition edit drag: a whole-body translation, or one endpoint re-drag
// (resize/re-angle). Ref-mirrored, one commit on release, same discipline as
// the vertex drag.
export type PartitionDragState = {
  wallId: string;
  mode: "move" | "start" | "end";
  startPointerMm: Vector2;
  startFloorMm: Vector2;
  endFloorMm: Vector2;
  previewStartFloorMm: Vector2;
  previewEndFloorMm: Vector2;
};
