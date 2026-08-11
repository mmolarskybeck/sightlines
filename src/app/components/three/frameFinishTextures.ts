import { CanvasTexture, SRGBColorSpace } from "three";
import { FRAME_FINISH_SHADING, type FrameFinishShading } from "../../../domain/framing";
import type { FrameFinish } from "../../../domain/project";

// Baked band textures for the material frame finishes (gold/silver/wood),
// from the same FRAME_FINISH_SHADING values the elevation bands use. The
// profile is FLAT (square box-section molding): a uniform base fill with
// only lengthwise texture on top — wavy grain for wood, brushed hairlines
// plus broad soft sheen zones for the metals. No ramp across the band; in
// 3D the prisms' side faces separate via real Lambert shading instead. Each
// finish gets ONE small canvas painted once and cached for the session — no
// per-frame work, no extra draw calls; the frame bars' Lambert materials
// simply sample it instead of a flat color.
//
// Texture space: x runs ALONG the band's length, y ACROSS the band. The
// mitred bar geometry (ArtworkPlane) writes its own UVs in exactly those
// terms — u along each bar's length, v across its band — so every bar of the
// ring samples this one texture correctly regardless of orientation.

// Power-of-two so mipmaps work; long enough that streaks don't visibly
// stretch on a room-scale frame bar.
const TEX_LENGTH_PX = 512;
const TEX_BAND_PX = 64;

// Deterministic PRNG (mulberry32) so every session bakes identical grain —
// a frame must not change appearance between visits or between the live
// scene and SnapshotStage captures.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paintBand(ctx: CanvasRenderingContext2D, shading: FrameFinishShading, seed: number) {
  // Flat face: uniform base fill, no ramp across the band.
  ctx.fillStyle = shading.baseHex;
  ctx.fillRect(0, 0, TEX_LENGTH_PX, TEX_BAND_PX);

  const random = mulberry32(seed);
  const isWood = shading === FRAME_FINISH_SHADING.wood;

  // Broad, very soft lengthwise tone zones first — the wide sheen bands a
  // brushed metal face shows, and walnut's slow color drift between grain
  // lines. Low alpha so the face still reads flat overall.
  for (let i = 0; i < 7; i++) {
    const y = random() * TEX_BAND_PX;
    ctx.strokeStyle = random() < 0.5 ? shading.litHex : shading.shadeHex;
    ctx.globalAlpha = 0.05 + random() * 0.05;
    ctx.lineWidth = 8 + random() * 16;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(TEX_LENGTH_PX, y);
    ctx.stroke();
  }

  // Wood reads as grain: fewer, wavier, slightly wider streaks. Metals read
  // as brushed: many straight hairlines at lower alpha.
  const streakCount = isWood ? 30 : 90;

  for (let i = 0; i < streakCount; i++) {
    const y = random() * TEX_BAND_PX;
    ctx.strokeStyle = random() < 0.5 ? shading.streakLightHex : shading.streakDarkHex;
    ctx.globalAlpha = isWood ? 0.1 + random() * 0.18 : 0.04 + random() * 0.1;
    ctx.lineWidth = isWood ? 0.8 + random() * 1.8 : 0.5 + random() * 0.7;
    ctx.beginPath();
    ctx.moveTo(0, y);
    if (isWood) {
      // Gentle lengthwise drift in a few segments — grain, not sine waves.
      const segments = 4;
      let px = 0;
      let py = y;
      for (let s = 1; s <= segments; s++) {
        const nx = (TEX_LENGTH_PX / segments) * s;
        const ny = y + (random() - 0.5) * 5;
        ctx.quadraticCurveTo(px + (nx - px) / 2, py + (random() - 0.5) * 4, nx, ny);
        px = nx;
        py = ny;
      }
    } else {
      ctx.lineTo(TEX_LENGTH_PX, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

const cache = new Map<FrameFinish, CanvasTexture>();

// Undefined for the flat finishes (white/black — no shading ramp) and in
// DOM-less environments (unit tests); callers fall back to the flat
// FRAME_FINISH_HEX color exactly as before.
export function getFrameFinishTexture(finish: FrameFinish): CanvasTexture | undefined {
  const shading = FRAME_FINISH_SHADING[finish];
  if (!shading || typeof document === "undefined") return undefined;

  const cached = cache.get(finish);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = TEX_LENGTH_PX;
  canvas.height = TEX_BAND_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;

  // Seed varies per finish only so gold/silver don't share identical streak
  // placement.
  paintBand(ctx, shading, finish.length * 7919 + finish.charCodeAt(0));

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;

  cache.set(finish, texture);
  return texture;
}
