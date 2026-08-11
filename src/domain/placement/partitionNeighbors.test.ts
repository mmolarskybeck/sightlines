import { describe, expect, it } from "vitest";
import { faceWallId, type FloorPartition } from "../geometry/freestandingWalls";
import type { Floor, Room, WallObjectBase } from "../project";
import {
  PARTITION_NEIGHBOR_MAX_GAP_MM,
  type ElevationScenePartitionProfile
} from "../scene2d/elevationScene";
import { resolveArtworkSnap } from "../snapping/artworkSnapTargets";
import {
  arrangeOnWallInZone,
  centerMemberBetweenBoundaries,
  detectBoundary,
  getOpenSpaceBounds
} from "./arrangeOnWall";
import {
  derivePartitionNeighborShimsForFloorWall,
  derivePartitionNeighborShimsForWall,
  findPartitionNeighborShim,
  partitionProfileNeighborShims,
  selectElevationPartitions,
  selectVisiblePartitionProfiles
} from "./partitionNeighbors";

// Same wall as elevationScene.test.ts: start→end runs +x along y=0, so the
// viewer (LEFT normal) stands at POSITIVE y and partitions must sit there to
// project at all.
const WALL_START = { xMm: 0, yMm: 0 };
const WALL_END = { xMm: 8000, yMm: 0 };
const WALL_HEIGHT_MM = 3000;

function partition(overrides: Partial<FloorPartition> = {}): FloorPartition {
  return {
    wallId: "partition-1",
    roomId: "room-1",
    startMm: { xMm: 3000, yMm: 0 },
    endMm: { xMm: 3000, yMm: 2000 },
    thicknessMm: 100,
    heightMm: 2400,
    name: "Partition 1",
    ...overrides
  };
}

function profile(
  overrides: Partial<ElevationScenePartitionProfile> = {}
): ElevationScenePartitionProfile {
  return {
    partition: partition(),
    xMinMm: 2950,
    xMaxMm: 3050,
    heightMm: 2400,
    abutting: true,
    gapMm: 0,
    ...overrides
  };
}

describe("selectElevationPartitions", () => {
  it("keeps only partitions owned by the viewed room", () => {
    const mine = partition({ wallId: "p-mine", roomId: "room-1" });
    const theirs = partition({ wallId: "p-theirs", roomId: "room-2" });

    const selected = selectElevationPartitions([mine, theirs], {
      roomId: "room-1",
      wallId: "wall-north"
    });

    expect(selected.map((p) => p.wallId)).toEqual(["p-mine"]);
  });

  it("drops the partition that owns the viewed face, keeping its neighbours", () => {
    // Viewing side A of partition-1: its own slab must not project its
    // thickness onto its own elevation, but partition-2 standing nearby must.
    const own = partition({ wallId: "partition-1" });
    const other = partition({ wallId: "partition-2" });

    const selected = selectElevationPartitions([own, other], {
      roomId: "room-1",
      wallId: faceWallId("partition-1", "a")
    });

    expect(selected.map((p) => p.wallId)).toEqual(["partition-2"]);
  });

  it("excludes nothing extra when the viewed wall is a perimeter wall", () => {
    // A perimeter wall id parses to no face, so the own-face gate is inert —
    // a partition must never be dropped just because its id looks similar.
    const selected = selectElevationPartitions(
      [partition({ wallId: "partition-1" }), partition({ wallId: "partition-2" })],
      { roomId: "room-1", wallId: "room-1-wall-north" }
    );

    expect(selected.map((p) => p.wallId)).toEqual(["partition-1", "partition-2"]);
  });
});

describe("partitionProfileNeighborShims", () => {
  it("converts a profile to a center-anchored shim keyed on the bare partition id", () => {
    const [shim] = partitionProfileNeighborShims(
      [profile({ xMinMm: 2000, xMaxMm: 3000, heightMm: 2400 })],
      WALL_HEIGHT_MM,
      "wall-north"
    );

    // NOT a face id — dimension-line identity on the canvas already keys on
    // the bare partition wallId.
    expect(shim!.id).toBe("partition-1");
    expect(shim!.wallId).toBe("wall-north");
    expect(shim!.xMm).toBe(2500);
    expect(shim!.widthMm).toBe(1000);
    // Rises from the floor: center height is half its own height.
    expect(shim!.yMm).toBe(1200);
    expect(shim!.heightMm).toBe(2400);
  });

  it("clamps a partition taller than the wall to the wall height, center included", () => {
    const [shim] = partitionProfileNeighborShims(
      [profile({ heightMm: 4000 })],
      WALL_HEIGHT_MM
    );

    expect(shim!.heightMm).toBe(WALL_HEIGHT_MM);
    // The clamp must move the center too — half of the CLAMPED height, not of
    // the drawn one, or the shim would float above the floor line.
    expect(shim!.yMm).toBe(WALL_HEIGHT_MM / 2);
  });

  it("admits a profile exactly at the neighbor gap limit and rejects one past it", () => {
    const atLimit = partitionProfileNeighborShims(
      [profile({ gapMm: PARTITION_NEIGHBOR_MAX_GAP_MM, abutting: false })],
      WALL_HEIGHT_MM
    );
    expect(atLimit).toHaveLength(1);

    const pastLimit = partitionProfileNeighborShims(
      [profile({ gapMm: PARTITION_NEIGHBOR_MAX_GAP_MM + 0.5, abutting: false })],
      WALL_HEIGHT_MM
    );
    expect(pastLimit).toEqual([]);
  });

  it("defaults the shim's wallId to an empty string when none is supplied", () => {
    const [shim] = partitionProfileNeighborShims([profile()], WALL_HEIGHT_MM);
    expect(shim!.wallId).toBe("");
  });
});

describe("derivePartitionNeighborShimsForWall", () => {
  const input = {
    wallId: "room-1-wall-north",
    roomId: "room-1",
    wallHeightMm: WALL_HEIGHT_MM,
    wallStartFloorMm: WALL_START,
    wallEndFloorMm: WALL_END
  };

  it("goes from floor partitions straight to shims, no scene required", () => {
    // Broadside 400 mm off the wall (thickness 100 → nearest face 350 mm).
    const shims = derivePartitionNeighborShimsForWall({
      ...input,
      partitions: [
        partition({
          startMm: { xMm: 2000, yMm: 400 },
          endMm: { xMm: 5000, yMm: 400 }
        })
      ]
    });

    expect(shims).toHaveLength(1);
    expect(shims[0]!.xMm).toBeCloseTo(3500);
    expect(shims[0]!.widthMm).toBeCloseTo(3000);
    expect(shims[0]!.wallId).toBe("room-1-wall-north");
  });

  it("applies the room gate, the viewer-side gate and the proximity rule together", () => {
    const shims = derivePartitionNeighborShimsForWall({
      ...input,
      partitions: [
        // Near, in this room → a neighbour.
        partition({
          wallId: "p-near",
          startMm: { xMm: 2000, yMm: 400 },
          endMm: { xMm: 5000, yMm: 400 }
        }),
        // Far out in the room → drawn as a ghost by the scene, but no shim.
        partition({
          wallId: "p-far",
          startMm: { xMm: 2000, yMm: 3000 },
          endMm: { xMm: 5000, yMm: 3000 }
        }),
        // Behind this wall face (negative y) → invisible from it.
        partition({
          wallId: "p-behind",
          startMm: { xMm: 2000, yMm: -400 },
          endMm: { xMm: 5000, yMm: -400 }
        }),
        // Another room's partition.
        partition({
          wallId: "p-other-room",
          roomId: "room-2",
          startMm: { xMm: 2000, yMm: 400 },
          endMm: { xMm: 5000, yMm: 400 }
        }),
        // Off the end of the wall entirely.
        partition({
          wallId: "p-offwall",
          startMm: { xMm: 12000, yMm: 400 },
          endMm: { xMm: 14000, yMm: 400 }
        })
      ]
    });

    expect(shims.map((shim) => shim.id)).toEqual(["p-near"]);
  });

  it("drops the viewed face's own partition", () => {
    const partitions = [
      partition({
        wallId: "partition-1",
        startMm: { xMm: 2000, yMm: 400 },
        endMm: { xMm: 5000, yMm: 400 }
      })
    ];

    expect(
      derivePartitionNeighborShimsForWall({
        ...input,
        wallId: faceWallId("partition-1", "a"),
        partitions
      })
    ).toEqual([]);
    // Sanity: the same slab IS a neighbour of the perimeter wall.
    expect(
      derivePartitionNeighborShimsForWall({ ...input, partitions })
    ).toHaveLength(1);
  });
});

// A room whose SOUTH wall runs (0,0)→(8000,0) with the interior at positive y,
// matching WALL_START/WALL_END above so partition fixtures carry over. The
// partition stands broadside 400 mm off that wall, 2000..5000 along it.
function roomWithPartition(overrides: Partial<FloorPartition> = {}): Room {
  const slab = partition({
    startMm: { xMm: 2000, yMm: 400 },
    endMm: { xMm: 5000, yMm: 400 },
    ...overrides
  });
  return {
    id: "room-1",
    name: "Gallery",
    heightMm: WALL_HEIGHT_MM,
    vertices: [
      { id: "v-a", xMm: 0, yMm: 0 },
      { id: "v-b", xMm: 8000, yMm: 0 },
      { id: "v-c", xMm: 8000, yMm: 5000 },
      { id: "v-d", xMm: 0, yMm: 5000 }
    ],
    walls: [
      {
        id: "wall-south",
        roomId: "room-1",
        name: "South wall",
        startVertexId: "v-a",
        endVertexId: "v-b",
        heightMm: WALL_HEIGHT_MM
      }
    ],
    freestandingWalls: [
      {
        id: slab.wallId,
        roomId: "room-1",
        name: slab.name,
        startXMm: slab.startMm.xMm,
        startYMm: slab.startMm.yMm,
        endXMm: slab.endMm.xMm,
        endYMm: slab.endMm.yMm,
        thicknessMm: slab.thicknessMm,
        heightMm: slab.heightMm
      }
    ]
  };
}

function floorWithPartition(overrides: Partial<FloorPartition> = {}): Floor {
  return {
    rooms: [
      {
        roomId: "room-1",
        offsetXMm: 0,
        offsetYMm: 0,
        rotationDeg: 0,
        room: roomWithPartition(overrides)
      }
    ]
  };
}

describe("derivePartitionNeighborShimsForFloorWall", () => {
  it("resolves the wall's room, endpoints and height straight off the floor", () => {
    const shims = derivePartitionNeighborShimsForFloorWall(floorWithPartition(), "wall-south");

    expect(shims).toHaveLength(1);
    expect(shims[0]!.id).toBe("partition-1");
    expect(shims[0]!.wallId).toBe("wall-south");
    expect(shims[0]!.partitionNeighbor).toBe(true);
    // The display name rides along so a readout can name the boundary without
    // reaching back into the floor.
    expect(shims[0]!.partitionName).toBe("Partition 1");
    expect(shims[0]!.xMm).toBeCloseTo(3500);
    expect(shims[0]!.widthMm).toBeCloseTo(3000);
  });

  it("still applies the own-face gate when the viewed wall is a partition face", () => {
    const floor = floorWithPartition();

    expect(
      derivePartitionNeighborShimsForFloorWall(floor, faceWallId("partition-1", "a"))
    ).toEqual([]);
  });

  it("yields nothing for a wall id that is not on the floor", () => {
    expect(derivePartitionNeighborShimsForFloorWall(floorWithPartition(), "nope")).toEqual([]);
  });
});

describe("findPartitionNeighborShim", () => {
  const shims = partitionProfileNeighborShims([profile()], WALL_HEIGHT_MM, "wall-south");

  it("recognises a boundary objectId that came from a shim", () => {
    expect(findPartitionNeighborShim(shims, "partition-1")?.partitionName).toBe("Partition 1");
  });

  it("returns undefined for a real wall object and for no boundary at all", () => {
    expect(findPartitionNeighborShim(shims, "artwork-7")).toBeUndefined();
    expect(findPartitionNeighborShim(shims, undefined)).toBeUndefined();
  });
});

describe("selectVisiblePartitionProfiles", () => {
  const abutting = profile({ partition: partition({ wallId: "p-abutting" }), gapMm: 0 });
  const ghost = profile({
    partition: partition({ wallId: "p-ghost" }),
    abutting: false,
    gapMm: 800
  });

  it("keeps both tiers while ghosts are shown", () => {
    expect(
      selectVisiblePartitionProfiles([abutting, ghost], true).map((p) => p.partition.wallId)
    ).toEqual(["p-abutting", "p-ghost"]);
  });

  it("keeps only the abutting tier with ghosts hidden", () => {
    expect(
      selectVisiblePartitionProfiles([abutting, ghost], false).map((p) => p.partition.wallId)
    ).toEqual(["p-abutting"]);
  });

  it("stops a hidden ghost from producing a snap target", () => {
    // The canvas composes the toggle with the shim conversion; a suppressed
    // ghost must drop out BEFORE it can capture a drag.
    const hiddenShims = partitionProfileNeighborShims(
      selectVisiblePartitionProfiles([ghost], false),
      WALL_HEIGHT_MM,
      "wall-south"
    );
    expect(hiddenShims).toEqual([]);

    const shownShims = partitionProfileNeighborShims(
      selectVisiblePartitionProfiles([ghost], true),
      WALL_HEIGHT_MM,
      "wall-south"
    );
    expect(shownShims).toHaveLength(1);
  });
});

// The point of the shims: once built they are indistinguishable from a real
// neighbour to every spacing/snapping engine downstream.
describe("partition shims as spacing neighbours", () => {
  // Slab 2000..5000 along an 8000 wall, 400 mm off it → a bay from 5000 to the
  // wall end at 8000 on its right, and 0..2000 on its left.
  const shims = derivePartitionNeighborShimsForFloorWall(floorWithPartition(), "wall-south");
  const work: WallObjectBase = {
    id: "art-1",
    wallId: "wall-south",
    xMm: 6000,
    yMm: 1500,
    widthMm: 800,
    heightMm: 1000
  };

  it("bounds detectBoundary on the side the slab stands", () => {
    const left = detectBoundary("left", [work], shims, 8000);
    expect(left).toEqual({ type: "object", edgeMm: 5000, objectId: "partition-1" });
    // Nothing to the right but the wall itself.
    expect(detectBoundary("right", [work], shims, 8000)).toEqual({
      type: "wall",
      edgeMm: 8000
    });
  });

  it("centers a work in the bay the slab creates, not on the whole wall", () => {
    expect(centerMemberBetweenBoundaries(work, shims, 8000)).toBeCloseTo(6500);
    // Without the shim the same work would center on the wall.
    expect(centerMemberBetweenBoundaries(work, [], 8000)).toBeCloseTo(4000);
  });

  it("spaces a run evenly inside the bay", () => {
    const bounds = getOpenSpaceBounds([work], shims, 8000);
    expect(bounds).toEqual({ startMm: 5000, endMm: 8000 });

    const members: WallObjectBase[] = [
      { ...work, id: "a", xMm: 5200, widthMm: 400 },
      { ...work, id: "b", xMm: 7600, widthMm: 400 }
    ];
    const moves = arrangeOnWallInZone(members, bounds.startMm, bounds.endMm);
    // (3000 − 800) / 3 = 733.33 of space either side and between.
    expect(moves[0]!.xMm).toBeCloseTo(5933.333);
    expect(moves[1]!.xMm).toBeCloseTo(7066.667);
  });

  it("snaps a dragged work flush to the partition edge", () => {
    // Proposed centre a few mm right of flush-against-the-slab (5000 + 400).
    const resolved = resolveArtworkSnap(
      { xMm: 5412, yMm: 1500 },
      {
        centerlineYMm: 1450,
        wallLengthMm: 8000,
        wallHeightMm: WALL_HEIGHT_MM,
        gridIntervalMm: 100,
        neighbors: shims,
        movingSize: { widthMm: 800, heightMm: 1000 },
        movingKind: "artwork",
        snapToGrid: false,
        thresholdMm: 50
      }
    );

    expect(resolved.point.xMm).toBeCloseTo(5400);
    expect(resolved.snapTargetIds.x).toBe("neighbor-edge:partition-1:right");
  });
});
