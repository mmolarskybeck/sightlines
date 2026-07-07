import { useMemo } from "react";
import { DoubleSide, Shape } from "three";
import type { Vec2 } from "../../../domain/geometry/scene3d";
import { MM_TO_WORLD } from "./coordinates";

// Matte warm-grey floor (spec §5.3). MeshLambertMaterial so it takes the light.
const FLOOR_COLOR = "#e8e4de";

// The room floor as a single ShapeGeometry triangulated from the polygon,
// laid flat in the xz-plane. Rendered double-sided so the ground reads whether
// the camera orbits above (the common case) or dips below.
export function FloorSurface({ polygon }: { polygon: Vec2[] }) {
  const shape = useMemo(() => {
    const outline = new Shape();
    polygon.forEach((point, index) => {
      const x = point.xMm * MM_TO_WORLD;
      const y = point.yMm * MM_TO_WORLD;
      if (index === 0) outline.moveTo(x, y);
      else outline.lineTo(x, y);
    });
    outline.closePath();
    return outline;
  }, [polygon]);

  // The shape is authored in its local xy-plane with y = plan-y; rotating +90°
  // about x lays it into the xz-plane so local y becomes world +z, matching the
  // plan(x, y) -> three(x, z) convention.
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]}>
      <shapeGeometry args={[shape]} />
      <meshLambertMaterial color={FLOOR_COLOR} side={DoubleSide} />
    </mesh>
  );
}
