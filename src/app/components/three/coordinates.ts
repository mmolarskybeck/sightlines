// The single mm -> three.js world scale. Everything the 3D view draws goes
// through this so camera near/far and lighting live at sane magnitudes
// (a 4 m wall is 4 world units, not 4000). See spec §5.2.
export const MM_TO_WORLD = 0.001;

// Axis convention (spec §5.2): floor-space plan (x, y) -> three (x, z), and
// object height -> three +y. Floor-space y therefore becomes world +z.
export function mmToWorld(mm: number): number {
  return mm * MM_TO_WORLD;
}
