import { describe, expect, it } from "vitest";
import { Euler, Vector3 } from "three";
import type { FloorObjectFace } from "../../../domain/project";
import {
  faceSizeMm,
  floorArtworkWorkSizeMm,
  floorObjectImagePanels,
  resolveFloorObjectImageFaces,
  type FloorImagePanel
} from "./floorObjectImageFaces";

// Deliberately unequal so a transposed axis can't pass: half-extents are
// x=1000, y=2000, z=3000, and every face plane sits at a distinct coordinate.
const BOX = { widthMm: 2000, heightMm: 4000, depthMm: 6000 };

const ALL_FACES: FloorObjectFace[] = ["front", "back", "left", "right", "top", "bottom"];

// The domain's face -> outward-normal mapping, restated from FloorObjectFace's
// doc comment (project.ts) rather than imported, so this file is an independent
// second statement of it: front = +z, back = -z, right = +x, left = -x,
// top = +y, bottom = -y, named from a viewer standing at the front face.
const FACE_NORMAL: Record<FloorObjectFace, [number, number, number]> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0]
};

// Where each face's plane sits along its own axis.
const FACE_PLANE_MM: Record<FloorObjectFace, number> = {
  right: BOX.widthMm / 2,
  left: -BOX.widthMm / 2,
  top: BOX.heightMm / 2,
  bottom: -BOX.heightMm / 2,
  front: BOX.depthMm / 2,
  back: -BOX.depthMm / 2
};

// Recompute a panel's orientation from its Euler angles instead of restating
// the angles: a PlaneGeometry is born in XY facing +z, so rotating its three
// local basis vectors answers "where does this quad face, and which way is the
// image's up/right" independently of how FACE_PLACEMENTS spells it.
function panelBasis(panel: FloorImagePanel) {
  const euler = new Euler(...panel.rotationRad, "XYZ");
  return {
    normal: new Vector3(0, 0, 1).applyEuler(euler),
    up: new Vector3(0, 1, 0).applyEuler(euler),
    right: new Vector3(1, 0, 0).applyEuler(euler)
  };
}

function expectVector(actual: Vector3, expected: [number, number, number], hint: string) {
  expect(actual.x, `${hint} x`).toBeCloseTo(expected[0], 10);
  expect(actual.y, `${hint} y`).toBeCloseTo(expected[1], 10);
  expect(actual.z, `${hint} z`).toBeCloseTo(expected[2], 10);
}

function panelsByFace(panels: FloorImagePanel[]): Map<FloorObjectFace, FloorImagePanel> {
  return new Map(panels.map((panel) => [panel.face, panel]));
}

describe("resolveFloorObjectImageFaces", () => {
  it("resolves an ABSENT imageFaces to the front+back default", () => {
    expect(resolveFloorObjectImageFaces(undefined, true).sort()).toEqual(["back", "front"]);
  });

  it("resolves an EMPTY array to no faces — not the default", () => {
    // Empty is a deliberate choice ("all faces off"), distinct from absent.
    // Falling back to the default here would make the picker's last unchecked
    // box silently re-check itself.
    expect(resolveFloorObjectImageFaces([], true)).toEqual([]);
  });

  it("resolves to no faces when there is no texture, whatever the faces say", () => {
    expect(resolveFloorObjectImageFaces(undefined, false)).toEqual([]);
    expect(resolveFloorObjectImageFaces(["front", "back"], false)).toEqual([]);
    expect(resolveFloorObjectImageFaces([], false)).toEqual([]);
  });

  it("keeps exactly the chosen faces", () => {
    expect(resolveFloorObjectImageFaces(["top"], true)).toEqual(["top"]);
    expect(resolveFloorObjectImageFaces(["left"], true)).toEqual(["left"]);
    expect(resolveFloorObjectImageFaces(["right"], true)).toEqual(["right"]);
    expect(resolveFloorObjectImageFaces(ALL_FACES, true).sort()).toEqual([...ALL_FACES].sort());
  });

  it("drops duplicate and unrecognised face values instead of throwing", () => {
    // A hand-edited project file, or a face name from a future version read by
    // older code. Neither may take the 3D view down.
    const faces = ["front", "front", "sideways", ""] as FloorObjectFace[];
    expect(resolveFloorObjectImageFaces(faces, true)).toEqual(["front"]);
  });
});

describe("floorObjectImagePanels — placement", () => {
  // A work exactly the size of the front face, so sizing never interferes with
  // the orientation assertions below.
  const panels = panelsByFace(
    floorObjectImagePanels(BOX, ALL_FACES, { widthMm: 1, heightMm: 1 }, undefined)
  );

  it("emits one panel per chosen face", () => {
    expect(panels.size).toBe(6);
  });

  it("faces each panel outward along its own face's normal", () => {
    // The load-bearing assertion of the whole feature: it fails if a rotation
    // points a panel into the box, and it fails if two faces are swapped.
    for (const face of ALL_FACES) {
      expectVector(panelBasis(panels.get(face)!).normal, FACE_NORMAL[face], `${face} normal`);
    }
  });

  it("sits each panel just outside its own face's plane", () => {
    for (const face of ALL_FACES) {
      const panel = panels.get(face)!;
      const normal = FACE_NORMAL[face];
      const axis = normal.findIndex((component) => component !== 0);
      const along = panel.positionMm[axis]!;
      const plane = FACE_PLANE_MM[face];

      // Same side of the box as the face, and strictly further out than the
      // face itself (the anti-z-fight lift) but not by a visible amount.
      expect(Math.sign(along), `${face} side`).toBe(Math.sign(plane));
      expect(Math.abs(along), `${face} outside the face`).toBeGreaterThan(Math.abs(plane));
      expect(Math.abs(along) - Math.abs(plane), `${face} lift`).toBeLessThanOrEqual(1);

      // And flat against it: no offset on the other two axes.
      panel.positionMm.forEach((component, index) => {
        if (index !== axis) expect(component, `${face} axis ${index}`).toBe(0);
      });
    }
  });

  it("keeps the image upright on the four vertical faces", () => {
    for (const face of ["front", "back", "left", "right"] as FloorObjectFace[]) {
      expectVector(panelBasis(panels.get(face)!).up, [0, 1, 0], `${face} up`);
    }
  });

  it("points the image's right edge to the viewer's right on every vertical face", () => {
    // A viewer of a face stands outside it looking in, so their right hand is
    // (forward x up) with forward = -normal. Left and right are the pair a
    // mirrored rotation would swap without changing anything else about how
    // the box reads.
    for (const face of ["front", "back", "left", "right"] as FloorObjectFace[]) {
      const forward = new Vector3(...FACE_NORMAL[face]).negate();
      const viewerRight = forward.clone().cross(new Vector3(0, 1, 0));
      expectVector(
        panelBasis(panels.get(face)!).right,
        [viewerRight.x, viewerRight.y, viewerRight.z],
        `${face} right`
      );
    }
  });

  it("points a floor graphic's image-up toward the box's back", () => {
    // Looking down at the top face with the object's front nearer you, "up" in
    // the image should read away from you.
    expectVector(panelBasis(panels.get("top")!).up, [0, 0, -1], "top up");
    expectVector(panelBasis(panels.get("bottom")!).up, [0, 0, 1], "bottom up");
  });

  it("clamps the lift on a hairline board so front and back can't cross", () => {
    // A 2 mm projection panel: half-extent 1 mm, so a flat 1 mm lift would put
    // the front image at z=2 and the back at z=-2 — through each other's face.
    const thin = floorObjectImagePanels(
      { widthMm: 2000, heightMm: 1000, depthMm: 2 },
      ["front", "back"],
      { widthMm: 1, heightMm: 1 },
      undefined
    );
    const byFace = panelsByFace(thin);
    expect(byFace.get("front")!.positionMm[2]).toBeCloseTo(1.25, 10);
    expect(byFace.get("back")!.positionMm[2]).toBeCloseTo(-1.25, 10);
  });

  it("emits nothing for a face with no area", () => {
    expect(floorObjectImagePanels({ ...BOX, depthMm: 0 }, ["left"], undefined, 1)).toEqual([]);
  });
});

describe("faceSizeMm", () => {
  it("reads each face's two in-plane axes off the box", () => {
    expect(faceSizeMm(BOX, "front")).toEqual({ widthMm: 2000, heightMm: 4000 });
    expect(faceSizeMm(BOX, "back")).toEqual({ widthMm: 2000, heightMm: 4000 });
    expect(faceSizeMm(BOX, "left")).toEqual({ widthMm: 6000, heightMm: 4000 });
    expect(faceSizeMm(BOX, "right")).toEqual({ widthMm: 6000, heightMm: 4000 });
    expect(faceSizeMm(BOX, "top")).toEqual({ widthMm: 2000, heightMm: 6000 });
    expect(faceSizeMm(BOX, "bottom")).toEqual({ widthMm: 2000, heightMm: 6000 });
  });
});

describe("floorArtworkWorkSizeMm", () => {
  it("takes both stated axes verbatim, even an off-ratio pair", () => {
    // A work's recorded dimensions are not obliged to match its photograph's
    // crop — mats, frames and documentation shots all break the ratio.
    expect(floorArtworkWorkSizeMm(1524, 1219, 2)).toEqual({ widthMm: 1524, heightMm: 1219 });
  });

  it("derives the missing axis from the native aspect", () => {
    expect(floorArtworkWorkSizeMm(1000, undefined, 1.25)).toEqual({
      widthMm: 1000,
      heightMm: 800
    });
    expect(floorArtworkWorkSizeMm(undefined, 800, 1.25)).toEqual({
      widthMm: 1000,
      heightMm: 800
    });
  });

  it("is undefined when nothing is knowable, rather than a fabricated size", () => {
    expect(floorArtworkWorkSizeMm(undefined, undefined, 1.25)).toBeUndefined();
    expect(floorArtworkWorkSizeMm(1000, undefined, undefined)).toBeUndefined();
    expect(floorArtworkWorkSizeMm(undefined, undefined, undefined)).toBeUndefined();
  });

  it("ignores non-positive and non-finite values", () => {
    expect(floorArtworkWorkSizeMm(0, 800, undefined)).toBeUndefined();
    expect(floorArtworkWorkSizeMm(-10, -20, undefined)).toBeUndefined();
    expect(floorArtworkWorkSizeMm(1000, undefined, Number.NaN)).toBeUndefined();
  });
});

describe("floorObjectImagePanels — sizing", () => {
  // The reported bug, in numbers: a 60" x 48" work on a board widened to 7'.
  const WORK = { widthMm: 1524, heightMm: 1219.2 };
  const BOARD = { widthMm: 2133.6, heightMm: 1219.2, depthMm: 25.4 };

  it("draws the work at its own size on a board wider than the work", () => {
    const [panel] = floorObjectImagePanels(BOARD, ["front"], WORK, 1.25);
    expect(panel!.widthMm).toBeCloseTo(1524, 6);
    expect(panel!.heightMm).toBeCloseTo(1219.2, 6);
  });

  it("does not change the image's aspect when only the board's width changes", () => {
    const narrow = floorObjectImagePanels({ ...BOARD, widthMm: 1600 }, ["front"], WORK, 1.25);
    const wide = floorObjectImagePanels({ ...BOARD, widthMm: 4000 }, ["front"], WORK, 1.25);
    const aspect = (panel: FloorImagePanel) => panel.widthMm / panel.heightMm;
    expect(aspect(narrow[0]!)).toBeCloseTo(aspect(wide[0]!), 10);
    expect(aspect(wide[0]!)).toBeCloseTo(WORK.widthMm / WORK.heightMm, 10);
  });

  it("fills the face exactly when the board is the work's size (the untouched case)", () => {
    const [panel] = floorObjectImagePanels(
      { widthMm: WORK.widthMm, heightMm: WORK.heightMm, depthMm: 25.4 },
      ["front"],
      WORK,
      1.25
    );
    expect(panel!.widthMm).toBeCloseTo(WORK.widthMm, 6);
    expect(panel!.heightMm).toBeCloseTo(WORK.heightMm, 6);
  });

  it("shrinks uniformly — never crops, never squashes — when the face is too small", () => {
    const [panel] = floorObjectImagePanels(
      { widthMm: 762, heightMm: 1219.2, depthMm: 25.4 },
      ["front"],
      WORK,
      1.25
    );
    // Width-bound: half the work's width, so half its height too.
    expect(panel!.widthMm).toBeCloseTo(762, 6);
    expect(panel!.heightMm).toBeCloseTo(609.6, 6);
  });

  it("contains the native aspect in the face when the work's size is unknown", () => {
    // Mirrors fitArtworkImageSizeMm's letterbox treatment of an
    // unknown-dimension wall work: a 2:1 image in a 1:1 face is width-bound.
    const [panel] = floorObjectImagePanels(
      { widthMm: 1000, heightMm: 1000, depthMm: 25 },
      ["front"],
      undefined,
      2
    );
    expect(panel!.widthMm).toBeCloseTo(1000, 6);
    expect(panel!.heightMm).toBeCloseTo(500, 6);
  });

  it("fills the face while the texture is still loading (no size, no aspect)", () => {
    const [panel] = floorObjectImagePanels(BOARD, ["front"], undefined, undefined);
    expect(panel!.widthMm).toBeCloseTo(BOARD.widthMm, 6);
    expect(panel!.heightMm).toBeCloseTo(BOARD.heightMm, 6);
  });

  it("shrinks the work onto a thin side face rather than smearing it across", () => {
    // The reason front+back is the default: a 1" edge has no honest reading of
    // a 60"-wide work, but a shrunken undistorted image beats a stretched one.
    const [panel] = floorObjectImagePanels(BOARD, ["right"], WORK, 1.25);
    expect(panel!.widthMm).toBeCloseTo(25.4, 6);
    expect(panel!.heightMm).toBeCloseTo(25.4 / (WORK.widthMm / WORK.heightMm), 6);
  });
});
