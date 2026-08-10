import { Fragment, useEffect, useMemo, useState } from "react";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import type { Artwork, CaseFloorObject, Project } from "../../../domain/project";
import type { EffectiveDocumentSettings } from "../../../domain/export/documentSettings";
import {
  caseElevationGlyph,
  casePlanGlyph,
  wallTextPlanGlyph
} from "../../../domain/geometry/caseGlyphs";
import {
  doorElevationGlyph,
  type DoorSwingPlanGlyph
} from "../../../domain/geometry/doorGlyphs";
import { getRoomPlaceableWalls } from "../../../domain/geometry/placeableWalls";
import { isPointInPolygon } from "../../../domain/geometry/polygon";
import {
  buildElevationScene,
  getArtworkRectSvg,
  type ElevationScene
} from "../../../domain/scene2d/elevationScene";
import {
  buildPlanScene,
  planScenePaintOrder,
  svgPolygonPoints,
  type PlanScene,
  type PlanSceneRoom
} from "../../../domain/scene2d/planScene";
import type { PlanRect } from "../../../domain/geometry/planObjects";
import {
  DOCUMENT_FOOTER_HEIGHT_PT,
  DOCUMENT_HEADER_HEIGHT_PT,
  DOCUMENT_PAGE_MARGIN_PT,
  fitBoundsToRect,
  getPageSizePt,
  getPlanSceneBounds,
  planRectCorners,
  type DocumentBoundsMm,
  type DocumentOrientation,
  type DocumentPageManifest
} from "../../../domain/export/pageComposition";
import { Button } from "../ui/button";
import {
  clampPageIndex,
  derivePreviewPages,
  previewPageCaption,
  type PreviewPage
} from "./exportPreviewModel";

// ── Stroke widths / colors (SVG user units == points, matching the PDF) ──────
// Colors are CSS custom properties so the card stays theme-aware; geometry and
// stroke weights echo the PDF writer's so the look-ahead reads like the export.
const INK = "var(--ink)";
const MUTED = "var(--muted)";
const SUBTLE = "var(--subtle)";
const GRID = "var(--line)";
const FILL_WEAK = "var(--surface-strong)";

type XY = { x: number; y: number };
type Transform = {
  scalePtPerMm: number;
  point: (p: { xMm: number; yMm: number }) => XY;
};

// A small inset inside the page's drawing rect, so content doesn't butt the
// header/footer/margin bands — the analog of the PDF writer's DRAWING_INSET_PT.
const DRAWING_INSET_PT = 14;

// The page's content rect in SVG (y-DOWN) point space: full margins on all
// sides, header band reserved at the TOP (SVG-natural) and footer at the
// bottom — the same bands getPageDrawingRectPt carves out, so content sits
// where it will on the real page.
function drawingRectPt(
  paperSize: EffectiveDocumentSettings["paperSize"],
  orientation: DocumentOrientation
) {
  const page = getPageSizePt(paperSize, orientation);
  return {
    xPt: DOCUMENT_PAGE_MARGIN_PT + DRAWING_INSET_PT,
    yPt: DOCUMENT_PAGE_MARGIN_PT + DOCUMENT_HEADER_HEIGHT_PT + DRAWING_INSET_PT,
    widthPt: page.widthPt - (DOCUMENT_PAGE_MARGIN_PT + DRAWING_INSET_PT) * 2,
    heightPt:
      page.heightPt -
      (DOCUMENT_PAGE_MARGIN_PT + DRAWING_INSET_PT) * 2 -
      DOCUMENT_HEADER_HEIGHT_PT -
      DOCUMENT_FOOTER_HEIGHT_PT
  };
}

// Plan transform: floor mm (y-DOWN, the same sense the plan canvas draws in) →
// SVG points (y-DOWN). A plain shift and scale, with NO flip.
//
// This deliberately does NOT copy createPlanTransform's formula, and copying it
// is exactly the bug this comment exists to prevent. That function ends in
// `(bounds.maxYMm - yMm)`, which looks like the thing to match — but its
// destination is pdf-lib page space, where y runs UP from the bottom-left, so
// the subtraction is what puts north at the TOP of the sheet. Here the
// destination is SVG, where y runs DOWN. The identical expression against the
// opposite axis mirrors the whole page: north renders at the bottom, and every
// room, artwork and door sits on the wrong side of the plan.
//
// It was invisible for as long as plan pages held only symmetric marks. The
// hinged-door swing arc is the first strongly HANDED plan glyph, and it made a
// preview that had been upside-down since the preview shipped (cec13cba) read
// as a door hinged on the wrong jamb.
//
// So this is now identical to elevationTransform. They are kept separate
// anyway: they answer different questions (floor space vs. wall-local space),
// and collapsing them would invite re-deriving one from the other's page
// conventions — which is how this went wrong in the first place.
export function planTransform(
  bounds: DocumentBoundsMm,
  fit: ReturnType<typeof fitBoundsToRect>
): Transform {
  return {
    scalePtPerMm: fit.scalePtPerMm,
    point: ({ xMm, yMm }) => ({
      x: fit.xPt + (xMm - bounds.minXMm) * fit.scalePtPerMm,
      y: fit.yPt + (yMm - bounds.minYMm) * fit.scalePtPerMm
    })
  };
}

// Elevation transform: wall-local SVG (already y-DOWN, top = 0) → SVG points.
function elevationTransform(
  bounds: DocumentBoundsMm,
  fit: ReturnType<typeof fitBoundsToRect>
): Transform {
  return {
    scalePtPerMm: fit.scalePtPerMm,
    point: ({ xMm, yMm }) => ({
      x: fit.xPt + (xMm - bounds.minXMm) * fit.scalePtPerMm,
      y: fit.yPt + (yMm - bounds.minYMm) * fit.scalePtPerMm
    })
  };
}

// Rotate a rect-local (center-origin) point into world mm — the plan glyphs are
// authored in a local-centered frame, same as planRectWorldPoint.
function localToWorld(rect: PlanRect, xMm: number, yMm: number) {
  const angle = (rect.angleDeg * Math.PI) / 180;
  return {
    xMm: rect.centerXMm + xMm * Math.cos(angle) - yMm * Math.sin(angle),
    yMm: rect.centerYMm + xMm * Math.sin(angle) + yMm * Math.cos(angle)
  };
}

// A coarse grid interval near bounds/10 — legible without the per-unit
// precision math the real export uses (a faint hint, not a measuring grid).
const NICE_STEPS_MM = [
  50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10_000, 20_000, 50_000
];
function coarseGridStepMm(spanMm: number): number {
  const target = spanMm / 10;
  return (
    NICE_STEPS_MM.find((step) => step >= target) ??
    NICE_STEPS_MM[NICE_STEPS_MM.length - 1]
  );
}

// ── Room-scope filter (a pure mirror of pdf/planPage.ts's roomScene, kept here
// so the preview never imports the pdf-lib-bearing pdf/ modules). ────────────
function roomScenePreview(
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

function gridMarks(bounds: DocumentBoundsMm, xf: Transform, key: string) {
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

function rectPolyPoints(rect: PlanRect, xf: Transform): string {
  return planRectCorners(rect)
    .map(xf.point)
    .map((p) => `${p.x},${p.y}`)
    .join(" ");
}

function planObjectMarks(
  rect: PlanRect,
  kind: string,
  isFloor: boolean,
  xf: Transform,
  key: string,
  // A hinged door's swing glyph off the plan scene (PlanSceneWallObject
  // .doorSwing) — the same object the canvas and the PDF writer draw. Never
  // recomputed here: the preview drifting from the artifact it previews is
  // exactly the failure this module's shared-glyph rule exists to prevent.
  swing?: DoorSwingPlanGlyph
): JSX.Element {
  const world = (xMm: number, yMm: number) =>
    xf.point(localToWorld(rect, xMm, yMm));
  const halfW = rect.widthMm / 2;
  const halfD = rect.depthMm / 2;
  const inner: JSX.Element[] = [];

  if (kind === "artwork") {
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

function planPageMarks(
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
            xf,
            `fobj-${i}`
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

function svgPolygonPointsScreen(
  polygonMm: { xMm: number; yMm: number }[],
  xf: Transform
): string {
  return polygonMm.map((p) => xf.point(p)).map((p) => `${p.x},${p.y}`).join(" ");
}

function elevationPageMarks(
  scene: ElevationScene,
  bounds: DocumentBoundsMm,
  xf: Transform,
  settings: EffectiveDocumentSettings,
  withDimensions: boolean
): JSX.Element[] {
  const marks: JSX.Element[] = [];
  const topLeft = xf.point({ xMm: 0, yMm: 0 });
  const w = scene.wallLengthMm * xf.scalePtPerMm;
  const h = scene.wallHeightMm * xf.scalePtPerMm;

  marks.push(
    <rect
      key="wall"
      x={topLeft.x}
      y={topLeft.y}
      width={w}
      height={h}
      fill="#ffffff"
      stroke={MUTED}
      strokeWidth={0.75}
    />
  );
  if (settings.grid) marks.push(...gridMarks(bounds, xf, "egrid"));

  // Floor line at the bottom edge.
  const floorA = xf.point({ xMm: 0, yMm: scene.wallHeightMm });
  const floorB = xf.point({ xMm: scene.wallLengthMm, yMm: scene.wallHeightMm });
  marks.push(
    <line
      key="floor"
      x1={floorA.x}
      y1={floorA.y}
      x2={floorB.x}
      y2={floorB.y}
      stroke={INK}
      strokeWidth={1.4}
    />
  );

  // Freestanding floor-case ghosts (dashed, low opacity), behind wall objects.
  scene.floorCaseGhosts.forEach((ghost, i) => {
    const topY = scene.wallHeightMm - ghost.heightMm;
    const a = xf.point({ xMm: ghost.xMinMm, yMm: topY });
    marks.push(
      <rect
        key={`ghost-${i}`}
        x={a.x}
        y={a.y}
        width={(ghost.xMaxMm - ghost.xMinMm) * xf.scalePtPerMm}
        height={ghost.heightMm * xf.scalePtPerMm}
        fill="none"
        stroke={SUBTLE}
        strokeWidth={0.5}
        strokeDasharray="3 2"
        opacity={0.7}
      />
    );
  });

  // Artworks: the stored image rect, filled (no per-artwork thumbnail data in
  // the dialog), with a muted border.
  scene.artworks.forEach((entry, i) => {
    const r = getArtworkRectSvg(scene.wallHeightMm, entry.centerMm, entry.sizeMm);
    const a = xf.point({ xMm: r.xMm, yMm: r.yMm });
    marks.push(
      <rect
        key={`art-${i}`}
        x={a.x}
        y={a.y}
        width={r.widthMm * xf.scalePtPerMm}
        height={r.heightMm * xf.scalePtPerMm}
        fill={FILL_WEAK}
        stroke={MUTED}
        strokeWidth={0.75}
      />
    );
  });

  // Openings: bordered rect, plus one mark per kind.
  scene.openings.forEach((entry, i) => {
    const r = getArtworkRectSvg(scene.wallHeightMm, entry.centerMm, entry.sizeMm);
    const a = xf.point({ xMm: r.xMm, yMm: r.yMm });
    const rw = r.widthMm * xf.scalePtPerMm;
    const rh = r.heightMm * xf.scalePtPerMm;
    marks.push(
      <rect
        key={`open-${i}`}
        x={a.x}
        y={a.y}
        width={rw}
        height={rh}
        fill="#ffffff"
        stroke={MUTED}
        strokeWidth={0.75}
      />
    );
    // A HINGED door gets the shared leaf panel + latch knob (the same glyph
    // the canvas and the PDF draw). The glyph's frame is y-DOWN from the
    // opening's top-left, which is exactly what getArtworkRectSvg returns, so
    // — unlike the plan glyph above — nothing flips here.
    const leaf =
      entry.object.kind === "door" ? entry.object.leaf : undefined;
    const doorGlyph = leaf
      ? doorElevationGlyph({
          widthMm: entry.sizeMm.widthMm,
          heightMm: entry.sizeMm.heightMm,
          hingeAtStart: leaf.hingeAtStart
        })
      : undefined;
    if (doorGlyph?.showMarks) {
      const leafOrigin = xf.point({
        xMm: r.xMm + doorGlyph.leafRect.xMm,
        yMm: r.yMm + doorGlyph.leafRect.yMm
      });
      marks.push(
        <rect
          key={`open-leaf-${i}`}
          x={leafOrigin.x}
          y={leafOrigin.y}
          width={doorGlyph.leafRect.widthMm * xf.scalePtPerMm}
          height={doorGlyph.leafRect.heightMm * xf.scalePtPerMm}
          fill="none"
          stroke={MUTED}
          strokeWidth={0.5}
        />
      );
      if (doorGlyph.knob) {
        const knob = xf.point({
          xMm: r.xMm + doorGlyph.knob.cxMm,
          yMm: r.yMm + doorGlyph.knob.cyMm
        });
        marks.push(
          <circle
            key={`open-knob-${i}`}
            cx={knob.x}
            cy={knob.y}
            r={doorGlyph.knob.radiusMm * xf.scalePtPerMm}
            fill={MUTED}
          />
        );
      }
    } else if (entry.object.kind !== "door") {
      // The coarse corner-to-corner hint this card has always used for
      // openings, now scoped to windows and blocked zones. A DOORWAY gets
      // nothing: it is a void, and both the canvas and the PDF draw it as a
      // bare outline (a1ebe03 removed the last unconditional door marks).
      // Keeping the diagonal only here would make the preview assert a leaf on
      // a door that has none — the precise drift this pass exists to close.
      marks.push(
        <line
          key={`open-d-${i}`}
          x1={a.x}
          y1={a.y + rh}
          x2={a.x + rw}
          y2={a.y}
          stroke={SUBTLE}
          strokeWidth={0.5}
        />
      );
    }
  });

  // Wall texts: bordered panel with a couple of skeleton bars.
  scene.wallTexts.forEach((entry, i) => {
    const r = getArtworkRectSvg(scene.wallHeightMm, entry.centerMm, entry.sizeMm);
    const a = xf.point({ xMm: r.xMm, yMm: r.yMm });
    const rw = r.widthMm * xf.scalePtPerMm;
    const rh = r.heightMm * xf.scalePtPerMm;
    marks.push(
      <rect
        key={`wt-${i}`}
        x={a.x}
        y={a.y}
        width={rw}
        height={rh}
        fill="#ffffff"
        stroke={MUTED}
        strokeWidth={0.6}
      />,
      <line
        key={`wt-l1-${i}`}
        x1={a.x + rw * 0.15}
        y1={a.y + rh * 0.42}
        x2={a.x + rw * 0.85}
        y2={a.y + rh * 0.42}
        stroke={SUBTLE}
        strokeWidth={0.5}
      />,
      <line
        key={`wt-l2-${i}`}
        x1={a.x + rw * 0.15}
        y1={a.y + rh * 0.6}
        x2={a.x + rw * 0.62}
        y2={a.y + rh * 0.6}
        stroke={SUBTLE}
        strokeWidth={0.5}
      />
    );
  });

  // Wall cases: outline + glass-lid + base-slab lines.
  scene.cases.forEach((entry, i) => {
    const r = getArtworkRectSvg(scene.wallHeightMm, entry.centerMm, entry.sizeMm);
    const a = xf.point({ xMm: r.xMm, yMm: r.yMm });
    const rw = r.widthMm * xf.scalePtPerMm;
    const rh = r.heightMm * xf.scalePtPerMm;
    marks.push(
      <rect
        key={`case-${i}`}
        x={a.x}
        y={a.y}
        width={rw}
        height={rh}
        fill="#ffffff"
        stroke={MUTED}
        strokeWidth={0.75}
      />
    );
    const glyph = caseElevationGlyph({
      widthMm: entry.sizeMm.widthMm,
      heightMm: entry.sizeMm.heightMm
    });
    if (glyph.showMarks) {
      const lid1 = xf.point({ xMm: r.xMm + glyph.glassLid.x1Mm, yMm: r.yMm + glyph.glassLid.yMm });
      const lid2 = xf.point({ xMm: r.xMm + glyph.glassLid.x2Mm, yMm: r.yMm + glyph.glassLid.yMm });
      const slab1 = xf.point({ xMm: r.xMm + glyph.slab.x1Mm, yMm: r.yMm + glyph.slab.yMm });
      const slab2 = xf.point({ xMm: r.xMm + glyph.slab.x2Mm, yMm: r.yMm + glyph.slab.yMm });
      marks.push(
        <line key={`case-lid-${i}`} x1={lid1.x} y1={lid1.y} x2={lid2.x} y2={lid2.y} stroke={SUBTLE} strokeWidth={0.5} />,
        <line key={`case-slab-${i}`} x1={slab1.x} y1={slab1.y} x2={slab2.x} y2={slab2.y} stroke={SUBTLE} strokeWidth={0.5} />
      );
    }
  });

  // Dimension hint: a thin baseline rule just below the floor (no labels).
  if (withDimensions) {
    const y = floorA.y + 8;
    marks.push(
      <line key="edim" x1={floorA.x} y1={y} x2={floorB.x} y2={y} stroke={MUTED} strokeWidth={0.4} />
    );
  }

  return marks;
}

// Build the elevation scene for one wall the same way createDocumentPdf does.
function buildElevationForPage(
  project: Project,
  page: Extract<DocumentPageManifest, { kind: "elevation" }>,
  artworksById: ReadonlyMap<string, Artwork>
): ElevationScene | null {
  const placement = project.floor.rooms.find(
    (candidate) => candidate.roomId === page.roomId
  );
  const wall = placement
    ? getRoomPlaceableWalls(placement.room).find(
        (candidate) => candidate.id === page.wallId
      )
    : undefined;
  if (!placement || !wall) return null;

  const roomPolygonMm = placement.room.vertices.map((vertex) => ({
    xMm: vertex.xMm + placement.offsetXMm,
    yMm: vertex.yMm + placement.offsetYMm
  }));
  const floorCases = project.floorObjects.filter(
    (object): object is CaseFloorObject =>
      object.kind === "case" &&
      isPointInPolygon({ xMm: object.xMm, yMm: object.yMm }, roomPolygonMm)
  );
  return buildElevationScene(project.wallObjects, {
    wallId: wall.id,
    wallLengthMm: wall.lengthMm,
    wallHeightMm: wall.heightMm,
    centerlineMm:
      wall.defaultCenterlineHeightMm ?? project.defaultCenterlineHeightMm,
    artworksById,
    floorCases,
    wallStartFloorMm: {
      xMm: wall.start.xMm + placement.offsetXMm,
      yMm: wall.start.yMm + placement.offsetYMm
    },
    wallEndFloorMm: {
      xMm: wall.end.xMm + placement.offsetXMm,
      yMm: wall.end.yMm + placement.offsetYMm
    }
  });
}

// Page-card sizing: exact aspect ratio, width-driven, but never taller than
// ~a third of the viewport — the preview is pinned above the scrolling
// controls, so its height budget has to leave the Options group room on
// short screens. Computing width from the height cap (instead of max-height)
// keeps the card's border hugging the page proportions exactly.
function previewCardStyle(widthPt: number, heightPt: number) {
  const ratio = widthPt / heightPt;
  return {
    aspectRatio: `${widthPt} / ${heightPt}`,
    width: `min(100%, calc(min(280px, 22dvh) * ${ratio.toFixed(4)}))`
  };
}

type ExportPdfPreviewProps = {
  project: Project;
  settings: EffectiveDocumentSettings;
  artworksById?: ReadonlyMap<string, Artwork>;
  thumbnailUrls?: Readonly<Record<string, string>>;
};

export function ExportPdfPreview({
  project,
  settings,
  artworksById = new Map(),
  thumbnailUrls = {}
}: ExportPdfPreviewProps) {
  const pages = useMemo(
    () => derivePreviewPages(project, settings, artworksById),
    [project, settings, artworksById]
  );
  // Full plan scene once — overview and every room page filter this same build.
  const fullPlanScene = useMemo(
    () => buildPlanScene(project, { artworksById }),
    [project, artworksById]
  );

  // Empty-state card keeps the chosen paper's portrait proportions, so
  // switching paper size reads in the preview even with nothing selected.
  const emptyPageSize = getPageSizePt(settings.paperSize, "portrait");

  const total = pages.length;
  const [index, setIndex] = useState(0);
  // Clamp back into range when the manifest shrinks under the cursor.
  useEffect(() => {
    setIndex((current) => clampPageIndex(current, total));
  }, [total]);
  const safeIndex = clampPageIndex(index, total);
  const page: PreviewPage | undefined = pages[safeIndex];

  // <section>, not <aside>: this now lives inside the dialog's options rail
  // (itself an aside), so it's a named region rather than a nested landmark.
  return (
    <section className="export-preview" aria-label="PDF preview">
      {page ? (
        <PreviewPageCard
          page={page}
          project={project}
          settings={settings}
          fullPlanScene={fullPlanScene}
          artworksById={artworksById}
          thumbnailUrls={thumbnailUrls}
        />
      ) : (
        <div
          className="export-preview-card export-preview-empty"
          style={previewCardStyle(emptyPageSize.widthPt, emptyPageSize.heightPt)}
        >
          <span>Nothing selected</span>
        </div>
      )}
      <div className="export-preview-pager">
        <Button
          aria-label="Previous page"
          className="export-preview-pager-button"
          disabled={total === 0 || safeIndex <= 0}
          size="icon-sm"
          variant="ghost"
          onClick={() => setIndex((current) => clampPageIndex(current - 1, total))}
        >
          <CaretLeftIcon aria-hidden="true" size={16} />
        </Button>
        <span className="export-preview-caption" aria-live="polite">
          {page
            ? previewPageCaption(page, total)
            : "No pages to preview"}
        </span>
        <Button
          aria-label="Next page"
          className="export-preview-pager-button"
          disabled={total === 0 || safeIndex >= total - 1}
          size="icon-sm"
          variant="ghost"
          onClick={() => setIndex((current) => clampPageIndex(current + 1, total))}
        >
          <CaretRightIcon aria-hidden="true" size={16} />
        </Button>
      </div>
    </section>
  );
}

function PreviewPageCard({
  page,
  project,
  settings,
  fullPlanScene,
  artworksById,
  thumbnailUrls
}: {
  page: PreviewPage;
  project: Project;
  settings: EffectiveDocumentSettings;
  fullPlanScene: PlanScene;
  artworksById: ReadonlyMap<string, Artwork>;
  thumbnailUrls: Readonly<Record<string, string>>;
}) {
  const manifest = page.manifest;
  const orientation = manifest.orientation;
  const pageSize = getPageSizePt(settings.paperSize, orientation);

  const svgChildren = useMemo(() => {
    const rect = drawingRectPt(settings.paperSize, orientation);
    if (manifest.kind === "three-d") {
      return null; // rendered as an image below, not SVG marks
    }
    if (manifest.kind === "elevation") {
      const scene = buildElevationForPage(project, manifest, artworksById);
      if (!scene) return [];
      const bounds = manifest.boundsMm;
      const fit = fitBoundsToRect(bounds, rect);
      const xf = elevationTransform(bounds, fit);
      return elevationPageMarks(scene, bounds, xf, settings, settings.dimensions);
    }
    // overview / room-plan
    const scene =
      manifest.kind === "overview"
        ? fullPlanScene
        : roomScenePreview(fullPlanScene, project, manifest.roomId);
    const bounds =
      manifest.kind === "overview"
        ? getPlanSceneBounds(fullPlanScene)
        : manifest.boundsMm;
    const fit = fitBoundsToRect(bounds, rect);
    const xf = planTransform(bounds, fit);
    // Room plans carry dimensions; the overview never does (matches the export).
    const withDimensions =
      settings.dimensions && manifest.kind === "room-plan";
    return planPageMarks(scene, bounds, xf, settings, withDimensions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, project, settings, fullPlanScene, artworksById, orientation]);

  const thumbnailSrc =
    manifest.kind === "three-d" ? thumbnailUrls[manifest.savedViewId] : undefined;

  return (
    <div
      className="export-preview-card"
      style={previewCardStyle(pageSize.widthPt, pageSize.heightPt)}
    >
      <svg
        className="export-preview-svg"
        viewBox={`0 0 ${pageSize.widthPt} ${pageSize.heightPt}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={page.detail}
      >
        <rect x={0} y={0} width={pageSize.widthPt} height={pageSize.heightPt} fill="#ffffff" />
        {/* Header band echo: the page title, small, top-left. */}
        <text
          x={DOCUMENT_PAGE_MARGIN_PT}
          y={DOCUMENT_PAGE_MARGIN_PT + 14}
          fontSize={11}
          fontWeight={600}
          fill={INK}
        >
          {manifest.title}
        </text>
        {manifest.kind === "three-d" ? (
          <ThreeDPageContent
            manifest={manifest}
            paperSize={settings.paperSize}
            orientation={orientation}
            src={thumbnailSrc}
          />
        ) : (
          svgChildren
        )}
      </svg>
    </div>
  );
}

function ThreeDPageContent({
  paperSize,
  orientation,
  src
}: {
  manifest: Extract<DocumentPageManifest, { kind: "three-d" }>;
  paperSize: EffectiveDocumentSettings["paperSize"];
  orientation: DocumentOrientation;
  src?: string;
}) {
  const rect = drawingRectPt(paperSize, orientation);
  if (src) {
    return (
      <image
        href={src}
        x={rect.xPt}
        y={rect.yPt}
        width={rect.widthPt}
        height={rect.heightPt}
        preserveAspectRatio="xMidYMid meet"
      />
    );
  }
  return (
    <rect
      x={rect.xPt}
      y={rect.yPt}
      width={rect.widthPt}
      height={rect.heightPt}
      fill={FILL_WEAK}
      stroke={MUTED}
      strokeWidth={0.7}
    />
  );
}
