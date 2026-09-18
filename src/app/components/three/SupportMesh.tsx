import type { FloorObject3d } from "../../../domain/geometry/scene3d";
import { mmToWorld } from "./coordinates";
import { planRotationToYaw } from "./planRotation";
import { SelectionBoxOutline } from "./UncertaintyOutline";
import { useSelectableFloorObject } from "./useSelectableFloorObject";
import { CASE_BODY_COLOR, CASE_GLASS_COLOR, CASE_GLASS_OPACITY } from "./tokens";

// Same glass construction CaseMesh's vitrine cap uses (color, opacity,
// depthWrite) — a plexi bonnet is drawn as one solid box rather than
// CaseMesh's inset ring+cap tray: a bonnet has no interior wall to build
// around, it is simply a transparent box sitting on the support's top face
// (footprint = the support's own, floor-supports spec §5/§6).
const GLASS_MATERIAL_PROPS = {
  color: CASE_GLASS_COLOR,
  transparent: true,
  opacity: CASE_GLASS_OPACITY,
  depthWrite: false
} as const;

// The same outset every other selected floor object wears.
const SELECTION_OUTLINE_OUTSET_MM = 20;

// A freestanding pedestal or plinth (spec: floor `support` objects) — a plain
// box standing from the floor to its top face (heightMm), in the same neutral
// material the old attached-support block used (CASE_BODY_COLOR, Lambert-
// shaded so it still reads as a volume). Pedestal and plinth share this exact
// construction; only the plan glyph and the object's own proportions tell
// them apart (spec §6) — there is nothing kind-specific to draw here.
//
// A rider (a work standing on this support) is NOT drawn here: it is an
// ordinary ArtworkFloorObject/CrtMonitorMesh entry whose own baseHeightMm the
// render layer already reads (suspendedCenterYMm), ever since a pedestal
// stopped being a block attached to one artwork (schema v8).
//
// Selectable and draggable through the shared floor-object wiring
// (useSelectableFloorObject) exactly as FloorCaseMesh: every sub-mesh (body,
// bonnet) shares one hover/press/click target, so grabbing any part of the
// installation selects and moves the whole thing. ThreeDView carries this
// support's riders along with it (objectDrag.ts's `riders`/`translateSupportRiders`),
// the 3D twin of the plan/inspector rigid-assembly rule.
export function SupportMesh({
  object,
  isSelected,
  isSnapTarget = false,
  onSelect
}: {
  object: FloorObject3d;
  isSelected: boolean;
  // A floor artwork being dropped or dragged in 3D is currently captured on
  // THIS support (ThreeDView resolves it through resolveFloorArtworkDragSeat).
  // A SURFACE ANNOUNCES ITSELF: the support wears the selection outline for
  // the length of the gesture, the floor twin of WallShelfMesh's prop of the
  // same name.
  isSnapTarget?: boolean;
  onSelect: (objectId: string, opts: { additive: boolean }) => void;
}) {
  const x = mmToWorld(object.xMm);
  const z = mmToWorld(object.yMm);
  const yaw = planRotationToYaw(object.rotationDeg);
  // Hover lives on the wrapping group (stopHoverPropagation), and the shared
  // click/drag props are spread onto both sub-meshes — same pattern
  // FloorCaseMesh uses for its own multi-mesh assembly.
  const { pointerProps, onPointerOver, onPointerOut } = useSelectableFloorObject(
    object.objectId,
    onSelect,
    { stopHoverPropagation: true }
  );

  const bonnetHeightMm = object.bonnetHeightMm;
  const totalHeightMm = object.heightMm + (bonnetHeightMm ?? 0);

  return (
    <group
      position={[x, 0, z]}
      rotation={[0, yaw, 0]}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      <mesh {...pointerProps} position={[0, mmToWorld(object.heightMm / 2), 0]}>
        <boxGeometry
          args={[mmToWorld(object.widthMm), mmToWorld(object.heightMm), mmToWorld(object.depthMm)]}
        />
        <meshLambertMaterial color={CASE_BODY_COLOR} />
      </mesh>
      {/* The plexi bonnet: a transparent box rising from the support's top
          face, drawn after the body so its transparency composites over it.
          Pointer handlers like the body — clicking the glass has clicked the
          installation, not a separate object. */}
      {bonnetHeightMm !== undefined ? (
        <mesh
          {...pointerProps}
          position={[0, mmToWorld(object.heightMm + bonnetHeightMm / 2), 0]}
        >
          <boxGeometry
            args={[mmToWorld(object.widthMm), mmToWorld(bonnetHeightMm), mmToWorld(object.depthMm)]}
          />
          <meshLambertMaterial {...GLASS_MATERIAL_PROPS} />
        </mesh>
      ) : null}
      {/* One outline around the whole installation — body plus bonnet, when
          there is one — never just the body a bonnet would otherwise poke
          out of. */}
      {isSelected || isSnapTarget ? (
        <group position={[0, mmToWorld(totalHeightMm / 2), 0]}>
          <SelectionBoxOutline
            widthMm={object.widthMm + SELECTION_OUTLINE_OUTSET_MM}
            heightMm={totalHeightMm + SELECTION_OUTLINE_OUTSET_MM}
            depthMm={object.depthMm + SELECTION_OUTLINE_OUTSET_MM}
          />
        </group>
      ) : null}
    </group>
  );
}
