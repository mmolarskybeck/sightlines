import { useCursor } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useMemo, useState } from "react";
import { MathUtils } from "three";
import type { Texture } from "three";
import type { FloorObject3d } from "../../../domain/geometry/scene3d";
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
import {
  DashedBoxOutline,
  isUncertain,
  SelectionBoxOutline,
  SelectionRectOutline
} from "./UncertaintyOutline";
import { BLOCKED_ZONE_COLOR, BOX_COLOR } from "./tokens";

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

// Plan-space rotation (CCW in plan x/y) to a three.js yaw about +y: plan y
// maps to world +z, which flips handedness — the one place that sign lives.
function planRotationToYaw(rotationDeg: number): number {
  return -MathUtils.degToRad(rotationDeg);
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
  const [hovered, setHovered] = useState(false);
  // Every kind this component draws is selectable now, so the cursor is no
  // longer gated on the kind — which also keeps the hook itself
  // kind-independent, like the two below it.
  useCursor(hovered);
  // Above the blocked-zone early return so the hook order never depends on the
  // object's kind. Memoized on the scene entry itself (deriveScene3d hands out
  // a fresh object only when the project actually changed) so the wire vertex
  // buffer downstream isn't rebuilt on every orbit frame.
  const wires = useMemo(() => planSuspensionWires(object), [object]);

  // Not a hook, so it can sit either side of the early return — but both
  // branches need it, and it is identical for both: the object selects itself
  // and stops, so the floor beneath never sees the click and never clears.
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    // An orbit drag's release also fires click — only a true click selects.
    if (event.delta > 6) return;
    const { shiftKey, metaKey, ctrlKey } = event.nativeEvent;
    onSelect(object.objectId, { additive: shiftKey || metaKey || ctrlKey });
  };

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
          onClick={handleClick}
          onPointerOver={() => setHovered(true)}
          onPointerOut={() => setHovered(false)}
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
  // The box is center-anchored, so its center rides at bottom edge + half the
  // height. With no baseHeightMm that is heightMm / 2 exactly as before —
  // halving is exact in binary floating point either side of the mm->world
  // scale, so a floor-resting box lands on the identical world y it always did.
  return (
    <group
      position={[x, mmToWorld(suspendedCenterYMm(object)), z]}
      rotation={[0, yaw, 0]}
    >
      <mesh
        onClick={handleClick}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
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
      {isUncertain(object.status) ? (
        <DashedBoxOutline
          widthMm={object.widthMm}
          heightMm={object.heightMm}
          depthMm={object.depthMm}
          status={object.status}
        />
      ) : null}
      {isSelected ? (
        <SelectionBoxOutline
          widthMm={object.widthMm + SELECTION_OUTLINE_OUTSET_MM}
          heightMm={object.heightMm + SELECTION_OUTLINE_OUTSET_MM}
          depthMm={object.depthMm + SELECTION_OUTLINE_OUTSET_MM}
        />
      ) : null}
      {/* Inside the yawed group on purpose: the wires attach to the board's
          top corners, so the same rotation that turns the box has to turn
          them. `fromLocalYMm` is the box's half-height because this group's
          origin is the box CENTER, not its top. */}
      {wires ? (
        <SuspensionWires plan={wires} fromLocalYMm={object.heightMm / 2} />
      ) : null}
    </group>
  );
}
