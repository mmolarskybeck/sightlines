import { useLayoutEffect, useMemo, useRef } from "react";
import { BoxGeometry, type LineLoop, type LineSegments } from "three";
import type { Dimensions } from "../../../domain/project";
import { mmToWorld } from "./coordinates";

// The shared dimension-uncertainty language (docs/plan.md §8), in WebGL: the
// 2D views draw a dashed outline stroked --caution (approximate) or --danger
// (unknown); these are those tokens' oklch values as hex, since three.js
// materials can't resolve CSS custom properties.
const APPROXIMATE_COLOR = "#8a6210"; // ≈ --caution  oklch(0.5 0.13 75)
const UNKNOWN_COLOR = "#b03a28"; // ≈ --danger   oklch(0.53 0.18 28)

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
