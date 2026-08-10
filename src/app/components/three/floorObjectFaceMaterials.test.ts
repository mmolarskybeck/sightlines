import { describe, expect, it } from "vitest";
import { BoxGeometry } from "three";
import type { FloorObjectFace } from "../../../domain/project";
import {
  BOX_MATERIAL_GROUP_FACES,
  floorObjectImageFaceFlags
} from "./floorObjectFaceMaterials";

// Deliberately unequal so a transposed axis can't pass: half-extents are
// x=1, y=2, z=3, and every face plane sits at a distinct coordinate.
const BOX_WIDTH = 2;
const BOX_HEIGHT = 4;
const BOX_DEPTH = 6;

// The domain's face -> axis mapping, restated from FloorObjectFace's doc
// comment (project.ts) rather than imported, so this file is an independent
// second statement of it: front = +z, back = -z, right = +x, left = -x,
// top = +y, bottom = -y, named from a viewer standing at the front face.
const FACE_PLANE: Record<FloorObjectFace, { axis: "x" | "y" | "z"; atWorld: number }> = {
  right: { axis: "x", atWorld: BOX_WIDTH / 2 },
  left: { axis: "x", atWorld: -BOX_WIDTH / 2 },
  top: { axis: "y", atWorld: BOX_HEIGHT / 2 },
  bottom: { axis: "y", atWorld: -BOX_HEIGHT / 2 },
  front: { axis: "z", atWorld: BOX_DEPTH / 2 },
  back: { axis: "z", atWorld: -BOX_DEPTH / 2 }
};

// Every vertex the given material group draws, read back out of the real
// geometry. BoxGeometry is INDEXED, so a group's start/count address the index
// buffer, not the position buffer directly — reading positions at the raw group
// offsets would silently sample the wrong triangles.
function groupVertices(
  geometry: BoxGeometry,
  groupIndex: number
): Array<{ x: number; y: number; z: number }> {
  const group = geometry.groups[groupIndex]!;
  const index = geometry.getIndex()!;
  const position = geometry.getAttribute("position");
  const vertices: Array<{ x: number; y: number; z: number }> = [];
  for (let i = group.start; i < group.start + group.count; i += 1) {
    const vertexIndex = index.getX(i);
    vertices.push({
      x: position.getX(vertexIndex),
      y: position.getY(vertexIndex),
      z: position.getZ(vertexIndex)
    });
  }
  return vertices;
}

describe("BOX_MATERIAL_GROUP_FACES — the three.js group order", () => {
  const geometry = new BoxGeometry(BOX_WIDTH, BOX_HEIGHT, BOX_DEPTH);

  it("has exactly one entry per material group the geometry emits", () => {
    expect(geometry.groups).toHaveLength(BOX_MATERIAL_GROUP_FACES.length);
  });

  it("assumes a material array index IS the group's materialIndex", () => {
    // `material={[m0..m5]}` only lines up with BOX_MATERIAL_GROUP_FACES because
    // BoxGeometry emits its groups in materialIndex order. If a three upgrade
    // ever emitted them shuffled, indexing the array by group ORDER would
    // still be wrong even with the face names right.
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("puts each named face's group on that face's plane", () => {
    // The load-bearing assertion of the whole feature: it fails if three
    // reorders its planes, and it fails if BOX_MATERIAL_GROUP_FACES names them
    // in any other order — including the plausible-looking front-first one.
    BOX_MATERIAL_GROUP_FACES.forEach((face, groupIndex) => {
      const plane = FACE_PLANE[face];
      const vertices = groupVertices(geometry, groupIndex);
      expect(vertices.length).toBeGreaterThan(0);
      for (const vertex of vertices) {
        expect(vertex[plane.axis], `group ${groupIndex} (${face})`).toBe(plane.atWorld);
      }
    });
  });
});

describe("floorObjectImageFaceFlags", () => {
  // Expectations are written as literal six-element arrays on purpose. Deriving
  // the expected index from BOX_MATERIAL_GROUP_FACES would make these tests
  // agree with any order the constant happened to have, which is exactly the
  // failure the suite above exists to catch.
  //                       right, left,  top,   bottom, front, back
  const NONE = [false, false, false, false, false, false];

  it("textures front + back when imageFaces is absent (the default)", () => {
    expect(floorObjectImageFaceFlags(undefined, true)).toEqual([
      false,
      false,
      false,
      false,
      true, // front, +z
      true // back, -z
    ]);
  });

  it("textures exactly the +z group for ['front']", () => {
    expect(floorObjectImageFaceFlags(["front"], true)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false
    ]);
  });

  it("textures exactly the -z group for ['back']", () => {
    expect(floorObjectImageFaceFlags(["back"], true)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true
    ]);
  });

  it("textures exactly the +x group for ['right'] and the -x group for ['left']", () => {
    // Left/right are the pair a mirrored axis mapping would swap without
    // changing anything else about how the box reads.
    expect(floorObjectImageFaceFlags(["right"], true)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false
    ]);
    expect(floorObjectImageFaceFlags(["left"], true)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false
    ]);
  });

  it("textures exactly the +y group for a floor graphic (['top'])", () => {
    expect(floorObjectImageFaceFlags(["top"], true)).toEqual([
      false,
      false,
      true,
      false,
      false,
      false
    ]);
  });

  it("textures exactly the -y group for ['bottom']", () => {
    expect(floorObjectImageFaceFlags(["bottom"], true)).toEqual([
      false,
      false,
      false,
      true,
      false,
      false
    ]);
  });

  it("textures every group when all six faces are chosen", () => {
    const all: FloorObjectFace[] = ["front", "back", "left", "right", "top", "bottom"];
    expect(floorObjectImageFaceFlags(all, true)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true
    ]);
  });

  it("leaves every group neutral for an EMPTY array — not the default", () => {
    // Empty is a deliberate choice ("all faces off"), distinct from absent.
    // Falling back to the default here would make the picker's last unchecked
    // box silently re-check itself.
    expect(floorObjectImageFaceFlags([], true)).toEqual(NONE);
  });

  it("leaves every group neutral when there is no texture, whatever the faces say", () => {
    expect(floorObjectImageFaceFlags(undefined, false)).toEqual(NONE);
    expect(floorObjectImageFaceFlags(["front", "back"], false)).toEqual(NONE);
    expect(floorObjectImageFaceFlags([], false)).toEqual(NONE);
  });

  it("ignores duplicate and unrecognised face values instead of throwing", () => {
    // A hand-edited project file, or a face name from a future version read by
    // older code. Neither may take the 3D view down.
    const faces = ["front", "front", "sideways", ""] as FloorObjectFace[];
    expect(floorObjectImageFaceFlags(faces, true)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false
    ]);
  });
});
