import { useLayoutEffect, useMemo, useRef } from "react";
import { BoxGeometry, type LineLoop, type LineSegments } from "three";
import type { Dimensions } from "../../../domain/project";
import { mmToWorld } from "./coordinates";
import { APPROXIMATE_COLOR, SELECTION_COLOR, UNKNOWN_COLOR } from "./tokens";

// The shared outline language of the 2D views, in WebGL: dashed strokes for
// dimension uncertainty (--caution approximate / --danger unknown, docs/
// plan.md §8) and a solid accent stroke for selection (--selection). Hex
// equivalents of those tokens' oklch values are mirrored in tokens.ts since
// three.js materials can't resolve CSS custom properties. Selection never tints
// an artwork's image texture (spec §4.3) — it's outline-only on textured planes.

// ~7:5 dash rhythm, matching .elevation-artwork.uncertain's stroke-dasharray.
const DASH_SIZE = 0.05;
const GAP_SIZE = 0.036;

export function isUncertain(status: Dimensions["status"] | undefined): boolean {
  return status === "approximate" || status === "unknown";
}

function uncertaintyColor(status: Dimensions["status"] | undefined): string {
  return status === "unknown" ? UNKNOWN_COLOR : APPROXIMATE_COLOR;
}

// Dashed rectangle, centered at the local origin in the local xy-plane —
// rendered slightly proud of the artwork plane by the parent's z offset.
// LineDashedMaterial needs computeLineDistances() on the Line object; R3F's
// onUpdate does NOT fire on initial mount, so this runs in a layout effect.
export function DashedRectOutline({
  widthMm,
  heightMm,
  status
}: {
  widthMm: number;
  heightMm: number;
  status: Dimensions["status"] | undefined;
}) {
  const lineRef = useRef<LineLoop>(null);
  const positions = useMemo(() => {
    const halfW = mmToWorld(widthMm) / 2;
    const halfH = mmToWorld(heightMm) / 2;
    return new Float32Array([
      -halfW, -halfH, 0,
      halfW, -halfH, 0,
      halfW, halfH, 0,
      -halfW, halfH, 0
    ]);
  }, [widthMm, heightMm]);

  useLayoutEffect(() => {
    lineRef.current?.computeLineDistances();
  }, [positions]);

  return (
    <lineLoop ref={lineRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineDashedMaterial
        color={uncertaintyColor(status)}
        dashSize={DASH_SIZE}
        gapSize={GAP_SIZE}
      />
    </lineLoop>
  );
}

// Solid selection rectangle, same local frame as DashedRectOutline.
export function SelectionRectOutline({
  widthMm,
  heightMm
}: {
  widthMm: number;
  heightMm: number;
}) {
  const positions = useMemo(() => {
    const halfW = mmToWorld(widthMm) / 2;
    const halfH = mmToWorld(heightMm) / 2;
    return new Float32Array([
      -halfW, -halfH, 0,
      halfW, -halfH, 0,
      halfW, halfH, 0,
      -halfW, halfH, 0
    ]);
  }, [widthMm, heightMm]);

  return (
    <lineLoop>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={SELECTION_COLOR} />
    </lineLoop>
  );
}

// Solid selection box edges, same local frame as DashedBoxOutline.
export function SelectionBoxOutline({
  widthMm,
  heightMm,
  depthMm
}: {
  widthMm: number;
  heightMm: number;
  depthMm: number;
}) {
  const box = useMemo(
    () => new BoxGeometry(mmToWorld(widthMm), mmToWorld(heightMm), mmToWorld(depthMm)),
    [widthMm, heightMm, depthMm]
  );

  return (
    <lineSegments>
      <edgesGeometry args={[box]} />
      <lineBasicMaterial color={SELECTION_COLOR} />
    </lineSegments>
  );
}

// Dashed box edges, centered at the local origin — the floor-object variant
// of the same treatment.
export function DashedBoxOutline({
  widthMm,
  heightMm,
  depthMm,
  status
}: {
  widthMm: number;
  heightMm: number;
  depthMm: number;
  status: Dimensions["status"] | undefined;
}) {
  const lineRef = useRef<LineSegments>(null);
  // EdgesGeometry needs a source geometry; memoize both so re-renders don't
  // rebuild them (R3F disposes them on unmount).
  const box = useMemo(
    () => new BoxGeometry(mmToWorld(widthMm), mmToWorld(heightMm), mmToWorld(depthMm)),
    [widthMm, heightMm, depthMm]
  );

  useLayoutEffect(() => {
    lineRef.current?.computeLineDistances();
  }, [box]);

  return (
    <lineSegments ref={lineRef}>
      <edgesGeometry args={[box]} />
      <lineDashedMaterial
        color={uncertaintyColor(status)}
        dashSize={DASH_SIZE}
        gapSize={GAP_SIZE}
      />
    </lineSegments>
  );
}
