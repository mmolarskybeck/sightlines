import { describe, expect, it } from "vitest";
import { createBlankProject } from "../newProject";
import { createSampleProject } from "../sample/sampleProject";
import { feetToMm } from "../units/length";
import type { Project } from "../project";
import { createPolygonRoomPlacement } from "./createRoom";
import { resizeWallPreservingAngles } from "./editRoom";
import { moveRoomWall } from "./reshapeRoom";
import { applyPlanPreview, type PlanPreview } from "./planPreview";

// Same L-shape reshapeRoom.test.ts uses for "rejects an offset that makes
// the re-intersected loop self-crossing" — a wall-slide on wall1 (v1->v2,
// the L's inner horizontal leg) throws, which is exactly the fallback path
// this suite needs to exercise for wallSlide.
const L_SHAPE = [
  { xMm: 1000, yMm: 1000 },
  { xMm: 1000, yMm: 4000 },
  { xMm: 3000, yMm: 4000 },
  { xMm: 3000, yMm: 2000 },
  { xMm: 5000, yMm: 2000 },
  { xMm: 5000, yMm: 1000 }
];

function polygonRoomProject(): Project {
  const base = createBlankProject("Polygon test");
  const placement = createPolygonRoomPlacement({
    roomId: "room-l",
    name: "Gallery L",
    heightMm: feetToMm(12),
    pointsFloorMm: L_SHAPE
  });
  return { ...base, floor: { rooms: [placement] } };
}

describe("applyPlanPreview", () => {
  it("returns the input project by reference when no layer is set", () => {
    const project = createSampleProject();
    expect(applyPlanPreview(project, {})).toBe(project);
  });

  describe("wallResize layer alone", () => {
    it("matches resizeWallPreservingAngles applied directly", () => {
      const project = createSampleProject();
      const expected = resizeWallPreservingAngles(project, "wall-north", feetToMm(30)).project;

      const result = applyPlanPreview(project, {
        wallResize: { wallId: "wall-north", lengthMm: feetToMm(30), anchor: "start" }
      });

      expect(result).toEqual(expected);
    });

    it("throws straight through rather than falling back — matches PlanView's original resizePreviewProject, which had no try/catch", () => {
      const project = createSampleProject();
      // Skew the room so it's no longer a rectangle — resizeWallPreservingAngles
      // refuses to numeric-resize a non-rectangular room's wall.
      const skewed: Project = {
        ...project,
        floor: {
          rooms: project.floor.rooms.map((placement) => ({
            ...placement,
            room: {
              ...placement.room,
              vertices: placement.room.vertices.map((vertex) =>
                vertex.id === "v-se" ? { ...vertex, xMm: feetToMm(29) } : vertex
              )
            }
          }))
        }
      };

      expect(() =>
        applyPlanPreview(skewed, {
          wallResize: { wallId: "wall-north", lengthMm: feetToMm(30), anchor: "start" }
        })
      ).toThrow(/isn't a simple rectangle/);
    });
  });

  describe("roomMove layer alone", () => {
    it("overrides the room's offset and leaves everything else untouched", () => {
      const project = createSampleProject();

      const result = applyPlanPreview(project, {
        roomMove: { roomId: "room-main", offsetXMm: 500, offsetYMm: 300 }
      });

      expect(result.floor.rooms[0]).toMatchObject({ offsetXMm: 500, offsetYMm: 300 });
      expect(result.floor.rooms[0].room).toBe(project.floor.rooms[0].room);
      expect(result.wallObjects).toBe(project.wallObjects);
    });
  });

  describe("vertexMove layer alone", () => {
    it("overrides one vertex's local position unconditionally, even into an invalid (self-intersecting) shape", () => {
      // Mirrors PlanView's original vertexDragPreviewProject: it splices the
      // in-flight position with no validity gate — canMoveRoomVertex only
      // gates the commit on pointer-up, not the live preview render, so the
      // danger token has something to show mid-drag.
      const project = createSampleProject();

      const result = applyPlanPreview(project, {
        vertexMove: { roomId: "room-main", vertexId: "v-ne", xMm: feetToMm(10), yMm: feetToMm(28) }
      });

      const vertex = result.floor.rooms[0].room.vertices.find((v) => v.id === "v-ne");
      expect(vertex).toMatchObject({ xMm: feetToMm(10), yMm: feetToMm(28) });
      // Untouched vertices are the same objects (shallow splice, not a deep clone).
      const untouchedBefore = project.floor.rooms[0].room.vertices.find((v) => v.id === "v-nw");
      const untouchedAfter = result.floor.rooms[0].room.vertices.find((v) => v.id === "v-nw");
      expect(untouchedAfter).toBe(untouchedBefore);
    });
  });

  describe("wallSlide layer alone", () => {
    it("matches moveRoomWall applied directly when the offset is valid", () => {
      const project = createSampleProject();
      const expected = moveRoomWall(project, "room-main", "wall-north", 1000).project;

      const result = applyPlanPreview(project, {
        wallSlide: { roomId: "room-main", wallId: "wall-north", offsetMm: 1000 }
      });

      expect(result).toEqual(expected);
    });

    it("falls back to the pre-slide project (by reference) when moveRoomWall throws", () => {
      const project = polygonRoomProject();
      const wallId = project.floor.rooms[0].room.walls[1].id; // the L's inner leg

      // Ground truth: moveRoomWall itself throws for this offset.
      expect(() => moveRoomWall(project, "room-l", wallId, 2000)).toThrow();

      // applyPlanPreview swallows it and returns the untouched input project —
      // same identity, since wallSlide was the only layer in play.
      const result = applyPlanPreview(project, {
        wallSlide: { roomId: "room-l", wallId, offsetMm: 2000 }
      });

      expect(result).toBe(project);
    });
  });

  describe("layering order", () => {
    it("applies roomMove AFTER wallResize, so an end-anchored resize's offset shift on the same room is overwritten by roomMove's absolute value", () => {
      const project = createSampleProject();

      // Ground truth: an end-anchored resize of wall-north shifts room-main's
      // placement offset (to hold the end vertex fixed in world space) — the
      // offset does NOT stay (0, 0).
      const resizeOnly = resizeWallPreservingAngles(project, "wall-north", feetToMm(30), "end").project;
      const resizeOnlyOffset = resizeOnly.floor.rooms[0];
      expect(resizeOnlyOffset.offsetXMm).not.toBeCloseTo(0);

      const preview: PlanPreview = {
        wallResize: { wallId: "wall-north", lengthMm: feetToMm(30), anchor: "end" },
        roomMove: { roomId: "room-main", offsetXMm: 500, offsetYMm: 300 }
      };

      const result = applyPlanPreview(project, preview);

      // If roomMove ran BEFORE wallResize, the final offset would be
      // (500, 300) further shifted by the resize's own offset delta — it
      // isn't. roomMove wins outright because it's the later layer, proving
      // the pipeline order (wallResize, then roomMove, ...) actually matters
      // and applyPlanPreview reproduces it.
      expect(result.floor.rooms[0]).toMatchObject({ offsetXMm: 500, offsetYMm: 300 });
      // But the resize's effect on the ROOM geometry (not the offset) still
      // shows through — roomMove only overrides offsetXMm/offsetYMm.
      expect(result.floor.rooms[0].room).toEqual(resizeOnly.floor.rooms[0].room);
    });
  });
});
