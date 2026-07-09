// Composes the one-gesture-at-a-time drag preview PlanView renders during a
// wall resize, room move, vertex drag, or wall-slide — extracted from
// PlanView's hand-spliced displayedProject pipeline so the splice semantics
// live in the domain layer instead of the view. Layers apply in the same
// order PlanView applied them (wall resize → room move → vertex move → wall
// slide), each reading the PREVIOUS layer's output, not the original
// project — so wallSlide, for instance, previews on top of an in-flight
// vertex move even though today's UI never lets both happen at once.
//
// Layers are mutually exclusive in practice today: PlanView only ever has
// one drag gesture live at a time, so at most one field of PlanPreview is
// set on any given render. Cross-room edits (the doorway feature, which
// needs to preview changes to two rooms from one gesture) should extend this
// function — add a layer, or let one layer's config carry more than one
// room's worth of change — rather than resuming hand-splicing in the view.
import type { Project } from "../project";
import { resizeWallPreservingAngles, type ResizeAnchor } from "./editRoom";
import { moveRoomWall } from "./reshapeRoom";

export type PlanPreview = {
  // A rectangle room's numeric/handle wall resize. Mirrors PlanView's
  // wall-resize DragState fields that resizeWallPreservingAngles actually
  // consumes (targetWallId → wallId, previewLengthMm → lengthMm, anchor
  // as-is); DragState's roomId/axis/startPointerMm/etc. are drag-gesture
  // bookkeeping the domain call never needed. NOT wrapped in a fallback —
  // same as PlanView's original resizePreviewProject, an invalid length or
  // non-rectangular room throws straight through (previewLengthMm is always
  // clamped positive upstream, and RoomResizeHandles only exist for
  // rectangles, so this hasn't been observed to throw in practice, but the
  // absence of a catch here is a deliberate match to prior behavior, not an
  // oversight).
  wallResize?: { wallId: string; lengthMm: number; anchor: ResizeAnchor };
  // A whole-room translate. Mirrors RoomDragState.previewOffsetMm.
  roomMove?: { roomId: string; offsetXMm: number; offsetYMm: number };
  // Reshape mode's single-vertex drag. Mirrors VertexDragState.previewLocalMm.
  // Applied unconditionally (no validity gate) — same as PlanView's original
  // vertexDragPreviewProject: an invalid in-flight position still needs to
  // render (the danger token), canMoveRoomVertex only gates the commit.
  vertexMove?: { roomId: string; vertexId: string; xMm: number; yMm: number };
  // Reshape mode's whole-wall body slide. Mirrors WallDragState's
  // roomId/wallId/previewOffsetMm. Wrapped in try/catch, falling back to
  // the pre-slide project on failure — same as PlanView's original inline
  // try/catch around moveRoomWall.
  wallSlide?: { roomId: string; wallId: string; offsetMm: number };
};

// Applies `preview`'s layers to `project` in wallResize → roomMove →
// vertexMove → wallSlide order, exactly as PlanView's
// resizePreviewProject/roomDragPreviewProject/vertexDragPreviewProject/
// displayedProject chain did. When no layer is set, returns `project` BY
// REFERENCE (not a copy) — callers that useMemo this against the committed
// project rely on that identity to avoid re-rendering when nothing is
// in-flight.
export function applyPlanPreview(project: Project, preview: PlanPreview): Project {
  let next = project;

  if (preview.wallResize) {
    next = resizeWallPreservingAngles(
      next,
      preview.wallResize.wallId,
      preview.wallResize.lengthMm,
      preview.wallResize.anchor
    ).project;
  }

  if (preview.roomMove) {
    const { roomId, offsetXMm, offsetYMm } = preview.roomMove;
    next = {
      ...next,
      floor: {
        rooms: next.floor.rooms.map((candidate) =>
          candidate.roomId === roomId ? { ...candidate, offsetXMm, offsetYMm } : candidate
        )
      }
    };
  }

  if (preview.vertexMove) {
    const { roomId, vertexId, xMm, yMm } = preview.vertexMove;
    next = {
      ...next,
      floor: {
        rooms: next.floor.rooms.map((placement) =>
          placement.roomId === roomId
            ? {
                ...placement,
                room: {
                  ...placement.room,
                  vertices: placement.room.vertices.map((vertex) =>
                    vertex.id === vertexId ? { ...vertex, xMm, yMm } : vertex
                  )
                }
              }
            : placement
        )
      }
    };
  }

  if (preview.wallSlide) {
    const beforeSlide = next;
    try {
      next = moveRoomWall(
        next,
        preview.wallSlide.roomId,
        preview.wallSlide.wallId,
        preview.wallSlide.offsetMm
      ).project;
    } catch {
      next = beforeSlide;
    }
  }

  return next;
}
