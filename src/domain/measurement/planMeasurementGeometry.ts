import type { PlanRect } from "../geometry/planObjects";
import type { buildPlanScene } from "../scene2d/planScene";
import type { MeasureCandidateSources } from "./measurement";

function planRectMeasureGeometry(rect: PlanRect, id: string): MeasureCandidateSources {
  const angle = (rect.angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const local = [
    [-rect.widthMm / 2, -rect.depthMm / 2],
    [rect.widthMm / 2, -rect.depthMm / 2],
    [rect.widthMm / 2, rect.depthMm / 2],
    [-rect.widthMm / 2, rect.depthMm / 2]
  ] as const;
  const corners = local.map(([x, y]) => ({
    xMm: rect.centerXMm + x * cos - y * sin,
    yMm: rect.centerYMm + x * sin + y * cos
  }));
  return {
    points: [
      ...corners.map((point, index) => ({ id: `${id}:corner:${index}`, kind: "vertex" as const, point })),
      { id: `${id}:center`, kind: "center", point: { xMm: rect.centerXMm, yMm: rect.centerYMm } }
    ],
    segments: corners.map((point, index) => ({
      id: `${id}:edge:${index}`,
      kind: "edge" as const,
      start: point,
      end: corners[(index + 1) % corners.length]
    }))
  };
}

export function buildPlanMeasureSources(
  scene: ReturnType<typeof buildPlanScene>
): MeasureCandidateSources {
  const points: NonNullable<MeasureCandidateSources["points"]>[number][] = [];
  const segments: NonNullable<MeasureCandidateSources["segments"]>[number][] = [];
  for (const room of scene.rooms) {
    room.polygonMm.forEach((point, index) =>
      points.push({ id: `room:${room.roomId}:vertex:${index}`, kind: "vertex", point })
    );
    room.walls.forEach((wall) =>
      segments.push({
        id: `wall:${wall.wallId}`,
        kind: "edge",
        start: wall.startMm,
        end: wall.endMm
      })
    );
  }
  const rects = [
    ...scene.partitions.map((entry) => ({ id: `partition:${entry.partition.wallId}`, rect: entry.rect })),
    ...scene.wallObjects.map((entry) => ({ id: `wall-object:${entry.object.id}`, rect: entry.renderedRect })),
    ...scene.floorObjects.map((entry) => ({ id: `floor-object:${entry.object.id}`, rect: entry.rect }))
  ];
  for (const entry of rects) {
    const geometry = planRectMeasureGeometry(entry.rect, entry.id);
    points.push(...(geometry.points ?? []));
    segments.push(...(geometry.segments ?? []));
  }
  return { points, segments };
}
