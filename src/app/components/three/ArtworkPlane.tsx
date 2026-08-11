import { useCursor } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import type { Texture } from "three";
import {
  FRAME_EDGE_HAIRLINE_HEX,
  FRAME_FINISH_HEX,
  MAT_BEVEL_HAIRLINE_HEX
} from "../../../domain/framing";
import type { ArtworkFrame } from "../../../domain/project";
import type { WallArtwork3d } from "../../../domain/geometry/scene3d";
import { fitArtworkImageSizeMm, textureNativeAspect } from "./artworkFit";
import { mmToWorld } from "./coordinates";
import { getFrameFinishTexture } from "./frameFinishTextures";
import { framingLayout } from "./framingGeometry";
import { mitredFrameBarGeometries } from "./frameMitreGeometry";
import {
  DashedRectOutline,
  isUncertain,
  SelectionRectOutline
} from "./UncertaintyOutline";
import { GHOST_OPACITY, MAT_FILL_COLOR, PLACEHOLDER_COLOR } from "./tokens";

// Outlines sit slightly proud of whatever face they wrap (the image plane, or
// the frame's front face when framed) so they never z-fight it.
const OUTLINE_OFFSET_MM = 5;

// Frame-edge hairlines sit just off the frame's front face — proud enough not
// to z-fight the boxes, but below OUTLINE_OFFSET_MM so they never share a
// depth with the uncertainty/selection outlines on the same rect.
const HAIRLINE_OFFSET_MM = 2;

// One hairline rectangle, centered in the local xy-plane — the 3D analogue of
// elevation's frame-edge hairlines, so a white frame on a white wall (or over
// a white mat) still reads as its own ring. Color is finish-aware: the light
// mat-bevel grey would shout against a dark frame.
function FrameEdgeHairline({
  widthMm,
  heightMm,
  color
}: {
  widthMm: number;
  heightMm: number;
  color: string;
}) {
  const positions = useMemo(() => {
    const halfW = mmToWorld(widthMm) / 2;
    const halfH = mmToWorld(heightMm) / 2;
    return new Float32Array([
      -halfW, -halfH, 0,
      halfW, -halfH, 0,
      halfW, halfH, 0,
      -halfW, halfH, 0
    ]);
  }, [widthMm, heightMm]);

  return (
    <lineLoop>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={color} />
    </lineLoop>
  );
}

// One placed wall artwork, in WALL-LOCAL coordinates: the parent WallPanel
// group maps local +x along the wall, +y up from the floor, +z inward, so
// this component does no coordinate math beyond mm -> world (spec §5.1).
// MeshBasicMaterial + toneMapped:false keeps the image's colors faithful
// (spec §6.2) — lighting realism must never tint a work a curator is judging,
// which is also why selection is outline-only here, never a material tint.
//
// Optional schematic framing (matWidthMm / frame) mirrors the elevation view:
// a mat board grown OUTSIDE the stored image rect, and a frame ring outside the
// mat, extruded off the wall for real depth. Both absent → the plane renders
// exactly as it always has (legacy-identical).
export function ArtworkPlane({
  artwork,
  texture,
  matWidthMm,
  frame,
  isSelected,
  onSelect,
  ghosted = false
}: {
  artwork: WallArtwork3d;
  texture: Texture | undefined;
  matWidthMm?: number;
  frame?: ArtworkFrame;
  isSelected: boolean;
  onSelect: (objectId: string, opts: { additive: boolean }) => void;
  // The wall this work hangs on crosses the active eye-level sightline: the
  // work fades with its wall, and outlines drop out entirely.
  ghosted?: boolean;
}) {
  // Known/approximate placements fill their rect exactly as before. An
  // unknown-dimension placement has a placeholder rect whose aspect is
  // arbitrary, so the image plane is letterboxed to the texture's native aspect
  // inside that rect (centered) — matching the elevation view — while the mat/
  // frame bands and the outlines below stay on the full STORED rect.
  const imageSize = fitArtworkImageSizeMm(
    { widthMm: artwork.widthMm, heightMm: artwork.heightMm },
    artwork.status,
    textureNativeAspect(texture?.image)
  );
  const width = mmToWorld(imageSize.widthMm);
  const height = mmToWorld(imageSize.heightMm);

  // Bands wrap the STORED rect (not the letterboxed image), exactly as
  // elevation does — the letterboxed image sits inside the opening.
  const layout = framingLayout(artwork.widthMm, artwork.heightMm, matWidthMm, frame);
  const frameFill = frame ? FRAME_FINISH_HEX[frame.finish] : undefined;
  // Baked band texture for the material finishes (gold/silver/wood) —
  // session-cached, so this is a map lookup, not a canvas paint. Undefined
  // (flat finishes, DOM-less tests) falls back to the flat color. The bars'
  // material keys include the finish so a texture appearing/disappearing
  // remounts the material instead of relying on needsUpdate.
  const frameTexture = frame ? getFrameFinishTexture(frame.finish) : undefined;
  const frameMaterialKey = `${ghosted ? "ghosted" : "solid"}-${frame?.finish ?? "none"}`;

  // Mitred bar prisms, rebuilt only when the framed footprint changes; the
  // previous set is disposed (imperatively created geometry isn't r3f's to
  // free).
  const frameBarGeometries = useMemo(
    () => (layout.hasFrame ? mitredFrameBarGeometries(layout) : undefined),
    // layout is a fresh object every render; its size fields are the real
    // inputs, so they are the deps.
    [
      layout.hasFrame,
      layout.outerWidthMm,
      layout.outerHeightMm,
      layout.openingWidthMm,
      layout.openingHeightMm,
      layout.frameDepthMm
    ]
  );
  useEffect(
    () => () => frameBarGeometries?.forEach((geometry) => geometry.dispose()),
    [frameBarGeometries]
  );

  // Desktop-only affordance (spec §4.3): a pointer cursor, nothing
  // load-bearing on hover.
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);

  // Event precedence (spec §4.3): the artwork consumes its click so the wall
  // beneath doesn't also select, and the canvas miss-handler doesn't clear.
  // event.delta > a few px means this "click" was an orbit drag's release.
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.delta > 6) return;
    const { shiftKey, metaKey, ctrlKey } = event.nativeEvent;
    onSelect(artwork.objectId, { additive: shiftKey || metaKey || ctrlKey });
  };

  return (
    // Group sits AT the wall surface (z = 0); each layer carries its own
    // off-wall depth. A plain work's image lands at WALL_OFFSET_MM, identical
    // to the historical group-offset placement.
    <group position={[mmToWorld(artwork.xMm), mmToWorld(artwork.yMm), 0]}>
      {frameBarGeometries ? (
        // Frame: four mitred trapezoid prisms (one per side) meeting at 45°
        // seams, extruded from the wall to FRAME_DEPTH_MM — the same corner
        // treatment as elevation's trapezoid bands. Lambert (not a metallic
        // material) keeps the schematic look and separates the flat faces of
        // a square-section molding by normal alone; the material finishes
        // (gold/silver/wood) sample their baked band texture, whose UVs the
        // geometry writes in band terms so grain/brushing runs along every
        // bar. The prisms already sit at z 0..depth, so no group offset.
        <group>
          {frameBarGeometries.map((geometry, index) => (
            <mesh key={index} geometry={geometry} onClick={handleClick}>
              <meshLambertMaterial
                key={frameMaterialKey}
                color={frameTexture ? "#ffffff" : frameFill}
                map={frameTexture}
                transparent={ghosted}
                opacity={ghosted ? GHOST_OPACITY : 1}
                depthWrite={!ghosted}
              />
            </mesh>
          ))}
        </group>
      ) : null}
      {layout.hasFrame && !ghosted && frame ? (
        <>
          {/* Frame edge hairlines, mirroring elevation's: one loop at the
              frame's outer edge, one at its inner boundary (frame/mat when
              matted, else frame/image opening), seated just proud of the
              frame's front face. Finish-aware color so the line stays quiet
              on dark finishes. */}
          <group
            position={[0, 0, mmToWorld((layout.frameFrontZMm as number) + HAIRLINE_OFFSET_MM)]}
          >
            <FrameEdgeHairline
              widthMm={layout.outerWidthMm}
              heightMm={layout.outerHeightMm}
              color={FRAME_EDGE_HAIRLINE_HEX[frame.finish]}
            />
            <FrameEdgeHairline
              widthMm={layout.openingWidthMm}
              heightMm={layout.openingHeightMm}
              color={FRAME_EDGE_HAIRLINE_HEX[frame.finish]}
            />
          </group>
          {/* Wall-contact loop: the frame's footprint traced on the wall
              itself, so from an oblique angle the frame's side faces still
              end at a visible seam instead of dissolving into the wall fill.
              Mat-bevel grey (it reads against the wall, not the frame). */}
          <group position={[0, 0, mmToWorld(HAIRLINE_OFFSET_MM)]}>
            <FrameEdgeHairline
              widthMm={layout.outerWidthMm}
              heightMm={layout.outerHeightMm}
              color={MAT_BEVEL_HAIRLINE_HEX}
            />
          </group>
        </>
      ) : null}
      {layout.hasMat ? (
        // Mat: an off-white board covering the frame's inner opening (image +
        // mat band), recessed a step behind the frame's front face. Lambert so
        // it takes the scene light like a physical board.
        <mesh position={[0, 0, mmToWorld(layout.matZMm as number)]} onClick={handleClick}>
          <planeGeometry
            args={[mmToWorld(layout.openingWidthMm), mmToWorld(layout.openingHeightMm)]}
          />
          <meshLambertMaterial
            key={ghosted ? "ghosted" : "solid"}
            color={MAT_FILL_COLOR}
            transparent={ghosted}
            opacity={ghosted ? GHOST_OPACITY : 1}
            depthWrite={!ghosted}
          />
        </mesh>
      ) : null}
      <mesh
        position={[0, 0, mmToWorld(layout.imageZMm)]}
        onClick={handleClick}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <planeGeometry args={[width, height]} />
        {texture ? (
          // Always transparent so a PNG's alpha channel is honored — the wall
          // (or mat, when matted) shows through, matching the elevation view's
          // native SVG behavior. alphaTest discards fully-clear pixels so they
          // never write depth over things behind the plane.
          <meshBasicMaterial
            key={ghosted ? "ghosted" : "solid"}
            map={texture}
            toneMapped={false}
            transparent
            alphaTest={0.01}
            opacity={ghosted ? GHOST_OPACITY : 1}
            depthWrite={!ghosted}
          />
        ) : (
          <meshLambertMaterial
            key={ghosted ? "ghosted" : "solid"}
            color={PLACEHOLDER_COLOR}
            transparent={ghosted}
            opacity={ghosted ? GHOST_OPACITY : 1}
            depthWrite={!ghosted}
          />
        )}
      </mesh>
      {!ghosted && isUncertain(artwork.status) ? (
        // Outline wraps the OUTER rect (image + mat + frame), matching
        // elevation's outerRect, seated at the frame front (or image) depth.
        <group position={[0, 0, mmToWorld(layout.outlineZMm + OUTLINE_OFFSET_MM)]}>
          <DashedRectOutline
            widthMm={layout.outerWidthMm}
            heightMm={layout.outerHeightMm}
            status={artwork.status}
          />
        </group>
      ) : null}
      {!ghosted && isSelected ? (
        <group position={[0, 0, mmToWorld(layout.outlineZMm + OUTLINE_OFFSET_MM * 2)]}>
          <SelectionRectOutline
            widthMm={layout.outerWidthMm}
            heightMm={layout.outerHeightMm}
          />
        </group>
      ) : null}
    </group>
  );
}
