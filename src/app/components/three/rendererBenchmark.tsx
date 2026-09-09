import { useFrame } from "@react-three/fiber";
import { useRef } from "react";

// CLICK_DRAG_TOLERANCE_PX now lives in sceneConstants.ts: with pointer-dragging
// of placed objects it is no longer only "was that click an orbit release?" but
// also "has the object's own drag begun?", and the meshes need the same number.
export const ACTIVE_FRAME_GAP_MAX_MS = 100;
export const FRAME_SAMPLE_LIMIT = 256;

export type RendererBenchmarkMetrics = {
  sceneDerivationMs: number;
  roomCount: number;
  wallCount: number;
  artworkCount: number;
  canvasCreatedAt: number;
  firstFrameAt: number | null;
  idleGapCount: number;
  entryMs: number | null;
  frameCount: number;
  frameTimeP50Ms: number | null;
  frameTimeP95Ms: number | null;
  maxActiveFrameTimeMs: number | null;
};

declare global {
  interface Window {
    __sightlinesRendererBenchmark?: {
      getMetrics: () => RendererBenchmarkMetrics | null;
      reset: () => void;
    };
  }
}

export const benchmarkMetrics: RendererBenchmarkMetrics = {
  sceneDerivationMs: 0,
  roomCount: 0,
  wallCount: 0,
  artworkCount: 0,
  canvasCreatedAt: 0,
  firstFrameAt: null,
  idleGapCount: 0,
  entryMs: null,
  frameCount: 0,
  frameTimeP50Ms: null,
  frameTimeP95Ms: null,
  maxActiveFrameTimeMs: null
};
export const activeFrameSamplesMs: number[] = [];

export const benchmarkEnabled =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("benchmark") === "renderer";

export function resetBenchmarkMetrics() {
  Object.assign(benchmarkMetrics, {
    sceneDerivationMs: 0,
    roomCount: 0,
    wallCount: 0,
    artworkCount: 0,
    canvasCreatedAt: 0,
    firstFrameAt: null,
    idleGapCount: 0,
    entryMs: null,
    frameCount: 0,
    frameTimeP50Ms: null,
    frameTimeP95Ms: null,
    maxActiveFrameTimeMs: null
  });
  activeFrameSamplesMs.length = 0;
}

export function recordFrameSample(frameTimeMs: number) {
  if (frameTimeMs > ACTIVE_FRAME_GAP_MAX_MS) {
    benchmarkMetrics.idleGapCount += 1;
    return;
  }
  activeFrameSamplesMs.push(frameTimeMs);
  if (activeFrameSamplesMs.length > FRAME_SAMPLE_LIMIT) activeFrameSamplesMs.shift();
  const sorted = activeFrameSamplesMs.slice().sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? null;
  benchmarkMetrics.frameCount = sorted.length;
  benchmarkMetrics.frameTimeP50Ms = percentile(0.5);
  benchmarkMetrics.frameTimeP95Ms = percentile(0.95);
  benchmarkMetrics.maxActiveFrameTimeMs = sorted.at(-1) ?? null;
}

export function BenchmarkFrameProbe() {
  const lastFrameAt = useRef<number | null>(null);
  useFrame(() => {
    const now = performance.now();
    if (benchmarkMetrics.firstFrameAt === null) {
      benchmarkMetrics.firstFrameAt = now;
      benchmarkMetrics.entryMs = now - benchmarkMetrics.canvasCreatedAt;
    }
    if (lastFrameAt.current !== null) {
      recordFrameSample(now - lastFrameAt.current);
    }
    lastFrameAt.current = now;
  });
  return null;
}
