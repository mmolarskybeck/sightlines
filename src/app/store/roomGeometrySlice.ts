import {
  createNextDrawnRectangleRoom,
  createNextPolygonRoom,
  createNextRectangleRoom
} from "../../domain/geometry/createRoom";
import type { Point } from "../../domain/geometry/polygon";
import {
  resizeWallPreservingAngles,
  setPolygonWallLength as setPolygonWallLengthEdit,
  type GeometryEditResult,
  type ResizeAnchor
} from "../../domain/geometry/editRoom";
import {
  centerFreestandingWallBetweenWalls,
  createFreestandingWall,
  duplicateFreestandingWallEdit,
  faceWallIdsOf,
  moveFreestandingEndpoint as moveFreestandingEndpointEdit,
  moveFreestandingWall as moveFreestandingWallEdit,
  roomIdContainingPoint,
  rotateFreestandingWall as rotateFreestandingWallEdit,
  setFreestandingClearanceEdit,
  setFreestandingHeight,
  setFreestandingLength,
  setFreestandingThickness,
  type FreestandingClearanceSide
} from "../../domain/geometry/freestandingWalls";
import {
  deleteRoomVertex as deleteRoomVertexEdit,
  moveRoomVertex as moveRoomVertexEdit,
  moveRoomWall as moveRoomWallEdit,
  splitWall as splitWallEdit
} from "../../domain/geometry/reshapeRoom";
import {
  deleteRoomFromProject,
  getRoomCascadeScope
} from "../../domain/geometry/roomCascade";
import { clearOpeningPartners } from "../../domain/placement/openingPairs";
import type { PlacementWarning } from "../../domain/placement/validatePlacement";
import type { Project } from "../../domain/project";
import { getFirstWall } from "../projectWalls";
import type { AppState, EditExtras } from "../store";
import { NO_SELECTION, selectionWrite, type Selection } from "./selectionSlice";

export type RoomGeometrySliceActions = {
  renameRoom: (roomId: string, name: string) => Promise<void>;
  deleteRoom: (roomId: string) => Promise<void>;
  addRectangleRoom: () => Promise<void>;
  addPolygonRoom: (pointsFloorMm: Point[]) => Promise<void>;
  addDrawnRectangleRoom: (rect: {
    offsetXMm: number;
    offsetYMm: number;
    widthMm: number;
    depthMm: number;
  }) => Promise<void>;
  addFreestandingWall: (startFloorMm: Point, endFloorMm: Point) => Promise<void>;
  duplicateFreestandingWall: (wallId: string, centerFloorMm: Point) => Promise<void>;
  moveFreestandingWall: (wallId: string, deltaFloorMm: Point) => Promise<void>;
  moveFreestandingWallEndpoint: (
    wallId: string,
    end: "start" | "end",
    nextFloorMm: Point
  ) => Promise<void>;
  rotateFreestandingWall: (wallId: string, angleDeg: number) => Promise<void>;
  centerFreestandingWall: (wallId: string, axis: "normal" | "axis") => Promise<void>;
  setFreestandingWallThickness: (wallId: string, thicknessMm: number) => Promise<void>;
  setFreestandingWallLength: (
    wallId: string,
    lengthMm: number,
    anchor?: "start" | "end"
  ) => Promise<void>;
  setFreestandingWallHeight: (wallId: string, heightMm: number) => Promise<void>;
  setFreestandingWallClearance: (
    wallId: string,
    side: FreestandingClearanceSide,
    distanceMm: number
  ) => Promise<void>;
  deleteFreestandingWall: (wallId: string) => Promise<void>;
  resizeRoomHeight: (roomId: string, heightMm: number) => Promise<void>;
  resizeWall: (wallId: string, lengthMm: number, anchor?: ResizeAnchor) => Promise<void>;
  setPolygonWallLength: (
    wallId: string,
    lengthMm: number,
    anchor?: ResizeAnchor
  ) => Promise<void>;
  resizeSelectedWall: (lengthMm: number) => Promise<void>;
  moveRoomVertex: (roomId: string, vertexId: string, nextLocalMm: Point) => Promise<void>;
  moveRoomWall: (roomId: string, wallId: string, offsetMm: number) => Promise<void>;
  splitWall: (wallId: string, xAlongMm: number) => Promise<void>;
  deleteRoomVertex: (roomId: string, vertexId: string) => Promise<void>;
  moveRoom: (roomId: string, offsetXMm: number, offsetYMm: number) => Promise<void>;
};

export type RoomGeometrySliceInternals = {
  applyEdit: (
    label: string,
    buildNextProject: (project: Project) => Project,
    extras?: EditExtras
  ) => Promise<void>;
  // Partition edit boundary: compute, validate affected placements, and commit.
  runPartitionEdit: (args: {
    label: string;
    errorFallback: string;
    compute: (project: Project) => GeometryEditResult;
    validate?: boolean;
    extras?: (result: GeometryEditResult) => EditExtras;
  }) => Promise<void>;
  validateChangedWallPlacements: (
    project: Project,
    changedWallIds: string[]
  ) => PlacementWarning[];
};

export function createRoomGeometrySlice(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  internals: RoomGeometrySliceInternals
): { actions: RoomGeometrySliceActions } {
  const { applyEdit, runPartitionEdit, validateChangedWallPlacements } = internals;

  const actions: RoomGeometrySliceActions = {
    async renameRoom(roomId, name) {
      const project = get().project;
      const trimmed = name.trim();
      const roomPlacement = project?.floor.rooms.find(
        (placement) => placement.roomId === roomId
      );
      if (!project || !roomPlacement || trimmed.length === 0) return;
      if (trimmed === roomPlacement.room.name) return;

      await applyEdit("Rename room", (current) => ({
        ...current,
        floor: {
          rooms: current.floor.rooms.map((placement) =>
            placement.roomId === roomId
              ? { ...placement, room: { ...placement.room, name: trimmed } }
              : placement
          )
        }
      }));
    },

    async deleteRoom(roomId) {
      const project = get().project;
      const roomPlacement = project?.floor.rooms.find(
        (placement) => placement.roomId === roomId
      );
      if (!project || !roomPlacement) return;

      // Domain cascade removes room wall objects and dangling partner refs.
      const { project: nextProject } = deleteRoomFromProject(project, roomId);
      const nextRooms = nextProject.floor.rooms;
      // Selection context keys off perimeter walls, not partition faces.
      const { wallIds: deletedWallIds } = getRoomCascadeScope(project, roomId);

      // Wall context falls back to a surviving wall when the deleted room
      // owned it; otherwise it persists untouched.
      const wallContextId = get().wallContextId;
      const nextWallContextId = wallContextId && deletedWallIds.has(wallContextId)
        ? (nextRooms[0]?.room.walls[0]?.id ?? null)
        : wallContextId;

      // Clear focused rooms and single opening selections; preserve tolerant
      // multi-selection ids because undo may make them live again.
      const current = get().selection;
      const isDyingOpeningSelection =
        current.kind === "objects" &&
        current.ids.length === 1 &&
        project.wallObjects.some(
          (wallObject) =>
            wallObject.id === current.ids[0] &&
            wallObject.kind !== "artwork" &&
            deletedWallIds.has(wallObject.wallId)
        );
      const nextSelection: Selection =
        (current.kind === "room" && current.roomId === roomId) || isDyingOpeningSelection
          ? NO_SELECTION
          : current;

      await applyEdit(
        `Delete ${roomPlacement.room.name}`,
        () => nextProject,
        {
          ...selectionWrite(nextProject, nextSelection, nextWallContextId),
          viewMode: "plan"
        }
      );
    },

    async addRectangleRoom() {
      const project = get().project;
      if (!project) return;

      const roomPlacement = createNextRectangleRoom(
        project.floor,
        project.defaultWallHeightMm
      );

      await applyEdit(
        `Add ${roomPlacement.room.name}`,
        (current) => ({
          ...current,
          floor: { rooms: [...current.floor.rooms, roomPlacement] }
        }),
        {
          // Move the sidebar context to the new room's first wall; the
          // current selection (if any) is left as-is.
          ...selectionWrite(
            project,
            get().selection,
            roomPlacement.room.walls[0]?.id ?? null
          ),
          viewMode: "plan"
        }
      );
    },

    async addPolygonRoom(pointsFloorMm) {
      const project = get().project;
      if (!project) return;

      // The draw tool already blocks self-intersection and coincident points,
      // but the constructor is the defense-in-depth boundary — a bad polygon
      // fails calmly here rather than corrupting the document.
      let roomPlacement;
      try {
        roomPlacement = createNextPolygonRoom(
          project.floor,
          project.defaultWallHeightMm,
          pointsFloorMm
        );
      } catch (error) {
        set({
          error: `Could not add that room (${
            error instanceof Error ? error.message : "invalid outline."
          }).`
        });
        return;
      }

      const nextProject: Project = {
        ...project,
        floor: { rooms: [...project.floor.rooms, roomPlacement] }
      };

      await applyEdit(`Add room`, () => nextProject, {
        // Select the new room and move the sidebar wall context to its first
        // wall, so plan handles and the elevation switcher both land on it.
        ...selectionWrite(
          nextProject,
          { kind: "room", roomId: roomPlacement.roomId },
          roomPlacement.room.walls[0]?.id ?? null
        ),
        viewMode: "plan"
      });
    },

    async addDrawnRectangleRoom(rect) {
      const project = get().project;
      if (!project) return;

      // The draw tool already enforces a minimum size, but the constructor is
      // the defense-in-depth boundary — a bad rectangle fails calmly here
      // rather than corrupting the document.
      let roomPlacement;
      try {
        roomPlacement = createNextDrawnRectangleRoom(
          project.floor,
          project.defaultWallHeightMm,
          rect
        );
      } catch (error) {
        set({
          error: `Could not add that room (${
            error instanceof Error ? error.message : "invalid rectangle."
          }).`
        });
        return;
      }

      const nextProject: Project = {
        ...project,
        floor: { rooms: [...project.floor.rooms, roomPlacement] }
      };

      await applyEdit(`Add ${roomPlacement.room.name}`, () => nextProject, {
        // Select the new room and move the sidebar wall context to its first
        // wall, so plan handles and the elevation switcher both land on it.
        ...selectionWrite(
          nextProject,
          { kind: "room", roomId: roomPlacement.roomId },
          roomPlacement.room.walls[0]?.id ?? null
        ),
        viewMode: "plan"
      });
    },

    async addFreestandingWall(startFloorMm, endFloorMm) {
      const project = get().project;
      if (!project) return;

      // Room assignment by the segment midpoint (spec §6.4). Off-room drags
      // (no containing room) are refused calmly rather than corrupting state.
      const midpoint = {
        xMm: (startFloorMm.xMm + endFloorMm.xMm) / 2,
        yMm: (startFloorMm.yMm + endFloorMm.yMm) / 2
      };
      const roomId = roomIdContainingPoint(project, midpoint);
      if (!roomId) {
        set({ error: "Draw a partition inside a room." });
        return;
      }

      let result;
      try {
        result = createFreestandingWall(project, roomId, startFloorMm, endFloorMm);
      } catch (error) {
        set({
          error: `Could not add that partition (${
            error instanceof Error ? error.message : "invalid endpoints."
          }).`
        });
        return;
      }

      await applyEdit("Add partition", () => result.project, {
        ...selectionWrite(
          result.project,
          { kind: "freestandingWall", wallId: result.wallId },
          get().wallContextId
        ),
        viewMode: "plan"
      });
    },

    async duplicateFreestandingWall(wallId, centerFloorMm) {
      await runPartitionEdit({
        label: "Duplicate partition",
        errorFallback: "Could not duplicate that partition",
        compute: (project) => duplicateFreestandingWallEdit(project, wallId, centerFloorMm),
        extras: (result) => ({
          ...selectionWrite(
            result.project,
            { kind: "freestandingWall", wallId: result.anchorVertexId },
            get().wallContextId
          ),
          viewMode: "plan"
        })
      });
    },

    async moveFreestandingWall(wallId, deltaFloorMm) {
      if (deltaFloorMm.xMm === 0 && deltaFloorMm.yMm === 0) return;

      await runPartitionEdit({
        label: "Move partition",
        errorFallback: "Could not move that partition",
        compute: (project) => moveFreestandingWallEdit(project, wallId, deltaFloorMm)
      });
    },

    async moveFreestandingWallEndpoint(wallId, end, nextFloorMm) {
      await runPartitionEdit({
        label: "Reshape partition",
        errorFallback: "Could not reshape that partition",
        compute: (project) => moveFreestandingEndpointEdit(project, wallId, end, nextFloorMm)
      });
    },

    async rotateFreestandingWall(wallId, angleDeg) {
      await runPartitionEdit({
        label: "Rotate partition",
        errorFallback: "Could not rotate that partition",
        compute: (project) => rotateFreestandingWallEdit(project, wallId, angleDeg)
      });
    },

    async centerFreestandingWall(wallId, axis) {
      await runPartitionEdit({
        label: "Center partition",
        errorFallback: "Could not center that partition",
        compute: (project) => centerFreestandingWallBetweenWalls(project, wallId, axis)
      });
    },

    async setFreestandingWallThickness(wallId, thicknessMm) {
      await runPartitionEdit({
        label: "Resize partition",
        errorFallback: "Could not resize that partition",
        compute: (project) => setFreestandingThickness(project, wallId, thicknessMm),
        validate: false
      });
    },

    async setFreestandingWallLength(wallId, lengthMm, anchor = "start") {
      await runPartitionEdit({
        label: "Resize partition",
        errorFallback: "Could not resize that partition",
        compute: (project) => setFreestandingLength(project, wallId, lengthMm, anchor)
      });
    },

    async setFreestandingWallHeight(wallId, heightMm) {
      await runPartitionEdit({
        label: "Resize partition",
        errorFallback: "Could not resize that partition",
        compute: (project) => setFreestandingHeight(project, wallId, heightMm)
      });
    },

    async setFreestandingWallClearance(wallId, side, distanceMm) {
      await runPartitionEdit({
        label: "Move partition",
        errorFallback: "Could not move that partition",
        compute: (project) =>
          setFreestandingClearanceEdit(project, wallId, side, distanceMm)
      });
    },

    async deleteFreestandingWall(wallId) {
      const project = get().project;
      if (!project) return;

      const placement = project.floor.rooms.find((candidate) =>
        candidate.room.freestandingWalls.some((wall) => wall.id === wallId)
      );
      if (!placement) return;

      // Cascade (spec §6.5): drop both faces' wall objects, then clear any
      // surviving partner's connectsToObjectId pointing at a deleted opening,
      // all in one commit so no dangling ref ever persists.
      const faceIds = new Set(faceWallIdsOf(wallId));
      const deletedObjectIds = new Set(
        project.wallObjects.filter((object) => faceIds.has(object.wallId)).map((o) => o.id)
      );
      const nextWallObjects = clearOpeningPartners(
        project.wallObjects.filter((object) => !deletedObjectIds.has(object.id)),
        deletedObjectIds
      );

      const nextProject: Project = {
        ...project,
        floor: {
          rooms: project.floor.rooms.map((candidate) =>
            candidate.roomId === placement.roomId
              ? {
                  ...candidate,
                  room: {
                    ...candidate.room,
                    freestandingWalls: candidate.room.freestandingWalls.filter(
                      (wall) => wall.id !== wallId
                    )
                  }
                }
              : candidate
          )
        },
        wallObjects: nextWallObjects,
        referenceMeasurements: (project.referenceMeasurements ?? []).filter(
          (measurement) => measurement.kind === "plan" || !faceIds.has(measurement.wallId)
        )
      };

      // Clear selection if it pointed at the deleted partition.
      const current = get().selection;
      const nextSelection: Selection =
        current.kind === "freestandingWall" && current.wallId === wallId
          ? NO_SELECTION
          : current.kind === "measurement" &&
              !(nextProject.referenceMeasurements ?? []).some(
                (measurement) => measurement.id === current.measurementId
              )
            ? NO_SELECTION
          : current;
      // If the wall context pointed at a face of the deleted partition, drop
      // it to a surviving wall.
      const wallContextId = get().wallContextId;
      const nextWallContextId =
        wallContextId && faceIds.has(wallContextId)
          ? (getFirstWall(nextProject)?.id ?? null)
          : wallContextId;

      await applyEdit("Delete partition", () => nextProject, {
        ...selectionWrite(nextProject, nextSelection, nextWallContextId)
      });
    },

    async resizeRoomHeight(roomId, heightMm) {
      const project = get().project;
      if (!project) return;
      if (!Number.isFinite(heightMm) || heightMm <= 0) {
        throw new Error("Room height must be greater than zero.");
      }

      const roomPlacement = project.floor.rooms.find(
        (placement) => placement.roomId === roomId
      );
      if (!roomPlacement) return;
      if (
        roomPlacement.room.heightMm === heightMm &&
        roomPlacement.room.walls.every((wall) => wall.heightMm === heightMm)
      ) {
        return;
      }

      // Partitions get FOLLOW-THE-DEFAULT semantics (spec §5.2): a partition
      // still at the previous room height is an untouched default and follows
      // the room; one deliberately built shorter keeps its own height. Their
      // affected face ids join changedWallIds so placements revalidate.
      const previousRoomHeightMm = roomPlacement.room.heightMm;
      const changedWallIds = [...roomPlacement.room.walls.map((wall) => wall.id)];
      const nextFreestandingWalls = roomPlacement.room.freestandingWalls.map((partition) => {
        if (partition.heightMm !== previousRoomHeightMm) return partition;
        changedWallIds.push(...faceWallIdsOf(partition.id));
        return { ...partition, heightMm };
      });

      const nextProject: Project = {
        ...project,
        floor: {
          rooms: project.floor.rooms.map((placement) =>
            placement.roomId === roomId
              ? {
                  ...placement,
                  room: {
                    ...placement.room,
                    heightMm,
                    walls: placement.room.walls.map((wall) => ({
                      ...wall,
                      heightMm
                    })),
                    freestandingWalls: nextFreestandingWalls
                  }
                }
              : placement
          )
        }
      };
      const placementWarnings = validateChangedWallPlacements(
        nextProject,
        changedWallIds
      );

      await applyEdit("Resize room height", () => nextProject, {
        placementWarnings
      });
    },

    async resizeWall(wallId, lengthMm, anchor = "start") {
      const project = get().project;
      if (!project) return;

      const result = resizeWallPreservingAngles(project, wallId, lengthMm, anchor);
      if (result.changedWallIds.length === 0) return;

      const placementWarnings = validateChangedWallPlacements(
        result.project,
        result.changedWallIds
      );

      await applyEdit("Resize wall", () => result.project, {
        placementWarnings,
        lastGeometryEdit: {
          anchorVertexId: result.anchorVertexId,
          changedWallIds: result.changedWallIds
        }
      });
    },

    async setPolygonWallLength(wallId, lengthMm, anchor = "start") {
      const project = get().project;
      if (!project) return;

      const result = setPolygonWallLengthEdit(project, wallId, lengthMm, anchor);
      if (result.changedWallIds.length === 0) return;

      const placementWarnings = validateChangedWallPlacements(
        result.project,
        result.changedWallIds
      );

      await applyEdit("Resize wall", () => result.project, {
        placementWarnings,
        lastGeometryEdit: {
          anchorVertexId: result.anchorVertexId,
          changedWallIds: result.changedWallIds
        }
      });
    },

    async resizeSelectedWall(lengthMm) {
      const wallContextId = get().wallContextId;
      if (!wallContextId) return;

      await get().resizeWall(wallContextId, lengthMm);
    },

    async moveRoomVertex(roomId, vertexId, nextLocalMm) {
      const project = get().project;
      if (!project) return;

      // PlanView already gates the drag on canMoveRoomVertex before ever
      // calling this (pointer-up on an invalid position never commits), so
      // a throw here means something else changed the project out from
      // under the drag — surface it rather than silently no-op.
      let result;
      try {
        result = moveRoomVertexEdit(project, roomId, vertexId, nextLocalMm);
      } catch (error) {
        set({
          error: `Could not move that corner (${
            error instanceof Error ? error.message : "invalid position."
          }).`
        });
        return;
      }
      if (result.changedWallIds.length === 0) return;

      const placementWarnings = validateChangedWallPlacements(
        result.project,
        result.changedWallIds
      );

      await applyEdit("Move room corner", () => result.project, {
        placementWarnings,
        lastGeometryEdit: {
          anchorVertexId: result.anchorVertexId,
          changedWallIds: result.changedWallIds
        }
      });
    },

    async moveRoomWall(roomId, wallId, offsetMm) {
      const project = get().project;
      if (!project) return;

      // PlanView's wall-body drag preview already gates the commit against
      // this same domain call (an invalid in-flight position never reaches
      // pointer-up), so a throw here means the project changed out from
      // under the drag — surface it rather than silently no-op.
      let result;
      try {
        result = moveRoomWallEdit(project, roomId, wallId, offsetMm);
      } catch (error) {
        set({
          error: `Could not move that wall (${
            error instanceof Error ? error.message : "invalid position."
          }).`
        });
        return;
      }
      if (result.changedWallIds.length === 0) return;

      const placementWarnings = validateChangedWallPlacements(
        result.project,
        result.changedWallIds
      );

      await applyEdit("Move wall", () => result.project, {
        placementWarnings,
        lastGeometryEdit: {
          anchorVertexId: result.anchorVertexId,
          changedWallIds: result.changedWallIds
        }
      });
    },

    async splitWall(wallId, xAlongMm) {
      const project = get().project;
      if (!project) return;

      let result;
      try {
        result = splitWallEdit(project, wallId, xAlongMm);
      } catch (error) {
        set({
          error: `Could not split that wall (${
            error instanceof Error ? error.message : "invalid split point."
          }).`
        });
        return;
      }

      const placementWarnings = validateChangedWallPlacements(
        result.project,
        result.changedWallIds
      );

      await applyEdit("Split wall", () => result.project, {
        placementWarnings,
        lastGeometryEdit: {
          anchorVertexId: result.anchorVertexId,
          changedWallIds: result.changedWallIds
        }
      });
    },

    async deleteRoomVertex(roomId, vertexId) {
      const project = get().project;
      if (!project) return;

      let result;
      try {
        result = deleteRoomVertexEdit(project, roomId, vertexId);
      } catch (error) {
        set({
          error: `Could not remove that corner (${
            error instanceof Error ? error.message : "invalid removal."
          }).`
        });
        return;
      }

      const placementWarnings = validateChangedWallPlacements(
        result.project,
        result.changedWallIds
      );
      // The merge deletes one of the two walls it joins — if the sidebar's
      // wall context was pointed at it, fall back to the surviving merged
      // wall, same idiom as deleteRoom's wallContextId fallback.
      const wallContextId = get().wallContextId;
      const survivingWallIds = new Set(
        result.project.floor.rooms.flatMap((placement) =>
          placement.room.walls.map((wall) => wall.id)
        )
      );
      const nextWallContextId =
        wallContextId && !survivingWallIds.has(wallContextId)
          ? (result.changedWallIds[0] ?? wallContextId)
          : wallContextId;

      await applyEdit("Delete room corner", () => result.project, {
        placementWarnings,
        lastGeometryEdit: {
          anchorVertexId: result.anchorVertexId,
          changedWallIds: result.changedWallIds
        },
        ...selectionWrite(result.project, get().selection, nextWallContextId)
      });
    },

    async moveRoom(roomId, offsetXMm, offsetYMm) {
      const project = get().project;
      if (!project) return;

      const placement = project.floor.rooms.find(
        (candidate) => candidate.roomId === roomId
      );
      if (!placement) {
        throw new Error(`Room not found: ${roomId}`);
      }

      // Dropping a room back where it started shouldn't cost an undo entry —
      // same no-op guard the placement moves (moveArtworkPlacement) use.
      if (placement.offsetXMm === offsetXMm && placement.offsetYMm === offsetYMm) {
        return;
      }

      await applyEdit("Move room", (current) => ({
        ...current,
        floor: {
          rooms: current.floor.rooms.map((candidate) =>
            candidate.roomId === roomId
              ? { ...candidate, offsetXMm, offsetYMm }
              : candidate
          )
        }
      }));
    }
  };

  return { actions };
}
