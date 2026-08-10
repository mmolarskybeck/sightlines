import { describe, expect, it } from "vitest";
import { createRectangularRoomPlacement } from "../geometry/createRoom";
import type {
  ConnectableOpeningWallObject,
  DoorLeaf,
  Project,
  RoomPlacement,
  WallObject
} from "../project";
import { CURRENT_SCHEMA_VERSION } from "../project";
import {
  BLOCKED_ZONE_HEIGHT_MM,
  BLOCKED_ZONE_WIDTH_MM,
  DOOR_HEIGHT_MM,
  DOOR_WIDTH_MM,
  WINDOW_HEIGHT_MM,
  WINDOW_WIDTH_MM
} from "./createOpening";
import {
  analyzeSharedOpenings,
  applySharedOpeningActions,
  type SharedOpeningAction,
  type SharedOpeningConflict
} from "./sharedOpeningAnalysis";

// Same fixture shape as sharedWalls.test.ts: room-b flush to the right of
// room-a makes room-a's east wall (running +y) and room-b's west wall (running
// −y) one coincident twin pair. A_EAST runs +y, so its local x equals floor y —
// and the anti-parallel twin mirrors x to (3000 − x).
function room(
  roomId: string,
  offsetXMm: number,
  offsetYMm = 0,
  overrides: { widthMm?: number; depthMm?: number } = {}
): RoomPlacement {
  return createRectangularRoomPlacement({
    roomId,
    name: roomId,
    widthMm: overrides.widthMm ?? 4000,
    depthMm: overrides.depthMm ?? 3000,
    heightMm: 2500,
    offsetXMm,
    offsetYMm
  });
}

function project(rooms: RoomPlacement[], wallObjects: WallObject[] = []): Project {
  return {
    id: "project",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title: "Shared openings",
    unit: "m",
    defaultWallHeightMm: 2500,
    defaultCenterlineHeightMm: 1450,
    floor: { rooms },
    checklistArtworkIds: [],
    wallObjects,
    floorObjects: [],
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z"
  };
}

const A_EAST = "room-a-wall-east";
const B_WEST = "room-b-wall-west";
const B_EAST = "room-b-wall-east";
const C_WEST = "room-c-wall-west";
const C_EAST = "room-c-wall-east";
const D_WEST = "room-d-wall-west";

function door(
  id: string,
  wallId: string,
  xMm: number,
  overrides: Partial<ConnectableOpeningWallObject> = {}
): ConnectableOpeningWallObject {
  return {
    id,
    kind: "door",
    blocksPlacement: true,
    wallId,
    xMm,
    yMm: DOOR_HEIGHT_MM / 2,
    widthMm: DOOR_WIDTH_MM,
    heightMm: DOOR_HEIGHT_MM,
    ...overrides
  };
}

function window(
  id: string,
  wallId: string,
  xMm: number,
  overrides: Partial<ConnectableOpeningWallObject> = {}
): ConnectableOpeningWallObject {
  return {
    id,
    kind: "window",
    blocksPlacement: true,
    wallId,
    xMm,
    yMm: 1450,
    widthMm: WINDOW_WIDTH_MM,
    heightMm: WINDOW_HEIGHT_MM,
    ...overrides
  };
}

// Wall text never blocks placement (project.ts) — it is furniture, not
// architecture — so it must never keep an architectural twin from being made.
function wallText(id: string, wallId: string, xMm: number): WallObject {
  return {
    id,
    kind: "wall-text",
    wallId,
    xMm,
    yMm: 1450,
    widthMm: 400,
    heightMm: 300
  } as WallObject;
}

function blockedZone(id: string, wallId: string, xMm: number): WallObject {
  return {
    id,
    kind: "blocked-zone",
    blocksPlacement: true,
    wallId,
    xMm,
    yMm: 1450,
    widthMm: BLOCKED_ZONE_WIDTH_MM,
    heightMm: BLOCKED_ZONE_HEIGHT_MM
  };
}

// Two abutting rooms, and a pair of doors that already mirror each other.
function pairedDoors(
  aXMm: number,
  bXMm: number
): [ConnectableOpeningWallObject, ConnectableOpeningWallObject] {
  return [
    door("door-a", A_EAST, aXMm, { connectsToObjectId: "door-b" }),
    door("door-b", B_WEST, bXMm, { connectsToObjectId: "door-a" })
  ];
}

function reasons(conflicts: SharedOpeningConflict[]): string[] {
  return conflicts.map((conflict) => conflict.reason);
}

// ---------------------------------------------------------------------------
// Phase 1 — the reconciliation ladder for one-sided openings.
// ---------------------------------------------------------------------------

describe("analyzeSharedOpenings — unpaired openings", () => {
  it("says nothing about an exterior door (no facing wall at all)", () => {
    // Ladder: findSharedBoundary "none" means exterior, NOT a conflict —
    // reporting one would flag every front door in the project.
    const result = analyzeSharedOpenings(
      project([room("room-a", 0)], [door("door-a", A_EAST, 1500)])
    );

    expect(result.actions).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("creates the twin when the one empty opposite face is unambiguous", () => {
    const result = analyzeSharedOpenings(
      project([room("room-a", 0), room("room-b", 4000)], [door("door-a", A_EAST, 1200)])
    );

    expect(result.conflicts).toEqual([]);
    expect(result.actions).toHaveLength(1);
    const action = result.actions[0];
    expect(action.kind).toBe("create-twin");
    if (action.kind !== "create-twin") return;
    expect(action.openingId).toBe("door-a");
    expect(action.wallId).toBe(B_WEST);
    // Anti-parallel twins mirror x → 3000 − x.
    expect(action.xMm).toBeCloseTo(1800);
  });

  it("never mints a twin ON an open wall", () => {
    // The reachable bug this guards: a wall is opened while exterior, then a
    // room is later slid flush against it. Without filtering, reconciliation
    // would put a door on the side that has no surface at all.
    const rooms = [room("room-a", 0), room("room-b", 4000)];
    const openBWest: RoomPlacement = {
      ...rooms[1],
      room: {
        ...rooms[1].room,
        walls: rooms[1].room.walls.map((wall) =>
          wall.id === B_WEST ? { ...wall, isOpenSide: true } : wall
        )
      }
    };

    const result = analyzeSharedOpenings(
      project([rooms[0], openBWest], [door("door-a", A_EAST, 1200)])
    );

    expect(result.actions).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("treats an opening on an open wall as exterior, not as half a pair", () => {
    const rooms = [room("room-a", 0), room("room-b", 4000)];
    const openAEast: RoomPlacement = {
      ...rooms[0],
      room: {
        ...rooms[0].room,
        walls: rooms[0].room.walls.map((wall) =>
          wall.id === A_EAST ? { ...wall, isOpenSide: true } : wall
        )
      }
    };

    const result = analyzeSharedOpenings(
      project([openAEast, rooms[1]], [door("door-a", A_EAST, 1200)])
    );

    expect(result.actions).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("adopts the one aligned, unpaired, same-kind opening opposite", () => {
    const result = analyzeSharedOpenings(
      project(
        [room("room-a", 0), room("room-b", 4000)],
        [door("door-a", A_EAST, 1200), door("door-b", B_WEST, 1800)]
      )
    );

    expect(result.conflicts).toEqual([]);
    // One action, not two: adopting claims BOTH halves, so door-b never comes
    // back around as a primary looking for its own twin.
    expect(result.actions).toEqual([
      { kind: "adopt", openingId: "door-a", counterpartOpeningId: "door-b" }
    ]);
  });

  it("reports a picker conflict when several openings opposite could be adopted", () => {
    const result = analyzeSharedOpenings(
      project(
        [room("room-a", 0), room("room-b", 4000)],
        [
          door("door-a", A_EAST, 1200),
          door("door-b1", B_WEST, 1400),
          door("door-b2", B_WEST, 1750)
        ]
      )
    );

    expect(result.actions).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    const conflict = result.conflicts[0];
    expect(conflict.reason).toBe("ambiguous-counterpart-opening");
    expect(conflict.id).toBe("door-a:ambiguous-counterpart-opening");
    expect(conflict.openingId).toBe("door-a");
    expect(conflict.wallIds).toEqual([A_EAST, B_WEST]);
    expect(conflict.candidates).toEqual([
      { kind: "opening", openingId: "door-b1" },
      { kind: "opening", openingId: "door-b2" }
    ]);
  });

  // Regression: adoption has to be MUTUALLY exclusive. One wide door opposite
  // two narrow ones has exactly one adoptable candidate read from either narrow
  // door, but two read from the wide one — so whichever side sorted first would
  // otherwise decide whether the document got a silent pairing or a conflict.
  // Identical geometry, opposite outcomes, purely from id lexicography. The
  // adoption graph settles it: all three are one connected component with two
  // edges, which is never a repair.
  it.each([
    ["narrow side sorts first", ["door-a1", "door-a2", "door-b"] as const],
    ["wide side sorts first", ["door-b1", "door-b2", "door-a"] as const]
  ])("refuses to guess when one wide door faces two narrow ones (%s)", (_label, ids) => {
    const [narrowOne, narrowTwo, wide] = ids;
    const result = analyzeSharedOpenings(
      project(
        [room("room-a", 0), room("room-b", 4000)],
        [
          door(narrowOne, A_EAST, 1000),
          door(narrowTwo, A_EAST, 2000),
          door(wide, B_WEST, 1500, { widthMm: 2400 })
        ]
      )
    );

    // No mutation from either direction, and exactly one conflict either way.
    expect(result.actions).toEqual([]);
    expect(reasons(result.conflicts)).toEqual(["ambiguous-counterpart-opening"]);

    // The conflict names the whole cluster, so Stage 7 can raise it for any
    // member the user selects, and is KEYED on the cluster's lexicographically
    // smallest member so nothing depends on traversal order.
    const members = [narrowOne, narrowTwo, wide].sort((a, b) => a.localeCompare(b));
    const conflict = result.conflicts[0];
    expect(conflict.memberIds).toEqual(members);
    expect(conflict.openingId).toBe(members[0]);
    expect(conflict.wallIds[0]).toBe(members[0] === wide ? B_WEST : A_EAST);
    expect([...conflict.wallIds].sort()).toEqual([A_EAST, B_WEST]);

    // `candidates` is the KEYED opening's own graph neighbours — the wide door
    // faces both narrow ones, a narrow door faces only the wide one.
    expect(conflict.candidates).toEqual(
      members[0] === wide
        ? [
            { kind: "opening", openingId: narrowOne },
            { kind: "opening", openingId: narrowTwo }
          ]
        : [{ kind: "opening", openingId: wide }]
    );
  });

  // Regression for the traversal-dependence the claim set used to hide: door-a1
  // can pair with door-b1 or door-b2, door-a2 with door-b2 or door-b3. Visiting
  // door-a1 first claimed b1/b2, leaving a2 with a single VISIBLE candidate it
  // then silently adopted — despite genuinely having had two. In the complete
  // graph all five are one component, so nothing is adopted at all.
  it("does not let an earlier ambiguity make a later opening look unique", () => {
    // Wide doors mirrored onto B_WEST land at 3000 − x; a 1400 mm pair overlaps
    // enough to be "aligned" while their centers are within 700 mm.
    const wide = { widthMm: 1400 };
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [
        door("door-a1", A_EAST, 1100, wide), // mirrors to 1900
        door("door-a2", A_EAST, 1900, wide), // mirrors to 1100
        door("door-b1", B_WEST, 2300, wide),
        door("door-b2", B_WEST, 1500, wide),
        door("door-b3", B_WEST, 700, wide)
      ]
    );
    const result = analyzeSharedOpenings(base);

    // The whole point: the same cluster, whichever member the pass reaches
    // first. Every rotation of the array is a different traversal order.
    const expected = normalize(result);
    for (let shift = 1; shift < base.wallObjects.length; shift += 1) {
      const shuffled = [...base.wallObjects.slice(shift), ...base.wallObjects.slice(0, shift)];
      expect(normalize(analyzeSharedOpenings({ ...base, wallObjects: shuffled }))).toBe(expected);
    }

    expect(result.actions).toEqual([]);
    expect(reasons(result.conflicts)).toEqual(["ambiguous-counterpart-opening"]);
    const conflict = result.conflicts[0];
    expect(conflict.memberIds).toEqual([
      "door-a1",
      "door-a2",
      "door-b1",
      "door-b2",
      "door-b3"
    ]);
    // door-a1 really did have two candidates of its own — the point of the bug.
    expect(conflict.openingId).toBe("door-a1");
    expect(conflict.candidates).toEqual([
      { kind: "opening", openingId: "door-b1" },
      { kind: "opening", openingId: "door-b2" }
    ]);
  });

  it("reports overhangs-common-span rather than treating the door as exterior", () => {
    // room-b is only 1500 deep, so the walls share [0, 1500] of room-a's east
    // wall. A door centred at 1500 straddles the end of that run. The WALLS are
    // still shared — the old extent-based API called this "no counterpart" and
    // mislabelled it exterior.
    const result = analyzeSharedOpenings(
      project(
        [room("room-a", 0), room("room-b", 4000, 0, { depthMm: 1500 })],
        [door("door-a", A_EAST, 1500)]
      )
    );

    expect(result.actions).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].reason).toBe("overhangs-common-span");
    expect(result.conflicts[0].wallIds).toEqual([A_EAST, B_WEST]);
  });

  it("explains an occupied opposite slot instead of offering a picker", () => {
    // door-b already belongs to another (legacy) pair, so it cannot be adopted
    // — and it stands exactly where the mirrored twin would go.
    const result = analyzeSharedOpenings(
      project(
        [room("room-a", 0), room("room-b", 4000)],
        [
          door("door-a", A_EAST, 1200),
          door("door-b", B_WEST, 1800, { connectsToObjectId: "door-b2" }),
          door("door-b2", B_EAST, 500, { connectsToObjectId: "door-b" })
        ]
      )
    );

    expect(result.actions).toEqual([]);
    const occupied = result.conflicts.find((c) => c.openingId === "door-a");
    expect(occupied?.reason).toBe("counterpart-occupied");
    expect(occupied?.blockerId).toBe("door-b");
    expect(occupied?.candidates).toBeUndefined();
  });

  it("reports a blocked mirror slot when a non-opening stands in the way", () => {
    const result = analyzeSharedOpenings(
      project(
        [room("room-a", 0), room("room-b", 4000)],
        [door("door-a", A_EAST, 1200), blockedZone("zone-b", B_WEST, 1800)]
      )
    );

    expect(result.actions).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].reason).toBe("blocked-mirror-slot");
    expect(result.conflicts[0].blockerId).toBe("zone-b");
  });

  it("names the object that actually blocks, not a label sharing the slot", () => {
    // The label's id sorts first, so a looser filter here than the one
    // isOpeningSlotFree uses would name the wall text as the blocker — and wall
    // text never blocks placement at all (overlapPolicy.ts).
    const result = analyzeSharedOpenings(
      project(
        [room("room-a", 0), room("room-b", 4000)],
        [
          door("door-a", A_EAST, 1200),
          wallText("aaa-label", B_WEST, 1800),
          blockedZone("zzz-zone", B_WEST, 1800)
        ]
      )
    );

    expect(reasons(result.conflicts)).toEqual(["blocked-mirror-slot"]);
    expect(result.conflicts[0].blockerId).toBe("zzz-zone");
  });

  it("does not offer a label as the reason a slot is blocked", () => {
    // With only the label in the mirrored slot the slot is FREE, so the twin is
    // created rather than reported as blocked.
    const result = analyzeSharedOpenings(
      project(
        [room("room-a", 0), room("room-b", 4000)],
        [door("door-a", A_EAST, 1200), wallText("label-b", B_WEST, 1800)]
      )
    );

    expect(result.conflicts).toEqual([]);
    expect(result.actions.map((action) => action.kind)).toEqual(["create-twin"]);
  });

  it("treats a wrong-kind opening in the mirrored slot as occupied, not adoptable", () => {
    const result = analyzeSharedOpenings(
      project(
        [room("room-a", 0), room("room-b", 4000)],
        [door("door-a", A_EAST, 1200), window("window-b", B_WEST, 1800)]
      )
    );

    expect(result.actions).toEqual([]);
    const doorConflict = result.conflicts.find((c) => c.openingId === "door-a");
    expect(doorConflict?.reason).toBe("counterpart-occupied");
    expect(doorConflict?.blockerId).toBe("window-b");
  });
});

// ---------------------------------------------------------------------------
// The narrowing refinement: wall-level ambiguity is not per-opening ambiguity.
// ---------------------------------------------------------------------------

describe("analyzeSharedOpenings — narrowing an ambiguous boundary", () => {
  // Two 1500-deep rooms stacked along room-a's 3000 mm east wall. Discovery is
  // ambiguous (the wall faces two rooms) but every individual opening sits over
  // exactly one of them.
  const stacked = [
    room("room-a", 0),
    room("room-b", 4000, 0, { depthMm: 1500 }),
    room("room-c", 4000, 1500, { depthMm: 1500 })
  ];

  it("resolves an opening that lies in only one half unambiguously", () => {
    const lower = analyzeSharedOpenings(project(stacked, [door("door-a", A_EAST, 700)]));
    expect(lower.conflicts).toEqual([]);
    expect(lower.actions).toHaveLength(1);
    expect(lower.actions[0]).toMatchObject({ kind: "create-twin", wallId: B_WEST });

    const upper = analyzeSharedOpenings(project(stacked, [door("door-a", A_EAST, 2300)]));
    expect(upper.conflicts).toEqual([]);
    expect(upper.actions).toHaveLength(1);
    expect(upper.actions[0]).toMatchObject({ kind: "create-twin", wallId: C_WEST });
  });

  it("reports overhangs-common-span for an opening spanning the seam between them", () => {
    // Centred on 1500 the door covers the end of one room and the start of the
    // next: no single boundary contains it, so neither room can host the twin.
    const result = analyzeSharedOpenings(project(stacked, [door("door-a", A_EAST, 1500)]));

    expect(result.actions).toEqual([]);
    expect(reasons(result.conflicts)).toEqual(["overhangs-common-span"]);
    expect(result.conflicts[0].wallIds).toEqual([A_EAST, B_WEST, C_WEST]);
  });

  it("stays ambiguous when two overlapping rooms both contain the opening", () => {
    // room-c overlaps room-b: both back the whole wall, so both common spans
    // contain the door and the app genuinely cannot pick a room for the user.
    const result = analyzeSharedOpenings(
      project(
        [room("room-a", 0), room("room-b", 4000), room("room-c", 4100)],
        [door("door-a", A_EAST, 1500)]
      )
    );

    expect(result.actions).toEqual([]);
    expect(reasons(result.conflicts)).toEqual(["ambiguous-boundary-wall"]);
    expect(result.conflicts[0].wallIds).toEqual([A_EAST, B_WEST, C_WEST]);
    // Both faces are EMPTY, so the only resolvable targets are the walls
    // themselves — the reason SharedOpeningTarget has a "wall" variant at all.
    expect(result.conflicts[0].candidates).toEqual([
      { kind: "wall", wallId: B_WEST },
      { kind: "wall", wallId: C_WEST }
    ]);
  });

  // Regression: a resolver target has to be valid from BOTH sides. `adoptableOn`
  // only asks whether the candidate looks right from the source — wall, kind,
  // alignment — and says nothing about where the candidate itself sits. A wide
  // opening can overlap the source enough to read as "aligned" while its own
  // extent runs off the end of the run its walls share, which makes it an
  // invalid half of any shared opening. It must not be advertised as a target.
  it("never offers a candidate that overhangs its own shared run", () => {
    // room-c is deep and offset 100 mm out, so C_WEST (5000 long) is backed by
    // room-a's 3000 mm east wall over only part of its length. A 1400 mm-wide
    // door there straddles the end of that shared run.
    const result = analyzeSharedOpenings(
      project(
        [
          room("room-a", 0),
          room("room-b", 4000),
          room("room-c", 4100, 0, { depthMm: 5000 })
        ],
        [
          door("door-a", A_EAST, 2400),
          door("door-c", C_WEST, 2600, { widthMm: 1400 })
        ]
      )
    );

    const ambiguous = result.conflicts.find(
      (conflict) => conflict.reason === "ambiguous-boundary-wall"
    );
    expect(ambiguous).toBeDefined();
    // B_WEST is empty and its slot is free, so it is offered as a wall target.
    // C_WEST offers nothing: door-c is disqualified, and the slot it occupies is
    // not free either.
    expect(ambiguous!.candidates).toEqual([{ kind: "wall", wallId: B_WEST }]);
    expect(ambiguous!.candidates).not.toContainEqual({
      kind: "opening",
      openingId: "door-c"
    });
    // door-c still reports its own problem, so nothing is hidden.
    expect(reasons(result.conflicts)).toContain("overhangs-common-span");
  });

  it("offers existing openings and empty walls side by side", () => {
    const result = analyzeSharedOpenings(
      project(
        [room("room-a", 0), room("room-b", 4000), room("room-c", 4100)],
        [door("door-a", A_EAST, 1500), door("door-b", B_WEST, 1500)]
      )
    );

    const conflict = result.conflicts.find((c) => c.openingId === "door-a");
    expect(conflict?.reason).toBe("ambiguous-boundary-wall");
    expect(conflict?.candidates).toEqual([
      { kind: "opening", openingId: "door-b" },
      { kind: "wall", wallId: C_WEST }
    ]);
    // The candidate opening is claimed, so it never quietly adopts door-a from
    // the other side while the conflict is still unresolved.
    expect(result.actions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A partly shared wall: shared over part of its run, exterior over the rest.
// ---------------------------------------------------------------------------

describe("analyzeSharedOpenings — a wall that is only partly shared", () => {
  // room-b is 1500 deep against room-a's 3000 mm east wall, so A_EAST is shared
  // over [0, 1500] and faces open air over [1500, 3000].
  const partlyShared = [room("room-a", 0), room("room-b", 4000, 0, { depthMm: 1500 })];

  it("says nothing about a door on the exterior stretch", () => {
    // Extent [1950, 2850]: past the shared run entirely. A front door on the far
    // half of a wall whose near half happens to back another room is a
    // deliberate, legitimate placement — not an overhang.
    const result = analyzeSharedOpenings(
      project(partlyShared, [door("door-a", A_EAST, 2400)])
    );

    expect(result.actions).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("reports overhangs-common-span for a door straddling the seam", () => {
    // Extent [1050, 1950]: overlaps the shared run without fitting inside it.
    const result = analyzeSharedOpenings(
      project(partlyShared, [door("door-a", A_EAST, 1500)])
    );

    expect(result.actions).toEqual([]);
    expect(reasons(result.conflicts)).toEqual(["overhangs-common-span"]);
    expect(result.conflicts[0].wallIds).toEqual([A_EAST, B_WEST]);
  });

  it("runs the normal ladder for a door inside the shared stretch", () => {
    const result = analyzeSharedOpenings(project(partlyShared, [door("door-a", A_EAST, 700)]));

    expect(result.conflicts).toEqual([]);
    expect(result.actions).toHaveLength(1);
    const action = result.actions[0];
    expect(action.kind).toBe("create-twin");
    if (action.kind !== "create-twin") return;
    expect(action.wallId).toBe(B_WEST);
    // B_WEST is only 1500 long, so the mirror is 1500 − 700, not 3000 − 700.
    expect(action.xMm).toBeCloseTo(800);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — existing pairs.
// ---------------------------------------------------------------------------

describe("analyzeSharedOpenings — existing pairs", () => {
  it("leaves a healthy shared pair alone", () => {
    const result = analyzeSharedOpenings(
      project([room("room-a", 0), room("room-b", 4000)], pairedDoors(1200, 1800))
    );

    expect(result.actions).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("realigns a drifted pair that still shares a boundary", () => {
    const result = analyzeSharedOpenings(
      project([room("room-a", 0), room("room-b", 4000)], pairedDoors(1200, 1700))
    );

    expect(result.conflicts).toEqual([]);
    expect(result.actions).toHaveLength(1);
    const action = result.actions[0];
    expect(action.kind).toBe("realign");
    if (action.kind !== "realign") return;
    // The lexicographically smaller half is authoritative in the whole-project
    // pass, which is what makes it deterministic.
    expect(action.authoritativeOpeningId).toBe("door-a");
    expect(action.partnerOpeningId).toBe("door-b");
    expect(action.partnerXMm).toBeCloseTo(1800);
  });

  it("reports paired-overhang when the shared run no longer holds the opening", () => {
    // room-b is 2000 deep, so the rooms now meet over only [0, 2000]. The pair
    // is still perfectly mirrored — and still runs past where the two rooms
    // actually meet, which is a conflict, not "healthy".
    const result = analyzeSharedOpenings(
      project(
        [room("room-a", 0), room("room-b", 4000, 0, { depthMm: 2000 })],
        [
          door("door-a", A_EAST, 1800, { connectsToObjectId: "door-b" }),
          door("door-b", B_WEST, 200, { connectsToObjectId: "door-a" })
        ]
      )
    );

    expect(result.actions).toEqual([]);
    expect(reasons(result.conflicts)).toEqual(["paired-overhang"]);
    expect(result.conflicts[0].openingId).toBe("door-a");
    expect(result.conflicts[0].partnerId).toBe("door-b");
    expect(result.conflicts[0].wallIds).toEqual([A_EAST, B_WEST]);
  });

  it("preserves identity and reports boundary-lost when the rooms move apart", () => {
    const result = analyzeSharedOpenings(
      project([room("room-a", 0), room("room-b", 8000)], pairedDoors(1200, 1800))
    );

    expect(result.actions).toEqual([]);
    expect(reasons(result.conflicts)).toEqual(["boundary-lost"]);
    expect(result.conflicts[0].openingId).toBe("door-a");
    expect(result.conflicts[0].partnerId).toBe("door-b");
  });

  it("reports each pair once, keyed on the lexicographically smaller half", () => {
    // Both orderings of the same document produce exactly one conflict named
    // for door-a.
    const forwards = analyzeSharedOpenings(
      project([room("room-a", 0), room("room-b", 8000)], pairedDoors(1200, 1800))
    );
    const [a, b] = pairedDoors(1200, 1800);
    const backwards = analyzeSharedOpenings(
      project([room("room-a", 0), room("room-b", 8000)], [b, a])
    );

    expect(forwards.conflicts).toEqual(backwards.conflicts);
    expect(forwards.conflicts).toHaveLength(1);
  });

  it("names the blocker when a drifted pair cannot be realigned into place", () => {
    const result = analyzeSharedOpenings(
      project(
        [room("room-a", 0), room("room-b", 4000)],
        [
          door("door-a", A_EAST, 1200, { connectsToObjectId: "door-b" }),
          door("door-b", B_WEST, 1000, { connectsToObjectId: "door-a" }),
          blockedZone("zone-b", B_WEST, 1800)
        ]
      )
    );

    expect(result.actions).toEqual([]);
    expect(reasons(result.conflicts)).toEqual(["blocked-mirror-slot"]);
    expect(result.conflicts[0].blockerId).toBe("zone-b");
  });

  // Only x is mirrored, so before paired-geometry-mismatch a pair whose halves
  // were different SIZES read as perfectly healthy. Stage 3 stops new mismatches
  // at the edit paths; this is the only thing that can explain an imported one.
  it.each([
    ["width", { widthMm: 1800 }],
    ["height", { heightMm: 1800 }],
    ["hang height", { yMm: 1200 }]
  ])("reports paired-geometry-mismatch when the halves differ in %s", (_label, override) => {
    const result = analyzeSharedOpenings(
      project(
        [room("room-a", 0), room("room-b", 4000)],
        [
          door("door-a", A_EAST, 1200, { connectsToObjectId: "door-b" }),
          door("door-b", B_WEST, 1800, { connectsToObjectId: "door-a", ...override })
        ]
      )
    );

    expect(reasons(result.conflicts)).toEqual(["paired-geometry-mismatch"]);
    expect(result.conflicts[0].openingId).toBe("door-a");
    expect(result.conflicts[0].partnerId).toBe("door-b");
    expect(result.conflicts[0].wallIds).toEqual([A_EAST, B_WEST]);
    // No authoritative half and no repair: there is no geometric answer to which
    // size is right, so Stage 6's Realign establishes authority from the half the
    // user selected instead.
    expect(result.actions).toEqual([]);
    expect(result.conflicts[0].candidates).toBeUndefined();
  });

  it("leaves a pair alone when both halves match within a millimetre", () => {
    const result = analyzeSharedOpenings(
      project(
        [room("room-a", 0), room("room-b", 4000)],
        [
          door("door-a", A_EAST, 1200, { connectsToObjectId: "door-b" }),
          door("door-b", B_WEST, 1800, {
            connectsToObjectId: "door-a",
            widthMm: DOOR_WIDTH_MM + 0.4,
            yMm: DOOR_HEIGHT_MM / 2 - 0.4
          })
        ]
      )
    );

    expect(result.actions).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("reports the mismatch instead of realigning a pair that is also drifted", () => {
    // Ordered after boundary-lost and paired-overhang but BEFORE the x-drift
    // check: realigning would move a half whose size is already wrong.
    const result = analyzeSharedOpenings(
      project(
        [room("room-a", 0), room("room-b", 4000)],
        [
          door("door-a", A_EAST, 1200, { connectsToObjectId: "door-b" }),
          door("door-b", B_WEST, 1700, { connectsToObjectId: "door-a", widthMm: 1800 })
        ]
      )
    );

    expect(result.actions).toEqual([]);
    expect(reasons(result.conflicts)).toEqual(["paired-geometry-mismatch"]);
  });

  it("still reports boundary-lost ahead of a geometry mismatch", () => {
    const result = analyzeSharedOpenings(
      project(
        [room("room-a", 0), room("room-b", 8000)],
        [
          door("door-a", A_EAST, 1200, { connectsToObjectId: "door-b" }),
          door("door-b", B_WEST, 1800, { connectsToObjectId: "door-a", widthMm: 1800 })
        ]
      )
    );

    expect(reasons(result.conflicts)).toEqual(["boundary-lost"]);
  });

  it("keeps a legacy same-room pair as a boundary-lost report, never a repair", () => {
    // A door on wall-north connected to one on wall-south: a legitimate,
    // user-created legacy state. Identity is preserved; the user resolves it.
    const result = analyzeSharedOpenings(
      project(
        [room("room-a", 0)],
        [
          door("door-a", "room-a-wall-north", 1500, { connectsToObjectId: "door-b" }),
          door("door-b", "room-a-wall-south", 1500, { connectsToObjectId: "door-a" })
        ]
      )
    );

    expect(result.actions).toEqual([]);
    expect(reasons(result.conflicts)).toEqual(["boundary-lost"]);
  });
});

// ---------------------------------------------------------------------------
// Purity, determinism and scope.
// ---------------------------------------------------------------------------

// Four rooms in a row exercising three different ladder rows at once, which is
// what makes the order/purity assertions meaningful.
function mixedProject(wallObjects: WallObject[] = []): Project {
  return project(
    [room("room-a", 0), room("room-b", 4000), room("room-c", 8000), room("room-d", 12000)],
    wallObjects.length > 0
      ? wallObjects
      : [
          door("door-1", A_EAST, 1200),
          door("door-2", B_WEST, 1800),
          door("door-3", B_EAST, 1000),
          door("door-4", C_EAST, 1200, { connectsToObjectId: "door-5" }),
          door("door-5", D_WEST, 1700, { connectsToObjectId: "door-4" })
        ]
  );
}

function normalize(analysis: {
  actions: SharedOpeningAction[];
  conflicts: SharedOpeningConflict[];
}): string {
  return JSON.stringify({
    actions: [...analysis.actions].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b))
    ),
    conflicts: [...analysis.conflicts].sort((a, b) => a.id.localeCompare(b.id))
  });
}

describe("analyzeSharedOpenings — purity and determinism", () => {
  it("is independent of wallObjects order", () => {
    const base = mixedProject();
    const expected = normalize(analyzeSharedOpenings(base));

    // Every rotation of the array is a different insertion order.
    for (let shift = 1; shift < base.wallObjects.length; shift += 1) {
      const shuffled = [...base.wallObjects.slice(shift), ...base.wallObjects.slice(0, shift)];
      expect(normalize(analyzeSharedOpenings({ ...base, wallObjects: shuffled }))).toBe(expected);
    }

    // And the reversed order, which flips every pair's discovery direction.
    const reversed = [...base.wallObjects].reverse();
    expect(normalize(analyzeSharedOpenings({ ...base, wallObjects: reversed }))).toBe(expected);
  });

  it("mutates nothing: every pre-existing connectsToObjectId is byte-identical", () => {
    const base = mixedProject();
    const before = JSON.stringify(base);
    const pointersBefore = base.wallObjects.map((object) =>
      object.kind === "door" || object.kind === "window"
        ? `${object.id}->${String(object.connectsToObjectId)}`
        : object.id
    );

    analyzeSharedOpenings(base);

    expect(JSON.stringify(base)).toBe(before);
    expect(
      base.wallObjects.map((object) =>
        object.kind === "door" || object.kind === "window"
          ? `${object.id}->${String(object.connectsToObjectId)}`
          : object.id
      )
    ).toEqual(pointersBefore);
  });

  it("never allocates an object id", () => {
    const base = mixedProject();
    const existingObjectIds = new Set(base.wallObjects.map((object) => object.id));
    const existingWallIds = new Set(
      base.floor.rooms.flatMap((placement) => placement.room.walls.map((wall) => wall.id))
    );

    const { actions, conflicts } = analyzeSharedOpenings(base);
    // Sanity: the sample really does exercise the id-bearing shapes.
    expect(actions.length).toBeGreaterThan(0);

    for (const action of actions) {
      if (action.kind === "adopt") {
        expect(existingObjectIds.has(action.openingId)).toBe(true);
        expect(existingObjectIds.has(action.counterpartOpeningId)).toBe(true);
      } else if (action.kind === "create-twin") {
        expect(existingObjectIds.has(action.openingId)).toBe(true);
        expect(existingWallIds.has(action.wallId)).toBe(true);
      } else {
        expect(existingObjectIds.has(action.authoritativeOpeningId)).toBe(true);
        expect(existingObjectIds.has(action.partnerOpeningId)).toBe(true);
      }
    }

    for (const conflict of conflicts) {
      expect(existingObjectIds.has(conflict.openingId)).toBe(true);
      for (const wallId of conflict.wallIds) expect(existingWallIds.has(wallId)).toBe(true);
      for (const candidate of conflict.candidates ?? []) {
        if (candidate.kind === "opening") {
          expect(existingObjectIds.has(candidate.openingId)).toBe(true);
        } else {
          expect(existingWallIds.has(candidate.wallId)).toBe(true);
        }
      }
      for (const memberId of conflict.memberIds ?? []) {
        expect(existingObjectIds.has(memberId)).toBe(true);
      }
      if (conflict.partnerId) expect(existingObjectIds.has(conflict.partnerId)).toBe(true);
      if (conflict.blockerId) expect(existingObjectIds.has(conflict.blockerId)).toBe(true);
    }
  });

  it("touches nothing outside its scope", () => {
    const base = mixedProject();

    // Scoped to the one opening that wants a twin: the adopt pair and the
    // drifted pair on the other boundaries are left entirely alone.
    const byOpening = analyzeSharedOpenings(base, { openingIds: ["door-3"] });
    expect(byOpening.conflicts).toEqual([]);
    expect(byOpening.actions).toEqual([
      { kind: "create-twin", openingId: "door-3", wallId: C_WEST, xMm: 2000 }
    ]);

    // Scoping by wall reaches the openings on that wall only.
    const byWall = analyzeSharedOpenings(base, { wallIds: [A_EAST] });
    expect(byWall.actions).toEqual([
      { kind: "adopt", openingId: "door-1", counterpartOpeningId: "door-2" }
    ]);

    // An empty scope is a real scope: nothing is in it.
    expect(analyzeSharedOpenings(base, {})).toEqual({ actions: [], conflicts: [] });

    // Either half of a pair pulls the pair into scope.
    const pairScope = analyzeSharedOpenings(base, { openingIds: ["door-5"] });
    expect(pairScope.actions).toHaveLength(1);
    expect(pairScope.actions[0]).toMatchObject({
      kind: "realign",
      authoritativeOpeningId: "door-4",
      partnerOpeningId: "door-5"
    });
  });
});

// ---------------------------------------------------------------------------
// Apply.
// ---------------------------------------------------------------------------

function idFactory(): () => string {
  let next = 0;
  return () => `twin-${(next += 1)}`;
}

describe("applySharedOpeningActions", () => {
  it("returns the same project reference when there is nothing to do", () => {
    const base = mixedProject();
    const applied = applySharedOpeningActions(base, [], idFactory());

    expect(applied.project).toBe(base);
    expect(applied.formedPairIds).toEqual([]);
    expect(applied.createdOpeningIds).toEqual([]);
    expect(applied.realignedIds).toEqual([]);
  });

  it("copies kind, width, height, yMm and blocksPlacement verbatim, mirroring only x", () => {
    // A window at a non-default hang height: copying yMm is what stops the twin
    // snapping back to the wall's default centerline.
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [window("window-a", A_EAST, 1200, { yMm: 900, widthMm: 800, heightMm: 700 })]
    );
    const { actions } = analyzeSharedOpenings(base);
    const applied = applySharedOpeningActions(base, actions, idFactory());

    expect(applied.createdOpeningIds).toEqual(["twin-1"]);
    expect(applied.formedPairIds).toEqual([["window-a", "twin-1"]]);

    const twin = applied.project.wallObjects.find((object) => object.id === "twin-1");
    expect(twin).toEqual({
      id: "twin-1",
      kind: "window",
      blocksPlacement: true,
      wallId: B_WEST,
      xMm: expect.closeTo(1800, 6),
      yMm: 900,
      widthMm: 800,
      heightMm: 700,
      connectsToObjectId: "window-a"
    });

    const primary = applied.project.wallObjects.find((object) => object.id === "window-a");
    expect(primary).toMatchObject({ connectsToObjectId: "twin-1", xMm: 1200, yMm: 900 });
  });

  it("writes both halves of an adopted pair", () => {
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [door("door-a", A_EAST, 1200), door("door-b", B_WEST, 1800)]
    );
    const { actions } = analyzeSharedOpenings(base);
    const applied = applySharedOpeningActions(base, actions, idFactory());

    expect(applied.createdOpeningIds).toEqual([]);
    expect(applied.formedPairIds).toEqual([["door-a", "door-b"]]);
    expect(
      applied.project.wallObjects.map((object) =>
        object.kind === "door" ? object.connectsToObjectId : null
      )
    ).toEqual(["door-b", "door-a"]);
  });

  it("moves only the partner of a realign", () => {
    const base = project([room("room-a", 0), room("room-b", 4000)], pairedDoors(1200, 1700));
    const { actions } = analyzeSharedOpenings(base);
    const applied = applySharedOpeningActions(base, actions, idFactory());

    expect(applied.realignedIds).toEqual(["door-b"]);
    expect(applied.project.wallObjects.find((object) => object.id === "door-a")?.xMm).toBe(1200);
    expect(
      applied.project.wallObjects.find((object) => object.id === "door-b")?.xMm
    ).toBeCloseTo(1800);
  });

  it("drops a stale action rather than corrupting the pairing", () => {
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [door("door-a", A_EAST, 1200, { connectsToObjectId: "door-b" }), door("door-b", B_WEST, 1800, { connectsToObjectId: "door-a" })]
    );
    // An adopt action naming an already-paired opening: analysis would never
    // emit it, but a memoized analysis or an older document could.
    const applied = applySharedOpeningActions(
      base,
      [{ kind: "adopt", openingId: "door-a", counterpartOpeningId: "door-b" }],
      idFactory()
    );

    expect(applied.project).toBe(base);
    expect(applied.formedPairIds).toEqual([]);
  });

  it("is idempotent: a second pass over an applied result finds nothing to do", () => {
    const base = mixedProject();
    const first = applySharedOpeningActions(base, analyzeSharedOpenings(base).actions, idFactory());
    expect(first.project).not.toBe(base);

    const second = analyzeSharedOpenings(first.project);
    expect(second.actions).toEqual([]);
    expect(second.conflicts).toEqual([]);

    const reapplied = applySharedOpeningActions(first.project, second.actions, idFactory());
    expect(reapplied.project).toBe(first.project);
  });
});

// ---------------------------------------------------------------------------
// Apply — hinged-door handing.
// ---------------------------------------------------------------------------

const HINGED: DoorLeaf = { hingeAtStart: true, swingsToLeft: true };

function leafOf(applied: { project: Project }, id: string): DoorLeaf | undefined {
  const found = applied.project.wallObjects.find((object) => object.id === id);
  return found?.kind === "door" ? found.leaf : undefined;
}

describe("applySharedOpeningActions — door leaves", () => {
  it("copies a create-twin's leaf MIRRORED, not verbatim", () => {
    // Twin walls run opposite directions and face opposite interiors, so the
    // same physical door is described by the opposite flags on the far wall.
    // A verbatim copy would put the two halves' arcs in different rooms.
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [door("door-a", A_EAST, 1200, { leaf: HINGED })]
    );
    const applied = applySharedOpeningActions(
      base,
      analyzeSharedOpenings(base).actions,
      idFactory()
    );

    expect(leafOf(applied, "door-a")).toEqual(HINGED);
    expect(leafOf(applied, "twin-1")).toEqual({ hingeAtStart: false, swingsToLeft: false });
  });

  it("gives a create-twin no leaf when the primary is a plain doorway", () => {
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [door("door-a", A_EAST, 1200)]
    );
    const applied = applySharedOpeningActions(
      base,
      analyzeSharedOpenings(base).actions,
      idFactory()
    );

    const twin = applied.project.wallObjects.find((object) => object.id === "twin-1");
    // The KEY is absent, not present-and-undefined: a doorway must serialize
    // exactly as it did before hinging existed.
    expect(Object.keys(twin ?? {})).not.toContain("leaf");
  });

  it("adopting hinged + doorway propagates the leaf, mirrored — hinged wins", () => {
    // Whichever half the user acted on, the pair ends up hinged: the losing
    // rule ("lexically smaller wins") could silently erase the only leaf.
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [door("door-a", A_EAST, 1200), door("door-b", B_WEST, 1800, { leaf: HINGED })]
    );
    const applied = applySharedOpeningActions(
      base,
      [{ kind: "adopt", openingId: "door-a", counterpartOpeningId: "door-b" }],
      idFactory()
    );

    // door-a is the primary here and it is the DOORWAY, so the counterpart's
    // leaf is what survives — mirrored onto the primary.
    expect(leafOf(applied, "door-b")).toEqual(HINGED);
    expect(leafOf(applied, "door-a")).toEqual({ hingeAtStart: false, swingsToLeft: false });
  });

  it("adopting two conflicting hinged doors lets the PRIMARY win", () => {
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [
        door("door-a", A_EAST, 1200, { leaf: HINGED }),
        door("door-b", B_WEST, 1800, { leaf: { hingeAtStart: true, swingsToLeft: false } })
      ]
    );
    const applied = applySharedOpeningActions(
      base,
      [{ kind: "adopt", openingId: "door-a", counterpartOpeningId: "door-b" }],
      idFactory()
    );

    // The half the user acted on keeps its handing verbatim; the counterpart is
    // restated in its own wall's frame.
    expect(leafOf(applied, "door-a")).toEqual(HINGED);
    expect(leafOf(applied, "door-b")).toEqual({ hingeAtStart: false, swingsToLeft: false });
  });

  it("lets the primary win from the other side too — the table is not id-ordered", () => {
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [
        door("door-a", A_EAST, 1200, { leaf: HINGED }),
        door("door-b", B_WEST, 1800, { leaf: { hingeAtStart: true, swingsToLeft: false } })
      ]
    );
    const applied = applySharedOpeningActions(
      base,
      [{ kind: "adopt", openingId: "door-b", counterpartOpeningId: "door-a" }],
      idFactory()
    );

    expect(leafOf(applied, "door-b")).toEqual({ hingeAtStart: true, swingsToLeft: false });
    expect(leafOf(applied, "door-a")).toEqual({ hingeAtStart: false, swingsToLeft: true });
  });

  it("leaves a doorway + doorway adoption with no leaf at all", () => {
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [door("door-a", A_EAST, 1200), door("door-b", B_WEST, 1800)]
    );
    const applied = applySharedOpeningActions(
      base,
      analyzeSharedOpenings(base).actions,
      idFactory()
    );

    for (const id of ["door-a", "door-b"]) {
      const found = applied.project.wallObjects.find((object) => object.id === id);
      expect(Object.keys(found ?? {})).not.toContain("leaf");
    }
  });

  it("never mints a leaf on an adopted WINDOW pair", () => {
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [window("window-a", A_EAST, 1200), window("window-b", B_WEST, 1800)]
    );
    const applied = applySharedOpeningActions(
      base,
      analyzeSharedOpenings(base).actions,
      idFactory()
    );

    for (const id of ["window-a", "window-b"]) {
      const found = applied.project.wallObjects.find((object) => object.id === id);
      expect(Object.keys(found ?? {})).not.toContain("leaf");
    }
  });

  it("does not report a conflict for disagreeing handing", () => {
    // Settled: paired-geometry-mismatch stays width/height/y. Handing is
    // reconciled silently and never becomes something the user must resolve.
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [
        door("door-a", A_EAST, 1200, { connectsToObjectId: "door-b", leaf: HINGED }),
        door("door-b", B_WEST, 1800, { connectsToObjectId: "door-a", leaf: HINGED })
      ]
    );

    const analysis = analyzeSharedOpenings(base);
    expect(analysis.conflicts).toEqual([]);
    expect(analysis.actions).toEqual([]);
  });
});
