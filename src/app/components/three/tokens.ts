// Color tokens for three.js materials. These mirror the CSS custom properties
// in styles/global.css since three.js materials cannot resolve CSS variables.
// When updating the design system colors, keep these in sync with the CSS values.

// ============================================================================
// Wall surfaces
// ============================================================================

// Near-white wall — MeshLambertMaterial so the single directional light shades
// adjacent walls slightly differently and the room reads as volume (spec §6.2).
export const WALL_COLOR = "#f4f2ef";

// Selection may tint untextured surfaces (spec §4.3): the selected wall gets a
// whisper of the selection petrol.
export const WALL_SELECTED_COLOR = "#e4edee";

// ============================================================================
// Floor surfaces
// ============================================================================

// Matte warm-grey floor (spec §5.3). MeshLambertMaterial so it takes the light.
export const FLOOR_COLOR = "#e8e4de";

// ============================================================================
// Floor objects (artwork pedestals, blocked zones)
// ============================================================================

// Neutral matte volume — deliberately not textured (spec §5.3): draping an
// image over a pedestal box misleads more than it informs.
export const BOX_COLOR = "#dbd8d2";

// Neutral placeholder for artworks whose image is missing or still loading —
// a shade between the wall white and the floor grey so it reads as "a work
// goes here" rather than a hole in the wall.
export const PLACEHOLDER_COLOR = "#e7e4df";

// ============================================================================
// Blocked zones (planning annotations, not physical)
// ============================================================================

// Wall blocked zones and floor blocked zones are planning annotations, not
// physical (spec §5.3): a translucent wash in the same subdued grey family
// as the 2D hatch.
export const BLOCKED_ZONE_COLOR = "#565b60";

// ============================================================================
// Uncertainty and selection indicators
// ============================================================================

// Dashed outline for dimension uncertainty (approximate).
export const APPROXIMATE_COLOR = "#8a6210"; // ≈ --caution   oklch(0.5 0.13 75)

// Dashed outline for dimension uncertainty (unknown/dangerous).
export const UNKNOWN_COLOR = "#b03a28"; // ≈ --danger    oklch(0.53 0.18 28)

// Solid accent stroke for selection in three.js views. Selection never tints
// an artwork's image texture (spec §4.3) — it's outline-only on textured planes.
export const SELECTION_COLOR = "#1d7e8c"; // ≈ --selection oklch(0.55 0.11 200)
