import type { PDFPage } from "pdf-lib";
import {
  caseElevationGlyph,
  caseFloorGhostGlyph
} from "../../../domain/geometry/caseGlyphs";
import type { DisplayUnit } from "../../../domain/project";
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
  } else if (opening.object.kind === "door") {
    const radius = Math.min(rect.width, rect.height);
    drawLine(
      page,
      { x: rect.x, y: rect.y },
      { x: rect.x, y: rect.y + radius },
      0.45,
      COLORS.subtle
    );
    drawLine(
      page,
      { x: rect.x, y: rect.y },
      { x: rect.x + radius, y: rect.y },
      0.45,
      COLORS.subtle
    );
  } else {
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
  const dash = { borderColor: COLORS.subtle, borderWidth: 0.5, borderDashArray: [3, 2] };

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
    0.5,
    COLORS.subtle,
    [3, 2]
  );
  for (const leg of glyph.legs) {
    drawLine(
      page,
      transform.point({ xMm: ghost.xMinMm + leg.xMm, yMm: slabY }),
      transform.point({ xMm: ghost.xMinMm + leg.xMm, yMm: ghost.heightMm - glyph.floorYMm }),
      0.5,
      COLORS.subtle,
      [3, 2]
    );
  }
}
