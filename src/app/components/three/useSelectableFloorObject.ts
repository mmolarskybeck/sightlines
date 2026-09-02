import { useCursor } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useState } from "react";
import { objectDragPointerDown, useThreeObjectDrag } from "./objectDragContext";
import { makeClickToSelect } from "./selectOnClick";

// The hover/drag-arm/click-to-select wiring every freestanding floor object
// (box, case, monitor) repeats: a hovered flag feeding useCursor, the
// press-and-drag handler from ThreeObjectDragContext, and the click handler
// from selectOnClick.ts. Returned as pieces rather than one fixed props object
// because callers differ in WHERE the hover handlers live (one wrapping group
// vs. every mesh) and whether hovering must stop propagation (a multi-mesh
// assembly with the hover on its outer group, vs. a single mesh that has
// nothing beneath it to stop).
export function useSelectableFloorObject(
  objectId: string,
  onSelect: (objectId: string, opts: { additive: boolean }) => void,
  options: { stopHoverPropagation?: boolean } = {}
) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);

  const drag = useThreeObjectDrag();
  const handlePointerDown = objectDragPointerDown(drag, objectId);
  const handleClick = makeClickToSelect(objectId, onSelect);

  const onPointerOver = options.stopHoverPropagation
    ? (event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        setHovered(true);
      }
    : () => setHovered(true);
  const onPointerOut = () => setHovered(false);

  return {
    hovered,
    pointerProps: { onClick: handleClick, onPointerDown: handlePointerDown },
    onPointerOver,
    onPointerOut
  };
}
