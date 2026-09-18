import { useCursor } from "@react-three/drei";
import { useState } from "react";
import type { WallShelf3d } from "../../../domain/geometry/scene3d";
import { mmToWorld } from "./coordinates";
import { objectDragPointerDown, useThreeObjectDrag } from "./objectDragContext";
import { makeClickToSelect } from "./selectOnClick";
import { WALL_OFFSET_MM } from "./framingGeometry";
import { SelectionBoxOutline } from "./UncertaintyOutline";
import { CASE_BODY_COLOR } from "./tokens";

// One wall shelf (WallPanel3d.shelves): a single opaque slab cantilevered off
// the wall face. Built from WallCaseMesh beside it — same wall-local frame (the
// parent WallPanel group maps local +x along the wall, +y up, +z inward), same
// WALL_OFFSET_MM standoff so the slab's back face is never coplanar with the
// wall panel it would otherwise z-fight — but it is ONE box rather than a tray:
// a shelf has no interior to see into, so there is nothing to build out of
// separate pieces and no glass to inset.
//
// Dragging the slab carries its riders: ThreeDView derives them (shelfRiders.ts)
// and the assembly moves as one rigid body.
export function WallShelfMesh({
  shelf,
  isSelected,
  isSnapTarget = false,
  onSelect,
  ghosted = false
}: {
  shelf: WallShelf3d;
  isSelected: boolean;
  // A work being dropped or dragged in 3D is currently captured on THIS slab
  // (ThreeDView resolves it through seatOnShelfTop). A SURFACE ANNOUNCES
  // ITSELF: the slab wears the selection outline for the length of the
  // gesture, the 3D counterpart of the elevation's lit slab and the plan
  // glyph's petrol wash, so "it will land on the shelf" is visible before the
  // release. Reuses the selected state's outline rather than inventing a
  // second one — there is one feedback vocabulary for this, everywhere.
  isSnapTarget?: boolean;
  onSelect: (objectId: string, opts: { additive: boolean }) => void;
  ghosted?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && !ghosted);

  const handleClick = makeClickToSelect(shelf.objectId, onSelect);

  // Direct manipulation, same pair as ArtworkPlane: press and drag the slab
  // along its wall. Inert unless a ThreeObjectDragContext provider is above —
  // the offscreen snapshot renderers mount this component with none.
  const handlePointerDown = objectDragPointerDown(useThreeObjectDrag(), shelf.objectId);

  return (
    <group
      position={[mmToWorld(shelf.xMm), mmToWorld(shelf.yMm), mmToWorld(WALL_OFFSET_MM)]}
      visible={!ghosted}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {/* The slab spans z in [0, depthMm] locally, exactly as the case's tray
          does — the group's standoff above is what lifts that local z = 0 back
          face off the real wall surface. */}
      <mesh
        position={[0, 0, mmToWorld(shelf.depthMm / 2)]}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
      >
        <boxGeometry
          args={[mmToWorld(shelf.widthMm), mmToWorld(shelf.heightMm), mmToWorld(shelf.depthMm)]}
        />
        <meshLambertMaterial color={CASE_BODY_COLOR} />
      </mesh>
      {!ghosted && (isSelected || isSnapTarget) ? (
        <group position={[0, 0, mmToWorld(shelf.depthMm / 2)]}>
          <SelectionBoxOutline
            widthMm={shelf.widthMm + 20}
            heightMm={shelf.heightMm + 20}
            depthMm={shelf.depthMm + 20}
          />
        </group>
      ) : null}
    </group>
  );
}
