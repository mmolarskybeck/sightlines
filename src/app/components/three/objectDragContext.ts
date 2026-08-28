import { createContext, useContext } from "react";
import type { ThreeEvent } from "@react-three/fiber";

// How a selectable mesh arms a pointer-drag of the object it draws, without
// every mesh growing a callback prop threaded down through SceneRooms ->
// WallPanel -> ArtworkPlane. A React context is the right shape here for a
// second reason: the OFFSCREEN render paths (SnapshotStage, SavedViewRenderHost)
// mount the same SceneRooms with no provider, and the default no-op below makes
// every mesh inert there — a snapshot can't be dragged, and doesn't have to
// remember to say so.
//
// The provider lives INSIDE the <Canvas> (R3F reconciles its own tree), so the
// value is created by ThreeDView's render and read by meshes R3F renders.
export type ThreeObjectDragApi = {
  // Arm a drag on `objectId`. The gesture only becomes a MOVE once the pointer
  // travels past CLICK_DRAG_TOLERANCE_PX; below that the release is still a
  // plain click-select, exactly as before.
  begin: (objectId: string, event: ThreeEvent<PointerEvent>) => void;
};

const NO_DRAG: ThreeObjectDragApi = { begin: () => {} };

export const ThreeObjectDragContext = createContext<ThreeObjectDragApi>(NO_DRAG);

export function useThreeObjectDrag(): ThreeObjectDragApi {
  return useContext(ThreeObjectDragContext);
}

// The pointerdown handler every draggable mesh installs. Factored out so the
// four mesh families (artwork planes, floor boxes, cases, monitors) can't drift
// on the two rules that matter:
//   - PRIMARY BUTTON ONLY. Middle/right stay OrbitControls' dolly and pan, so
//     the camera is still reachable with the cursor over an object.
//   - MOUSE AND PEN ONLY. One finger pans the room like a map (OrbitControls'
//     touches={{ONE: PAN}}), and hijacking that over every placed object would
//     make an iPad unable to move the camera across a busy gallery. Touch
//     dragging of placed objects needs its own gesture (long-press to pick up,
//     most likely) and is deliberately a later round.
//   - stopPropagation, so a press that lands on a stack of coplanar quads
//     (image over mat over frame over body) arms one drag, not four.
export function objectDragPointerDown(
  drag: ThreeObjectDragApi,
  objectId: string
): (event: ThreeEvent<PointerEvent>) => void {
  return (event) => {
    if (event.button !== 0) return;
    if (event.pointerType === "touch") return;
    event.stopPropagation();
    drag.begin(objectId, event);
  };
}
