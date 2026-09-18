import { Fragment } from "react";
import type { Project } from "../../../domain/project";
import {
  casePlanGlyph,
  wallTextPlanGlyph
} from "../../../domain/geometry/caseGlyphs";
import { monitorPlanGlyph } from "../../../domain/geometry/monitorGlyphs";
import type { DoorSwingPlanGlyph } from "../../../domain/geometry/doorGlyphs";
import { getRoomPlaceableWalls } from "../../../domain/geometry/placeableWalls";
import { isPointInPolygon } from "../../../domain/geometry/polygon";
import {
  planScenePaintOrder,
  type PlanScene,
  type PlanSceneRoom
} from "../../../domain/scene2d/planScene";
import type { PlanRect } from "../../../domain/geometry/planObjects";
import {
  planRectCorners,
  type DocumentBoundsMm
} from "../../../domain/export/pageComposition";
import type { EffectiveDocumentSettings } from "../../../domain/export/documentSettings";
import { GRID, INK, MUTED, FILL_WEAK, SUBTLE, type Transform } from "./previewStyle";
import { coarseGridStepMm, localToWorld } from "./previewTransforms";
import { isMonitorArtwork } from "../../../domain/geometry/monitorGlyphs";

// ── Room-scope filter (a pure mirror of pdf/planPage.ts's roomScene, kept here
// so the preview never imports the pdf-lib-bearing pdf/ modules). ────────────
export function roomScenePreview(
  scene: PlanScene,
  project: Project,
  roomId: string
): PlanScene {
  const room = scene.rooms.find((candidate) => candidate.roomId === roomId);
  const placement = project.floor.rooms.find(
    (candidate) => candidate.roomId === roomId
  );
  if (!room || !placement) {
    return {
      rooms: [],
      partitions: [],
      openingConnections: [],
      wallObjects: [],
      floorObjects: []
    };
  }
  const wallIds = new Set(
    getRoomPlaceableWalls(placement.room).map((wall) => wall.id)
  );
  return {
    rooms: [room],
    partitions: scene.partitions.filter(
      (partition) => partition.partition.roomId === roomId
    ),
    openingConnections: [],
    wallObjects: scene.wallObjects.filter((entry) =>
      wallIds.has(entry.object.wallId)
    ),
    floorObjects: scene.floorObjects.filter((entry) =>
      isPointInPolygon(
        { xMm: entry.rect.centerXMm, yMm: entry.rect.centerYMm },
        room.polygonMm
      )
    )
  };
}

// ── SVG mark builders ────────────────────────────────────────────────────────

export function gridMarks(bounds: DocumentBoundsMm, xf: Transform, key: string) {
  const stepX = coarseGridStepMm(bounds.widthMm);
  const stepY = coarseGridStepMm(bounds.heightMm);
  const lines: JSX.Element[] = [];
  const start = (min: number, step: number) => Math.ceil(min / step) * step;
  for (let x = start(bounds.minXMm, stepX); x <= bounds.maxXMm; x += stepX) {
    const a = xf.point({ xMm: x, yMm: bounds.minYMm });
    const b = xf.point({ xMm: x, yMm: bounds.maxYMm });
    lines.push(
      <line
        key={`${key}-vx-${x}`}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke={GRID}
        strokeWidth={0.35}
      />
    );
  }
  for (let y = start(bounds.minYMm, stepY); y <= bounds.maxYMm; y += stepY) {
    const a = xf.point({ xMm: bounds.minXMm, yMm: y });
    const b = xf.point({ xMm: bounds.maxXMm, yMm: y });
    lines.push(
      <line
        key={`${key}-hy-${y}`}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke={GRID}
        strokeWidth={0.35}
      />
    );
  }
  return lines;
}

export function rectPolyPoints(rect: PlanRect, xf: Transform): string {
  return planRectCorners(rect)
    .map(xf.point)
    .map((p) => `${p.x},${p.y}`)
    .join(" ");
}

// Exported for test: the preview's per-object marks are the one place this card
// could silently drift from the artifact it previews, so they are asserted
// directly rather than through a rendered card.
export function planObjectMarks(
  rect: PlanRect,
  kind: string,
  isFloor: boolean,
  // This artwork is displayed on a CRT / box monitor — same flag, same reason
  // as PlanObject's and drawPlanObject's.
  isMonitor: boolean,
  xf: Transform,
  key: string,
  // A hinged door's swing glyph off the plan scene (PlanSceneWallObject
  // .doorSwing) — the same object the canvas and the PDF writer draw. Never
  // recomputed here: the preview drifting from the artifact it previews is
  // exactly the failure this module's shared-glyph rule exists to prevent.
  swing?: DoorSwingPlanGlyph,
  // The pedestal/plinth this floor placement stands on, off the same scene
  // entry the canvas and the PDF writer read (PlanSceneFloorObject.support).
  support?: { rect: PlanRect; hasBonnet: boolean }
): JSX.Element {
  const world = (xMm: number, yMm: number) =>
    xf.point(localToWorld(rect, xMm, yMm));
  const halfW = rect.widthMm / 2;
  const halfD = rect.depthMm / 2;
  const inner: JSX.Element[] = [];

  if (kind === "artwork" && isMonitor) {
    // The CRT's screen line just inside the front edge, off the same shared
    // glyph the canvas and the PDF writer use (monitorGlyphs.ts) — the preview
    // drifting from the artifact it previews is exactly what that rule exists
    // to prevent.
    const { screen } = monitorPlanGlyph({
      widthMm: rect.widthMm,
      depthMm: rect.depthMm
    });
    if (screen) {
      const a = world(screen.x1Mm, screen.yMm);
      const b = world(screen.x2Mm, screen.yMm);
      inner.push(
        <line
          key={`${key}-screen`}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={SUBTLE}
          strokeWidth={0.5}
        />
      );
    }
  } else if (kind === "artwork") {
    const inset = Math.min(rect.widthMm, rect.depthMm) * 0.22;
    const insetRect: PlanRect = {
      ...rect,
      widthMm: Math.max(0, rect.widthMm - inset * 2),
      depthMm: Math.max(0, rect.depthMm - inset * 2)
    };
    inner.push(
      <polygon
        key={`${key}-in`}
        points={rectPolyPoints(insetRect, xf)}
        fill="none"
        stroke={SUBTLE}
        strokeWidth={0.5}
      />
    );
  } else if (kind === "case") {
    const glyph = casePlanGlyph({
      widthMm: rect.widthMm,
      depthMm: rect.depthMm,
      includeLegs: isFloor
    });
    if (glyph.glass) {
      const g = glyph.glass;
      const pts = [
        world(g.x0Mm, g.y0Mm),
        world(g.x1Mm, g.y0Mm),
        world(g.x1Mm, g.y1Mm),
        world(g.x0Mm, g.y1Mm)
      ]
        .map((p) => `${p.x},${p.y}`)
        .join(" ");
      inner.push(
        <polygon
          key={`${key}-glass`}
          points={pts}
          fill="none"
          stroke={SUBTLE}
          strokeWidth={0.5}
        />
      );
    }
    glyph.hatch.forEach((line, i) => {
      const a = world(line.x1Mm, line.y1Mm);
      const b = world(line.x2Mm, line.y2Mm);
      inner.push(
        <line
          key={`${key}-h${i}`}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={SUBTLE}
          strokeWidth={0.45}
        />
      );
    });
    glyph.legs.forEach((leg, i) => {
      const half = leg.sizeMm / 2;
      const pts = [
        world(leg.cxMm - half, leg.cyMm - half),
        world(leg.cxMm + half, leg.cyMm - half),
        world(leg.cxMm + half, leg.cyMm + half),
        world(leg.cxMm - half, leg.cyMm + half)
      ]
        .map((p) => `${p.x},${p.y}`)
        .join(" ");
      inner.push(<polygon key={`${key}-leg${i}`} points={pts} fill={SUBTLE} />);
    });
  } else if (kind === "wall-text") {
    const glyph = wallTextPlanGlyph({
      widthMm: rect.widthMm,
      depthMm: rect.depthMm
    });
    glyph.lines.forEach((line, i) => {
      const a = world(line.x1Mm, line.yMm);
      const b = world(line.x2Mm, line.yMm);
      inner.push(
        <line
          key={`${key}-t${i}`}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={SUBTLE}
          strokeWidth={0.5}
        />
      );
    });
  } else if (kind === "door" && swing) {
    // A HINGED door: leaf line + swept quarter-circle, from the shared glyph.
    const leafFrom = world(swing.leaf.x1Mm, swing.leaf.y1Mm);
    const leafTo = world(swing.leaf.x2Mm, swing.leaf.y2Mm);
    // Drawn as the FLATTENED polyline (arcPolyline), not an SVG `A` command,
    // even though this surface is SVG and could emit one: it is what the PDF
    // actually prints, and this card is a look-ahead at the PDF. Sharing the
    // flattening also means a curve that reads smooth here cannot print
    // faceted there.
    //
    // (An `A` would draw correctly now that planTransform no longer flips y.
    // It did not before that fix, and the flattened form was already immune —
    // a polyline carries no sweep flag to get backwards.)
    const arcPoints = swing
      .arcPolyline()
      .map((point) => world(point.xMm, point.yMm))
      .map((point) => `${point.x},${point.y}`)
      .join(" ");
    inner.push(
      <line
        key={`${key}-leaf`}
        x1={leafFrom.x}
        y1={leafFrom.y}
        x2={leafTo.x}
        y2={leafTo.y}
        stroke={SUBTLE}
        strokeWidth={0.5}
      />,
      <polyline
        key={`${key}-arc`}
        points={arcPoints}
        fill="none"
        stroke={SUBTLE}
        strokeWidth={0.5}
      />
    );
  } else if (kind === "door") {
    const a = world(-halfW, halfD);
    const b = world(-halfW, -halfD);
    const c = world(halfW, halfD);
    inner.push(
      <line key={`${key}-d1`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={SUBTLE} strokeWidth={0.5} />,
      <line key={`${key}-d2`} x1={b.x} y1={b.y} x2={c.x} y2={c.y} stroke={SUBTLE} strokeWidth={0.5} />
    );
  } else if (kind === "window") {
    const h1a = world(-halfW, 0);
    const h1b = world(halfW, 0);
    const v1a = world(0, -halfD);
    const v1b = world(0, halfD);
    inner.push(
      <line key={`${key}-w1`} x1={h1a.x} y1={h1a.y} x2={h1b.x} y2={h1b.y} stroke={SUBTLE} strokeWidth={0.5} />,
      <line key={`${key}-w2`} x1={v1a.x} y1={v1a.y} x2={v1b.x} y2={v1b.y} stroke={SUBTLE} strokeWidth={0.5} />
    );
  }

  return (
    <Fragment key={key}>
      {/* The support first, beneath the work, so the work's own outline
          overdraws the seam where the two meet — the canvas's and the PDF
          writer's paint order. Lighter stroke than the object standing on it;
          the bonnet is the same footprint, dashed, since a plan cannot show
          its height (USER DECISION 2026-09-17). */}
      {support ? (
        <polygon
          points={rectPolyPoints(support.rect, xf)}
          fill={FILL_WEAK}
          stroke={MUTED}
          strokeWidth={0.55}
        />
      ) : null}
      {support?.hasBonnet ? (
        <polygon
          points={rectPolyPoints(support.rect, xf)}
          fill="none"
          stroke={SUBTLE}
          strokeWidth={0.5}
          strokeDasharray="3 2"
        />
      ) : null}
      <polygon
        points={rectPolyPoints(rect, xf)}
        fill={kind === "blocked-zone" ? FILL_WEAK : "#ffffff"}
        stroke={MUTED}
        strokeWidth={0.8}
        strokeDasharray={isFloor ? "3 2" : undefined}
      />
      {inner}
    </Fragment>
  );
}

// A faint dimension hint alongside each wall: offset the segment outward (away
// from the room centroid) by a few points. No labels — too small to read.
export function planDimensionMarks(room: PlanSceneRoom, xf: Transform): JSX.Element[] {
  const centroid = room.polygonMm.reduce(
    (acc, p) => ({ xMm: acc.xMm + p.xMm, yMm: acc.yMm + p.yMm }),
    { xMm: 0, yMm: 0 }
  );
  const n = Math.max(room.polygonMm.length, 1);
  centroid.xMm /= n;
  centroid.yMm /= n;
  return room.walls.flatMap((wall, i) => {
    const start = xf.point(wall.startMm);
    const end = xf.point(wall.endMm);
    const midWorld = {
      xMm: (wall.startMm.xMm + wall.endMm.xMm) / 2,
      yMm: (wall.startMm.yMm + wall.endMm.yMm) / 2
    };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if (len <= 0) return [];
    // Screen-space perpendicular, oriented away from the centroid.
    let nx = -dy / len;
    let ny = dx / len;
    // Both sides of this comparison are in SCREEN space: the outward direction
    // is the transformed centroid subtracted from the transformed wall midpoint,
    // not the world-space difference. `xf` is affine, so transforming both ends
    // and subtracting yields the true screen direction under ANY axis
    // convention it might use.
    //
    // The previous form compared a screen normal against a WORLD outward vector
    // and hand-corrected with `-outWorldY`, on the premise that screen y opposed
    // world y. That premise came from a planTransform which mirrored the page
    // (see its comment); when the mirror was fixed the negation silently
    // inverted, drawing the north and south dimension hints INSIDE the room
    // while the east/west ones stayed correct — those only exercise the x term.
    // Comparing within one space removes the premise rather than re-tuning it.
    const midScreen = xf.point(midWorld);
    const centroidScreen = xf.point(centroid);
    const outX = midScreen.x - centroidScreen.x;
    const outY = midScreen.y - centroidScreen.y;
    if (nx * outX + ny * outY < 0) {
      nx = -nx;
      ny = -ny;
    }
    const off = 7;
    const a = { x: start.x + nx * off, y: start.y + ny * off };
    const b = { x: end.x + nx * off, y: end.y + ny * off };
    return [
      <line
        key={`dim-${i}`}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke={MUTED}
        strokeWidth={0.4}
      />
    ];
  });
}

export function svgPolygonPointsScreen(
  polygonMm: { xMm: number; yMm: number }[],
  xf: Transform
): string {
  return polygonMm.map((p) => xf.point(p)).map((p) => `${p.x},${p.y}`).join(" ");
}

export function planPageMarks(
  scene: PlanScene,
  bounds: DocumentBoundsMm,
  xf: Transform,
  settings: EffectiveDocumentSettings,
  withDimensions: boolean
): JSX.Element[] {
  const marks: JSX.Element[] = [];
  if (settings.grid) marks.push(...gridMarks(bounds, xf, "grid"));
  scene.rooms.forEach((room, ri) =>
    marks.push(
      <polygon
        key={`room-fill-${ri}`}
        points={svgPolygonPointsScreen(room.polygonMm, xf)}
        fill="#ffffff"
      />
    )
  );
  scene.rooms.forEach((room, ri) =>
    room.walls.forEach((wall, wi) => {
      // Matches planPage.ts and the interactive plan: an open wall is a gap.
      // The preview's whole job is to show what the PDF will contain, so a
      // divergence here would be worse than no preview at all.
      if (wall.isOpenSide) return;
      const a = xf.point(wall.startMm);
      const b = xf.point(wall.endMm);
      marks.push(
        <line
          key={`wall-${ri}-${wi}`}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={INK}
          strokeWidth={1.8}
          strokeLinecap="square"
        />
      );
    })
  );
  scene.partitions.forEach((partition, pi) =>
    marks.push(
      <polygon
        key={`part-${pi}`}
        points={rectPolyPoints(partition.rect, xf)}
        fill={INK}
        opacity={0.72}
      />
    )
  );
  planScenePaintOrder(scene.wallObjects, scene.floorObjects).forEach(
    (painted, i) => {
      if (painted.group === "wall") {
        marks.push(
          planObjectMarks(
            painted.entry.renderedRect,
            painted.entry.object.kind,
            false,
            // A monitor work hung on a wall is a plain image there — the
            // cabinet is a floor rendering (see PlanObject's isMonitor).
            false,
            xf,
            `wobj-${i}`,
            painted.entry.doorSwing
          )
        );
      } else {
        marks.push(
          planObjectMarks(
            painted.entry.rect,
            painted.entry.object.kind,
            true,
            isMonitorArtwork(painted.entry.artwork),
            xf,
            `fobj-${i}`,
            undefined,
            painted.entry.support
          )
        );
      }
    }
  );
  if (withDimensions) {
    scene.rooms.forEach((room) =>
      marks.push(...planDimensionMarks(room, xf))
    );
  }
  return marks;
}
