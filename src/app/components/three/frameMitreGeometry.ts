import { ExtrudeGeometry, Shape } from "three";
import { mmToWorld } from "./coordinates";
import type { FramingLayout } from "./framingGeometry";

// Mitred frame ring for the 3D view: four trapezoid prisms (one per side)
// whose slanted ends meet at 45° seams, matching both a real molding's mitre
// joints and the elevation renderer's trapezoid bands. Extruded from the wall
// plane (z = 0) to the frame's front face (z = frameDepthMm), so the caller
// mounts them in the wall-local artwork group with NO z offset — unlike the
// old centered boxes.
//
// Each bar's UVs are rewritten in band terms — u along the bar's length,
// v 0..1 across the band — so all four bars sample one shared finish texture
// (frameFinishTextures) with its grain/brushing running lengthwise on every
// side; the direction change at each seam is what makes the mitre read. Side
// faces inherit the mapping by position, giving them plausible material
// rather than a stretched smear.
export function mitredFrameBarGeometries(layout: FramingLayout): ExtrudeGeometry[] {
  const ow2 = mmToWorld(layout.outerWidthMm) / 2;
  const oh2 = mmToWorld(layout.outerHeightMm) / 2;
  const iw2 = mmToWorld(layout.openingWidthMm) / 2;
  const ih2 = mmToWorld(layout.openingHeightMm) / 2;
  const depth = mmToWorld(layout.frameDepthMm);
  const bandY = oh2 - ih2;
  const bandX = ow2 - iw2;

  const bars: {
    points: [number, number][];
    toUv: (x: number, y: number) => [number, number];
  }[] = [
    // top
    {
      points: [
        [-ow2, oh2],
        [ow2, oh2],
        [iw2, ih2],
        [-iw2, ih2]
      ],
      toUv: (x, y) => [(x + ow2) / (2 * ow2), (y - ih2) / bandY]
    },
    // bottom
    {
      points: [
        [-ow2, -oh2],
        [-iw2, -ih2],
        [iw2, -ih2],
        [ow2, -oh2]
      ],
      toUv: (x, y) => [(x + ow2) / (2 * ow2), (y + oh2) / bandY]
    },
    // left
    {
      points: [
        [-ow2, oh2],
        [-iw2, ih2],
        [-iw2, -ih2],
        [-ow2, -oh2]
      ],
      toUv: (x, y) => [(y + oh2) / (2 * oh2), (x + ow2) / bandX]
    },
    // right
    {
      points: [
        [ow2, oh2],
        [ow2, -oh2],
        [iw2, -ih2],
        [iw2, ih2]
      ],
      toUv: (x, y) => [(y + oh2) / (2 * oh2), (x - iw2) / bandX]
    }
  ];

  return bars.map(({ points, toUv }) => {
    const shape = new Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
    shape.closePath();

    const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    for (let i = 0; i < position.count; i++) {
      const [u, v] = toUv(position.getX(i), position.getY(i));
      uv.setXY(i, u, v);
    }
    uv.needsUpdate = true;
    return geometry;
  });
}
