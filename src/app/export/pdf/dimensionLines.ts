import type { PDFPage } from "pdf-lib";
import {
  deriveElevationSceneDimensions,
  elevationSceneToDimensionParticipants
} from "../../../domain/dimensions/elevationDimensions";
import type {
  BoundaryDimension,
  GapDimension
} from "../../../domain/dimensions/orthogonalNeighbors";
import type { ElevationScene } from "../../../domain/scene2d/elevationScene";
import type { DisplayUnit } from "../../../domain/project";
import {
  choosePdfLabelCandidate,
  findPdfLeaderRoute,
  type PdfLabelBox
} from "../pdfDimensionLayout";
import {
  COLORS,
  DIMENSION_SIZE_PT,
  drawCenteredLabel,
  drawLine,
  formatDocumentDimension,
  textWidth,
  type PdfFonts
} from "./primitives";
import type { ElevationTransform } from "./transforms";

export function participantObstacleBoxes(
  scene: ElevationScene,
  transform: ElevationTransform,
  paddingPt = 3
): PdfLabelBox[] {
  return elevationSceneToDimensionParticipants(scene).map((participant) => {
    const bottomLeft = transform.point({
      xMm: participant.rect.xMm,
      yMm: participant.rect.yMm
    });
    const topRight = transform.point({
      xMm: participant.rect.xMm + participant.rect.widthMm,
      yMm: participant.rect.yMm + participant.rect.heightMm
    });
    return {
      left: bottomLeft.x - paddingPt,
      right: topRight.x + paddingPt,
      bottom: bottomLeft.y - paddingPt,
      top: topRight.y + paddingPt
    };
  });
}

export function drawGapDimension(
  page: PDFPage,
  fonts: PdfFonts,
  transform: ElevationTransform,
  dimension: GapDimension | BoundaryDimension,
  unit: DisplayUnit,
  occupied: PdfLabelBox[],
  obstacles: readonly PdfLabelBox[],
  leaderObstacles: readonly PdfLabelBox[],
  wallFrame: { leftX: number; rightX: number; topY: number; bottomY: number }
) {
  const label = formatDocumentDimension(dimension.gapMm, unit);
  const isBoundary = !("axis" in dimension);
  const lineColor = isBoundary ? COLORS.subtle : COLORS.dimension;
  const lineWidth = isBoundary ? 0.3 : 0.4;
  if ("axis" in dimension && dimension.axis === "vertical") {
    const xMm =
      (dimension.corridorLoMm + dimension.corridorHiMm) / 2;
    const a = transform.point({ xMm, yMm: dimension.fromMm });
    const b = transform.point({ xMm, yMm: dimension.toMm });
    drawLine(page, a, b, lineWidth, lineColor);
    drawLine(
      page,
      { x: a.x - 2.5, y: a.y },
      { x: a.x + 2.5, y: a.y },
      lineWidth,
      lineColor
    );
    drawLine(
      page,
      { x: b.x - 2.5, y: b.y },
      { x: b.x + 2.5, y: b.y },
      lineWidth,
      lineColor
    );
    const available = Math.abs(b.y - a.y);
    const labelHeight = textWidth(fonts, label, DIMENSION_SIZE_PT, true);
    const midY = (a.y + b.y) / 2;
    if (available >= labelHeight + 8) {
      const labelPosition = choosePdfLabelCandidate(
        [0, 8, -8, 16, -16, 24, -24].map((offset) => {
          const x = a.x + offset;
          return {
            x,
            box: {
              left: x - DIMENSION_SIZE_PT * 0.25,
              right: x + DIMENSION_SIZE_PT + 3,
              bottom: midY - labelHeight / 2 - 2,
              top: midY + labelHeight / 2 + 2
            }
          };
        }),
        occupied,
        obstacles
      );
      if (!labelPosition) return;
      const labelX = labelPosition.x;
      occupied.push(labelPosition.box);
      if (Math.abs(labelX - a.x) > 3) {
        drawLine(
          page,
          { x: a.x, y: midY },
          { x: labelX, y: midY },
          0.3,
          COLORS.subtle
        );
      }
      drawCenteredLabel(
        page,
        fonts,
        label,
        labelX,
        midY,
        DIMENSION_SIZE_PT,
        90
      );
      return;
    }

    // The label keeps the line's mid-height and escapes sideways past the
    // contiguous cluster around the gap, on the side the gap's own column
    // is on — a 2x2 block's left-column gap labels to the block's left, the
    // right-column gap to its right, so position names the column. The
    // flood joins footprints separated by less than a label-sized gap; a
    // real inter-group gap breaks the chain and the label stays adjacent.
    const labelWidth = textWidth(fonts, label, DIMENSION_SIZE_PT, true);
    const labelY = midY - DIMENSION_SIZE_PT / 2;
    // Footprints sharing the gap's vertical extent — the works the label
    // must escape past to stay unambiguous.
    const bandLo = Math.min(a.y, b.y) - 2;
    const bandHi = Math.max(a.y, b.y) + 2;
    const band = obstacles.filter(
      (box) => box.top > bandLo && box.bottom < bandHi
    );
    // Contiguous crowd around the gap: footprints separated by less than 8pt
    // read as one block the label must not sit inside.
    let crowdLeft = a.x - 6;
    let crowdRight = a.x + 6;
    for (let changed = true; changed; ) {
      changed = false;
      for (const box of band) {
        if (
          box.left < crowdRight + 8 &&
          box.right > crowdLeft - 8 &&
          (box.left < crowdLeft || box.right > crowdRight)
        ) {
          crowdLeft = Math.min(crowdLeft, box.left);
          crowdRight = Math.max(crowdRight, box.right);
          changed = true;
        }
      }
    }
    // Escape toward the block's nearer outside edge, judged over the crowd
    // plus its immediate ring — so a 2x2 block's left-column gap labels to
    // the block's left and the right column to its right, and the position
    // itself names the column.
    let contextLeft = crowdLeft;
    let contextRight = crowdRight;
    for (const box of band) {
      if (box.left < crowdRight + 24 && box.right > crowdLeft - 24) {
        contextLeft = Math.min(contextLeft, box.left);
        contextRight = Math.max(contextRight, box.right);
      }
    }
    const rightward = a.x - contextLeft >= contextRight - a.x;
    // Nearest x on the given side where the label clears every band
    // footprint (monotone outward walk, so it terminates). Distance is a
    // preference, not a reason to place a knockout over artwork.
    const slideClear = (direction: 1 | -1): number | null => {
      let x =
        (direction === 1 ? crowdRight : crowdLeft) +
        direction * (labelWidth / 2 + 6);
      for (let moved = true; moved; ) {
        moved = false;
        for (const box of band) {
          if (
            box.right > x - labelWidth / 2 - 2 &&
            box.left < x + labelWidth / 2 + 2
          ) {
            x =
              direction === 1
                ? box.right + labelWidth / 2 + 4
                : box.left - labelWidth / 2 - 4;
            moved = true;
          }
        }
      }
      return x;
    };
    const nearX = slideClear(rightward ? 1 : -1);
    const farX = slideClear(rightward ? -1 : 1);
    const step = rightward ? 9 : -9;
    const diagonalX = a.x + (rightward ? 1 : -1) * (labelWidth / 2 + 9);
    const leaderStart = { x: a.x, y: midY };
    const candidates = [
      ...(nearX !== null
        ? [
            { x: nearX, y: labelY },
            { x: nearX + step, y: labelY },
            { x: nearX, y: labelY + 10 },
            { x: nearX, y: labelY - 10 },
            { x: nearX + step, y: labelY + 10 },
            { x: nearX + step, y: labelY - 10 }
          ]
        : []),
      ...(farX !== null
        ? [
            { x: farX, y: labelY },
            { x: farX, y: labelY + 10 },
            { x: farX, y: labelY - 10 }
          ]
        : []),
      { x: diagonalX, y: midY + 8 },
      { x: diagonalX, y: midY - 12 },
      { x: a.x, y: midY + 8 }
    ].map((candidate) => {
        const leaderRoute = findPdfLeaderRoute(
          leaderStart,
          {
            x: candidate.x,
            y: candidate.y + DIMENSION_SIZE_PT / 2
          },
          leaderObstacles
        );
        return {
          x: candidate.x,
          y: candidate.y,
          leaderRoute,
          box: {
            left: candidate.x - labelWidth / 2 - 2,
            right: candidate.x + labelWidth / 2 + 2,
            bottom: candidate.y - 1,
            top: candidate.y + DIMENSION_SIZE_PT + 3
          }
        };
      })
      // A close diagonal is only acceptable when its path actually clears
      // the artwork. Otherwise leave the label on a clear exterior lane.
      .filter(
        (candidate) =>
          candidate.leaderRoute !== null &&
          candidate.box.left >= wallFrame.leftX + 4 &&
          candidate.box.right <= wallFrame.rightX - 4 &&
          candidate.box.bottom >= wallFrame.bottomY + 4 &&
          candidate.box.top <= wallFrame.topY - 4
      );
    const labelPosition = choosePdfLabelCandidate(
      candidates,
      occupied,
      obstacles
    );
    if (!labelPosition) return;
    occupied.push(labelPosition.box);
    labelPosition.leaderRoute!.slice(1).forEach((point, index) =>
      drawLine(
        page,
        labelPosition.leaderRoute![index]!,
        point,
        0.3,
        COLORS.subtle
      )
    );
    drawCenteredLabel(
      page,
      fonts,
      label,
      labelPosition.x,
      labelPosition.y
    );
    return;
  }

  const yMm =
    (dimension.corridorLoMm + dimension.corridorHiMm) / 2;
  const a = transform.point({ xMm: dimension.fromMm, yMm });
  const b = transform.point({ xMm: dimension.toMm, yMm });
  drawLine(page, a, b, lineWidth, lineColor);
  drawLine(
    page,
    { x: a.x, y: a.y - 2.5 },
    { x: a.x, y: a.y + 2.5 },
    lineWidth,
    lineColor
  );
  drawLine(
    page,
    { x: b.x, y: b.y - 2.5 },
    { x: b.x, y: b.y + 2.5 },
    lineWidth,
    lineColor
  );
  const available = Math.abs(b.x - a.x);
  const labelWidth = textWidth(fonts, label, DIMENSION_SIZE_PT, true);
  const midX = (a.x + b.x) / 2;
  const labelLeft = midX - labelWidth / 2 - 2;
  const labelRight = midX + labelWidth / 2 + 2;
  const fitsInGap = available >= labelWidth + 6;
  // A label wider than its gap must clear the flanking artworks anyway, so
  // it escapes to a lane just past the local footprints — on the side its
  // own line is on, so a stacked block's top-row dims read above the block
  // and bottom-row dims below it, and the position names the row.
  let baseY = a.y + 2;
  let offsets = [0, 8, 16, -8, -16, 24, -24];
  if (!fitsInGap) {
    let crowdTop = a.y + 6;
    let crowdBottom = a.y - 6;
    for (const box of obstacles) {
      if (box.right > labelLeft && box.left < labelRight) {
        crowdTop = Math.max(crowdTop, box.top);
        crowdBottom = Math.min(crowdBottom, box.bottom);
      }
    }
    let upward = a.y >= (crowdTop + crowdBottom) / 2;
    // Never leave the wall: a downward lane that would land on or below the
    // floor line (into the overall-width dimension) flips upward, and vice
    // versa — the wall interior is the only space these labels may use.
    if (!upward && crowdBottom - DIMENSION_SIZE_PT - 4 < wallFrame.bottomY + 4) {
      upward = true;
    } else if (upward && crowdTop + 3 + DIMENSION_SIZE_PT > wallFrame.topY - 4) {
      upward = false;
    }
    baseY = upward ? crowdTop + 3 : crowdBottom - DIMENSION_SIZE_PT - 4;
    offsets = upward ? [0, 9, 18, 27] : [0, -9, -18, -27];
  }
  const labelPosition = choosePdfLabelCandidate(
    offsets.map((offset) => {
      const y = baseY + offset;
      return {
        y,
        box: {
          left: labelLeft,
          right: labelRight,
          bottom: y - 1,
          top: y + DIMENSION_SIZE_PT + 3
        }
      };
    }),
    occupied,
    obstacles
  );
  if (!labelPosition) return;
  const labelY = labelPosition.y;
  occupied.push(labelPosition.box);
  if (Math.abs(labelY - a.y) > 3) {
    drawLine(
      page,
      { x: midX, y: a.y },
      { x: midX, y: labelY },
      0.3,
      COLORS.subtle
    );
  }
  drawCenteredLabel(page, fonts, label, midX, labelY);
}

export function drawElevationDimensions(
  page: PDFPage,
  fonts: PdfFonts,
  scene: ElevationScene,
  transform: ElevationTransform,
  unit: DisplayUnit
) {
  const dimensions = deriveElevationSceneDimensions(scene);
  // Participant footprints are hard obstacles; the occupied list contains
  // only labels, so later annotations still prefer their own clear lanes.
  const obstacleBoxes = participantObstacleBoxes(scene, transform);
  const leaderObstacleBoxes = participantObstacleBoxes(scene, transform, 0);
  const occupiedLabels: PdfLabelBox[] = [];
  const wallBottomLeft = transform.point({ xMm: 0, yMm: 0 });
  const wallTopRight = transform.point({
    xMm: scene.wallLengthMm,
    yMm: scene.wallHeightMm
  });

  const overallY = wallBottomLeft.y - 16;
  drawLine(
    page,
    { x: wallBottomLeft.x, y: overallY },
    { x: wallTopRight.x, y: overallY },
    0.65,
    COLORS.muted
  );
  drawLine(
    page,
    { x: wallBottomLeft.x, y: overallY - 4 },
    { x: wallBottomLeft.x, y: overallY + 4 },
    0.65,
    COLORS.muted
  );
  drawLine(
    page,
    { x: wallTopRight.x, y: overallY - 4 },
    { x: wallTopRight.x, y: overallY + 4 },
    0.65,
    COLORS.muted
  );
  drawCenteredLabel(
    page,
    fonts,
    formatDocumentDimension(dimensions.overallWidthMm, unit),
    (wallBottomLeft.x + wallTopRight.x) / 2,
    overallY - 3
  );

  const overallX = wallBottomLeft.x - 17;
  drawLine(
    page,
    { x: overallX, y: wallBottomLeft.y },
    { x: overallX, y: wallTopRight.y },
    0.65,
    COLORS.muted
  );
  drawLine(
    page,
    { x: overallX - 4, y: wallBottomLeft.y },
    { x: overallX + 4, y: wallBottomLeft.y },
    0.65,
    COLORS.muted
  );
  drawLine(
    page,
    { x: overallX - 4, y: wallTopRight.y },
    { x: overallX + 4, y: wallTopRight.y },
    0.65,
    COLORS.muted
  );
  drawCenteredLabel(
    page,
    fonts,
    formatDocumentDimension(dimensions.overallHeightMm, unit),
    overallX,
    (wallBottomLeft.y + wallTopRight.y) / 2,
    DIMENSION_SIZE_PT,
    90
  );

  // Parallel gaps with the same printed value and the same facing edges (a
  // stacked row's top and bottom both offset equally from a flanking work,
  // or a 2x2 block's two column gaps) collapse to one printed dimension —
  // the second line restates the first. The widest corridor draws it.
  const uniqueGaps = new Map<string, GapDimension>();
  for (const gap of dimensions.neighborGaps) {
    const key = [
      gap.axis,
      formatDocumentDimension(gap.gapMm, unit),
      Math.round(gap.fromMm),
      Math.round(gap.toMm)
    ].join("|");
    const existing = uniqueGaps.get(key);
    if (
      !existing ||
      gap.corridorHiMm - gap.corridorLoMm >
        existing.corridorHiMm - existing.corridorLoMm
    ) {
      uniqueGaps.set(key, gap);
    }
  }

  const allGaps = [...uniqueGaps.values(), ...dimensions.boundaryGaps];
  allGaps.forEach((dimension) =>
    drawGapDimension(
      page,
      fonts,
      transform,
      dimension,
      unit,
      occupiedLabels,
      obstacleBoxes,
      leaderObstacleBoxes,
      {
        leftX: wallBottomLeft.x,
        rightX: wallTopRight.x,
        topY: wallTopRight.y,
        bottomY: wallBottomLeft.y
      }
    )
  );

  if (dimensions.centerHeights.length === 0) return;
  const datumX = wallTopRight.x + 12;
  const centerHeights = [...dimensions.centerHeights].sort(
    (a, b) => a.centerHeightMm - b.centerHeightMm
  );
  const highestDatumY = transform.point({
    xMm: scene.wallLengthMm,
    yMm: centerHeights[centerHeights.length - 1]!.centerHeightMm
  }).y;
  drawLine(
    page,
    { x: datumX, y: wallBottomLeft.y },
    { x: datumX, y: highestDatumY },
    0.4,
    COLORS.subtle
  );
  drawLine(
    page,
    { x: datumX - 3, y: wallBottomLeft.y },
    { x: datumX + 3, y: wallBottomLeft.y },
    0.4,
    COLORS.subtle
  );

  centerHeights.forEach((dimension, index) => {
    const datumY = transform.point({
      xMm: scene.wallLengthMm,
      yMm: dimension.centerHeightMm
    }).y;
    // Dashed leader: a work's boundary margin arrives at the wall edge at
    // this exact height (its own centerline), and a solid leader would fuse
    // the two into one apparent measurement running past the corner. The
    // dash break keeps the anchor without the fusion.
    drawLine(
      page,
      { x: wallTopRight.x + 3, y: datumY },
      { x: datumX + 3, y: datumY },
      0.3,
      COLORS.subtle,
      [2, 2]
    );
    const label = formatDocumentDimension(dimension.centerHeightMm, unit);
    const labelWidth = textWidth(fonts, label, DIMENSION_SIZE_PT, true);
    const labelX = datumX + 8 + labelWidth / 2;
    const position = choosePdfLabelCandidate(
      [0, 9, -9, 18, -18, 27, -27].map((offset) => {
        const y =
          datumY - DIMENSION_SIZE_PT / 2 + offset + (index % 2) * 0.5;
        return {
          x: labelX,
          y,
          box: {
            left: labelX - labelWidth / 2 - 2,
            right: labelX + labelWidth / 2 + 2,
            bottom: y - 1,
            top: y + DIMENSION_SIZE_PT + 3
          }
        };
      }),
      occupiedLabels,
      obstacleBoxes
    );
    if (!position) return;
    occupiedLabels.push(position.box);
    const labelMidY = position.y + DIMENSION_SIZE_PT / 2;
    if (Math.abs(labelMidY - datumY) > 2) {
      drawLine(
        page,
        { x: datumX + 3, y: datumY },
        { x: position.box.left, y: labelMidY },
        0.3,
        COLORS.subtle
      );
    }
    drawCenteredLabel(
      page,
      fonts,
      label,
      position.x,
      position.y
    );
  });
}
