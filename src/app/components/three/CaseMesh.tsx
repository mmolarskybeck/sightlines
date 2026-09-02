import { useCursor } from "@react-three/drei";
import { useState } from "react";
import { MathUtils } from "three";
import type { FloorObject3d, WallCase3d } from "../../../domain/geometry/scene3d";
import {
  CASE_BASE_SLAB_THICKNESS_MM,
  CASE_GLASS_THICKNESS_MM,
  CASE_LEG_INSET_MM,
  CASE_LEG_SIZE_MM,
  CASE_WALL_THICKNESS_MM,
  FLOOR_CASE_BOX_HEIGHT_MM
} from "../../../domain/project";
import { mmToWorld } from "./coordinates";
import { objectDragPointerDown, useThreeObjectDrag } from "./objectDragContext";
import { makeClickToSelect } from "./selectOnClick";
import { WALL_OFFSET_MM } from "./framingGeometry";
import { SelectionBoxOutline } from "./UncertaintyOutline";
import { useSelectableFloorObject } from "./useSelectableFloorObject";
import { CASE_BODY_COLOR, CASE_FRAME_COLOR, CASE_GLASS_COLOR, CASE_GLASS_OPACITY } from "./tokens";

// A freestanding vitrine (spec: floor `case` objects) — MoMA table-vitrine
// silhouette: four slender legs, a thin opaque base slab, then an opaque
// white display case on top spanning the full footprint, glazed ONLY on its
// top face. Legs fill whatever height remains below the fixed-height display
// case (FLOOR_CASE_BOX_HEIGHT_MM), same convention the domain layer documents
// on CaseFloorObject.
//
// The display "box" is built as an open-top TRAY rather than a single
// BoxGeometry: a ring of four opaque side walls around the footprint's
// perimeter, plus a separate inset glass cap at the very top — every opaque
// piece is itself a closed box, so plain FrontSide materials render correctly
// from any angle with no coincident plane to z-fight the base slab's top.

// Plan-space rotation (CCW in plan x/y) to a three.js yaw about +y — identical
// convention to FloorObjectBox's planRotationToYaw (duplicated locally rather
// than exported/shared, to keep this file's only coupling to FloorObjectBox
// at zero).
function planRotationToYaw(rotationDeg: number): number {
  return -MathUtils.degToRad(rotationDeg);
}

// Never let legs invert to a negative height on a very short case.
const MIN_LEG_HEIGHT_MM = 20;

const GLASS_MATERIAL_PROPS = {
  color: CASE_GLASS_COLOR,
  transparent: true,
  opacity: CASE_GLASS_OPACITY,
  depthWrite: false
} as const;

// One freestanding floor vitrine. Mirrors FloorObjectBox's selection/click
// conventions (useSelectableFloorObject's drag guard, outline-only selection,
// no texture/emissive tint) but is composed of several stacked meshes instead
// of one box, so the click handler and hover state are shared across the
// pieces that make up the case rather than living on a single mesh.
//
// DECISION: a floor case deliberately IGNORES FloorObjectBase.baseHeightMm and
// always stands on the floor, unlike the suspended artwork boxes FloorObjectBox
// now lifts. A vitrine is furniture on four legs, and this mesh derives those
// legs' height from heightMm — which CaseFloorObject defines as "overall, floor
// to the top of the glass box", a measurement taken FROM THE FLOOR. Honoring a
// base height would render legs stopping in mid-air (and no wires: a case does
// not hang from ceiling rigging), while silently invalidating the very datum
// the leg height is computed against. planSuspensionWires (SuspensionWires.tsx)
// encodes the same rule for the wires; the honest completion of this decision
// is for the inspector not to offer suspension on a case at all.
export function FloorCaseMesh({
  object,
  isSelected,
  onSelect
}: {
  object: FloorObject3d;
  isSelected: boolean;
  onSelect: (objectId: string, opts: { additive: boolean }) => void;
}) {
  const x = mmToWorld(object.xMm);
  const z = mmToWorld(object.yMm);
  const yaw = planRotationToYaw(object.rotationDeg);
  // Every piece of the case (legs, slab, tray walls, glass) arms the same
  // hover/drag/click wiring, so a vitrine moves and selects by grabbing any
  // part of it — same hook FloorObjectBox and CrtMonitorMesh share. Hover
  // lives on the wrapping group below, so its pointerOver must stop
  // propagation the way FloorObjectBox's per-mesh one doesn't need to.
  const { pointerProps, onPointerOver, onPointerOut } = useSelectableFloorObject(
    object.objectId,
    onSelect,
    { stopHoverPropagation: true }
  );

  const legHeightMm = Math.max(
    object.heightMm - FLOOR_CASE_BOX_HEIGHT_MM - CASE_BASE_SLAB_THICKNESS_MM,
    MIN_LEG_HEIGHT_MM
  );
  const slabTopMm = legHeightMm + CASE_BASE_SLAB_THICKNESS_MM;
  const boxHeightMm = FLOOR_CASE_BOX_HEIGHT_MM;
  // The ring walls span the full case-body height (slab top to overall top —
  // the same vertical extent the old single box occupied); the glass cap
  // sits inset at the very top, within that same band, over the interior
  // footprint only, so it never adds height beyond the original silhouette.
  const trayTopMm = slabTopMm + boxHeightMm;
  const trayWallCenterYMm = slabTopMm + boxHeightMm / 2;

  const legOffsetXMm = Math.max(object.widthMm / 2 - CASE_LEG_INSET_MM, CASE_LEG_SIZE_MM / 2);
  const legOffsetZMm = Math.max(object.depthMm / 2 - CASE_LEG_INSET_MM, CASE_LEG_SIZE_MM / 2);
  const legCorners: [number, number][] = [
    [-legOffsetXMm, -legOffsetZMm],
    [legOffsetXMm, -legOffsetZMm],
    [-legOffsetXMm, legOffsetZMm],
    [legOffsetXMm, legOffsetZMm]
  ];

  // Ring walls butt-jointed at the corners: front/back run the full width,
  // left/right fill the gap between them — no two wall volumes intersect.
  const halfWidthMm = object.widthMm / 2;
  const halfDepthMm = object.depthMm / 2;
  const sideWallDepthMm = Math.max(object.depthMm - 2 * CASE_WALL_THICKNESS_MM, 0);
  const glassWidthMm = Math.max(object.widthMm - 2 * CASE_WALL_THICKNESS_MM, 0);
  const glassDepthMm = Math.max(object.depthMm - 2 * CASE_WALL_THICKNESS_MM, 0);

  return (
    <group
      position={[x, 0, z]}
      rotation={[0, yaw, 0]}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      {legCorners.map(([legX, legZ], index) => (
        <mesh
          key={index}
          {...pointerProps}
          position={[mmToWorld(legX), mmToWorld(legHeightMm / 2), mmToWorld(legZ)]}
        >
          <boxGeometry args={[mmToWorld(CASE_LEG_SIZE_MM), mmToWorld(legHeightMm), mmToWorld(CASE_LEG_SIZE_MM)]} />
          <meshLambertMaterial color={CASE_FRAME_COLOR} />
        </mesh>
      ))}
      <mesh {...pointerProps} position={[0, mmToWorld(legHeightMm + CASE_BASE_SLAB_THICKNESS_MM / 2), 0]}>
        <boxGeometry
          args={[mmToWorld(object.widthMm), mmToWorld(CASE_BASE_SLAB_THICKNESS_MM), mmToWorld(object.depthMm)]}
        />
        <meshLambertMaterial color={CASE_FRAME_COLOR} />
      </mesh>
      {/* The display case: a ring of four opaque walls resting on the slab
          plus an inset glass cap. onClick lives on this wrapping group so
          every tray piece (and the glass) is one clickable hit target,
          matching the single-mesh click target the old box provided. */}
      <group {...pointerProps}>
        {/* Back/front walls (thin in z, full width). */}
        <mesh position={[0, mmToWorld(trayWallCenterYMm), mmToWorld(-(halfDepthMm - CASE_WALL_THICKNESS_MM / 2))]}>
          <boxGeometry args={[mmToWorld(object.widthMm), mmToWorld(boxHeightMm), mmToWorld(CASE_WALL_THICKNESS_MM)]} />
          <meshLambertMaterial color={CASE_BODY_COLOR} />
        </mesh>
        <mesh position={[0, mmToWorld(trayWallCenterYMm), mmToWorld(halfDepthMm - CASE_WALL_THICKNESS_MM / 2)]}>
          <boxGeometry args={[mmToWorld(object.widthMm), mmToWorld(boxHeightMm), mmToWorld(CASE_WALL_THICKNESS_MM)]} />
          <meshLambertMaterial color={CASE_BODY_COLOR} />
        </mesh>
        {/* Left/right walls (thin in x, fill the gap between front/back). */}
        <mesh position={[mmToWorld(-(halfWidthMm - CASE_WALL_THICKNESS_MM / 2)), mmToWorld(trayWallCenterYMm), 0]}>
          <boxGeometry args={[mmToWorld(CASE_WALL_THICKNESS_MM), mmToWorld(boxHeightMm), mmToWorld(sideWallDepthMm)]} />
          <meshLambertMaterial color={CASE_BODY_COLOR} />
        </mesh>
        <mesh position={[mmToWorld(halfWidthMm - CASE_WALL_THICKNESS_MM / 2), mmToWorld(trayWallCenterYMm), 0]}>
          <boxGeometry args={[mmToWorld(CASE_WALL_THICKNESS_MM), mmToWorld(boxHeightMm), mmToWorld(sideWallDepthMm)]} />
          <meshLambertMaterial color={CASE_BODY_COLOR} />
        </mesh>
        {/* Inset glass cap: smaller footprint than the ring's interior
            opening, its top flush with the walls' top edge (trayTopMm) —
            never coplanar with any opaque face since it sits over the
            hollow interior, not over any wall. Through it, the viewer sees
            straight down to the base slab's top face. */}
        <mesh position={[0, mmToWorld(trayTopMm - CASE_GLASS_THICKNESS_MM / 2), 0]}>
          <boxGeometry args={[mmToWorld(glassWidthMm), mmToWorld(CASE_GLASS_THICKNESS_MM), mmToWorld(glassDepthMm)]} />
          <meshLambertMaterial {...GLASS_MATERIAL_PROPS} />
        </mesh>
      </group>
      {isSelected ? (
        <group position={[0, mmToWorld(object.heightMm / 2), 0]}>
          <SelectionBoxOutline
            widthMm={object.widthMm + 20}
            heightMm={object.heightMm + 20}
            depthMm={object.depthMm + 20}
          />
        </group>
      ) : null}
    </group>
  );
}

// One wall-mounted vitrine (WallPanel3d.cases): a bottom slab + a ring of
// four opaque side walls + an inset glass cap, cantilevered off the wall
// face. Wall-local coordinates like ArtworkPlane/WallTextPanel — the parent
// WallPanel group already maps local +x along the wall, +y up, +z inward.
// Unlike ArtworkPlane (which offsets only its image plane), the ENTIRE case
// group here is pushed off the wall by WALL_OFFSET_MM: with a single flush
// box, the back face landed exactly at z = 0, coincident with the wall
// panel's own surface and z-fighting against it. Floating the whole case off
// the wall by the same standoff ArtworkPlane uses keeps the case's own depth
// reading as depthMm while its back face is no longer coplanar with anything.
export function WallCaseMesh({
  wallCase,
  isSelected,
  onSelect,
  ghosted = false
}: {
  wallCase: WallCase3d;
  isSelected: boolean;
  onSelect: (objectId: string, opts: { additive: boolean }) => void;
  ghosted?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && !ghosted);

  const handleClick = makeClickToSelect(wallCase.objectId, onSelect);

  // A wall case slides along its wall exactly as a hung work does — same store
  // path (it is an ordinary wall object), so it drags in 3D too.
  const drag = useThreeObjectDrag();
  const handlePointerDown = objectDragPointerDown(drag, wallCase.objectId);

  const widthMm = wallCase.widthMm;
  const heightMm = wallCase.heightMm;
  const depthMm = wallCase.depthMm;

  // Vertical layout, relative to the group's y = wallCase.yMm mount center:
  // a bottom slab, then a ring of walls rising to the same overall top the
  // old single box used (+heightMm / 2), with the glass cap inset at that
  // top edge rather than added above it.
  const slabBottomYMm = -heightMm / 2;
  const slabTopYMm = slabBottomYMm + CASE_WALL_THICKNESS_MM;
  const overallTopYMm = heightMm / 2;
  const wallHeightMm = overallTopYMm - slabTopYMm;
  const wallCenterYMm = slabTopYMm + wallHeightMm / 2;
  const slabCenterYMm = slabBottomYMm + CASE_WALL_THICKNESS_MM / 2;
  const glassCenterYMm = overallTopYMm - CASE_GLASS_THICKNESS_MM / 2;

  // Horizontal (x = along wall, z = out from wall) layout: the case spans
  // z in [0, depthMm] locally, same as the old box — the group offset below
  // is what moves that local z = 0 back face off the actual wall surface.
  const halfWidthMm = widthMm / 2;
  const sideWallDepthMm = Math.max(depthMm - 2 * CASE_WALL_THICKNESS_MM, 0);
  const glassWidthMm = Math.max(widthMm - 2 * CASE_WALL_THICKNESS_MM, 0);
  const glassDepthMm = Math.max(depthMm - 2 * CASE_WALL_THICKNESS_MM, 0);

  return (
    <group
      position={[mmToWorld(wallCase.xMm), mmToWorld(wallCase.yMm), mmToWorld(WALL_OFFSET_MM)]}
      visible={!ghosted}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {/* onClick lives on this wrapping group so every tray piece (slab,
          walls, glass) is one clickable hit target, matching the single-mesh
          click target the old flush box provided. */}
      <group onClick={handleClick} onPointerDown={handlePointerDown}>
        <mesh position={[0, mmToWorld(slabCenterYMm), mmToWorld(depthMm / 2)]}>
          <boxGeometry args={[mmToWorld(widthMm), mmToWorld(CASE_WALL_THICKNESS_MM), mmToWorld(depthMm)]} />
          <meshLambertMaterial color={CASE_FRAME_COLOR} />
        </mesh>
        {/* Back/front walls (thin in z, full width). Back sits at local
            z = CASE_WALL_THICKNESS_MM / 2, i.e. still short of the group's
            own z = 0 — the wall-standoff offset on the group is what keeps
            this from ever reaching the real wall surface. */}
        <mesh position={[0, mmToWorld(wallCenterYMm), mmToWorld(CASE_WALL_THICKNESS_MM / 2)]}>
          <boxGeometry args={[mmToWorld(widthMm), mmToWorld(wallHeightMm), mmToWorld(CASE_WALL_THICKNESS_MM)]} />
          <meshLambertMaterial color={CASE_BODY_COLOR} />
        </mesh>
        <mesh position={[0, mmToWorld(wallCenterYMm), mmToWorld(depthMm - CASE_WALL_THICKNESS_MM / 2)]}>
          <boxGeometry args={[mmToWorld(widthMm), mmToWorld(wallHeightMm), mmToWorld(CASE_WALL_THICKNESS_MM)]} />
          <meshLambertMaterial color={CASE_BODY_COLOR} />
        </mesh>
        {/* Left/right walls (thin in x, fill the gap between front/back). */}
        <mesh position={[mmToWorld(-(halfWidthMm - CASE_WALL_THICKNESS_MM / 2)), mmToWorld(wallCenterYMm), mmToWorld(depthMm / 2)]}>
          <boxGeometry args={[mmToWorld(CASE_WALL_THICKNESS_MM), mmToWorld(wallHeightMm), mmToWorld(sideWallDepthMm)]} />
          <meshLambertMaterial color={CASE_BODY_COLOR} />
        </mesh>
        <mesh position={[mmToWorld(halfWidthMm - CASE_WALL_THICKNESS_MM / 2), mmToWorld(wallCenterYMm), mmToWorld(depthMm / 2)]}>
          <boxGeometry args={[mmToWorld(CASE_WALL_THICKNESS_MM), mmToWorld(wallHeightMm), mmToWorld(sideWallDepthMm)]} />
          <meshLambertMaterial color={CASE_BODY_COLOR} />
        </mesh>
        {/* Inset glass cap, flush with the walls' top edge — sits over the
            hollow interior only, never coplanar with any opaque face. */}
        <mesh position={[0, mmToWorld(glassCenterYMm), mmToWorld(depthMm / 2)]}>
          <boxGeometry args={[mmToWorld(glassWidthMm), mmToWorld(CASE_GLASS_THICKNESS_MM), mmToWorld(glassDepthMm)]} />
          <meshLambertMaterial {...GLASS_MATERIAL_PROPS} />
        </mesh>
      </group>
      {!ghosted && isSelected ? (
        <group position={[0, 0, mmToWorld(wallCase.depthMm / 2)]}>
          <SelectionBoxOutline
            widthMm={wallCase.widthMm + 20}
            heightMm={wallCase.heightMm + 20}
            depthMm={wallCase.depthMm + 20}
          />
        </group>
      ) : null}
    </group>
  );
}
