import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { Vector2 } from "../../domain/geometry/dragResize";
import {
  getWallObjectPlanRect,
  WALL_OBJECT_PLAN_DEPTH_MM,
  type FloorWall,
  type PlanRect
} from "../../domain/geometry/planObjects";
import { roomIdContainingPoint } from "../../domain/geometry/freestandingWalls";
import type { PlacementForm } from "../../domain/placement/artworkForm";
import {
  floatPolicyForKind,
  resolvePlanPlacement,
  type FloatPolicy,
  type PlanPlacement
} from "../../domain/snapping/planSnapTargets";
import { resolveSnap, type Guide } from "../../domain/snapping/resolveSnap";
import {
  artworkMemberWallIds,
  getPlanGroupCenterMm,
  resolvePlanGroupMemberMove,
  resolvePlanGroupReanchorWall,
  type PlanGroupMember
} from "../../domain/snapping/planGroupMove";
import type { Project, WallObject, WallObjectBase } from "../../domain/project";
import { useDragGesture } from "./useDragGesture";
import type { ObjectDragState } from "../components/plan/types";

// The object-movement controller lifted out of PlanView verbatim: the pointer
// drag of an existing placed object (single or whole multi-selection) plus the
// two pieces that arm it — beginObjectDrag (resolves live group members and
// hands the gesture its initial state) and floatPolicyForMovingObject (the
// wall/floor float policy for the pressed object). Preview and commit both flow
// through resolvePlanPlacement / resolvePlanGroupMemberMove, so what the user
// sees dragging is exactly what lands.
//
// Same deferred-closure story as the raw useDragGesture config used to have:
// onMove/onRelease/beginObjectDrag read PlanView locals (toSvgMm, the snapping
// geometry, the commit callbacks, …) that are declared far below the point this
// controller is created. PlanView passes them through a `getDeps` thunk invoked
// at event time, so every gesture reads the latest render's values without this
// hook having to sit below all of them — which in turn keeps `objectMove.active`
// available up where planInteractionActive is assembled.
export type PlanObjectMoveDeps = {
  toSvgMm: (clientX: number, clientY: number) => Vector2 | null;
  project: Project;
  floorWallsForTool: FloorWall[];
  snappingWallObjects: WallObjectBase[];
  floorObjectRoomIds: ReadonlyMap<string, string | null>;
  captureDistanceMm: number;
  gridSnapTargets: Parameters<typeof resolvePlanPlacement>[1]["gridTargets"];
  snapToGrid: boolean;
  snapThresholdMm: number;
  selectedObjectIds: string[];
  artworkFormFor: (artworkId: string | null) => PlacementForm;
  suppressNextSelect: () => void;
  onCommitPlanMove?: (objectId: string, placement: PlanPlacement) => void;
  onCommitPlanMoveGroup?: (
    moves: { id: string; xMm: number; yMm?: number; wallId?: string }[]
  ) => void;
};

type BeginObjectDragParams = {
  objectId: string;
  kind: WallObject["kind"];
  startCenterMm: Vector2;
  movingSize: { widthMm: number; heightMm: number; depthMm: number };
  wallFootprintWidthMm?: number;
  rotationDeg: number;
  currentPlacement: PlanPlacement;
  initialPlanRect: PlanRect;
};

export function usePlanObjectMove(getDeps: () => PlanObjectMoveDeps) {
  // The thunk is recreated each render (fresh closure over PlanView's locals);
  // route it through a ref so the deferred handlers always call the latest one.
  const getDepsRef = useRef(getDeps);
  getDepsRef.current = getDeps;

  // A move of an existing placed object (single or group), and the HTML5 drop
  // preview for a checklist artwork. Both flow through resolvePlanPlacement,
  // so preview and commit can never disagree.
  const {
    drag: objectDrag,
    dragRef: objectDragRef,
    beginDrag: startObjectDrag
  } = useDragGesture<ObjectDragState>({
    onMove: (current, event) => {
      const {
        toSvgMm,
        project,
        floorWallsForTool,
        snappingWallObjects,
        floorObjectRoomIds,
        captureDistanceMm,
        gridSnapTargets,
        snapToGrid,
        snapThresholdMm
      } = getDepsRef.current();
      const pointerMm = toSvgMm(event.clientX, event.clientY);
      if (!pointerMm) return null;

      // Group drag: rigid translation, with one exception — wall-anchored
      // ARTWORK re-anchors onto a foreign wall the group is dragged near
      // (resolvePlanGroupReanchorWall, driven by the snapped group center, with
      // break-free hysteresis off the currently-held target). Snap the whole
      // group's box center to the grid (grid tier only), apply the snapped delta
      // to every member — floor members translate, openings/blocked zones slide
      // on their own wall, artwork projects onto the resolved target wall (or its
      // own wall when none is near).
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
          // showGuide:false suppresses the drawn guide line for grid snaps (the
          // grid itself is the visual reference); this is center-based group
          // snapping, not the edge-based single-object snap in
          // resolvePlanPlacement — group edge-snapping is a follow-up.
          const hiddenGridTargets = gridSnapTargets.map((target) => ({
            ...target,
            showGuide: false
          }));
          const snap = resolveSnap(proposedGroupCenterMm, hiddenGridTargets, {
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

        // Which foreign wall (if any) the group's artwork re-anchors onto this
        // frame. memberWallIds are the walls the artwork already sits on, so
        // those never count as "foreign"; the previous target stays sticky.
        const reanchorWall = resolvePlanGroupReanchorWall({
          groupCenterMm: snappedGroupCenterMm,
          walls: floorWallsForTool,
          memberWallIds: artworkMemberWallIds(current.members),
          captureDistanceMm,
          previousTargetWallId: current.previewReanchorWall?.id ?? null
        });

        const previewRectById = new Map<string, PlanRect>(
          current.members.map((member) => [
            member.id,
            resolvePlanGroupMemberMove(member, deltaMm, reanchorWall).rect
          ])
        );

        return {
          ...current,
          previewGroupCenterMm: snappedGroupCenterMm,
          previewRectById,
          previewReanchorWall: reanchorWall,
          previousSnapTargetIds: snapTargetIds,
          activeGuides
        };
      }

      // Preserve the grab offset by moving the center by pointer delta.
      const proposedCenterMm: Vector2 = {
        xMm: current.startCenterMm.xMm + (pointerMm.xMm - current.startPointerMm.xMm),
        yMm: current.startCenterMm.yMm + (pointerMm.yMm - current.startPointerMm.yMm)
      };

      const proposedRoomId = roomIdContainingPoint(project, proposedCenterMm);
      const result = resolvePlanPlacement(proposedCenterMm, {
        walls: floorWallsForTool,
        // Do not snap to the moving object's old position.
        wallObjects: snappingWallObjects.filter((object) => object.id !== current.objectId),
        movingSize: current.movingSize,
        wallFootprintWidthMm: current.wallFootprintWidthMm,
        movingKind: current.kind,
        floatPolicy: current.floatPolicy,
        // Keep wall-capture hysteresis across pointer moves.
        currentAnchorWallId: current.currentAnchorWallId,
        captureDistanceMm,
        gridTargets: gridSnapTargets,
        snapToGrid,
        thresholdMm: snapThresholdMm,
        previousSnapTargetIds: current.previousSnapTargetIds,
        rotationDeg: current.rotationDeg,
        floorAlign: {
          roomId: proposedRoomId,
          floorObjects: project.floorObjects.filter(
            (object) =>
              object.id !== current.objectId &&
              floorObjectRoomIds.get(object.id) === proposedRoomId
          )
        }
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
      const { suppressNextSelect, onCommitPlanMove, onCommitPlanMoveGroup } = getDepsRef.current();
      // Commit a group move once; sub-threshold releases remain clicks.
      if (current.members && current.startGroupCenterMm && current.previewGroupCenterMm) {
        const deltaMm: Vector2 = {
          xMm: current.previewGroupCenterMm.xMm - current.startGroupCenterMm.xMm,
          yMm: current.previewGroupCenterMm.yMm - current.startGroupCenterMm.yMm
        };
        if (Math.hypot(deltaMm.xMm, deltaMm.yMm) < 0.5) return;

        // Prevent the trailing click from collapsing the multi-selection.
        suppressNextSelect();
        // Same target wall the last preview frame resolved, so the committed
        // re-anchor matches exactly what the user saw glued to the wall.
        const reanchorWall = current.previewReanchorWall ?? null;
        const moves = current.members.map(
          (member) => resolvePlanGroupMemberMove(member, deltaMm, reanchorWall).commit
        );
        onCommitPlanMoveGroup?.(moves);
        return;
      }

      // Sub-threshold releases remain clicks and create no undo entry.
      const movedMm = Math.hypot(
        current.previewPlanRect.centerXMm - current.startCenterMm.xMm,
        current.previewPlanRect.centerYMm - current.startCenterMm.yMm
      );
      if (movedMm < 0.5) return;

      // Invalid wall-only drops keep the original placement.
      if (current.previewPlacement.anchor === "none") return;

      onCommitPlanMove?.(current.objectId, current.previewPlacement);
    }
  });

  // The float policy for a moving placed object. For every kind but artwork it's
  // kind-only; an artwork's depends on its effective form (a floor work moves
  // floor-only, a wall work rejects off the wall), so we resolve the object's
  // artworkId (wall or floor object) and read the form. An unresolved artwork
  // falls back to the wall-only default (floatPolicyForKind's own fallback).
  function floatPolicyForMovingObject(kind: WallObject["kind"], objectId: string): FloatPolicy {
    const { project, artworkFormFor } = getDepsRef.current();
    // A case never converts between wall and floor (that machinery is
    // artwork-only; planMoveFloorToWall throws for a case). So a floor case must
    // drag floor-only — it can never capture a wall and hit that throw — while a
    // wall case keeps capture-any and slides along walls like an opening.
    if (kind === "case") {
      const isFloorCase = project.floorObjects.some((object) => object.id === objectId);
      return isFloorCase ? "floor-only" : "capture-any";
    }
    if (kind !== "artwork") return floatPolicyForKind(kind);
    const placed =
      project.wallObjects.find((object) => object.id === objectId) ??
      project.floorObjects.find((object) => object.id === objectId);
    const artworkId = placed?.kind === "artwork" ? placed.artworkId : null;
    return floatPolicyForKind("artwork", artworkFormFor(artworkId));
  }

  function beginObjectDrag(
    params: BeginObjectDragParams,
    event: ReactPointerEvent<SVGGElement>
  ) {
    const { toSvgMm, selectedObjectIds, floorWallsForTool, project } = getDepsRef.current();
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
          kind: object.kind,
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
          wallFootprintWidthMm: params.wallFootprintWidthMm,
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
      wallFootprintWidthMm: params.wallFootprintWidthMm,
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

  return {
    objectDrag,
    objectDragRef,
    beginObjectDrag,
    // This controller's single live gesture state — OR'd into PlanView's
    // planInteractionActive registry as objectMove.active.
    active: Boolean(objectDrag)
  };
}
