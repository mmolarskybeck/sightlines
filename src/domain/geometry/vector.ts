// Shared 2D vector primitives (mm units). Several modules — editRoom.ts,
// reshapeRoom.ts, scene3d.ts, dragResize.ts — currently reimplement a subset
// of these locally; this module is the consolidation point for a follow-up
// migration. Semantics here are matched to the existing private
// implementations so that migration is a drop-in swap, not a behavior change.

export type Vector2 = {
  xMm: number;
  yMm: number;
};

export function add(a: Vector2, b: Vector2): Vector2 {
  return { xMm: a.xMm + b.xMm, yMm: a.yMm + b.yMm };
}

export function subtract(a: Vector2, b: Vector2): Vector2 {
  return { xMm: a.xMm - b.xMm, yMm: a.yMm - b.yMm };
}

export function scale(v: Vector2, s: number): Vector2 {
  return { xMm: v.xMm * s, yMm: v.yMm * s };
}

export function vectorLength(v: Vector2): number {
  return Math.hypot(v.xMm, v.yMm);
}

export function distance(a: Vector2, b: Vector2): number {
  return vectorLength(subtract(b, a));
}

// Same zero-length policy as editRoom.ts's and reshapeRoom.ts's private
// normalize() helpers (which throw "Cannot resize a zero-length wall." and
// "Cannot move a zero-length wall." respectively): a zero-length input has no
// direction, so silently returning (0, 0) would hide a degenerate geometry
// bug rather than surface it. This shared version throws a generic,
// context-free message; call sites that migrate to it and want a
// domain-specific message should catch and rethrow with their own text.
export function normalize(v: Vector2): Vector2 {
  const length = vectorLength(v);
  if (length === 0) {
    throw new Error("Cannot normalize a zero-length vector.");
  }
  return { xMm: v.xMm / length, yMm: v.yMm / length };
}

export function dot(a: Vector2, b: Vector2): number {
  return a.xMm * b.xMm + a.yMm * b.yMm;
}

// z-component of a × b (both treated as 3D vectors with z = 0).
export function cross(a: Vector2, b: Vector2): number {
  return a.xMm * b.yMm - a.yMm * b.xMm;
}

export function midpoint(a: Vector2, b: Vector2): Vector2 {
  return { xMm: (a.xMm + b.xMm) / 2, yMm: (a.yMm + b.yMm) / 2 };
}

// Unit left normal of the directed segment from -> to: rotate(to - from,
// +90°) = (-dy, dx), then normalize. This is the codebase's standing
// convention — see scene3d.ts's wallInwardNormal (~line 162-168), which
// computes exactly `{ xMm: -dy / length, yMm: dx / length }`, and
// editRoom.ts's chooseSideDirection, which uses the unnormalized
// `{ xMm: -axis.yMm, yMm: axis.xMm }` as its normal candidate. For a segment
// pointing +x (dx=1, dy=0), the left normal is (0, +1).
//
// Throws on coincident points (zero-length segment), same as normalize().
export function unitLeftNormal(from: Vector2, to: Vector2): Vector2 {
  const axis = subtract(to, from);
  const length = vectorLength(axis);
  if (length === 0) {
    throw new Error("Cannot compute a normal for a zero-length segment.");
  }
  return { xMm: -axis.yMm / length, yMm: axis.xMm / length };
}

// Non-throwing variant for renderers and derivations that must tolerate
// degenerate segments (schema-invalid but possible mid-gesture or in
// hand-edited data): coincident points yield the zero vector, matching the
// `|| 1` / conditional guards the call sites used before consolidation.
export function unitLeftNormalOrZero(from: Vector2, to: Vector2): Vector2 {
  const axis = subtract(to, from);
  const length = vectorLength(axis);
  if (length === 0) return { xMm: 0, yMm: 0 };
  return { xMm: -axis.yMm / length, yMm: axis.xMm / length };
}

// The point `distanceMm` along a UNIT direction from `origin`. Callers own the
// unit-length contract (directions here come from normalized wall axes);
// passing an unnormalized direction scales the distance silently.
export function pointAlong(origin: Vector2, direction: Vector2, distanceMm: number): Vector2 {
  return add(origin, scale(direction, distanceMm));
}

// Signed distance of `point` along a UNIT `axis` anchored at `origin` — the
// scalar projection used to express floor-space points in wall-local x.
export function projectScalar(point: Vector2, origin: Vector2, axis: Vector2): number {
  return dot(subtract(point, origin), axis);
}

// Perpendicular distance from `point` to the infinite line through
// `lineOrigin` along UNIT `lineDirection` (|cross| of the offset against the
// direction).
export function pointToLineDistance(
  point: Vector2,
  lineOrigin: Vector2,
  lineDirection: Vector2
): number {
  return Math.abs(cross(lineDirection, subtract(point, lineOrigin)));
}
