import { MathUtils } from "three";
import type { Texture } from "three";
import type { FloorObject3d } from "../../../domain/geometry/scene3d";
import {
  monitorImageSizeMm,
  monitorScreenRectMm
} from "../../../domain/geometry/monitorGlyphs";
import { textureNativeAspect } from "./artworkFit";
import { mmToWorld } from "./coordinates";
import { floorSupportLayoutMm } from "./FloorObjectBox";
import { SelectionBoxOutline } from "./UncertaintyOutline";
import { useSelectableFloorObject } from "./useSelectableFloorObject";
import {
  CASE_BODY_COLOR,
  CASE_GLASS_COLOR,
  CASE_GLASS_OPACITY,
  MONITOR_BODY_COLOR,
  MONITOR_SCREEN_COLOR
} from "./tokens";

// Plan-space rotation (CCW in plan x/y) to a three.js yaw about +y — the same
// single sign flip FloorObjectBox owns, restated rather than imported because
// both are two lines and a shared import would make one component's render
// depend on the other's file.
function planRotationToYaw(rotationDeg: number): number {
  return -MathUtils.degToRad(rotationDeg);
}

// How far the screen (and, ahead of it, the image) floats off the cabinet's
// front face so the coplanar surfaces can't z-fight. Same 1mm step and same
// reasoning as floorObjectImageFaces.ts's IMAGE_PANEL_LIFT_MM; the image takes
// a second step so it can never fight the screen behind it either.
const SCREEN_LIFT_MM = 1;
const IMAGE_LIFT_MM = 2;

// Outset of the selection outline, matching every other selected thing in 3D.
const SELECTION_OUTLINE_OUTSET_MM = 20;

// The bonnet's glass, identical to FloorObjectBox's and the vitrine cap's in
// CaseMesh.tsx: one glass language across the app (the 2D glyphs share
// CASE_GLASS_THICKNESS_MM for the same reason). Restated locally rather than
// imported from either, exactly as planRotationToYaw above is — no component
// should have to import another's render internals.
const GLASS_MATERIAL_PROPS = {
  color: CASE_GLASS_COLOR,
  transparent: true,
  opacity: CASE_GLASS_OPACITY,
  depthWrite: false
} as const;

// Where every box in a monitor assembly sits, in mm off the floor and in the
// placement's own rotated local frame — the pure half of the component, split
// out for the reason FloorObjectBox.tsx splits floorSupportLayoutMm out: the
// arithmetic is all there is to get wrong, and testing it does not need an R3F
// renderer.
//
// It IS floorSupportLayoutMm, with the cabinet standing in for "the work" —
// deliberately the same helper rather than a monitor-shaped copy, so a plinth
// under a CRT and a plinth under a sculpture can never disagree about where
// its top face, its bonnet or the assembly's bounding box are. The only thing
// added here is the no-support fallback: a cabinet on the bare floor, whose
// outline is its own box.
export type CrtMonitorLayoutMm = {
  // Center height of the cabinet box.
  cabinetCenterYMm: number;
  // The resolved support layout, or null when the cabinet is on the floor.
  support: ReturnType<typeof floorSupportLayoutMm>;
  // The box the selection outline wraps, BEFORE its outset: the assembly union
  // (cabinet ∪ offset plinth ∪ bonnet) when there is a support, the cabinet
  // alone otherwise.
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
  const support = floorSupportLayoutMm(object);
  if (!support) {
    return {
      cabinetCenterYMm: object.heightMm / 2,
      support: null,
      outline: {
        widthMm: object.widthMm,
        heightMm: object.heightMm,
        depthMm: object.depthMm,
        centerYMm: object.heightMm / 2,
        offsetXMm: 0,
        offsetZMm: 0
      }
    };
  }
  return {
    cabinetCenterYMm: support.workCenterYMm,
    support,
    outline: {
      widthMm: support.assemblyWidthMm,
      heightMm: support.assemblyHeightMm,
      depthMm: support.assemblyDepthMm,
      centerYMm: support.assemblyCenterYMm,
      offsetXMm: support.assemblyOffsetXMm,
      offsetZMm: support.assemblyOffsetZMm
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
// already resolved on the scene entry (FloorObject3d.support — an explicit
// pedestal/plinth the curator authored, or the monitor's own absent-means-
// pedestal default), and is absent when the cabinet stands on the bare floor.
// That split is deliberate: toggling the pedestal off must not rewrite the
// placement's geometry (and toggling it back on must not have to guess what the
// cabinet's own height was), so the stored number stays the one thing the
// curator can type in the inspector's Height field and the support stays a pure
// display decision.
//
// TRAP: the pedestal's FOOTPRINT is the support's, not the cabinet's, and so is
// the bonnet's. Those coincide for the monitor default (which is sized to its
// monitor) and diverge the moment a curator stands the cabinet on a named
// plinth — reading object.widthMm/depthMm here would silently shrink that
// plinth to the box, and the selection outline has to wrap the union of the
// three rather than the cabinet alone.
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

  // What the cabinet stands on, resolved once in the scene (resolveFloorSupport:
  // an explicit block wins, else absent monitorSupport means the 800mm default
  // pedestal, else nothing) and laid out by the SAME helper FloorObjectBox uses
  // — never re-derived here.
  const layout = crtMonitorLayoutMm(object);
  const support = layout.support;
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
      {/* The support block, at ITS OWN footprint and offset (the monitor
          default's happens to be the cabinet's). CASE_BODY_COLOR white so it
          reads as gallery furniture of the same family as a vitrine's body
          rather than as a second, paler artwork box. Lambert like every other
          volume in the scene.

          Local x is the placement's width and local z its depth inside this
          yawed group, and the support's stored offsets are in that same rotated
          local frame (offsetYMm is the depth axis, which planRotationToYaw maps
          onto world +z), so the offsets apply with no sign flip. */}
      {support ? (
        <mesh
          position={[
            mmToWorld(support.supportOffsetXMm),
            mmToWorld(support.supportCenterYMm),
            mmToWorld(support.supportOffsetZMm)
          ]}
          {...pointerProps}
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

      {/* The plexi bonnet over the cabinet: a glass box at the PLINTH's
          footprint and offset (bonnet footprint = support footprint, USER
          DECISION 2026-09-17) rising from its top face, in the same glass the
          vitrine cap and FloorObjectBox's bonnet use. Drawn after the cabinet
          and its picture so the transparent material composites over them, and
          carrying the same pointer handlers as every other sub-mesh — a curator
          clicking the glass has clicked the installation.

          A LOCKED bonnet may be SHORTER than the cabinet it covers (the
          normaliser warns rather than growing it); the cabinet then pokes out
          of its top, which is exactly the collision the inspector is warning
          about and must be visible here. */}
      {support?.bonnet ? (
        <mesh
          position={[
            mmToWorld(support.supportOffsetXMm),
            mmToWorld(support.bonnet.centerYMm),
            mmToWorld(support.supportOffsetZMm)
          ]}
          {...pointerProps}
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

      {/* One outline around the WHOLE assembly — plinth, bonnet and the
          plinth's own OFFSET included — because the thing that got selected is
          the installation, not the cabinet on top of it. The union comes from
          the shared assemblyPlanRect (via floorSupportLayoutMm), so an offset
          plinth shifts the box instead of being cropped out of it.
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
