import type { Texture } from "three";
import type { FloorObject3d } from "../../../domain/geometry/scene3d";
import {
  monitorImageSizeMm,
  monitorScreenRectMm
} from "../../../domain/geometry/monitorGlyphs";
import { textureNativeAspect } from "./artworkFit";
import { mmToWorld } from "./coordinates";
import { planRotationToYaw } from "./planRotation";
import { SelectionBoxOutline } from "./UncertaintyOutline";
import { useSelectableFloorObject } from "./useSelectableFloorObject";
import { MONITOR_BODY_COLOR, MONITOR_SCREEN_COLOR } from "./tokens";

// How far the screen (and, ahead of it, the image) floats off the cabinet's
// front face so the coplanar surfaces can't z-fight. Same 1mm step and same
// reasoning as floorObjectImageFaces.ts's IMAGE_PANEL_LIFT_MM; the image takes
// a second step so it can never fight the screen behind it either.
const SCREEN_LIFT_MM = 1;
const IMAGE_LIFT_MM = 2;

// Outset of the selection outline, matching every other selected thing in 3D.
const SELECTION_OUTLINE_OUTSET_MM = 20;

// Where every box in a monitor assembly sits, in mm off the floor and in the
// placement's own rotated local frame — the pure half of the component, split
// out because the arithmetic is all there is to get wrong and testing it does
// not need an R3F renderer.
//
// Schema v8: whatever the cabinet is standing on is its OWN floor object with
// its own mesh, so the only question left here is how high the cabinet's bottom
// edge is — `baseHeightMm`, which is a pedestal's top face for a monitor
// standing on one and 0 on the bare floor.
export type CrtMonitorLayoutMm = {
  // Center height of the cabinet box.
  cabinetCenterYMm: number;
  // The box the selection outline wraps, BEFORE its outset: the cabinet alone.
  // The pedestal under it draws — and selects — as the separate object it is.
  outline: {
    widthMm: number;
    heightMm: number;
    depthMm: number;
    centerYMm: number;
    offsetXMm: number;
    offsetZMm: number;
  };
};

export function crtMonitorLayoutMm(object: FloorObject3d): CrtMonitorLayoutMm {
  const baseHeightMm = Math.max(0, object.baseHeightMm ?? 0);
  const centerYMm = baseHeightMm + object.heightMm / 2;
  return {
    cabinetCenterYMm: centerYMm,
    outline: {
      widthMm: object.widthMm,
      heightMm: object.heightMm,
      depthMm: object.depthMm,
      centerYMm,
      offsetXMm: 0,
      offsetZMm: 0
    }
  };
}

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
// — the box, and nothing else. The pedestal is NOT in heightMm; it arrives
// — the box, and nothing else. Whatever it stands on is a separate support
// floor object with its own mesh (schema v8), so toggling a pedestal off never
// rewrites the placement's geometry: the stored number stays the one thing the
// curator types in the inspector's Height field.
//
// `baseHeightMm` IS read here, unlike in FloorCaseMesh: for a monitor it is not
// a suspension height (a monitor never hangs — the inspector withholds "Height
// off floor" for it) but the height of the pedestal it is standing on, written
// by the seating rule. A cabinet on the bare floor has 0.
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

  const layout = crtMonitorLayoutMm(object);
  const monitorHeightMm = object.heightMm;

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
      {/* The cabinet, sitting on top of whatever is (or isn't) beneath it. */}
      <group position={[0, mmToWorld(layout.cabinetCenterYMm), 0]}>
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

      {/* One outline around the CABINET. The pedestal under it is its own
          object and wraps its own outline when IT is selected (floor-supports
          spec §6: the selection box wraps only the selected object).
          No dashed uncertainty outline: unlike a sculpture's bounding box, this
          volume is equipment at standard dimensions, so the work's own
          dimension status says nothing about how big the monitor is. */}
      {isSelected ? (
        <group
          position={[
            mmToWorld(layout.outline.offsetXMm),
            mmToWorld(layout.outline.centerYMm),
            mmToWorld(layout.outline.offsetZMm)
          ]}
        >
          <SelectionBoxOutline
            widthMm={layout.outline.widthMm + SELECTION_OUTLINE_OUTSET_MM}
            heightMm={layout.outline.heightMm + SELECTION_OUTLINE_OUTSET_MM}
            depthMm={layout.outline.depthMm + SELECTION_OUTLINE_OUTSET_MM}
          />
        </group>
      ) : null}
    </group>
  );
}
