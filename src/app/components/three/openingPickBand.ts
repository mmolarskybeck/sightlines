// Where the invisible click target for an OPEN (uncapped) opening goes.
//
// An open doorway is a real hole punched through the wall mesh (WallPanel's
// ShapeGeometry, spec §5.3): there is no surface in it, so there is nothing to
// click, and a doorway — a placed object with its own inspector — was the one
// drawn thing in the 3D view that could not be selected in the 3D view.
//
// THE RULE, and the reason this is a band rather than a plane: the CENTER of an
// open doorway is deliberately left click-through. You look through a doorway
// at the next room, and a work hanging on the wall beyond it has to stay
// directly clickable — filling the aperture with a pick plane would put an
// invisible sheet of glass in front of every one of them. So the target hugs
// the INSIDE edge of the opening, where the only thing behind it is the jamb.
//
// Pure geometry, kept out of WallPanel.tsx and unit-tested, because this is the
// kind of thing that fails silently: a transposed axis or a band grown outward
// instead of inward still renders as nothing at all (the band is invisible by
// construction) and the only symptom is a click that does the wrong thing.

// Band thickness, in millimetres of real wall. Sized to be comfortably
// clickable at ordinary room distance — a standard 900mm doorway gives up
// ~13% of its width to the two verticals — while leaving the great majority of
// the aperture see-through AND click-through (see the rule above).
export const OPENING_PICK_BAND_WIDTH_MM = 60;

// One band segment, wall-local and center-anchored — the form WallPanel's
// meshes want (position + planeGeometry args), so the render layer does no
// arithmetic of its own.
export type PickBandRect = {
  centerXMm: number;
  centerYMm: number;
  widthMm: number;
  heightMm: number;
};

// The band as up to four segments, all strictly INSIDE the hole's bounds.
//
// Horizontals span the full width and verticals fill only the height between
// them, so the corners aren't covered twice — the same ring construction
// ArtworkPlane uses for a frame's four bars, for the same reason (overlapping
// meshes at a corner are two hits at one depth, i.e. an arbitrary winner).
//
// The band is clamped to half the hole on each axis, so a pathologically small
// opening (a wall-bounds-clamped sliver) degenerates to a fully-covered target
// rather than to segments that overshoot their own hole. A sliver has no
// see-through middle worth preserving anyway.
export function openingPickBandRects(
  hole: { xMinMm: number; xMaxMm: number; yMinMm: number; yMaxMm: number },
  bandWidthMm: number = OPENING_PICK_BAND_WIDTH_MM
): PickBandRect[] {
  const widthMm = hole.xMaxMm - hole.xMinMm;
  const heightMm = hole.yMaxMm - hole.yMinMm;
  // A degenerate hole is dropped by the derivation before it ever reaches the
  // render layer (scene3d.ts refuses to punch one), but a zero-area pick target
  // is worse than none — it would be an un-hittable mesh in the scene graph.
  if (widthMm <= 0 || heightMm <= 0) return [];

  const bandMm = Math.min(bandWidthMm, widthMm / 2, heightMm / 2);
  if (bandMm <= 0) return [];

  const centerXMm = (hole.xMinMm + hole.xMaxMm) / 2;
  const rects: PickBandRect[] = [
    { centerXMm, centerYMm: hole.yMinMm + bandMm / 2, widthMm, heightMm: bandMm },
    { centerXMm, centerYMm: hole.yMaxMm - bandMm / 2, widthMm, heightMm: bandMm }
  ];

  const innerHeightMm = heightMm - 2 * bandMm;
  if (innerHeightMm > 0) {
    const centerYMm = (hole.yMinMm + hole.yMaxMm) / 2;
    rects.push(
      {
        centerXMm: hole.xMinMm + bandMm / 2,
        centerYMm,
        widthMm: bandMm,
        heightMm: innerHeightMm
      },
      {
        centerXMm: hole.xMaxMm - bandMm / 2,
        centerYMm,
        widthMm: bandMm,
        heightMm: innerHeightMm
      }
    );
  }

  return rects;
}
