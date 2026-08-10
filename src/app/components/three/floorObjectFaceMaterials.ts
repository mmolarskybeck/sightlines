import { DEFAULT_FLOOR_OBJECT_IMAGE_FACES, type FloorObjectFace } from "../../../domain/project";

// The seam between the domain's face NAMES (FloorObjectFace, project.ts) and
// three.js's material-group ORDER for a BoxGeometry. Kept out of
// FloorObjectBox.tsx and unit-tested because it is the one part of the feature
// that fails silently: get the order wrong and the image lands on the wrong
// faces, which still looks like a plausible box.

// Index -> face, matching the six material groups BoxGeometry emits, in the
// order it emits them.
//
// TRAP: this order is `+x, -x, +y, -y, +z, -z` — NOT the intuitive
// front/back/left/right reading order, and NOT the order the picker lists the
// faces in. It comes from BoxGeometry's own buildPlane calls (three/src/
// geometries/BoxGeometry.js: px, nx, py, ny, pz, nz, material indices 0..5).
// The domain's axis mapping (front = +z, right = +x, top = +y — see
// FloorObjectFace) then names each group. Both halves are pinned by a test
// that reads the real geometry's groups back out of the position buffer, so a
// three upgrade that reordered the planes would fail rather than quietly
// rotate every curator's image onto the sides of the box.
export const BOX_MATERIAL_GROUP_FACES: readonly FloorObjectFace[] = [
  "right", // 0: +x
  "left", // 1: -x
  "top", // 2: +y
  "bottom", // 3: -y
  "front", // 4: +z
  "back" // 5: -z
];

// Which of the box's six material groups carry the artwork image. Indexed by
// material-group index, so `flags[i]` answers "is the material at
// `material-${i}` the textured one" directly — the render layer does no
// face-name lookup of its own.
//
// The three rules this owns, all of them cases the render layer would
// otherwise have to remember:
//   - `imageFaces` ABSENT means "never chosen" -> the front+back default. It
//     cannot be baked in at write time (ArtworkFloorObject.imageFaces), so it
//     has to be resolved here, at read time.
//   - An EMPTY array is legal and distinct from absent: every face deliberately
//     off, i.e. a neutral volume.
//   - No texture at all (missing artwork record or missing asset) -> every face
//     neutral, never a broken image. This wins over `imageFaces` entirely: a
//     face the curator turned on but has no image for is still a blank box
//     face, and painting it with an undefined map would render black.
//
// Unknown or duplicated face strings (a hand-edited project file, a future
// face name arriving on older code) simply never match a group — they are
// ignored rather than throwing, since a bad string in one field must not take
// the whole 3D view down.
export function floorObjectImageFaceFlags(
  imageFaces: FloorObjectFace[] | undefined,
  hasTexture: boolean
): boolean[] {
  if (!hasTexture) return BOX_MATERIAL_GROUP_FACES.map(() => false);
  const faces = imageFaces ?? DEFAULT_FLOOR_OBJECT_IMAGE_FACES;
  // `includes` over an array of at most six entries, per face: 36 string
  // compares at the absolute worst, cheaper than building a Set.
  return BOX_MATERIAL_GROUP_FACES.map((face) => faces.includes(face));
}
