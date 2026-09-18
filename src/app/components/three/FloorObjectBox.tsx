import { useMemo } from "react";
import { MathUtils } from "three";
import type { Texture } from "three";
import type { FloorObject3d } from "../../../domain/geometry/scene3d";
import {
  assemblyPlanRect,
  supportedTotalHeightMm,
  type ResolvedFloorSupport
} from "../../../domain/geometry/supportGlyphs";
import { textureNativeAspect } from "./artworkFit";
import { mmToWorld } from "./coordinates";
import {
  floorArtworkWorkSizeMm,
  floorObjectImagePanels,
  resolveFloorObjectImageFaces
} from "./floorObjectImageFaces";
import {
  planSuspensionWires,
  suspendedCenterYMm,
  SuspensionWires
} from "./SuspensionWires";
import { useSelectableFloorObject } from "./useSelectableFloorObject";
import {
  DashedBoxOutline,
  isUncertain,
  SelectionBoxOutline,
  SelectionRectOutline
} from "./UncertaintyOutline";
import {
  BLOCKED_ZONE_COLOR,
  BOX_COLOR,
  CASE_BODY_COLOR,
  CASE_GLASS_COLOR,
  CASE_GLASS_OPACITY
} from "./tokens";

// Planning annotation, not physical (spec §5.3) — same subdued grey family
// as the 2D blocked-zone hatch, as a translucent wash.
const BLOCKED_ZONE_OPACITY = 0.15;

// Sits just above the floor plane to avoid z-fighting.
const FLOOR_QUAD_OFFSET_MM = 2;

// The zone's selection outline sits a further step above the wash, for the same
// reason (millimetres, not fractions — sub-millimetre steps shimmer under
// camera motion at room scale).
const BLOCKED_ZONE_OUTLINE_LIFT_MM = 2;

// Outset of the selection outline from the rect it wraps, total across both
// sides. The same 20mm every other selected thing in the 3D view wears.
const SELECTION_OUTLINE_OUTSET_MM = 20;

// The bonnet's glass, identical to the vitrine cap's in CaseMesh.tsx: one glass
// language across the app (the 2D glyphs share CASE_GLASS_THICKNESS_MM for the
// same reason). Restated locally rather than exported from CaseMesh, exactly as
// planRotationToYaw below is restated there — neither file should have to import
// the other's render internals.
const GLASS_MATERIAL_PROPS = {
  color: CASE_GLASS_COLOR,
  transparent: true,
  opacity: CASE_GLASS_OPACITY,
  depthWrite: false
} as const;

// Plan-space rotation (CCW in plan x/y) to a three.js yaw about +y: plan y
// maps to world +z, which flips handedness — the one place that sign lives.
function planRotationToYaw(rotationDeg: number): number {
  return -MathUtils.degToRad(rotationDeg);
}

// Everything the mesh layer needs to stand a work on its support, in mm, in the
// placement's OWN (yawed) frame — so the whole assembly rides inside the one
// rotation the box group already applies and nothing here has to know about
// angles. Null for an object with no support, which then draws exactly what it
// drew before supports existed.
//
// Axes: local x is the placement's width, local z its depth. The support's
// stored offsets are in the plan's rotated local frame (x along width, y toward
// the front face), and planRotationToYaw maps plan +y onto world +z, so
// offsetYMm IS the local z — no sign flip, the yaw carries it.
export type FloorSupportLayoutMm = {
  // Center heights for the three boxes. The work's bottom edge is the support's
  // TOP FACE — that is what a support means, and baseHeightMm is ignored under
  // one (the same rule cases and monitors already follow), so this SUPERSEDES
  // suspendedCenterYMm rather than adding to it.
  supportCenterYMm: number;
  supportHeightMm: number;
  workCenterYMm: number;
  // The plexi bonnet, absent when there is none. One optional object rather
  // than two optional numbers so "there is a bonnet" is a single fact the
  // render site can narrow on.
  bonnet?: { centerYMm: number; heightMm: number };
  // Support/bonnet footprint and its local offset from the work's center.
  supportWidthMm: number;
  supportDepthMm: number;
  supportOffsetXMm: number;
  supportOffsetZMm: number;
  // The union of work and support footprints, and the assembly's full height:
  // what the selection outline wraps, because the thing selected is the
  // installation, not the sculpture balanced on top of it.
  assemblyWidthMm: number;
  assemblyDepthMm: number;
  assemblyHeightMm: number;
  assemblyOffsetXMm: number;
  assemblyOffsetZMm: number;
  assemblyCenterYMm: number;
};

export function floorSupportLayoutMm(
  object: Pick<FloorObject3d, "widthMm" | "depthMm" | "heightMm"> & {
    support?: ResolvedFloorSupport;
  }
): FloorSupportLayoutMm | null {
  const support = object.support;
  if (!support) return null;

  // assemblyPlanRect against a placement parked at the origin at 0° returns the
  // union IN THE LOCAL FRAME: its center is the union's offset from the work's
  // center and its size is the union's size. Calling the domain helper this way
  // rather than un-rotating its floor-space answer keeps the union rule in one
  // place (supportGlyphs.ts) and this file free of trig.
  const localAssembly = assemblyPlanRect(
    {
      xMm: 0,
      yMm: 0,
      widthMm: object.widthMm,
      depthMm: object.depthMm,
      rotationDeg: 0
    },
    support
  );
  const assemblyHeightMm = supportedTotalHeightMm(object, support);

  return {
    supportCenterYMm: support.heightMm / 2,
    supportHeightMm: support.heightMm,
    workCenterYMm: support.heightMm + object.heightMm / 2,
    ...(support.bonnetHeightMm !== undefined
      ? {
          bonnet: {
            centerYMm: support.heightMm + support.bonnetHeightMm / 2,
            heightMm: support.bonnetHeightMm
          }
        }
      : {}),
    supportWidthMm: support.widthMm,
    supportDepthMm: support.depthMm,
    supportOffsetXMm: support.offsetXMm ?? 0,
    supportOffsetZMm: support.offsetYMm ?? 0,
    assemblyWidthMm: localAssembly.widthMm,
    assemblyDepthMm: localAssembly.depthMm,
    assemblyHeightMm,
    assemblyOffsetXMm: localAssembly.centerXMm,
    assemblyOffsetZMm: localAssembly.centerYMm,
    assemblyCenterYMm: assemblyHeightMm / 2
  };
}

// One floor-placed object: a neutral artwork box carrying the work's image on
// the faces the curator chose (ArtworkFloorObject.imageFaces — front + back by
// default, the freestanding-panel reading) with the shared uncertainty edge
// treatment, blocked zones as flat translucent quads. When the artwork record
// or its asset is missing the box shows no image at all (texture undefined),
// never a broken one.
//
// The box and the image are two different measurements: widthMm/heightMm/
// depthMm size the OBJECT ON THE FLOOR, while the image is drawn at the WORK's
// own recorded dimensions, centered on each chosen face. They coincide at
// placement and diverge the moment a curator resizes the board — at which
// point bare board appears around the image instead of the image stretching.
// floorObjectImageFaces.ts owns that rule.
//
// BOTH kinds this component draws are click-to-select (spec §4.3) and both
// consume their clicks. A zone's quad used to be deliberately inert, letting
// the click fall through — but what it fell through TO was the floor, whose
// handler CLEARS the selection, so clicking a blocked zone in 3D actively
// deselected whatever you had. A zone is a placed object with its own
// inspector; it selects itself now, like everything else that is drawn.
//
// An artwork box may also be SUSPENDED (baseHeightMm > 0): the box lifts off
// the floor and hangs from wires drawn up to the room's wall height. See
// SuspensionWires.tsx, which owns both halves of that rule.
export function FloorObjectBox({
  object,
  texture,
  isSelected,
  onSelect
}: {
  object: FloorObject3d;
  texture: Texture | undefined;
  isSelected: boolean;
  onSelect: (objectId: string, opts: { additive: boolean }) => void;
}) {
  const x = mmToWorld(object.xMm);
  const z = mmToWorld(object.yMm);
  const yaw = planRotationToYaw(object.rotationDeg);
  // Above the blocked-zone early return so the hook order never depends on the
  // object's kind. Memoized on the scene entry itself (deriveScene3d hands out
  // a fresh object only when the project actually changed) so the wire vertex
  // buffer downstream isn't rebuilt on every orbit frame.
  const wires = useMemo(() => planSuspensionWires(object), [object]);
  // Hover, drag-arm and click-to-select, shared with FloorCaseMesh and
  // CrtMonitorMesh (useSelectableFloorObject.ts) — identical for both branches
  // below, which is why it sits above the early return.
  const { pointerProps, onPointerOver, onPointerOut } = useSelectableFloorObject(
    object.objectId,
    onSelect
  );

  if (object.kind === "blocked-zone") {
    // A blocked zone deliberately IGNORES baseHeightMm and stays on the floor.
    // It is a planning annotation about floor AREA (spec §5.3) — "do not put
    // anything in this footprint" — not a physical volume; the 2D views draw it
    // as a hatched footprint for the same reason. Floating it would say the
    // floor beneath it is free, which inverts the annotation's meaning, and it
    // has no height to hover with (heightMm is 0 for zones).
    //
    // The -90° x-rotation lays the quad flat and maps its local +z onto world
    // +y, so the outline's own "proud of the surface" offset is a +z step in
    // this same frame — and local x/y are the object's width/depth.
    return (
      <group
        position={[x, mmToWorld(FLOOR_QUAD_OFFSET_MM), z]}
        rotation={[-Math.PI / 2, 0, yaw]}
      >
        <mesh
          {...pointerProps}
          onPointerOver={onPointerOver}
          onPointerOut={onPointerOut}
        >
          <planeGeometry args={[mmToWorld(object.widthMm), mmToWorld(object.depthMm)]} />
          <meshBasicMaterial
            color={BLOCKED_ZONE_COLOR}
            transparent
            opacity={BLOCKED_ZONE_OPACITY}
            depthWrite={false}
          />
        </mesh>
        {/* Outline, never a tint (spec §6.2) — the wash's colour is what says
            "blocked", and re-colouring it to say "selected" would overwrite
            one meaning with the other. Flat rect rather than the box outline
            the other kinds get: a zone is an AREA and has no height to trace. */}
        {isSelected ? (
          <group position={[0, 0, mmToWorld(BLOCKED_ZONE_OUTLINE_LIFT_MM)]}>
            <SelectionRectOutline
              widthMm={object.widthMm + SELECTION_OUTLINE_OUTSET_MM}
              heightMm={object.depthMm + SELECTION_OUTLINE_OUTSET_MM}
            />
          </group>
        ) : null}
      </group>
    );
  }

  // Not memoized: a handful of `includes` over a six-element array plus some
  // arithmetic, computed from props that are already stable. Wrapping it would
  // cost more (a hook slot plus a dependency array on an array prop whose
  // identity changes with the scene derivation anyway) than the work it saves.
  // Contrast `wires` above, which memoizes because it allocates a GPU vertex
  // buffer.
  //
  // The image is drawn at the WORK's own size, centered on each chosen face —
  // never stretched to the face. See floorObjectImageFaces.ts, which owns both
  // the face resolution and the sizing rule.
  const nativeAspect = textureNativeAspect(texture?.image);
  const imagePanels = floorObjectImagePanels(
    object,
    resolveFloorObjectImageFaces(object.imageFaces, texture !== undefined),
    floorArtworkWorkSizeMm(object.artworkWidthMm, object.artworkHeightMm, nativeAspect),
    nativeAspect
  );

  const height = mmToWorld(object.heightMm);
  // The pedestal/plinth under this work, if any — footprint, offsets, bonnet and
  // the assembly union all resolved in mm-space (floorSupportLayoutMm above).
  const support = floorSupportLayoutMm(object);
  // This group's origin is the WORK BOX's center, so every sub-mesh below is
  // positioned relative to it: a height in mm above the floor becomes a local
  // offset by subtracting the work center's own height. Keeping the origin where
  // it already was is what lets the image panels, the uncertainty outline and
  // the suspension wires stay untouched.
  const localYMm = (heightAboveFloorMm: number) =>
    heightAboveFloorMm - (support ? support.workCenterYMm : 0);
  // The box is center-anchored, so its center rides at bottom edge + half the
  // height. With no baseHeightMm that is heightMm / 2 exactly as before —
  // halving is exact in binary floating point either side of the mm->world
  // scale, so a floor-resting box lands on the identical world y it always did.
  //
  // A SUPPORT SUPERSEDES that: the work's bottom edge is the support's top face
  // and baseHeightMm is ignored under one (the same rule cases and monitors
  // follow), so a stale suspension height left on a work that was later stood on
  // a plinth must not lift it off its own pedestal.
  return (
    <group
      position={[
        x,
        mmToWorld(support ? support.workCenterYMm : suspendedCenterYMm(object)),
        z
      ]}
      rotation={[0, yaw, 0]}
    >
      {/* The support block: white gallery furniture of the same family as a
          vitrine's body (CASE_BODY_COLOR), Lambert like every other volume, and
          carrying the SAME pointer handlers as the work above it — clicking,
          pressing or hovering the pedestal acts on the placement, because the
          assembly is one installation and not two objects. */}
      {support ? (
        <mesh
          position={[
            mmToWorld(support.supportOffsetXMm),
            mmToWorld(localYMm(support.supportCenterYMm)),
            mmToWorld(support.supportOffsetZMm)
          ]}
          {...pointerProps}
          onPointerOver={onPointerOver}
          onPointerOut={onPointerOut}
        >
          <boxGeometry
            args={[
              mmToWorld(support.supportWidthMm),
              mmToWorld(support.supportHeightMm),
              mmToWorld(support.supportDepthMm)
            ]}
          />
          <meshLambertMaterial color={CASE_BODY_COLOR} />
        </mesh>
      ) : null}
      <mesh
        {...pointerProps}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
      >
        <boxGeometry
          args={[mmToWorld(object.widthMm), height, mmToWorld(object.depthMm)]}
        />
        {/* The box is the SUPPORT — a projection board, a plinth, a sculpture's
            bounding volume — and is always the neutral colour. The image rides
            on top as its own quads (below) rather than as the box's face
            textures, because a face texture's aspect ratio is necessarily the
            FACE's aspect ratio: widening a 60"x48" work's board to 7' stretched
            the image 1.4x horizontally, and there was no way to prevent or undo
            it short of retyping the board to match the work.

            Lambert, so per-face shading still reads the neutral box as a volume
            rather than a flat silhouette. Note the image quads are deliberately
            NOT Lambert — see their material below. */}
        <meshLambertMaterial color={BOX_COLOR} />
      </mesh>
      {/* One quad per chosen face, at the WORK's own dimensions, centered, and
          floated a millimetre clear of the face it sits on so the two coplanar
          surfaces can't z-fight. Sizing and placement are
          floorObjectImageFaces.ts's; nothing about them is decided here.

          No pointer handlers: an R3F event walks every intersection in
          front-to-back order and only calls handlers it finds, so a click that
          lands on a panel still reaches the box's onClick behind it. Adding
          handlers here would just duplicate them.

          MeshBasicMaterial + toneMapped:false, exactly like ArtworkPlane (spec
          §6.2: lighting realism must never tint a work a curator is judging).
          It is not a style choice — Lambert here was a bug.
          AMBIENT_LIGHT_INTENSITY is 2.9 (sceneConstants.ts), tuned to wash the
          near-white walls, so a Lambert-shaded artwork texture was multiplied
          ~3x and saturated to flat white: floor-placed works rendered as blank
          boxes while the same image on a wall rendered correctly. Most visible
          on a suspended projection board, whose whole purpose is showing the
          projected image. */}
      {imagePanels.map((panel) => (
        <mesh
          key={panel.face}
          position={[
            mmToWorld(panel.positionMm[0]),
            mmToWorld(panel.positionMm[1]),
            mmToWorld(panel.positionMm[2])
          ]}
          rotation={[panel.rotationRad[0], panel.rotationRad[1], panel.rotationRad[2]]}
        >
          <planeGeometry args={[mmToWorld(panel.widthMm), mmToWorld(panel.heightMm)]} />
          {/* transparent + alphaTest: a PNG's clear regions show the neutral
              box face beneath instead of the black stored under the alpha. */}
          <meshBasicMaterial map={texture} toneMapped={false} transparent alphaTest={0.01} />
        </mesh>
      ))}
      {/* The plexi bonnet: a glass box at the SUPPORT's footprint (bonnet
          footprint = support footprint, USER DECISION 2026-09-17) rising from
          the support's top face, in the same glass the vitrine cap uses. Drawn
          after the work and its image so the transparent material composites
          over them. Pointer handlers like every other sub-mesh — a curator
          clicking the glass has clicked the installation.

          A LOCKED bonnet may be SHORTER than the work it covers (the normaliser
          warns rather than growing it); the work box is then simply taller than
          the glass and pokes out of its top, which is exactly the collision the
          inspector is warning about and must be visible here. */}
      {support?.bonnet ? (
        <mesh
          position={[
            mmToWorld(support.supportOffsetXMm),
            mmToWorld(localYMm(support.bonnet.centerYMm)),
            mmToWorld(support.supportOffsetZMm)
          ]}
          {...pointerProps}
          onPointerOver={onPointerOver}
          onPointerOut={onPointerOut}
        >
          <boxGeometry
            args={[
              mmToWorld(support.supportWidthMm),
              mmToWorld(support.bonnet.heightMm),
              mmToWorld(support.supportDepthMm)
            ]}
          />
          <meshLambertMaterial {...GLASS_MATERIAL_PROPS} />
        </mesh>
      ) : null}
      {isUncertain(object.status) ? (
        <DashedBoxOutline
          widthMm={object.widthMm}
          heightMm={object.heightMm}
          depthMm={object.depthMm}
          status={object.status}
        />
      ) : null}
      {/* One outline around the WHOLE assembly when there is a support — the
          thing that got selected is the installation, not the sculpture
          balanced on top of it (the same call CrtMonitorMesh makes about its
          pedestal). Off a support this is unchanged: the box's own outline. */}
      {isSelected && support ? (
        <group
          position={[
            mmToWorld(support.assemblyOffsetXMm),
            mmToWorld(localYMm(support.assemblyCenterYMm)),
            mmToWorld(support.assemblyOffsetZMm)
          ]}
        >
          <SelectionBoxOutline
            widthMm={support.assemblyWidthMm + SELECTION_OUTLINE_OUTSET_MM}
            heightMm={support.assemblyHeightMm + SELECTION_OUTLINE_OUTSET_MM}
            depthMm={support.assemblyDepthMm + SELECTION_OUTLINE_OUTSET_MM}
          />
        </group>
      ) : isSelected ? (
        <SelectionBoxOutline
          widthMm={object.widthMm + SELECTION_OUTLINE_OUTSET_MM}
          heightMm={object.heightMm + SELECTION_OUTLINE_OUTSET_MM}
          depthMm={object.depthMm + SELECTION_OUTLINE_OUTSET_MM}
        />
      ) : null}
      {/* Inside the yawed group on purpose: the wires attach to the board's
          top corners, so the same rotation that turns the box has to turn
          them. `fromLocalYMm` is the box's half-height because this group's
          origin is the box CENTER, not its top.

          Withheld under a support: a support and suspension are mutually
          exclusive states (a support puts the bottom edge on its top face and
          ignores baseHeightMm), so a stale suspension height on a work that was
          later stood on a plinth must not sprout wires from a pedestal. */}
      {wires && !support ? (
        <SuspensionWires plan={wires} fromLocalYMm={object.heightMm / 2} />
      ) : null}
    </group>
  );
}
