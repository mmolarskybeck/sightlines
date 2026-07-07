// Clamps a value to a range [min, max], returning the input unchanged if it
// falls within bounds, otherwise the nearer boundary. This is the core math
// for keeping dragged panel widths, zoom levels, and other one-dimensional
// user inputs within acceptable bounds.
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
