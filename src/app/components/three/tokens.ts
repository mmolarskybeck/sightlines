// Color tokens for three.js materials. These mirror the CSS custom properties
// in styles/global.css since three.js materials cannot resolve CSS variables.
// When updating the design system colors, keep these in sync with the CSS values.

// ============================================================================
// Wall surfaces
// ============================================================================

// Near-white wall — MeshLambertMaterial so the single directional light shades
// adjacent walls slightly differently and the room reads as volume (spec §6.2).
// Kept just off pure white (~0.966 lightness) so a lit face and a shadowed one
// still separate against each other and against the grey ground; the value
// scheme is white walls on a quiet grey ground, not the inverse.
export const WALL_COLOR = "#f5f6f7";

// Selection may tint untextured surfaces (spec §4.3): the selected wall gets a
// whisper of the selection petrol.
export const WALL_SELECTED_COLOR = "#e4edee";

// Recessed backing for an opening that is not a geometrically aligned pair.
// Door caps stay neutral; window caps use a quiet cool tint so the aperture
// reads as glazing/blocked sightline rather than a portal.
export const OPENING_CAP_COLOR = "#d2d5d8";
export const WINDOW_CAP_COLOR = "#b9d5d8";

// ============================================================================
// Scene ground / background
// ============================================================================

// The 3D viewport's own ground: a quiet cool grey the WebGL scene clears to,
// so near-white walls read as lit volumes sitting on a calm grey rather than
// dissolving into a white void. Set as the three.js scene background (the
// surrounding workspace chrome stays white — this is the viewport's ground,
// not the app's). Deliberately undramatic for a "calm museum instrument".
// Value chosen one clear step below the DARKEST wall face (an away-facing
// wall renders ~0.87 sRGB under the scene lights; this sits at ~0.84) so
// every wall, lit or shadowed, stays lighter than the field behind it.
export const SCENE_BACKGROUND_COLOR = "#d2d6da";

// ============================================================================
// Floor surfaces
// ============================================================================

// Matte cool mid-grey floor (spec §5.3). MeshLambertMaterial so it takes the
// light. Deliberately DARKER than both the white walls and the grey backdrop
// (renders ~0.71 sRGB under the scene lights vs the backdrop's ~0.82 and the
// lit walls' ~0.97) so the read is: white walls standing on a grounded grey
// floor, inside a quiet grey field — a full value step below the backdrop so
// the room's footprint separates cleanly from the empty void around it.
export const FLOOR_COLOR = "#b4b8bc";

// ============================================================================
// Floor objects (artwork pedestals, blocked zones)
// ============================================================================

// Neutral matte volume — the fallback for a floor-placed artwork box whose
// image is missing (no asset / unresolved record), so it never renders as a
// broken texture. A resolved box carries the work's image on every face.
// Cool neutral between the mid-grey floor and the white walls so the box
// reads as a distinct volume against both.
export const BOX_COLOR = "#d5d8db";

// Neutral placeholder for artworks whose image is missing or still loading —
// a shade between the wall white and the floor grey so it reads as "a work
// goes here" rather than a hole in the wall.
export const PLACEHOLDER_COLOR = "#e3e6e9";

// ============================================================================
// Framing (schematic frame + mat, spec docs/quick-todos.md)
// ============================================================================

// How far a frame stands OFF the wall in 3D (~1.5"). This is deliberately
// independent of the frame's entered face width (frame.widthMm): that field
// describes the width of the frame's FACE band (how thick the moulding looks
// head-on), not how deep it projects from the wall. Every frame extrudes to
// this same depth regardless of face width, matching how real gallery frames
// have a roughly constant rebate depth.
export const FRAME_DEPTH_MM = 38;

// Off-white mat board for the 3D mat plane. Duplicated from MAT_FILL_HEX in
// src/domain/framing.ts (kept as its own token here so this file stays the
// single place three.js material colors live) — keep the two in sync.
export const MAT_FILL_COLOR = "#F5F5F2";

// ============================================================================
// Display cases (vitrines)
// ============================================================================

// Opaque legs/base-slab — a light warm-neutral gray, one notch darker than
// BOX_COLOR so the leg/slab furniture reads as distinct from the case body.
export const CASE_FRAME_COLOR = "#d7d7d3";

// Opaque case body (all sides + bottom of the display box) — reads as a
// painted-white wood box with only the top glazed (spec: MoMA vitrine
// reference photos). Pure white, matching WALL_TEXT_PANEL_COLOR's precedent:
// against the cool-tinted WALL_COLOR (#f5f6f7) a true white face is what
// actually reads as "white like the walls", while a near-wall gray
// (#eef0f0, the first attempt) lit identically to the wall behind it
// dissolved into an edgeless patch that users read as transparent.
export const CASE_BODY_COLOR = "#ffffff";

// Glass pane: meshLambertMaterial, transparent, low opacity, depthWrite off
// (spec: flat/simple look, no MeshTransmissionMaterial). Used ONLY on the
// top face of each case now — sides/front/back/bottom are opaque
// CASE_BODY_COLOR. A faint cool white so it still separates from
// WALL_COLOR/BOX_COLOR when opaque geometry sits behind it.
export const CASE_GLASS_COLOR = "#eef2f3";
export const CASE_GLASS_OPACITY = 0.25;

// ============================================================================
// Blocked zones (planning annotations, not physical)
// ============================================================================

// Wall blocked zones and floor blocked zones are planning annotations, not
// physical (spec §5.3): a translucent wash in the same subdued grey family
// as the 2D hatch.
export const BLOCKED_ZONE_COLOR = "#565b60";

// ============================================================================
// Wall text (didactic label panels)
// ============================================================================

// A crisp white didactic panel, its skeleton "text" a light grey (~#d4d4d4,
// the shadcn Skeleton look), separated from the white by a subtle hairline
// border. Kept off the wall by a small standoff so it reads as mounted, less
// than the artworks' projection so a panel never looks like it covers a work.
export const WALL_TEXT_PANEL_COLOR = "#ffffff";
export const WALL_TEXT_BORDER_COLOR = "#b8bcc0";
export const WALL_TEXT_BAR_COLOR = "#d4d4d4";
export const WALL_TEXT_OFFSET_MM = 12;

// ============================================================================
// Eye-level ghosting
// ============================================================================

// Opacity for walls/partitions standing across the eye-level sightline: the
// obstruction fades to a readable hint instead of the camera creeping closer
// (position is framing's job, visibility is ghosting's — spec §4.2).
export const GHOST_OPACITY = 0.15;

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
