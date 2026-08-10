import { DEFAULT_FLOOR_OBJECT_IMAGE_FACES, type FloorObjectFace } from "../../../domain/project";
import type { SizeMm } from "./artworkFit";

// Everything about putting a floor-placed artwork's image onto its box: which
// faces carry it, how big it is, and where each image panel sits. Kept out of
// FloorObjectBox.tsx and unit-tested because it is the part of the feature that
// fails silently — a transposed axis or a swapped face still renders a
// plausible-looking box.
//
// THE SIZING RULE, in one sentence: the image is drawn at the WORK's own
// dimensions, centered on the face, and shrunk (never distorted, never
// stretched) only when the face is too small to hold it.
//
// The box's widthMm/heightMm/depthMm describe the OBJECT STANDING ON THE FLOOR
// — a projection board, a plinth, a sculpture's bounding box — and the
// artwork record's dimensions describe the WORK. Those are two different
// physical measurements that happen to coincide at placement time
// (placeArtworkOnFloor seeds the box from the artwork's effective size), and
// the moment a curator resizes the board they stop coinciding. Mapping the
// image with the box's own face UVs (the previous behavior) made the image's
// aspect ratio a function of the SUPPORT: widening a 60"x48" work's board to
// 84" stretched the image 1.4x horizontally, with no way to prevent or undo it
// short of retyping the board to match the work. Now the board just gets wider
// and 12" of bare board appears either side, which is what you would see in
// the room.

// Face -> the box's local outward axis, restated from FloorObjectFace's doc
// comment (project.ts): front = +z, back = -z, right = +x, left = -x,
// top = +y, bottom = -y, named from a viewer standing at the front face.
//
// `rotationRad` turns a PlaneGeometry (which is born in XY facing +z) to face
// outward along that axis, choosing among the several rotations that would do
// so the one whose image-up reads correctly to a viewer of that face: on the
// side faces the image's right-hand edge points the viewer's right, and on the
// top face image-up points toward the box's back. Pinned by the test suite,
// which recomputes each panel's normal and up vector from these angles rather
// than restating them.
const FACE_PLACEMENTS: Record<
  FloorObjectFace,
  {
    axis: "x" | "y" | "z";
    sign: 1 | -1;
    rotationRad: readonly [number, number, number];
  }
> = {
  front: { axis: "z", sign: 1, rotationRad: [0, 0, 0] },
  back: { axis: "z", sign: -1, rotationRad: [0, Math.PI, 0] },
  right: { axis: "x", sign: 1, rotationRad: [0, Math.PI / 2, 0] },
  left: { axis: "x", sign: -1, rotationRad: [0, -Math.PI / 2, 0] },
  top: { axis: "y", sign: 1, rotationRad: [-Math.PI / 2, 0, 0] },
  bottom: { axis: "y", sign: -1, rotationRad: [Math.PI / 2, 0, 0] }
};

// How far an image panel floats off the face it sits on, so the two coplanar
// surfaces can't z-fight. Physically invisible (1 mm at gallery scale), and
// clamped below to a quarter of the box's half-extent on that axis so a
// hairline board — a 2 mm panel is entirely plausible for a projection
// surface — can't push its front and back images through each other.
const IMAGE_PANEL_LIFT_MM = 1;

export type FloorObjectBoxSizeMm = {
  widthMm: number;
  heightMm: number;
  depthMm: number;
};

// One image quad, in the box's own local space (origin = box center, mm).
// The render layer converts to world units and mounts it inside the box's
// already-yawed group, so nothing here needs to know the object's rotation.
export type FloorImagePanel = {
  face: FloorObjectFace;
  // In-plane size of the quad: `widthMm` runs along the face's horizontal
  // axis as a viewer of that face sees it, `heightMm` along its vertical.
  widthMm: number;
  heightMm: number;
  positionMm: readonly [number, number, number];
  rotationRad: readonly [number, number, number];
};

// Which faces show the image. Returns the resolved list rather than the raw
// stored field, because three rules sit between the two — all of them cases
// the render layer would otherwise have to remember:
//   - `imageFaces` ABSENT means "never chosen" -> the front+back default. It
//     cannot be baked in at write time (ArtworkFloorObject.imageFaces), so it
//     has to be resolved here, at read time.
//   - An EMPTY array is legal and distinct from absent: every face deliberately
//     off, i.e. a neutral volume.
//   - No texture at all (missing artwork record or missing asset) -> no image
//     panels, never a broken image. This wins over `imageFaces` entirely: a
//     face the curator turned on but has no image for is still a blank box
//     face, and painting a panel with an undefined map would render black.
//
// Unknown or duplicated face strings (a hand-edited project file, a future
// face name arriving on older code) are dropped rather than thrown on, since a
// bad string in one field must not take the whole 3D view down.
export function resolveFloorObjectImageFaces(
  imageFaces: FloorObjectFace[] | undefined,
  hasTexture: boolean
): FloorObjectFace[] {
  if (!hasTexture) return [];
  const chosen = imageFaces ?? DEFAULT_FLOOR_OBJECT_IMAGE_FACES;
  // Filter the known faces BY the stored list rather than the other way round:
  // that drops unrecognised names, collapses duplicates, and hands back a
  // stable canonical order in one pass.
  return (Object.keys(FACE_PLACEMENTS) as FloorObjectFace[]).filter((face) =>
    chosen.includes(face)
  );
}

// The work's own size in mm, from the artwork record's stated dimensions plus
// (when only one axis is recorded) the texture's native pixel aspect. Mirrors
// getEffectivePlacementSizeMm's rules for the cases where an answer exists,
// and returns undefined rather than that function's placeholder box when
// neither axis is known — "we don't know how big this work is" has to stay
// distinguishable here, because the caller's fallback (contain the image in
// the face, exactly as a wall-hung unknown-dimension work does — see
// fitArtworkImageSizeMm) is better than a fabricated size.
export function floorArtworkWorkSizeMm(
  statedWidthMm: number | undefined,
  statedHeightMm: number | undefined,
  nativeAspect: number | undefined
): SizeMm | undefined {
  const width = isPositive(statedWidthMm) ? statedWidthMm : undefined;
  const height = isPositive(statedHeightMm) ? statedHeightMm : undefined;

  if (width !== undefined && height !== undefined) {
    // A curator's real numbers always win, even an off-ratio pair — same rule
    // getEffectivePlacementSizeMm follows, and for the same reason: a work's
    // recorded dimensions are not obliged to match its photograph's crop.
    return { widthMm: width, heightMm: height };
  }

  const aspect = isPositive(nativeAspect) ? nativeAspect : undefined;
  if (aspect === undefined) return undefined;
  if (width !== undefined) return { widthMm: width, heightMm: width / aspect };
  if (height !== undefined) return { widthMm: height * aspect, heightMm: height };
  return undefined;
}

// The image panels to draw on a box, one per chosen face.
//
// `workSizeMm` is the work's real size (floorArtworkWorkSizeMm). When it is
// known the panel is drawn at exactly that size, shrunk uniformly only if the
// face can't hold it — so a board bigger than the work shows bare board around
// the image, and a board smaller than the work shows the whole image scaled
// down rather than a crop or a squash.
//
// When it is not known we fall back to `nativeAspect`, containing the image in
// the face the way a wall-hung unknown-dimension work is contained in its
// placeholder rect; and with neither (texture still loading) the panel simply
// fills the face, which is what this code did before it could do better.
export function floorObjectImagePanels(
  box: FloorObjectBoxSizeMm,
  faces: FloorObjectFace[],
  workSizeMm: SizeMm | undefined,
  nativeAspect: number | undefined
): FloorImagePanel[] {
  const panels: FloorImagePanel[] = [];

  for (const face of faces) {
    const placement = FACE_PLACEMENTS[face];
    if (!placement) continue;

    const faceSize = faceSizeMm(box, face);
    if (faceSize.widthMm <= 0 || faceSize.heightMm <= 0) continue;

    const size = imagePanelSizeMm(faceSize, workSizeMm, nativeAspect);
    if (size.widthMm <= 0 || size.heightMm <= 0) continue;

    const halfExtentMm = boxHalfExtentMm(box, placement.axis);
    const liftMm = Math.min(IMAGE_PANEL_LIFT_MM, halfExtentMm / 4);
    const offsetMm = placement.sign * (halfExtentMm + liftMm);

    panels.push({
      face,
      widthMm: size.widthMm,
      heightMm: size.heightMm,
      positionMm: [
        placement.axis === "x" ? offsetMm : 0,
        placement.axis === "y" ? offsetMm : 0,
        placement.axis === "z" ? offsetMm : 0
      ],
      rotationRad: placement.rotationRad
    });
  }

  return panels;
}

// A face's in-plane extents, read off the box: the two axes that are NOT the
// face's outward normal. Which of them is "horizontal" is the viewer's reading
// of that face, matching FACE_PLACEMENTS' rotations.
export function faceSizeMm(box: FloorObjectBoxSizeMm, face: FloorObjectFace): SizeMm {
  switch (FACE_PLACEMENTS[face].axis) {
    case "z": // front / back: across the width, up the height
      return { widthMm: box.widthMm, heightMm: box.heightMm };
    case "x": // left / right: across the depth, up the height
      return { widthMm: box.depthMm, heightMm: box.heightMm };
    default: // top / bottom: across the width, "up" the depth
      return { widthMm: box.widthMm, heightMm: box.depthMm };
  }
}

function boxHalfExtentMm(box: FloorObjectBoxSizeMm, axis: "x" | "y" | "z"): number {
  const extentMm =
    axis === "x" ? box.widthMm : axis === "y" ? box.heightMm : box.depthMm;
  return Math.max(0, extentMm) / 2;
}

function imagePanelSizeMm(
  faceSize: SizeMm,
  workSizeMm: SizeMm | undefined,
  nativeAspect: number | undefined
): SizeMm {
  if (workSizeMm && workSizeMm.widthMm > 0 && workSizeMm.heightMm > 0) {
    // True size, shrunk to fit. `Math.min(1, …)` is the whole rule: a face
    // roomier than the work leaves the image alone.
    const scale = Math.min(
      1,
      faceSize.widthMm / workSizeMm.widthMm,
      faceSize.heightMm / workSizeMm.heightMm
    );
    return { widthMm: workSizeMm.widthMm * scale, heightMm: workSizeMm.heightMm * scale };
  }

  if (isPositive(nativeAspect)) {
    // Unknown work size: contain the native image aspect in the face, the same
    // letterbox/pillarbox treatment fitArtworkImageSizeMm gives an
    // unknown-dimension wall work.
    const faceAspect = faceSize.widthMm / faceSize.heightMm;
    return nativeAspect > faceAspect
      ? { widthMm: faceSize.widthMm, heightMm: faceSize.widthMm / nativeAspect }
      : { widthMm: faceSize.heightMm * nativeAspect, heightMm: faceSize.heightMm };
  }

  return faceSize;
}

function isPositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}
