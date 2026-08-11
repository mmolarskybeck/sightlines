import type { PDFPage } from "pdf-lib";
import {
  caseElevationGlyph,
  caseFloorGhostGlyph
} from "../../../domain/geometry/caseGlyphs";
import { doorElevationGlyph } from "../../../domain/geometry/doorGlyphs";
import {
  SUSPENSION_WIRE_INSET_FRACTION,
  SUSPENSION_WIRE_INSET_MM,
  type DisplayUnit
} from "../../../domain/project";
import type { ElevationScene } from "../../../domain/scene2d/elevationScene";
import { computeWallTextSkeleton } from "../../../domain/scene2d/wallTextSkeleton";
import {
  getMajorGridIntervalMm,
  getMinorGridIntervalMm
} from "../../../domain/units/precision";
import {
  COLORS,
  GRID_TARGET_PT,
  drawLine,
  drawWrappedCenteredText,
  gridStart,
  type PdfFonts
} from "./primitives";
import { elevationRect, type ElevationTransform } from "./transforms";

// Shared dashed/subtle vocabulary for every elevation ghost (freestanding
// floor cases, suspended-artwork boards, non-abutting partitions): the print
// twin of the CSS ghost boldening (global.css .elevation-*-ghost, 1→1.5,
// 0.55→0.78 opacity). Bumped from the original 0.5pt/COLORS.subtle pairing —
// users read that as too faint next to a real artwork's 0.65-0.75pt
// COLORS.muted outline — but kept below that thickness, and still
// COLORS.subtle rather than COLORS.muted: there's no PDF gray strictly
// between the two (see COLORS in primitives.ts), so width alone carries the
// "still subordinate" read, same call the CSS pass made.
const GHOST_BORDER_WIDTH_PT = 0.6;
const GHOST_DASH: [number, number] = [3, 2];
// Wires read as hairlines relative to the board they carry — one step
// thinner than GHOST_BORDER_WIDTH_PT, echoing the CSS wire rule.
const GHOST_WIRE_WIDTH_PT = 0.45;
const GHOST_WIRE_DASH: [number, number] = [2, 2];

export function drawElevationGrid(
  page: PDFPage,
  scene: ElevationScene,
  transform: ElevationTransform,
  unit: DisplayUnit
) {
  const minor = getMinorGridIntervalMm(unit, transform.scalePtPerMm, {
    targetMinorPx: GRID_TARGET_PT
  });
  const major = getMajorGridIntervalMm(unit, minor);
  const maxLines = 2_000;
  let count = 0;

  for (let x = 0; x <= scene.wallLengthMm && count < maxLines; x += minor, count += 1) {
    const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
    drawLine(
      page,
      transform.point({ xMm: x, yMm: 0 }),
      transform.point({ xMm: x, yMm: scene.wallHeightMm }),
      isMajor ? 0.45 : 0.25,
      isMajor ? COLORS.gridMajor : COLORS.gridMinor
    );
  }
  for (let y = 0; y <= scene.wallHeightMm && count < maxLines; y += minor, count += 1) {
    const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-6;
    drawLine(
      page,
      transform.point({ xMm: 0, yMm: y }),
      transform.point({ xMm: scene.wallLengthMm, yMm: y }),
      isMajor ? 0.45 : 0.25,
      isMajor ? COLORS.gridMajor : COLORS.gridMinor
    );
  }
}

export function drawArtworkPlaceholder(
  page: PDFPage,
  fonts: PdfFonts,
  rect: { x: number; y: number; width: number; height: number },
  label: string,
  unavailable: boolean
) {
  page.drawRectangle({
    ...rect,
    color: COLORS.surface,
    borderColor: COLORS.muted,
    borderWidth: 0.7
  });
  drawWrappedCenteredText(
    page,
    fonts,
    unavailable ? ["Image unavailable", label] : [label],
    rect
  );
}

export function drawElevationOpening(
  page: PDFPage,
  transform: ElevationTransform,
  opening: ElevationScene["openings"][number]
) {
  const xMm = opening.centerMm.xMm - opening.sizeMm.widthMm / 2;
  const yMm = opening.centerMm.yMm - opening.sizeMm.heightMm / 2;
  const rect = elevationRect(
    transform,
    xMm,
    yMm,
    opening.sizeMm.widthMm,
    opening.sizeMm.heightMm
  );
  page.drawRectangle({
    ...rect,
    borderColor: COLORS.muted,
    borderWidth: 0.7,
    ...(opening.object.kind === "blocked-zone"
      ? { color: COLORS.surfaceStrong }
      : {})
  });
  if (opening.object.kind === "window") {
    drawLine(
      page,
      { x: rect.x + rect.width / 2, y: rect.y },
      { x: rect.x + rect.width / 2, y: rect.y + rect.height },
      0.5,
      COLORS.muted
    );
    drawLine(
      page,
      { x: rect.x, y: rect.y + rect.height / 2 },
      { x: rect.x + rect.width, y: rect.y + rect.height / 2 },
      0.5,
      COLORS.muted
    );
  } else if (opening.object.kind === "door" && opening.object.leaf) {
    // A HINGED door's front face: an inset leaf panel and a latch-side knob,
    // the print twin of ElevationOpening.tsx's DoorLeaf. A plain doorway (no
    // `leaf`) still draws nothing but its outline — it is a void, and the
    // unconditional door lines a1ebe03 removed from this exact branch are NOT
    // revived here. Nor is any swing indication: an elevation cannot honestly
    // show swing depth, which was that commit's whole objection. `showMarks`
    // false (a door too narrow/short for its own reveal) falls through to the
    // bare outline the same way.
    const glyph = doorElevationGlyph({
      widthMm: opening.sizeMm.widthMm,
      heightMm: opening.sizeMm.heightMm,
      hingeAtStart: opening.object.leaf.hingeAtStart
    });
    if (glyph.showMarks) {
      // The glyph's frame is y-DOWN from the opening's TOP; this model space is
      // y-up with the floor at 0, so every local y subtracts from the top edge
      // (the same flip drawElevationCase does). Rectangles are placed by their
      // BOTTOM edge here, hence the extra leaf height in the conversion.
      const topYMm = yMm + opening.sizeMm.heightMm;
      page.drawRectangle({
        ...elevationRect(
          transform,
          xMm + glyph.leafRect.xMm,
          topYMm - glyph.leafRect.yMm - glyph.leafRect.heightMm,
          glyph.leafRect.widthMm,
          glyph.leafRect.heightMm
        ),
        borderColor: COLORS.muted,
        borderWidth: 0.5
      });
      if (glyph.knob) {
        // True mm radius scaled like every other length on the page — no
        // legibility floor, matching the canvas, where the knob is likewise a
        // scaling circle (only strokes are non-scaling there).
        const center = transform.point({
          xMm: xMm + glyph.knob.cxMm,
          yMm: topYMm - glyph.knob.cyMm
        });
        page.drawCircle({
          x: center.x,
          y: center.y,
          size: glyph.knob.radiusMm * transform.scalePtPerMm,
          color: COLORS.muted
        });
      }
    }
  } else if (opening.object.kind === "blocked-zone") {
    const step = 7;
    for (let x = rect.x - rect.height; x < rect.x + rect.width; x += step) {
      const startX = Math.max(rect.x, x);
      const startY = rect.y + Math.max(0, rect.x - x);
      const endX = Math.min(rect.x + rect.width, x + rect.height);
      const endY = rect.y + Math.min(rect.height, rect.x + rect.width - x);
      if (endX > startX) {
        drawLine(
          page,
          { x: startX, y: startY },
          { x: endX, y: endY },
          0.35,
          COLORS.subtle
        );
      }
    }
  }
}

// A white didactic panel with a subtle border and light-grey skeleton bars —
// the export twin of ElevationWallText / the 3D wall-text panel, all three
// sharing computeWallTextSkeleton so the bar layout is identical everywhere.
export function drawElevationWallText(
  page: PDFPage,
  transform: ElevationTransform,
  wallText: ElevationScene["wallTexts"][number]
) {
  const xMm = wallText.centerMm.xMm - wallText.sizeMm.widthMm / 2;
  const yMm = wallText.centerMm.yMm - wallText.sizeMm.heightMm / 2;
  const rect = elevationRect(
    transform,
    xMm,
    yMm,
    wallText.sizeMm.widthMm,
    wallText.sizeMm.heightMm
  );
  page.drawRectangle({
    ...rect,
    color: COLORS.white,
    borderColor: COLORS.muted,
    borderWidth: 0.7
  });
  const skeleton = computeWallTextSkeleton(wallText.sizeMm.widthMm, wallText.sizeMm.heightMm);
  for (const bar of skeleton.bars) {
    page.drawRectangle({
      // Bars are normalized top-left/y-down; PDF is y-up, so flip the top.
      x: rect.x + bar.xFrac * rect.width,
      y: rect.y + rect.height - (bar.yFrac + bar.heightFrac) * rect.height,
      width: bar.widthFrac * rect.width,
      height: bar.heightFrac * rect.height,
      color: COLORS.skeletonBar
    });
  }
}

// A wall display case in elevation: a solid side-profile box (outline) with a
// thin inner glass inset — the export twin of ElevationCase.tsx / the plan-view
// case glyph.
export function drawElevationCase(
  page: PDFPage,
  transform: ElevationTransform,
  displayCase: ElevationScene["cases"][number]
) {
  const xMm = displayCase.centerMm.xMm - displayCase.sizeMm.widthMm / 2;
  const yMm = displayCase.centerMm.yMm - displayCase.sizeMm.heightMm / 2;
  const rect = elevationRect(
    transform,
    xMm,
    yMm,
    displayCase.sizeMm.widthMm,
    displayCase.sizeMm.heightMm
  );
  page.drawRectangle({
    ...rect,
    color: COLORS.white,
    borderColor: COLORS.muted,
    borderWidth: 0.7
  });
  // Real front-face construction from the shared glyph (glass-lid line inset
  // between the tray walls + a base-slab line) instead of the old generic
  // 0.22 concentric inset. No live zoom, so the raw mm case constants apply;
  // the glyph is in local mm, y-DOWN from the box top — the model space here is
  // y-up, so the box top sits at (yMm + heightMm) and local y subtracts down.
  const widthMm = displayCase.sizeMm.widthMm;
  const heightMm = displayCase.sizeMm.heightMm;
  const glyph = caseElevationGlyph({ widthMm, heightMm });
  if (glyph.showMarks) {
    const topYMm = yMm + heightMm;
    const glassY = topYMm - glyph.glassLid.yMm;
    const slabY = topYMm - glyph.slab.yMm;
    drawLine(
      page,
      transform.point({ xMm: xMm + glyph.glassLid.x1Mm, yMm: glassY }),
      transform.point({ xMm: xMm + glyph.glassLid.x2Mm, yMm: glassY }),
      0.5,
      COLORS.subtle
    );
    drawLine(
      page,
      transform.point({ xMm: xMm + glyph.slab.x1Mm, yMm: slabY }),
      transform.point({ xMm: xMm + glyph.slab.x2Mm, yMm: slabY }),
      0.5,
      COLORS.subtle
    );
  }
}

// The elevation shadow of a freestanding floor case standing in front of the
// wall: a light dashed outline from the floor line up to the case height,
// spanning the along-wall range its footprint projects onto. Non-structural —
// drawn before the wall objects (an alignment aid, never an occluder).
export function drawElevationFloorCaseGhost(
  page: PDFPage,
  transform: ElevationTransform,
  ghost: ElevationScene["floorCaseGhosts"][number]
) {
  const widthMm = Math.max(0, ghost.xMaxMm - ghost.xMinMm);
  const glyph = caseFloorGhostGlyph({ widthMm, heightMm: ghost.heightMm });
  const dash = {
    borderColor: COLORS.subtle,
    borderWidth: GHOST_BORDER_WIDTH_PT,
    borderDashArray: GHOST_DASH
  };

  if (!glyph.hasLegs) {
    // Too short for legs — a plain dashed silhouette, exactly as before.
    page.drawRectangle({
      ...elevationRect(transform, ghost.xMinMm, 0, widthMm, ghost.heightMm),
      ...dash
    });
    return;
  }

  // The real ghost construction (glass box + base slab line + two legs to the
  // floor), all kept dashed/subtle since the whole ghost is an alignment aid.
  // Model space is y-up (floor at 0); the glyph is local y-down from the top,
  // so a local y maps to model (heightMm − localY).
  const glassBox = glyph.glassBox;
  page.drawRectangle({
    ...elevationRect(
      transform,
      ghost.xMinMm,
      ghost.heightMm - glassBox.heightMm,
      glassBox.widthMm,
      glassBox.heightMm
    ),
    ...dash
  });
  const slabY = ghost.heightMm - glyph.slabYMm;
  drawLine(
    page,
    transform.point({ xMm: ghost.xMinMm, yMm: slabY }),
    transform.point({ xMm: ghost.xMinMm + widthMm, yMm: slabY }),
    GHOST_BORDER_WIDTH_PT,
    COLORS.subtle,
    GHOST_DASH
  );
  for (const leg of glyph.legs) {
    drawLine(
      page,
      transform.point({ xMm: ghost.xMinMm + leg.xMm, yMm: slabY }),
      transform.point({ xMm: ghost.xMinMm + leg.xMm, yMm: ghost.heightMm - glyph.floorYMm }),
      GHOST_BORDER_WIDTH_PT,
      COLORS.subtle,
      GHOST_DASH
    );
  }
}

// The elevation shadow of a SUSPENDED floor artwork (a board hung from
// ceiling wires) — the print twin of ElevationSuspendedArtworkGhost.tsx.
// Unlike the floor-case ghost this does NOT stand on the floor line: this
// module's model space is wall-local y-up with the floor at 0 (see the caller
// in createDocumentPdf.ts drawing the floor line at yMm=0), so the board's
// bottom edge sits directly at ghost.baseHeightMm and its top at
// baseHeightMm + heightMm — no flip needed, unlike the SVG-y-down canvas
// component this mirrors. Wires run from the board's top up to the wall's
// TOP edge (wallHeightMm), suppressed once the board has reached it — same
// rule as the canvas twin, passed in because (unlike the floor-case ghost)
// the ceiling reference isn't part of the ghost's own data.
export function drawElevationSuspendedArtworkGhost(
  page: PDFPage,
  transform: ElevationTransform,
  ghost: ElevationScene["suspendedArtworkGhosts"][number],
  wallHeightMm: number
) {
  const widthMm = Math.max(0, ghost.xMaxMm - ghost.xMinMm);
  const topMm = ghost.baseHeightMm + ghost.heightMm;

  if (topMm < wallHeightMm) {
    const wireInsetMm = Math.min(
      SUSPENSION_WIRE_INSET_MM,
      widthMm * SUSPENSION_WIRE_INSET_FRACTION
    );
    const wireXStartMm = ghost.xMinMm + wireInsetMm;
    const wireXEndMm = ghost.xMaxMm - wireInsetMm;
    drawLine(
      page,
      transform.point({ xMm: wireXStartMm, yMm: topMm }),
      transform.point({ xMm: wireXStartMm, yMm: wallHeightMm }),
      GHOST_WIRE_WIDTH_PT,
      COLORS.subtle,
      GHOST_WIRE_DASH
    );
    drawLine(
      page,
      transform.point({ xMm: wireXEndMm, yMm: topMm }),
      transform.point({ xMm: wireXEndMm, yMm: wallHeightMm }),
      GHOST_WIRE_WIDTH_PT,
      COLORS.subtle,
      GHOST_WIRE_DASH
    );
  }

  page.drawRectangle({
    ...elevationRect(transform, ghost.xMinMm, ghost.baseHeightMm, widthMm, ghost.heightMm),
    borderColor: COLORS.subtle,
    borderWidth: GHOST_BORDER_WIDTH_PT,
    borderDashArray: GHOST_DASH
  });
}

// A free-standing partition projected onto this wall, print twin of
// ElevationPartitionProfile.tsx. Abutting → a solid slab in the same ink and
// opacity the plan page fills its partition slabs with (planPage.ts), drawn
// AFTER the wall objects; otherwise → the dashed subtle outline the floor-case
// ghost uses, drawn BEFORE them. The caller owns that ordering, exactly as it
// does on the canvas — this only draws one profile in its own tier.
export function drawElevationPartitionProfile(
  page: PDFPage,
  transform: ElevationTransform,
  profile: ElevationScene["partitionProfiles"][number]
) {
  const widthMm = Math.max(0, profile.xMaxMm - profile.xMinMm);
  const rect = elevationRect(transform, profile.xMinMm, 0, widthMm, profile.heightMm);

  if (profile.abutting) {
    page.drawRectangle({ ...rect, color: COLORS.ink, opacity: 0.72 });
    return;
  }
  page.drawRectangle({
    ...rect,
    borderColor: COLORS.subtle,
    borderWidth: GHOST_BORDER_WIDTH_PT,
    borderDashArray: GHOST_DASH
  });
}
