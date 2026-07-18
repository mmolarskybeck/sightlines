import { useCursor } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useState } from "react";
import { MathUtils } from "three";
import type { FloorObject3d, WallCase3d } from "../../../domain/geometry/scene3d";
import { FLOOR_CASE_BOX_HEIGHT_MM } from "../../../domain/project";
import { mmToWorld } from "./coordinates";
import { WALL_OFFSET_MM } from "./framingGeometry";
import { SelectionBoxOutline } from "./UncertaintyOutline";
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
// perimeter, plus a separate inset glass cap at the very top. History: a
// single box with a 6-slot material array (5 opaque faces + 1 glass) needed
// DoubleSide on the opaque faces so the interior read correctly through the
// glass top (single-sided faces were backface-culled, making the case look
// bottomless) — but DoubleSide then made that box's bottom face z-fight
// against the base slab's top face, since both are full-footprint planes at
// the same height. A tray has no such coincident plane: the ring walls only
// touch the slab along a thin perimeter strip that's never simultaneously
// visible from both sides, the glass cap is inset and offset in height from
// every opaque face it neighbors, and plain FrontSide materials suffice
// because every opaque piece is itself a closed box (renders correctly from
// any angle without DoubleSide).

// Plan-space rotation (CCW in plan x/y) to a three.js yaw about +y — identical
// convention to FloorObjectBox's planRotationToYaw (duplicated locally rather
// than exported/shared, to keep this file's only coupling to FloorObjectBox
// at zero).
function planRotationToYaw(rotationDeg: number): number {
  return -MathUtils.degToRad(rotationDeg);
}

const LEG_SIZE_MM = 40;
const LEG_INSET_MM = 40; // distance from the footprint edge to a leg's center
const BASE_SLAB_THICKNESS_MM = 24;
// Never let legs invert to a negative height on a very short case.
const MIN_LEG_HEIGHT_MM = 20;

// Tray wall/bottom-slab thickness shared by both case types.
const CASE_WALL_THICKNESS_MM = 20;
// Inset glass cap thickness.
const CASE_GLASS_THICKNESS_MM = 6;

const GLASS_MATERIAL_PROPS = {
  color: CASE_GLASS_COLOR,
  transparent: true,
  opacity: CASE_GLASS_OPACITY,
  depthWrite: false
} as const;

// One freestanding floor vitrine. Mirrors FloorObjectBox's selection/click
// conventions (event.delta > 6 orbit-drag guard, outline-only selection, no
// texture/emissive tint) but is composed of several stacked meshes instead of
// one box, so the click handler and hover state are shared across the pieces
// that make up the case rather than living on a single mesh.
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
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    // An orbit drag's release also fires click — only a true click selects.
    if (event.delta > 6) return;
    const { shiftKey, metaKey, ctrlKey } = event.nativeEvent;
    onSelect(object.objectId, { additive: shiftKey || metaKey || ctrlKey });
  };

  const legHeightMm = Math.max(
    object.heightMm - FLOOR_CASE_BOX_HEIGHT_MM - BASE_SLAB_THICKNESS_MM,
    MIN_LEG_HEIGHT_MM
  );
  const slabTopMm = legHeightMm + BASE_SLAB_THICKNESS_MM;
  const boxHeightMm = FLOOR_CASE_BOX_HEIGHT_MM;
  // The ring walls span the full case-body height (slab top to overall top —
  // the same vertical extent the old single box occupied); the glass cap
  // sits inset at the very top, within that same band, over the interior
  // footprint only, so it never adds height beyond the original silhouette.
  const trayTopMm = slabTopMm + boxHeightMm;
  const trayWallCenterYMm = slabTopMm + boxHeightMm / 2;

  const legOffsetXMm = Math.max(object.widthMm / 2 - LEG_INSET_MM, LEG_SIZE_MM / 2);
  const legOffsetZMm = Math.max(object.depthMm / 2 - LEG_INSET_MM, LEG_SIZE_MM / 2);
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
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {legCorners.map(([legX, legZ], index) => (
        <mesh
          key={index}
          onClick={handleClick}
          position={[mmToWorld(legX), mmToWorld(legHeightMm / 2), mmToWorld(legZ)]}
        >
          <boxGeometry args={[mmToWorld(LEG_SIZE_MM), mmToWorld(legHeightMm), mmToWorld(LEG_SIZE_MM)]} />
          <meshLambertMaterial color={CASE_FRAME_COLOR} />
        </mesh>
      ))}
      <mesh onClick={handleClick} position={[0, mmToWorld(legHeightMm + BASE_SLAB_THICKNESS_MM / 2), 0]}>
        <boxGeometry
          args={[mmToWorld(object.widthMm), mmToWorld(BASE_SLAB_THICKNESS_MM), mmToWorld(object.depthMm)]}
        />
        <meshLambertMaterial color={CASE_FRAME_COLOR} />
      </mesh>
      {/* The display case: a ring of four opaque walls resting on the slab
          plus an inset glass cap. onClick lives on this wrapping group so
          every tray piece (and the glass) is one clickable hit target,
          matching the single-mesh click target the old box provided. */}
      <group onClick={handleClick}>
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

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.delta > 6) return;
    const { shiftKey, metaKey, ctrlKey } = event.nativeEvent;
    onSelect(wallCase.objectId, { additive: shiftKey || metaKey || ctrlKey });
  };

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
      <group onClick={handleClick}>
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
