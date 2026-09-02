import type { ThreeEvent } from "@react-three/fiber";
import { CLICK_DRAG_TOLERANCE_PX } from "./sceneConstants";

// Whether a click event is a REAL click rather than the release of an orbit
// or an object drag — both also fire `onClick` in r3f, distinguished only by
// how far the pointer travelled since press (event.delta). A click at the end
// of a drag must not select or clear, or every drag would end by also
// changing the selection underneath it.
function isRealClick(event: ThreeEvent<MouseEvent>): boolean {
  return event.delta <= CLICK_DRAG_TOLERANCE_PX;
}

// The click handler for anything in the 3D view that selects ITSELF: stop the
// event so nothing behind it (the wall, the floor) also reacts, drop drag
// releases per isRealClick, then read the modifier keys off the native event
// and hand both the object's id and the additive flag to onSelect.
export function makeClickToSelect(
  objectId: string,
  onSelect: (objectId: string, opts: { additive: boolean }) => void
) {
  return (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (!isRealClick(event)) return;
    const { shiftKey, metaKey, ctrlKey } = event.nativeEvent;
    onSelect(objectId, { additive: shiftKey || metaKey || ctrlKey });
  };
}

// The sibling for bare surfaces (the floor) that CLEAR the selection instead
// of setting it — same event and drag-release handling, no modifier read.
export function makeClickToClear(onClear: () => void) {
  return (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (!isRealClick(event)) return;
    onClear();
  };
}
