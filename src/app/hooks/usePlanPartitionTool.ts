import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent
} from "react";
import type { Vector2 } from "../../domain/geometry/dragResize";
import type { FloorWall } from "../../domain/geometry/planObjects";
import { getPlacedRoomBounds } from "../../domain/geometry/walls";
import {
  parseFaceWallId,
  roomIdContainingPoint,
  type FloorPartition
} from "../../domain/geometry/freestandingWalls";
import { midpointOf } from "../../domain/geometry/partitionChains";
import type { Point } from "../../domain/geometry/polygon";
import { snapDrawPointToRooms } from "../../domain/geometry/drawSnapping";
import {
  getPartitionDrawSnapTargets,
  getPartitionMoveSnapTargets
} from "../../domain/snapping/partitionSnapTargets";
import {
  resolveSnap,
  type Guide,
  type SnapTarget,
  type SnapTargetIds
} from "../../domain/snapping/resolveSnap";
import type { Project } from "../../domain/project";
import { useDisarmOnEscape } from "./useDisarmOnEscape";
import { useDragGesture } from "./useDragGesture";
import type {
  PartitionDragState,
  PartitionDrawState,
  PartitionDuplicateGhostState
} from "../components/plan/types";

// Minimum partition centerline length in floor millimeters.
const PARTITION_MIN_LENGTH_MM = 100;

// The partition (free-standing wall) workflow controller lifted out of PlanView
// verbatim: the draw gesture (armed-tool centerline drag), the edit drag (whole-
// body moves + endpoint re-drags), and the duplicate-ghost placement cycle, plus
// the pieces that arm each (beginPartitionDraw / beginPartitionDrag) and the
// duplicate move/click handlers. snapPartitionDrawPoint and partitionDrawInvalid
// travel too — both are now partition-only (snapDrawPoint stays shared in
// PlanView and is threaded in as a callback).
//
// Same deferred-closure story as usePlanObjectMove: the useDragGesture configs
// and the begin/handle functions read PlanView locals (toSvgMm, the snapping
// geometry, the commit callbacks, …) that are declared far below the point this
// controller is created. PlanView passes them through a `getDeps` thunk invoked
// at event time, so every gesture reads the latest render's values without this
// hook having to sit below all of them — which in turn keeps `active` available
// up where planInteractionActive is assembled. The two duplicate-cycle props
// that drive effects (duplicatePartitionSourceWallId + onDuplicatePartition
// change) come in directly so useEffect / useDisarmOnEscape can key on them.
export type PlanPartitionToolDeps = {
  toSvgMm: (clientX: number, clientY: number) => Vector2 | null;
  project: Project;
  floorWallsForTool: FloorWall[];
  gridSnapTargets: SnapTarget[];
  snapToGrid: boolean;
  snapThresholdMm: number;
  minorGridMm: number;
  handleSizeMm: number;
  suppressNextToolClickRef: MutableRefObject<boolean>;
  // Shared with the rectangle-draw and polygon-draw gestures, so it stays owned
  // by PlanView and is threaded in rather than moved.
  snapDrawPoint: (pointerMm: Vector2, prev: Vector2 | null, shiftKey: boolean) => Vector2;
  partitionToolActive: boolean;
  onPartitionToolChange?: (active: boolean) => void;
  onAddFreestandingWall?: (startFloorMm: Point, endFloorMm: Point) => void;
  onMoveFreestandingWall?: (wallId: string, deltaFloorMm: Point) => void;
  onMoveFreestandingWallEndpoint?: (
    wallId: string,
    end: "start" | "end",
    nextFloorMm: Point
  ) => void;
  onDuplicateFreestandingWall?: (wallId: string, centerFloorMm: Point) => void;
  onSelectFreestandingWall?: (wallId: string) => void;
};

export function usePlanPartitionTool(options: {
  // Drives the duplicate-cycle reset effect + Escape disarm (dependency-array
  // participants), so they come in directly rather than through the thunk.
  duplicatePartitionSourceWallId: string | null;
  onDuplicatePartitionChange?: (active: boolean) => void;
  getDeps: () => PlanPartitionToolDeps;
}) {
  const { duplicatePartitionSourceWallId, onDuplicatePartitionChange, getDeps } = options;
  // The thunk is recreated each render (fresh closure over PlanView's locals);
  // route it through a ref so the deferred handlers always call the latest one.
  const getDepsRef = useRef(getDeps);
  getDepsRef.current = getDeps;

  // Escape disarms the tool; onRelease gates the commit because useDragGesture
  // has no imperative cancel. Its inert listeners remain until pointerup.
  const { drag: partitionDraw, beginDrag: startPartitionDraw } =
    useDragGesture<PartitionDrawState>({
      onMove: (current, event) => {
        const { toSvgMm } = getDepsRef.current();
        const pointerMm = toSvgMm(event.clientX, event.clientY);
        if (!pointerMm) return null;
        const endMm = snapPartitionDrawPoint(pointerMm, current.startMm, event.shiftKey);
        return { ...current, endMm, invalid: partitionDrawInvalid(current.startMm, endMm) };
      },
      onRelease: (current) => {
        const { partitionToolActive, onPartitionToolChange, onAddFreestandingWall } =
          getDepsRef.current();
        onPartitionToolChange?.(false);
        if (!current.endMm || current.invalid || !partitionToolActive) return;
        onAddFreestandingWall?.(current.startMm, current.endMm);
      }
    });

  // Partition edit drag supports whole-body moves and endpoint changes.
  const { drag: partitionDrag, beginDrag: startPartitionDrag } =
    useDragGesture<PartitionDragState>({
      onMove: (current, event) => {
        const {
          toSvgMm,
          project,
          floorWallsForTool,
          gridSnapTargets,
          snapToGrid,
          snapThresholdMm,
          minorGridMm,
          handleSizeMm,
          snapDrawPoint
        } = getDepsRef.current();
        const pointerMm = toSvgMm(event.clientX, event.clientY);
        if (!pointerMm) return null;
        const deltaMm = {
          xMm: pointerMm.xMm - current.startPointerMm.xMm,
          yMm: pointerMm.yMm - current.startPointerMm.yMm
        };

        if (current.mode === "move") {
          // Only raw pointer travel can activate an axis; snaps cannot create a move.
          const latchThresholdMm = snapThresholdMm / 2;
          const movedAxes = getPartitionMovedAxes(current.movedAxes, deltaMm, latchThresholdMm);
          if (!movedAxes.x && !movedAxes.y) {
            return { ...current, movedAxes };
          }

          // Snap the midpoint; wall-aware targets outrank grid and work with grid off.
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
                  proposedMidFloorMm: proposedMid,
                  incrementMm: minorGridMm
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
          // Most targets now supply their own tight extentMm (see
          // partitionSnapTargets.ts); only fall back to the room bbox — with a
          // small cosmetic margin, not the old 200mm overshoot — for a guide
          // whose target left extentMm undefined (e.g. a plain grid snap).
          const guidePadMm = handleSizeMm > 0 ? handleSizeMm : 40;
          const roomBox = placement ? getPlacedRoomBounds(placement) : null;
          const activeGuides =
            roomBox
              ? snap.activeGuides.map((guide) =>
                  guide.extentMm
                    ? guide
                    : {
                        ...guide,
                        extentMm:
                          guide.axis === "x"
                            ? { startMm: roomBox.minY - guidePadMm, endMm: roomBox.maxY + guidePadMm }
                            : { startMm: roomBox.minX - guidePadMm, endMm: roomBox.maxX + guidePadMm }
                      }
                )
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

        // Endpoint precedence: Shift axis-lock > other wall faces > grid.
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
        const { onMoveFreestandingWall, onMoveFreestandingWallEndpoint } = getDepsRef.current();
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

  const [partitionDuplicateGhost, setPartitionDuplicateGhost] =
    useState<PartitionDuplicateGhostState | null>(null);
  const partitionDuplicateSnapIdsRef = useRef<SnapTargetIds | undefined>(undefined);

  useEffect(() => {
    setPartitionDuplicateGhost(null);
    partitionDuplicateSnapIdsRef.current = undefined;
  }, [duplicatePartitionSourceWallId]);

  useDisarmOnEscape(duplicatePartitionSourceWallId, () => onDuplicatePartitionChange?.(false));

  function handlePartitionDuplicateMove(event: ReactPointerEvent<SVGRectElement>) {
    const { toSvgMm, project, gridSnapTargets, snapToGrid, snapThresholdMm, minorGridMm } =
      getDepsRef.current();
    if (!duplicatePartitionSourceWallId) return;
    const pointerMm = toSvgMm(event.clientX, event.clientY);
    if (!pointerMm) return;
    const sourcePlacement = project.floor.rooms.find((candidate) =>
      candidate.room.freestandingWalls.some((wall) => wall.id === duplicatePartitionSourceWallId)
    );
    const source = sourcePlacement?.room.freestandingWalls.find(
      (wall) => wall.id === duplicatePartitionSourceWallId
    );
    if (!source) return;

    const roomId = roomIdContainingPoint(project, pointerMm);
    const destination = roomId
      ? project.floor.rooms.find((candidate) => candidate.roomId === roomId) ?? null
      : null;
    const targets: SnapTarget[] = [
      ...(destination
        ? getPartitionMoveSnapTargets({
            room: destination.room,
            placementOffsetMm: {
              xMm: destination.offsetXMm,
              yMm: destination.offsetYMm
            },
            partition: { ...source, id: "partition-duplicate-preview" },
            proposedMidFloorMm: pointerMm,
            incrementMm: minorGridMm
          })
        : []),
      ...(snapToGrid ? gridSnapTargets : [])
    ];
    const snap = resolveSnap(pointerMm, targets, {
      thresholdMm: snapThresholdMm,
      previousSnapTargetIds: partitionDuplicateSnapIdsRef.current
    });
    partitionDuplicateSnapIdsRef.current = snap.snapTargetIds;
    const halfDx = (source.endXMm - source.startXMm) / 2;
    const halfDy = (source.endYMm - source.startYMm) / 2;
    setPartitionDuplicateGhost({
      startMm: { xMm: snap.point.xMm - halfDx, yMm: snap.point.yMm - halfDy },
      endMm: { xMm: snap.point.xMm + halfDx, yMm: snap.point.yMm + halfDy },
      thicknessMm: source.thicknessMm,
      invalid: roomIdContainingPoint(project, snap.point) === null,
      activeGuides: snap.activeGuides
    });
  }

  function handlePartitionDuplicateClick(event: ReactMouseEvent<SVGRectElement>) {
    const { onDuplicateFreestandingWall } = getDepsRef.current();
    event.stopPropagation();
    if (!duplicatePartitionSourceWallId || !partitionDuplicateGhost || partitionDuplicateGhost.invalid) {
      return;
    }
    const center = midpointOf(partitionDuplicateGhost.startMm, partitionDuplicateGhost.endMm);
    onDuplicateFreestandingWall?.(duplicatePartitionSourceWallId, center);
    onDuplicatePartitionChange?.(false);
  }

  // Partition drawing uses the same absolute grid as other tools, augmented
  // by room-relative clean-inset families so dimensions stay round even when
  // the room origin or perimeter is off the floor lattice.
  function snapPartitionDrawPoint(
    pointerMm: Vector2,
    prev: Vector2 | null,
    shiftKey: boolean
  ): Vector2 {
    const { project, gridSnapTargets, snapToGrid, snapThresholdMm, minorGridMm } =
      getDepsRef.current();
    let result = pointerMm;
    if (snapToGrid) {
      const roomId = roomIdContainingPoint(project, pointerMm);
      const placement = roomId
        ? project.floor.rooms.find((candidate) => candidate.roomId === roomId) ?? null
        : null;
      const targets: SnapTarget[] = [
        ...(placement ? getPartitionDrawSnapTargets(placement, pointerMm, minorGridMm) : []),
        ...gridSnapTargets
      ];
      if (prev) {
        targets.push(
          { id: "partition-draw-prev-x", kind: "grid", axis: "x", point: { xMm: prev.xMm, yMm: 0 } },
          { id: "partition-draw-prev-y", kind: "grid", axis: "y", point: { xMm: 0, yMm: prev.yMm } }
        );
      }
      result = resolveSnap(pointerMm, targets, { thresholdMm: snapThresholdMm }).point;
    }
    if (shiftKey && prev) {
      const dx = Math.abs(pointerMm.xMm - prev.xMm);
      const dy = Math.abs(pointerMm.yMm - prev.yMm);
      result =
        dx >= dy ? { xMm: result.xMm, yMm: prev.yMm } : { xMm: prev.xMm, yMm: result.yMm };
    }
    return result;
  }

  function partitionDrawInvalid(startMm: Vector2, endMm: Vector2): boolean {
    const { project } = getDepsRef.current();
    const lengthMm = Math.hypot(endMm.xMm - startMm.xMm, endMm.yMm - startMm.yMm);
    if (lengthMm < PARTITION_MIN_LENGTH_MM) return true;
    const midpoint = {
      xMm: (startMm.xMm + endMm.xMm) / 2,
      yMm: (startMm.yMm + endMm.yMm) / 2
    };
    return roomIdContainingPoint(project, midpoint) === null;
  }

  // Begin a partition centerline drag from the capture overlay (armed tool).
  function beginPartitionDraw(event: ReactPointerEvent<SVGRectElement>) {
    const { toSvgMm, suppressNextToolClickRef } = getDepsRef.current();
    event.stopPropagation();
    if (suppressNextToolClickRef.current) {
      suppressNextToolClickRef.current = false;
      return;
    }
    const startMm = toSvgMm(event.clientX, event.clientY);
    if (!startMm) return;
    const snapped = snapPartitionDrawPoint(startMm, null, event.shiftKey);
    startPartitionDraw({ startMm: snapped, endMm: null, invalid: true });
  }

  // Begin a partition edit drag: whole-body move, or one endpoint re-drag.
  function beginPartitionDrag(
    partition: FloorPartition,
    mode: "move" | "start" | "end",
    event: ReactPointerEvent<SVGElement>
  ) {
    const { toSvgMm, onSelectFreestandingWall } = getDepsRef.current();
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

  return {
    partitionDraw,
    partitionDrag,
    partitionDuplicateGhost,
    beginPartitionDraw,
    beginPartitionDrag,
    handlePartitionDuplicateMove,
    handlePartitionDuplicateClick,
    // The controller's live gesture states — OR'd into PlanView's
    // planInteractionActive registry (the duplicate cycle registers separately
    // there via its own source-wall prop).
    active: Boolean(partitionDraw || partitionDrag)
  };
}

// Whole-partition moves latch each axis from pointer travel, never from the
// potentially larger correction introduced by snapping. Exported (and re-
// exported from PlanView) for the focused interaction regression tests.
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
