import { describe, expect, it } from "vitest";
import type { ConnectableOpeningWallObject, Project, RoomPlacement } from "../project";
import { CURRENT_SCHEMA_VERSION } from "../project";
import { createRectangularRoomPlacement } from "./createRoom";
import {
  evaluateOpeningPair,
  OPENING_PAIR_ANGLE_TOLERANCE_DEG,
  OPENING_PAIR_MAX_GAP_MM,
  OPENING_PAIR_MIN_OVERLAP_MM,
  OPENING_PAIR_MIN_OVERLAP_RATIO
} from "./openingConnections";

function room(roomId: string, offsetXMm: number): RoomPlacement {
  return createRectangularRoomPlacement({
    roomId,
    name: roomId,
    widthMm: 4000,
    depthMm: 3000,
    heightMm: 2500,
    offsetXMm,
    offsetYMm: 0
  });
}

function opening(
  id: string,
  wallId: string,
  overrides: Partial<ConnectableOpeningWallObject> = {}
): ConnectableOpeningWallObject {
  return {
    id,
    kind: "door",
    blocksPlacement: true,
    wallId,
    xMm: 1500,
    yMm: 1000,
    widthMm: 900,
    heightMm: 2000,
    ...overrides
  };
}

function project(
  a: ConnectableOpeningWallObject,
  b: ConnectableOpeningWallObject,
  roomB: RoomPlacement = room("room-b", 4000)
): Project {
  return {
    id: "project",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title: "Opening alignment",
    unit: "m",
    defaultWallHeightMm: 2500,
    defaultCenterlineHeightMm: 1450,
    floor: { rooms: [room("room-a", 0), roomB] },
    checklistArtworkIds: [],
    wallObjects: [a, b],
    floorObjects: [],
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z"
  };
}

const A_EAST = "room-a-wall-east";
const B_WEST = "room-b-wall-west";

describe("evaluateOpeningPair", () => {
  it("exports the spec's named starting tolerances", () => {
    expect(OPENING_PAIR_ANGLE_TOLERANCE_DEG).toBe(2);
    expect(OPENING_PAIR_MAX_GAP_MM).toBe(250);
    expect(OPENING_PAIR_MIN_OVERLAP_RATIO).toBe(0.5);
    expect(OPENING_PAIR_MIN_OVERLAP_MM).toBe(300);
  });

  it("aligns anti-parallel openings and returns a mirrored local clear interval for each wall", () => {
    const result = evaluateOpeningPair(
      project(
        opening("a", A_EAST, { xMm: 1200, widthMm: 1000 }),
        opening("b", B_WEST, { xMm: 1700, widthMm: 600 })
      ),
      "a",
      "b"
    );

    expect(result.status).toBe("aligned");
    if (result.status !== "aligned") return;
    // One physical clear segment (floor y=1000..1600) becomes different local
    // intervals because room B's west wall runs in the opposite direction.
    expect(result.clearA.xMinMm).toBeCloseTo(1000);
    expect(result.clearA.xMaxMm).toBeCloseTo(1600);
    expect(result.clearB.xMinMm).toBeCloseTo(1400);
    expect(result.clearB.xMaxMm).toBeCloseTo(2000);
  });

  it("rejects nearby same-direction walls because paired room edges must be anti-parallel", () => {
    const nearbySameDirectionRoom = room("room-b", 0);
    nearbySameDirectionRoom.offsetYMm = 200;
    const result = evaluateOpeningPair(
      project(
        opening("a", "room-a-wall-north"),
        opening("b", "room-b-wall-north"),
        nearbySameDirectionRoom
      ),
      "a",
      "b"
    );
    expect(result).toEqual({ status: "misaligned", reason: "angle" });
  });

  it("reports angle before the other geometric criteria", () => {
    const skewedRoom = room("room-b", 4000);
    // Tilt B's west wall by a little over 3° while keeping a valid non-zero
    // segment. The rest of the polygon is irrelevant to this pure evaluator.
    skewedRoom.room.vertices.find((vertex) => vertex.id === "room-b-v-nw")!.xMm = 160;

    expect(
      evaluateOpeningPair(
        project(opening("a", A_EAST), opening("b", B_WEST), skewedRoom),
        "a",
        "b"
      )
    ).toEqual({ status: "misaligned", reason: "angle" });
  });

  it("reports a wall-line gap over 250 mm", () => {
    expect(
      evaluateOpeningPair(
        project(opening("a", A_EAST), opening("b", B_WEST), room("room-b", 4251)),
        "a",
        "b"
      )
    ).toEqual({ status: "misaligned", reason: "gap" });
  });

  it("reports no-overlap when horizontal overlap misses either minimum", () => {
    const insufficientAbsolute = evaluateOpeningPair(
      project(
        opening("a", A_EAST, { xMm: 1000, widthMm: 900 }),
        opening("b", B_WEST, { xMm: 1350, widthMm: 900 })
      ),
      "a",
      "b"
    );
    expect(insufficientAbsolute).toEqual({ status: "misaligned", reason: "no-overlap" });

    const insufficientRatio = evaluateOpeningPair(
      project(
        opening("a", A_EAST, { xMm: 1000, widthMm: 1000 }),
        opening("b", B_WEST, { xMm: 1400, widthMm: 1000 })
      ),
      "a",
      "b"
    );
    expect(insufficientRatio).toEqual({ status: "misaligned", reason: "no-overlap" });
  });

  it("reports height when floor-space width overlaps but vertical extents do not", () => {
    const result = evaluateOpeningPair(
      project(
        opening("a", A_EAST, {
          kind: "window",
          yMm: 500,
          heightMm: 400
        }),
        opening("b", B_WEST, {
          kind: "window",
          yMm: 1500,
          heightMm: 400
        })
      ),
      "a",
      "b"
    );
    expect(result).toEqual({ status: "misaligned", reason: "height" });
  });

  it("treats touching vertical extents as no usable height overlap", () => {
    const result = evaluateOpeningPair(
      project(
        opening("a", A_EAST, { kind: "window", yMm: 500, heightMm: 400 }),
        opening("b", B_WEST, { kind: "window", yMm: 900, heightMm: 400 })
      ),
      "a",
      "b"
    );
    expect(result).toEqual({ status: "misaligned", reason: "height" });
  });

  it("fails safely for missing geometry, cross-kind pairs, and the same wall", () => {
    const base = project(opening("a", A_EAST), opening("b", B_WEST));
    expect(evaluateOpeningPair(base, "a", "missing")).toEqual({
      status: "misaligned",
      reason: "no-overlap"
    });

    const crossKind = project(
      opening("a", A_EAST),
      opening("b", B_WEST, { kind: "window" })
    );
    expect(evaluateOpeningPair(crossKind, "a", "b")).toEqual({
      status: "misaligned",
      reason: "no-overlap"
    });

    const sameWall = project(opening("a", A_EAST), opening("b", A_EAST));
    expect(evaluateOpeningPair(sameWall, "a", "b")).toEqual({
      status: "misaligned",
      reason: "no-overlap"
    });
  });
});
