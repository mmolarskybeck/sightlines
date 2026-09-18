import type {
  Artwork,
  ArtworkFloorObject,
  CaseFloorObject,
  Project
} from "../../../domain/project";
import { caseElevationGlyph } from "../../../domain/geometry/caseGlyphs";
import { monitorElevationGlyph } from "../../../domain/geometry/monitorGlyphs";
import { doorElevationGlyph } from "../../../domain/geometry/doorGlyphs";
import { getRoomPlaceableWalls } from "../../../domain/geometry/placeableWalls";
import { getFloorPartitions } from "../../../domain/geometry/freestandingWalls";
import { selectElevationPartitions } from "../../../domain/placement/partitionNeighbors";
import { isPointInPolygon } from "../../../domain/geometry/polygon";
import {
  SUSPENSION_WIRE_INSET_FRACTION,
  SUSPENSION_WIRE_INSET_MM
} from "../../../domain/project";
import {
  buildElevationScene,
  getArtworkRectSvg,
  type ElevationScene
} from "../../../domain/scene2d/elevationScene";
import type {
  DocumentBoundsMm,
  DocumentPageManifest
} from "../../../domain/export/pageComposition";
import type { EffectiveDocumentSettings } from "../../../domain/export/documentSettings";
import {
  FILL_WEAK,
  GHOST_DASH,
  GHOST_OPACITY,
  GHOST_STROKE_WIDTH,
  GHOST_WIRE_DASH,
  GHOST_WIRE_OPACITY,
  GHOST_WIRE_WIDTH,
  INK,
  MUTED,
  SUBTLE,
  type Transform
} from "./previewStyle";
import { gridMarks } from "./planPageMarks";

export function elevationPageMarks(
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
        strokeWidth={GHOST_STROKE_WIDTH}
        strokeDasharray={GHOST_DASH}
        opacity={GHOST_OPACITY}
      />
    );
  });

  // Suspended-artwork ghosts (boards hung above the floor): the board floats
  // between baseHeightMm and baseHeightMm + heightMm rather than standing on
  // the floor line, plus two suspension wires up to the wall's top edge — the
  // print twin of drawElevationSuspendedArtworkGhost / the canvas component,
  // same behind-the-wall-objects paint slot as the floor-case ghosts above.
  scene.suspendedArtworkGhosts.forEach((ghost, i) => {
    const topMm = ghost.baseHeightMm + ghost.heightMm;
    const topY = scene.wallHeightMm - topMm;
    const a = xf.point({ xMm: ghost.xMinMm, yMm: topY });
    const widthMm = Math.max(0, ghost.xMaxMm - ghost.xMinMm);
    if (topMm < scene.wallHeightMm) {
      const wireInsetMm = Math.min(
        SUSPENSION_WIRE_INSET_MM,
        widthMm * SUSPENSION_WIRE_INSET_FRACTION
      );
      const wireStartX = xf.point({ xMm: ghost.xMinMm + wireInsetMm, yMm: 0 }).x;
      const wireEndX = xf.point({ xMm: ghost.xMaxMm - wireInsetMm, yMm: 0 }).x;
      const wireTopY = xf.point({ xMm: 0, yMm: 0 }).y;
      marks.push(
        <line
          key={`suspended-wire-l-${i}`}
          x1={wireStartX}
          y1={wireTopY}
          x2={wireStartX}
          y2={a.y}
          stroke={SUBTLE}
          strokeWidth={GHOST_WIRE_WIDTH}
          strokeDasharray={GHOST_WIRE_DASH}
          opacity={GHOST_WIRE_OPACITY}
        />,
        <line
          key={`suspended-wire-r-${i}`}
          x1={wireEndX}
          y1={wireTopY}
          x2={wireEndX}
          y2={a.y}
          stroke={SUBTLE}
          strokeWidth={GHOST_WIRE_WIDTH}
          strokeDasharray={GHOST_WIRE_DASH}
          opacity={GHOST_WIRE_OPACITY}
        />
      );
    }
    marks.push(
      <rect
        key={`suspended-ghost-${i}`}
        x={a.x}
        y={a.y}
        width={widthMm * xf.scalePtPerMm}
        height={ghost.heightMm * xf.scalePtPerMm}
        fill="none"
        stroke={SUBTLE}
        strokeWidth={GHOST_STROKE_WIDTH}
        strokeDasharray={GHOST_DASH}
        opacity={GHOST_OPACITY}
      />
    );
  });

  // Supported-artwork ghosts: a pedestal/plinth block on the floor line, the
  // work standing on it, an optional plexi bonnet over both — the print twin of
  // drawElevationSupportedArtworkGhost / the canvas component, same
  // behind-the-wall-objects slot. TWO SPANS: the support's own bounds the
  // support and the bonnet, the work's own bounds the work rect above it, and a LOCKED
  // bonnet shorter than its work leaves the work drawn straight through it.
  scene.supportedArtworkGhosts.forEach((ghost, i) => {
    const supportWidthMm = Math.max(0, ghost.supportXMaxMm - ghost.supportXMinMm);
    const workWidthMm = Math.max(0, ghost.workXMaxMm - ghost.workXMinMm);
    // This preview's own space is SVG-y-down from the wall top, so each box's
    // top edge is the wall height less its own top in wall-local y-up.
    const topY = (bottomMm: number, heightMm: number) =>
      xf.point({ xMm: 0, yMm: scene.wallHeightMm - (bottomMm + heightMm) }).y;
    marks.push(
      <rect
        key={`supported-ghost-support-${i}`}
        x={xf.point({ xMm: ghost.supportXMinMm, yMm: 0 }).x}
        y={topY(0, ghost.supportHeightMm)}
        width={supportWidthMm * xf.scalePtPerMm}
        height={ghost.supportHeightMm * xf.scalePtPerMm}
        fill="none"
        stroke={SUBTLE}
        strokeWidth={GHOST_STROKE_WIDTH}
        strokeDasharray={GHOST_DASH}
        opacity={GHOST_OPACITY}
      />,
      <rect
        key={`supported-ghost-work-${i}`}
        x={xf.point({ xMm: ghost.workXMinMm, yMm: 0 }).x}
        y={topY(ghost.supportHeightMm, ghost.workHeightMm)}
        width={workWidthMm * xf.scalePtPerMm}
        height={ghost.workHeightMm * xf.scalePtPerMm}
        fill="none"
        stroke={SUBTLE}
        strokeWidth={GHOST_STROKE_WIDTH}
        strokeDasharray={GHOST_DASH}
        opacity={GHOST_OPACITY}
      />
    );
    if (ghost.bonnetHeightMm !== undefined) {
      marks.push(
        <rect
          key={`supported-ghost-bonnet-${i}`}
          x={xf.point({ xMm: ghost.supportXMinMm, yMm: 0 }).x}
          y={topY(ghost.supportHeightMm, ghost.bonnetHeightMm)}
          width={supportWidthMm * xf.scalePtPerMm}
          height={ghost.bonnetHeightMm * xf.scalePtPerMm}
          fill="none"
          stroke={SUBTLE}
          strokeWidth={GHOST_WIRE_WIDTH}
          strokeDasharray={GHOST_WIRE_DASH}
          opacity={GHOST_WIRE_OPACITY}
        />
      );
    }
  });

  // Box-monitor ghosts: pedestal + cabinet + screen, standing on the floor line
  // — the print twin of drawElevationMonitorGhost / the canvas component, off
  // the same shared glyph, in the same behind-the-wall-objects slot.
  scene.monitorGhosts.forEach((ghost, i) => {
    const widthMm = Math.max(0, ghost.xMaxMm - ghost.xMinMm);
    const glyph = monitorElevationGlyph({
      widthMm,
      monitorHeightMm: ghost.monitorHeightMm,
      pedestalHeightMm: ghost.pedestalHeightMm,
      // Plinth and bonnet span the SUPPORT, not the cabinet — the same two
      // spans the canvas and the PDF page use, collapsing to one for a legacy
      // monitor's own default pedestal.
      pedestalXMm: ghost.supportXMinMm - ghost.xMinMm,
      pedestalWidthMm: Math.max(0, ghost.supportXMaxMm - ghost.supportXMinMm),
      bonnetHeightMm: ghost.bonnetHeightMm
    });
    // This preview's own space is SVG-y-down from the wall top, and the glyph
    // is local-y-down from the assembly's top, so both flips are one addition.
    const topSvgYMm = scene.wallHeightMm - glyph.totalHeightMm;
    const parts = [
      glyph.pedestal ? { key: "pedestal", rect: glyph.pedestal } : null,
      { key: "cabinet", rect: glyph.monitor },
      glyph.screen ? { key: "screen", rect: glyph.screen } : null
    ].filter((part): part is { key: string; rect: { xMm: number; yMm: number; widthMm: number; heightMm: number } } => part !== null);
    for (const part of parts) {
      const a = xf.point({
        xMm: ghost.xMinMm + part.rect.xMm,
        yMm: topSvgYMm + part.rect.yMm
      });
      marks.push(
        <rect
          key={`monitor-ghost-${part.key}-${i}`}
          x={a.x}
          y={a.y}
          width={part.rect.widthMm * xf.scalePtPerMm}
          height={part.rect.heightMm * xf.scalePtPerMm}
          fill="none"
          stroke={SUBTLE}
          strokeWidth={GHOST_STROKE_WIDTH}
          strokeDasharray={GHOST_DASH}
          opacity={GHOST_OPACITY}
        />
      );
    }
    // The plexi bonnet over the cabinet, at the plinth's span, in the finer
    // wire weight the screen and the supported-artwork bonnet take.
    if (glyph.bonnet) {
      const a = xf.point({
        xMm: ghost.xMinMm + glyph.bonnet.xMm,
        yMm: topSvgYMm + glyph.bonnet.yMm
      });
      marks.push(
        <rect
          key={`monitor-ghost-bonnet-${i}`}
          x={a.x}
          y={a.y}
          width={glyph.bonnet.widthMm * xf.scalePtPerMm}
          height={glyph.bonnet.heightMm * xf.scalePtPerMm}
          fill="none"
          stroke={SUBTLE}
          strokeWidth={GHOST_WIRE_WIDTH}
          strokeDasharray={GHOST_WIRE_DASH}
          opacity={GHOST_WIRE_OPACITY}
        />
      );
    }
  });

  // Free-standing partitions projected onto this wall. Non-abutting ones ghost
  // here with the floor cases; abutting ones are a solid band after the wall
  // objects (below), mirroring the page's own paint order.
  scene.partitionProfiles.forEach((profile, i) => {
    if (profile.abutting) return;
    const a = xf.point({ xMm: profile.xMinMm, yMm: scene.wallHeightMm - profile.heightMm });
    marks.push(
      <rect
        key={`partition-ghost-${i}`}
        x={a.x}
        y={a.y}
        width={(profile.xMaxMm - profile.xMinMm) * xf.scalePtPerMm}
        height={profile.heightMm * xf.scalePtPerMm}
        fill="none"
        stroke={SUBTLE}
        strokeWidth={GHOST_STROKE_WIDTH}
        strokeDasharray={GHOST_DASH}
        opacity={GHOST_OPACITY}
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

  // Wall shelves: one filled slab band each, from the scene entry's span (the
  // same numbers drawElevationShelf prints) — filled rather than outlined, the
  // way the canvas draws it, because a shelf is a surface a work stands on.
  scene.shelves.forEach((shelf, i) => {
    const a = xf.point({
      xMm: shelf.xMinMm,
      yMm: scene.wallHeightMm - (shelf.yMm + shelf.heightMm / 2)
    });
    marks.push(
      <rect
        key={`shelf-${i}`}
        x={a.x}
        y={a.y}
        width={(shelf.xMaxMm - shelf.xMinMm) * xf.scalePtPerMm}
        height={shelf.heightMm * xf.scalePtPerMm}
        fill={FILL_WEAK}
        stroke={MUTED}
        strokeWidth={0.75}
      />
    );
  });

  // Abutting partitions: a solid slab over the wall objects, same ink/opacity
  // as the plan page's partition slabs.
  scene.partitionProfiles.forEach((profile, i) => {
    if (!profile.abutting) return;
    const a = xf.point({ xMm: profile.xMinMm, yMm: scene.wallHeightMm - profile.heightMm });
    marks.push(
      <rect
        key={`partition-slab-${i}`}
        x={a.x}
        y={a.y}
        width={(profile.xMaxMm - profile.xMinMm) * xf.scalePtPerMm}
        height={profile.heightMm * xf.scalePtPerMm}
        fill={INK}
        opacity={0.72}
      />
    );
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
export function buildElevationForPage(
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
  // Same room filter, applied to floor artworks — mirrors
  // createDocumentPdf.ts's elevationFloorArtworks; the builder itself gates
  // on baseHeightMm > 0.
  const floorArtworks = project.floorObjects.filter(
    (object): object is ArtworkFloorObject =>
      object.kind === "artwork" &&
      isPointInPolygon({ xMm: object.xMm, yMm: object.yMm }, roomPolygonMm)
  );
  // Same two partition gates createDocumentPdf applies: room-owned, minus the
  // partition this page's own face belongs to.
  const partitions = selectElevationPartitions(getFloorPartitions(project.floor), {
    roomId: page.roomId,
    wallId: wall.id
  });
  return buildElevationScene(project.wallObjects, {
    wallId: wall.id,
    wallLengthMm: wall.lengthMm,
    wallHeightMm: wall.heightMm,
    centerlineMm:
      wall.defaultCenterlineHeightMm ?? project.defaultCenterlineHeightMm,
    artworksById,
    floorCases,
    floorArtworks,
    partitions,
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
