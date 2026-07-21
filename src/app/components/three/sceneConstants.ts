// Camera and lighting constants shared between the interactive 3D view
// (ThreeDView.tsx) and the offscreen snapshot renderer (SnapshotStage.tsx).
// Kept in their own leaf module (rather than exported from ThreeDView.tsx)
// so the two never form a value-level import cycle — a snapshot must render
// with exactly these numbers, never a re-guessed copy.

export const CAMERA_FOV_DEG = 50;
// Initial-frame value only: cameraNav.ts's updateCameraClipping re-derives
// near/far from orbit distance on every pose change (see it for the
// depth-precision constraint that drives framed-artwork z-fighting).
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 1000;

// Soft, shadowless lighting (spec §6.1): flat ambient plus one gentle high
// front-left key so walls shade apart and read as volume. Tuned for
// NoToneMapping (`flat` on both Canvases) and three's physical lights mode
// (r155+), where Lambert divides irradiance by π — intensities here carry
// that factor. Measured targets: an ambient-only interior wall face lands
// ~0.93 sRGB (white but readable as a shaded plane) and a key-facing wall
// ~0.97 — one clear value step so depth reads without shadows.
export const AMBIENT_LIGHT_INTENSITY = 2.9;
export const KEY_LIGHT_INTENSITY = 0.4;
export const KEY_LIGHT_POSITION: [number, number, number] = [-6, 8, 6];
