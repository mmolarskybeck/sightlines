import { describe, expect, it } from "vitest";
import {
  deriveElevationDimensions,
  NEIGHBOR_TOLERANCE_MM,
  type DimensionAxis,
  type DimensionParticipant,
  type ElevationDimensions,
  type ParticipantKind
} from "./orthogonalNeighbors";

// Participants are given as edge coordinates [x0..x1, y0..y1] in wall-local y-up
// space and converted to the engine's min-corner + extent shape.
function part(
  id: string,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  kind: ParticipantKind = "artwork"
): DimensionParticipant {
  return { id, kind, rect: { xMm: x0, yMm: y0, widthMm: x1 - x0, heightMm: y1 - y0 } };
}

function derive(
  participants: DimensionParticipant[],
  wallLengthMm = 4000,
  wallHeightMm = 3000
): ElevationDimensions {
  return deriveElevationDimensions({ wallLengthMm, wallHeightMm, participants });
}

function findGap(dims: ElevationDimensions, id1: string, id2: string, axis: DimensionAxis) {
  const [aId, bId] = id1 < id2 ? [id1, id2] : [id2, id1];
  return dims.neighborGaps.find((g) => g.axis === axis && g.aId === aId && g.bId === bId);
}

describe("deriveElevationDimensions — neighbor gaps", () => {
  it("collapses a single-row hang to a left-to-right gap chain", () => {
    const dims = derive([
      part("w1", 0, 1000, 1000, 2000),
      part("w2", 1500, 2500, 1000, 2000),
      part("w3", 3000, 4000, 1000, 2000)
    ]);

    expect(findGap(dims, "w1", "w2", "horizontal")?.gapMm).toBe(500);
    expect(findGap(dims, "w2", "w3", "horizontal")?.gapMm).toBe(500);
    // Chain, never a jump: w2 blocks w1<->w3.
    expect(findGap(dims, "w1", "w3", "horizontal")).toBeUndefined();
    // A row has no vertical neighbors (x-spans are disjoint).
    expect(dims.neighborGaps.filter((g) => g.axis === "vertical")).toHaveLength(0);
  });

  it("gives a salon 2x2 grid horizontal and vertical gaps but no diagonals", () => {
    const dims = derive([
      part("tl", 0, 1000, 2000, 3000),
      part("tr", 1500, 2500, 2000, 3000),
      part("bl", 0, 1000, 0, 1000),
      part("br", 1500, 2500, 0, 1000)
    ]);

    expect(findGap(dims, "tl", "tr", "horizontal")?.gapMm).toBe(500);
    expect(findGap(dims, "bl", "br", "horizontal")?.gapMm).toBe(500);
    expect(findGap(dims, "tl", "bl", "vertical")?.gapMm).toBe(1000);
    expect(findGap(dims, "tr", "br", "vertical")?.gapMm).toBe(1000);

    // No diagonal relationships in either axis.
    expect(findGap(dims, "tl", "br", "horizontal")).toBeUndefined();
    expect(findGap(dims, "tl", "br", "vertical")).toBeUndefined();
    expect(findGap(dims, "tr", "bl", "horizontal")).toBeUndefined();
    expect(findGap(dims, "tr", "bl", "vertical")).toBeUndefined();
  });

  it("lets an opening block two works and be dimensioned to each", () => {
    const dims = derive([
      part("w1", 0, 1000, 1000, 2000),
      part("door", 1200, 1800, 0, 2500, "door"),
      part("w2", 2000, 3000, 1000, 2000)
    ]);

    // The door blocks every corridor between the works.
    expect(findGap(dims, "w1", "w2", "horizontal")).toBeUndefined();
    // ...and is itself a neighbor of both.
    expect(findGap(dims, "w1", "door", "horizontal")?.gapMm).toBe(200);
    expect(findGap(dims, "door", "w2", "horizontal")?.gapMm).toBe(200);
  });

  it("keeps a relationship through a partial block and uses the widest corridor", () => {
    const dims = derive([
      part("w1", 0, 500, 0, 3000),
      part("w2", 2000, 2500, 0, 3000),
      part("blk", 1000, 1500, 0, 1000, "blocked-zone")
    ]);

    const gap = findGap(dims, "w1", "w2", "horizontal");
    expect(gap?.gapMm).toBe(1500);
    // Only the lower third is blocked; the line sits in the clear upper span.
    expect(gap?.corridorLoMm).toBe(1000);
    expect(gap?.corridorHiMm).toBe(3000);
  });

  it("selects the widest of several remaining corridors", () => {
    const dims = derive([
      part("w1", 0, 500, 0, 3000),
      part("w2", 2000, 2500, 0, 3000),
      part("b1", 1000, 1500, 0, 1000, "blocked-zone"),
      part("b2", 1000, 1500, 1200, 1600, "blocked-zone")
    ]);

    const gap = findGap(dims, "w1", "w2", "horizontal");
    // Clear spans are [1000,1200] (200) and [1600,3000] (1400) -> widest wins.
    expect(gap?.corridorLoMm).toBe(1600);
    expect(gap?.corridorHiMm).toBe(3000);
  });

  it("treats a corridor at or below tolerance as a sliver (no relationship)", () => {
    const belowTol = derive([
      part("w1", 0, 500, 0, 1000),
      part("w2", 2000, 2500, 0, 1000),
      part("blk", 1000, 1500, 0.4, 1000, "blocked-zone")
    ]);
    expect(findGap(belowTol, "w1", "w2", "horizontal")).toBeUndefined();

    // Exactly at tolerance is still a sliver (strict "> tolerance" required).
    const atTol = derive([
      part("w1", 0, 500, 0, 1000),
      part("w2", 2000, 2500, 0, 1000),
      part("blk", 1000, 1500, NEIGHBOR_TOLERANCE_MM, 1000, "blocked-zone")
    ]);
    expect(findGap(atTol, "w1", "w2", "horizontal")).toBeUndefined();
  });

  it("does not create neighbors from a sliver span overlap", () => {
    // Vertical spans overlap by only 0.4mm (<= tolerance).
    const dims = derive([
      part("w1", 0, 1000, 0, 1000),
      part("w2", 1500, 2500, 999.6, 2000)
    ]);
    expect(findGap(dims, "w1", "w2", "horizontal")).toBeUndefined();
  });

  it("reads touching neighbors as 0", () => {
    const flush = derive([
      part("w1", 0, 1000, 0, 1000),
      part("w2", 1000, 2000, 0, 1000)
    ]);
    const gap = findGap(flush, "w1", "w2", "horizontal");
    expect(gap?.gapMm).toBe(0);

    // Within tolerance still reads 0.
    const nearlyFlush = derive([
      part("w1", 0, 1000, 0, 1000),
      part("w2", 1000.3, 2000, 0, 1000)
    ]);
    expect(findGap(nearlyFlush, "w1", "w2", "horizontal")?.gapMm).toBe(0);
  });

  it("emits no gap dimension for overlapping objects on either axis", () => {
    const dims = derive([
      part("w1", 0, 1000, 0, 1000),
      part("w2", 800, 1800, 0, 1000)
    ]);
    expect(findGap(dims, "w1", "w2", "horizontal")).toBeUndefined();
    expect(findGap(dims, "w1", "w2", "vertical")).toBeUndefined();
  });

  it("emits at most one dimension per unordered pair per axis", () => {
    const dims = derive([
      part("w1", 0, 1000, 1000, 2000),
      part("w2", 1500, 2500, 1000, 2000)
    ]);
    const horizontal = dims.neighborGaps.filter((g) => g.axis === "horizontal");
    expect(horizontal).toHaveLength(1);
    // Ids are sorted lexically within the pair.
    expect(horizontal[0].aId).toBe("w1");
    expect(horizontal[0].bId).toBe("w2");
  });
});

describe("deriveElevationDimensions — wall boundaries", () => {
  it("dimensions exposed left and right margins for a lone work", () => {
    const dims = derive([part("w1", 500, 1000, 1000, 2000)], 3000, 3000);

    const left = dims.boundaryGaps.find((b) => b.side === "left");
    const right = dims.boundaryGaps.find((b) => b.side === "right");
    expect(left?.gapMm).toBe(500);
    expect(left?.participantIds).toEqual(["w1"]);
    expect(right?.gapMm).toBe(2000);
  });

  it("consolidates coincident exterior margins for stacked works", () => {
    const dims = derive(
      [part("w1", 500, 1000, 2000, 3000), part("w2", 500, 1000, 0, 1000)],
      3000,
      3000
    );

    const left = dims.boundaryGaps.filter((b) => b.side === "left");
    expect(left).toHaveLength(1);
    expect(left[0].gapMm).toBe(500);
    expect(left[0].participantIds).toEqual(["w1", "w2"]);
  });

  it("suppresses a margin when another object blocks the wall edge", () => {
    const dims = derive(
      [
        part("blk", 500, 1000, 0, 3000, "blocked-zone"),
        part("w1", 1500, 2000, 1000, 2000)
      ],
      3000,
      3000
    );

    // The blocked zone stands between w1 and the left wall.
    expect(dims.boundaryGaps.find((b) => b.side === "left" && b.participantIds.includes("w1"))).toBeUndefined();
    // The blocked zone is not a work, so it earns no exterior margin of its own.
    expect(dims.boundaryGaps.find((b) => b.participantIds.includes("blk"))).toBeUndefined();
  });

  it("emits no margin for a work overlapping the wall edge (out-of-bounds is an advisory, not a 0)", () => {
    const dims = derive([part("w1", -100, 500, 1000, 2000)], 3000, 3000);

    expect(dims.boundaryGaps.find((b) => b.side === "left")).toBeUndefined();
    const right = dims.boundaryGaps.find((b) => b.side === "right");
    expect(right?.gapMm).toBe(2500);
  });
});

describe("deriveElevationDimensions — center heights", () => {
  it("consolidates a shared center height and keeps others individual", () => {
    const dims = derive([
      part("w1", 0, 1000, 1050, 1850), // center 1450
      part("w2", 2000, 3000, 1050, 1850), // center 1450
      part("w3", 3200, 3800, 800, 1200) // center 1000
    ]);

    const common = dims.centerHeights.find((c) => c.common);
    const individual = dims.centerHeights.find((c) => !c.common);
    expect(dims.centerHeights).toHaveLength(2);
    expect(common?.centerHeightMm).toBeCloseTo(1450);
    expect(common?.participantIds).toEqual(["w1", "w2"]);
    expect(individual?.centerHeightMm).toBeCloseTo(1000);
    expect(individual?.participantIds).toEqual(["w3"]);
  });

  it("ignores openings when grouping center heights", () => {
    const dims = derive([
      part("w1", 0, 1000, 1050, 1850),
      part("door", 2000, 2900, 0, 2100, "door")
    ]);
    expect(dims.centerHeights).toHaveLength(1);
    expect(dims.centerHeights[0].participantIds).toEqual(["w1"]);
  });
});

describe("deriveElevationDimensions — degenerate inputs", () => {
  it("returns only overall dimensions for an empty wall", () => {
    const dims = derive([], 4000, 3000);
    expect(dims.overallWidthMm).toBe(4000);
    expect(dims.overallHeightMm).toBe(3000);
    expect(dims.neighborGaps).toHaveLength(0);
    expect(dims.boundaryGaps).toHaveLength(0);
    expect(dims.centerHeights).toHaveLength(0);
  });

  it("handles a single work: margins and one individual center height", () => {
    const dims = derive([part("w1", 500, 1000, 1000, 2000)], 3000, 3000);
    expect(dims.neighborGaps).toHaveLength(0);
    expect(dims.boundaryGaps).toHaveLength(2);
    expect(dims.centerHeights).toHaveLength(1);
    expect(dims.centerHeights[0].common).toBe(false);
  });
});
