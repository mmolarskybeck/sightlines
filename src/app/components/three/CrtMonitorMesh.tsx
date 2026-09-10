import type { Texture } from "three";
import type { FloorObject3d } from "../../../domain/geometry/scene3d";
import {
  monitorImageSizeMm,
  monitorPedestalHeightMm,
  monitorScreenRectMm
} from "../../../domain/geometry/monitorGlyphs";
import { textureNativeAspect } from "./artworkFit";
import { mmToWorld } from "./coordinates";
import { planRotationToYaw } from "./planRotation";
import { SelectionBoxOutline } from "./UncertaintyOutline";
import { useSelectableFloorObject } from "./useSelectableFloorObject";
import { CASE_BODY_COLOR, MONITOR_BODY_COLOR, MONITOR_SCREEN_COLOR } from "./tokens";

// How far the screen (and, ahead of it, the image) floats off the cabinet's
// front face so the coplanar surfaces can't z-fight. Same 1mm step and same
// reasoning as floorObjectImageFaces.ts's IMAGE_PANEL_LIFT_MM; the image takes
// a second step so it can never fight the screen behind it either.
const SCREEN_LIFT_MM = 1;
const IMAGE_LIFT_MM = 2;

// Outset of the selection outline, matching every other selected thing in 3D.
const SELECTION_OUTLINE_OUTSET_MM = 20;

// A video work installed on a CRT / box monitor (Artwork.displayAs ===
// "monitor"): a black cabinet with a 4:3 screen on its FRONT face carrying the
// work's image, standing on a plain white pedestal — or, when the curator says
// so, directly on the floor.
//
// THE MONITOR IS THE ARTWORK'S RENDERING, NOT A NEW OBJECT KIND. The placement
// is an ordinary ArtworkFloorObject (the projection-board precedent: "the work
// IS the board"), so drag, rotate, group-move, marquee, undo and the plan/
// elevation views all keep working with no new store machinery.
//
// WHAT THE STORED GEOMETRY MEANS HERE: widthMm/heightMm/depthMm are the CABINET
// — the box, and nothing else. The pedestal is NOT in heightMm; it is added
// here, at render time, from monitorSupport. That split is deliberate: toggling
// the pedestal off must not rewrite the placement's geometry (and toggling it
// back on must not have to guess what the cabinet's own height was), so the
// stored number stays the one thing the curator can type in the inspector's
// Height field and the pedestal stays a pure display decision.
//
// baseHeightMm is deliberately IGNORED, exactly as FloorCaseMesh ignores it: a
// monitor stands on a pedestal or on the floor, and hanging one from ceiling
// wires is not a thing this type represents. The inspector withholds the
// "Height off floor" field for the same reason.
export function CrtMonitorMesh({
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

  // Absent monitorSupport means a pedestal — resolved here, at read time (see
  // resolveMonitorSupport), never baked into the stored placement.
  const pedestalHeightMm = monitorPedestalHeightMm(object.monitorSupport);
  const monitorHeightMm = object.heightMm;
  const totalHeightMm = pedestalHeightMm + monitorHeightMm;

  // Bezel at true mm — there is no zoom here to clamp for. Null on a cabinet
  // too small to hold a bezel on both sides, which then draws as a plain black
  // box rather than an inverted screen.
  const screen = monitorScreenRectMm({
    widthMm: object.widthMm,
    heightMm: monitorHeightMm
  });
  // The bezel is uniform, so the screen is concentric with the face and both
  // quads sit at the face's centre — no offset arithmetic to get wrong.
  const nativeAspect = textureNativeAspect(texture?.image);
  const image =
    screen && texture
      ? monitorImageSizeMm(screen.widthMm, screen.heightMm, nativeAspect)
      : undefined;

  // The whole assembly selects, drags and hovers as one: clicking, pressing or
  // hovering the pedestal, the cabinet or the picture all act on the
  // placement — same hook FloorObjectBox and FloorCaseMesh share
  // (useSelectableFloorObject.ts). The floor beneath never sees the click and
  // never clears the selection (FloorObjectBox's rule).
  const { pointerProps: selectableProps, onPointerOver, onPointerOut } =
    useSelectableFloorObject(object.objectId, onSelect);
  const pointerProps = { ...selectableProps, onPointerOver, onPointerOut };

  const halfDepthMm = object.depthMm / 2;

  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      {/* Plinth: same footprint as the cabinet (a monitor pedestal is sized to
          its monitor), CASE_BODY_COLOR white so it reads as gallery furniture
          of the same family as a vitrine's body rather than as a second, paler
          artwork box. Lambert like every other volume in the scene. */}
      {pedestalHeightMm > 0 ? (
        <mesh position={[0, mmToWorld(pedestalHeightMm / 2), 0]} {...pointerProps}>
          <boxGeometry
            args={[
              mmToWorld(object.widthMm),
              mmToWorld(pedestalHeightMm),
              mmToWorld(object.depthMm)
            ]}
          />
          <meshLambertMaterial color={CASE_BODY_COLOR} />
        </mesh>
      ) : null}

      {/* The cabinet, sitting on top of whatever is (or isn't) beneath it. */}
      <group position={[0, mmToWorld(pedestalHeightMm + monitorHeightMm / 2), 0]}>
        <mesh {...pointerProps}>
          <boxGeometry
            args={[
              mmToWorld(object.widthMm),
              mmToWorld(monitorHeightMm),
              mmToWorld(object.depthMm)
            ]}
          />
          <meshLambertMaterial color={MONITOR_BODY_COLOR} />
        </mesh>

        {/* The dead tube behind the picture. Drawn even with no texture, so a
            work whose image is missing still reads as a monitor with a screen
            rather than as an anonymous black block — and it is what shows in
            the letterbox bars whenever the image isn't 4:3. Basic, not Lambert:
            it is a dark surface right beside an untinted image, and shading one
            but not the other would make the bars glow relative to the picture. */}
        {screen ? (
          <mesh position={[0, 0, mmToWorld(halfDepthMm + SCREEN_LIFT_MM)]} {...pointerProps}>
            <planeGeometry
              args={[mmToWorld(screen.widthMm), mmToWorld(screen.heightMm)]}
            />
            <meshBasicMaterial color={MONITOR_SCREEN_COLOR} toneMapped={false} />
          </mesh>
        ) : null}

        {/* The picture: contained inside the screen area, never stretched and
            never cropped (monitorImageSizeMm owns that rule).

            MeshBasicMaterial + toneMapped:false, exactly like ArtworkPlane and
            the floor box's image quads — AMBIENT_LIGHT_INTENSITY is 2.9, so a
            Lambert-shaded artwork texture saturates to flat white. That was a
            real bug on floor artwork; it is not repeated here.

            No pointer handlers of its own would be needed (an R3F event walks
            every intersection and reaches the mesh behind), but the quad is the
            frontmost thing a curator clicks, so it carries them explicitly
            rather than relying on the walk. */}
        {image ? (
          <mesh position={[0, 0, mmToWorld(halfDepthMm + IMAGE_LIFT_MM)]} {...pointerProps}>
            <planeGeometry args={[mmToWorld(image.widthMm), mmToWorld(image.heightMm)]} />
            {/* transparent + alphaTest: a PNG's clear regions show the dark
                screen beneath instead of the black stored under the alpha. */}
            <meshBasicMaterial map={texture} toneMapped={false} transparent alphaTest={0.01} />
          </mesh>
        ) : null}
      </group>

      {/* One outline around the WHOLE assembly, pedestal included — the thing
          that got selected is the installation, not the cabinet on top of it.
          Centred on the assembly's own mid-height, not the cabinet's.
          No dashed uncertainty outline: unlike a sculpture's bounding box, this
          volume is equipment at standard dimensions, so the work's own
          dimension status says nothing about how big the monitor is. */}
      {isSelected ? (
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
