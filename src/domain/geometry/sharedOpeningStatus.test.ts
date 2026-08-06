import { describe, expect, it } from "vitest";
import {
  BLOCKED_ZONE_HEIGHT_MM,
  BLOCKED_ZONE_WIDTH_MM,
  DOOR_HEIGHT_MM,
  DOOR_WIDTH_MM,
  WINDOW_HEIGHT_MM,
  WINDOW_WIDTH_MM
} from "../placement/createOpening";
import type {
  SharedOpeningConflictReason,
  SharedOpeningTarget
} from "../placement/sharedOpeningAnalysis";
import { selectSharedOpeningConflicts } from "../placement/sharedOpeningIssues";
import type {
  ConnectableOpeningWallObject,
  Project,
  RoomPlacement,
  WallObject
} from "../project";
import { CURRENT_SCHEMA_VERSION } from "../project";
import { createRectangularRoomPlacement } from "./createRoom";
import {
  getSharedOpeningStatus,
  sharedOpeningResolutions,
  type SharedOpeningResolution,
  type SharedOpeningStatus
} from "./sharedOpeningStatus";

// Same fixture shape as sharedOpeningAnalysis.test.ts: room-b flush to the
// right of room-a makes room-a's east wall (running +y) and room-b's west wall
// (running −y) one coincident twin pair. A_EAST's local x equals floor y, and
// the anti-parallel twin mirrors x to (3000 − x).
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
const A_NORTH = "room-a-wall-north";
const A_SOUTH = "room-a-wall-south";
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

function pairedDoors(
  aXMm: number,
  bXMm: number
): [ConnectableOpeningWallObject, ConnectableOpeningWallObject] {
  return [
    door("door-a", A_EAST, aXMm, { connectsToObjectId: "door-b" }),
    door("door-b", B_WEST, bXMm, { connectsToObjectId: "door-a" })
  ];
}

// Reason of a status that is expected to be a conflict, without an `if` guard
// in every test.
function reasonOf(status: SharedOpeningStatus): SharedOpeningConflictReason | null {
  return status.kind === "conflict" ? status.conflict.reason : null;
}

function candidatesOf(status: SharedOpeningStatus): SharedOpeningTarget[] | null {
  return status.kind === "conflict" ? status.candidates : null;
}

// ---------------------------------------------------------------------------
// exposed — the state that shows nothing at all.
// ---------------------------------------------------------------------------

describe("getSharedOpeningStatus — exposed", () => {
  it("reads exposed for an id that is not in the project", () => {
    const status = getSharedOpeningStatus(project([room("room-a", 0)]), "no-such-object");

    expect(status).toEqual({ kind: "exposed" });
    expect(sharedOpeningResolutions(status)).toEqual([]);
  });

  it("reads exposed for a wall object that is not a door or window", () => {
    const base = project([room("room-a", 0), room("room-b", 4000)], [
      wallText("label-a", A_EAST, 1200)
    ]);

    expect(getSharedOpeningStatus(base, "label-a")).toEqual({ kind: "exposed" });
  });

  it("reads exposed for an exterior door on a wall with no facing room, and offers nothing", () => {
    // The single most important negative: an exterior door is not a problem,
    // and today's "No door on a facing wall to pair with." goes away entirely.
    const base = project([room("room-a", 0)], [door("door-a", A_EAST, 1500)]);
    const status = getSharedOpeningStatus(base, "door-a");

    expect(status).toEqual({ kind: "exposed" });
    expect(sharedOpeningResolutions(status)).toEqual([]);
  });

  it("reads exposed on the exterior stretch of a partly shared wall", () => {
    // room-b is 1500 deep against room-a's 3000 mm east wall: the door at 2400
    // sits clear of the shared run. Still not a problem.
    const base = project(
      [room("room-a", 0), room("room-b", 4000, 0, { depthMm: 1500 })],
      [door("door-a", A_EAST, 2400)]
    );

    expect(getSharedOpeningStatus(base, "door-a")).toEqual({ kind: "exposed" });
  });

  it("reads exposed for an opening the analyzer is about to adopt silently", () => {
    // Two aligned unpaired doors: the analyzer emits `adopt`, which needs no
    // user involvement, so the inspector must say nothing about it.
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [door("door-a", A_EAST, 1200), door("door-b", B_WEST, 1800)]
    );

    expect(getSharedOpeningStatus(base, "door-a")).toEqual({ kind: "exposed" });
    expect(getSharedOpeningStatus(base, "door-b")).toEqual({ kind: "exposed" });
  });
});

// ---------------------------------------------------------------------------
// shared — the healthy state.
// ---------------------------------------------------------------------------

describe("getSharedOpeningStatus — shared", () => {
  it("reads shared from BOTH halves of a healthy pair and offers nothing", () => {
    const base = project([room("room-a", 0), room("room-b", 4000)], pairedDoors(1200, 1800));

    const a = getSharedOpeningStatus(base, "door-a");
    const b = getSharedOpeningStatus(base, "door-b");

    expect(a).toEqual({ kind: "shared", partnerId: "door-b" });
    expect(b).toEqual({ kind: "shared", partnerId: "door-a" });
    expect(sharedOpeningResolutions(a)).toEqual([]);
    expect(sharedOpeningResolutions(b)).toEqual([]);
  });

  it("reads shared for a healthy window pair too", () => {
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [
        window("window-a", A_EAST, 1200, { connectsToObjectId: "window-b" }),
        window("window-b", B_WEST, 1800, { connectsToObjectId: "window-a" })
      ]
    );

    expect(getSharedOpeningStatus(base, "window-b")).toEqual({
      kind: "shared",
      partnerId: "window-a"
    });
  });

  it("does not read shared when the pointer is not reciprocal", () => {
    // A dangling half-pointer is not a pair; `livePartnerId` uses the same
    // structural test normalizeOpeningPairs would repair with.
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [door("door-a", A_EAST, 1200, { connectsToObjectId: "door-b" }), door("door-b", B_WEST, 1800)]
    );

    expect(getSharedOpeningStatus(base, "door-a").kind).not.toBe("shared");
  });
});

// ---------------------------------------------------------------------------
// drifted — a live boundary, halves out of mirror.
// ---------------------------------------------------------------------------

describe("getSharedOpeningStatus — drifted", () => {
  it("reads drifted from BOTH halves and offers Realign only", () => {
    // The analyzer's `realign` is keyed on the lexicographically smaller half
    // as authoritative; either half must still read as drifted.
    const base = project([room("room-a", 0), room("room-b", 4000)], pairedDoors(1200, 1700));

    const a = getSharedOpeningStatus(base, "door-a");
    const b = getSharedOpeningStatus(base, "door-b");

    expect(a).toEqual({ kind: "drifted", partnerId: "door-b" });
    expect(b).toEqual({ kind: "drifted", partnerId: "door-a" });
    // Split is refused for a drifted pair by design.
    expect(sharedOpeningResolutions(a)).toEqual(["realign"]);
    expect(sharedOpeningResolutions(b)).toEqual(["realign"]);
  });
});

// ---------------------------------------------------------------------------
// conflict — one per reason, from both halves where a pair is involved.
// ---------------------------------------------------------------------------

describe("getSharedOpeningStatus — boundary-lost", () => {
  it("reads boundary-lost from both halves of a legacy non-boundary pair", () => {
    // A door on wall-north connected to one on wall-south of the SAME room: a
    // legitimate user-created legacy state that keeps its identity.
    const base = project(
      [room("room-a", 0)],
      [
        door("door-a", A_NORTH, 1500, { connectsToObjectId: "door-b" }),
        door("door-b", A_SOUTH, 1500, { connectsToObjectId: "door-a" })
      ]
    );

    const a = getSharedOpeningStatus(base, "door-a");
    const b = getSharedOpeningStatus(base, "door-b");

    expect(reasonOf(a)).toBe("boundary-lost");
    // The conflict is keyed on door-a, so door-b only reaches it through
    // `partnerId` — without that rung the second half reads as healthy.
    expect(reasonOf(b)).toBe("boundary-lost");
    expect(a.kind === "conflict" && a.conflict.id).toBe("door-a:boundary-lost");
    expect(b.kind === "conflict" && b.conflict.id).toBe("door-a:boundary-lost");

    expect(a.kind === "conflict" && a.partnerId).toBe("door-b");
    expect(b.kind === "conflict" && b.partnerId).toBe("door-a");

    expect(sharedOpeningResolutions(a)).toEqual(["split", "keep-this-only"]);
    expect(sharedOpeningResolutions(b)).toEqual(["split", "keep-this-only"]);
    // No picker: `keep-this-only` and `split` need no target.
    expect(candidatesOf(a)).toEqual([]);
    expect(candidatesOf(b)).toEqual([]);
  });

  it("reads boundary-lost from both halves when the rooms are moved apart", () => {
    const base = project([room("room-a", 0), room("room-b", 8000)], pairedDoors(1200, 1800));

    expect(reasonOf(getSharedOpeningStatus(base, "door-a"))).toBe("boundary-lost");
    expect(reasonOf(getSharedOpeningStatus(base, "door-b"))).toBe("boundary-lost");
    expect(getSharedOpeningStatus(base, "door-b")).toMatchObject({
      kind: "conflict",
      partnerId: "door-a"
    });
  });
});

describe("getSharedOpeningStatus — missing-twin", () => {
  it("reads missing-twin for a legacy one-sided door facing an empty shared wall", () => {
    const base = project([room("room-a", 0), room("room-b", 4000)], [door("door-a", A_EAST, 1200)]);
    const status = getSharedOpeningStatus(base, "door-a");

    expect(status.kind).toBe("conflict");
    expect(reasonOf(status)).toBe("missing-twin");
    expect(sharedOpeningResolutions(status)).toEqual(["complete"]);
    expect(candidatesOf(status)).toEqual([]);
    expect(status.kind === "conflict" && status.partnerId).toBe(null);
  });

  it("builds the missing-twin conflict exactly as selectSharedOpeningConflicts does", () => {
    // The issues rail and the inspector describe the same problem: a rail row
    // the user clicks must open an inspector showing the SAME conflict id, so
    // this asserts against the real selector, not a hand-written string.
    const base = project([room("room-a", 0), room("room-b", 4000)], [door("door-a", A_EAST, 1200)]);
    const fromSelector = selectSharedOpeningConflicts(base);
    const status = getSharedOpeningStatus(base, "door-a");

    expect(fromSelector).toHaveLength(1);
    expect(status.kind === "conflict" && status.conflict).toEqual(fromSelector[0]);
    // ...and the id shape the rail keys rows on.
    expect(fromSelector[0].id).toBe("door-a:missing-twin");
    expect(fromSelector[0].wallIds).toEqual([A_EAST, B_WEST]);
  });

  it("reads missing-twin for a window as well as a door", () => {
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [window("window-a", A_EAST, 1200, { yMm: 900 })]
    );

    expect(reasonOf(getSharedOpeningStatus(base, "window-a"))).toBe("missing-twin");
  });
});

describe("getSharedOpeningStatus — ambiguous-boundary-wall", () => {
  // room-c overlaps room-b, so both back the whole of room-a's east wall.
  const overlapping = [room("room-a", 0), room("room-b", 4000), room("room-c", 4100)];

  it("offers a pick over the two empty facing walls", () => {
    const base = project(overlapping, [door("door-a", A_EAST, 1500)]);
    const status = getSharedOpeningStatus(base, "door-a");

    expect(reasonOf(status)).toBe("ambiguous-boundary-wall");
    expect(sharedOpeningResolutions(status)).toEqual(["resolve"]);
    expect(candidatesOf(status)).toEqual([
      { kind: "wall", wallId: B_WEST },
      { kind: "wall", wallId: C_WEST }
    ]);
  });

  it("mixes existing openings and empty walls in the pick", () => {
    const base = project(overlapping, [
      door("door-a", A_EAST, 1500),
      door("door-b", B_WEST, 1500)
    ]);
    const status = getSharedOpeningStatus(base, "door-a");

    expect(reasonOf(status)).toBe("ambiguous-boundary-wall");
    expect(candidatesOf(status)).toEqual([
      { kind: "opening", openingId: "door-b" },
      { kind: "wall", wallId: C_WEST }
    ]);
  });
});

describe("getSharedOpeningStatus — ambiguous-counterpart-opening clusters", () => {
  // The analyzer's five-member cluster: door-a1 can pair with b1 or b2, door-a2
  // with b2 or b3. One conflict stands for the whole cluster, keyed on door-a1.
  const wide = { widthMm: 1400 };
  function cluster(): Project {
    return project(
      [room("room-a", 0), room("room-b", 4000)],
      [
        door("door-a1", A_EAST, 1100, wide), // mirrors to 1900
        door("door-a2", A_EAST, 1900, wide), // mirrors to 1100
        door("door-b1", B_WEST, 2300, wide),
        door("door-b2", B_WEST, 1500, wide),
        door("door-b3", B_WEST, 700, wide)
      ]
    );
  }
  const MEMBERS = ["door-a1", "door-a2", "door-b1", "door-b2", "door-b3"];

  it("surfaces the cluster conflict for the KEYED member with its own candidates", () => {
    const status = getSharedOpeningStatus(cluster(), "door-a1");

    expect(reasonOf(status)).toBe("ambiguous-counterpart-opening");
    expect(status.kind === "conflict" && status.conflict.openingId).toBe("door-a1");
    expect(status.kind === "conflict" && status.conflict.memberIds).toEqual(MEMBERS);
    expect(sharedOpeningResolutions(status)).toEqual(["resolve"]);
    expect(candidatesOf(status)).toEqual([
      { kind: "opening", openingId: "door-b1" },
      { kind: "opening", openingId: "door-b2" }
    ]);
  });

  it("surfaces the same conflict for a NON-keyed member, with that member's own candidates", () => {
    // The whole point of sharedOpeningCandidates. door-b3's only graph
    // neighbour is door-a2; the conflict's own `candidates` are door-a1's
    // neighbours (b1, b2), and offering those to door-b3 would advertise a
    // pairing door-b3 cannot form.
    const base = cluster();
    const status = getSharedOpeningStatus(base, "door-b3");

    expect(reasonOf(status)).toBe("ambiguous-counterpart-opening");
    expect(status.kind === "conflict" && status.conflict.id).toBe(
      "door-a1:ambiguous-counterpart-opening"
    );
    expect(status.kind === "conflict" && status.conflict.openingId).toBe("door-a1");
    expect(sharedOpeningResolutions(status)).toEqual(["resolve"]);

    expect(candidatesOf(status)).toEqual([{ kind: "opening", openingId: "door-a2" }]);
    // ...which is NOT what the conflict itself carries.
    expect(candidatesOf(status)).not.toEqual(
      status.kind === "conflict" ? status.conflict.candidates : null
    );
    expect(candidatesOf(status)).not.toContainEqual({ kind: "opening", openingId: "door-b1" });
  });

  it("is independent of wallObjects order for a non-keyed member", () => {
    const base = cluster();
    const expected = JSON.stringify(getSharedOpeningStatus(base, "door-b3"));

    for (let shift = 1; shift < base.wallObjects.length; shift += 1) {
      const wallObjects = [...base.wallObjects.slice(shift), ...base.wallObjects.slice(0, shift)];
      expect(JSON.stringify(getSharedOpeningStatus({ ...base, wallObjects }, "door-b3"))).toBe(
        expected
      );
    }
    const reversed = [...base.wallObjects].reverse();
    expect(JSON.stringify(getSharedOpeningStatus({ ...base, wallObjects: reversed }, "door-b3"))).toBe(
      expected
    );
  });

  it("surfaces a three-member cluster for the member on the far wall", () => {
    // One wide door opposite two narrow ones. Keyed on door-a1; door-b's own
    // neighbours are both narrow doors.
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [
        door("door-a1", A_EAST, 1000),
        door("door-a2", A_EAST, 2000),
        door("door-b", B_WEST, 1500, { widthMm: 2400 })
      ]
    );

    const keyed = getSharedOpeningStatus(base, "door-a1");
    const other = getSharedOpeningStatus(base, "door-b");

    expect(reasonOf(keyed)).toBe("ambiguous-counterpart-opening");
    expect(reasonOf(other)).toBe("ambiguous-counterpart-opening");
    expect(candidatesOf(keyed)).toEqual([{ kind: "opening", openingId: "door-b" }]);
    expect(candidatesOf(other)).toEqual([
      { kind: "opening", openingId: "door-a1" },
      { kind: "opening", openingId: "door-a2" }
    ]);
  });
});

describe("getSharedOpeningStatus — conflicts with nothing to offer", () => {
  it("reads overhangs-common-span and offers nothing", () => {
    // room-b is 1500 deep; a door centred on 1500 straddles the end of the run
    // the two rooms share.
    const base = project(
      [room("room-a", 0), room("room-b", 4000, 0, { depthMm: 1500 })],
      [door("door-a", A_EAST, 1500)]
    );
    const status = getSharedOpeningStatus(base, "door-a");

    expect(reasonOf(status)).toBe("overhangs-common-span");
    expect(sharedOpeningResolutions(status)).toEqual([]);
    expect(candidatesOf(status)).toEqual([]);
  });

  it("reads paired-overhang from both halves and offers nothing", () => {
    const base = project(
      [room("room-a", 0), room("room-b", 4000, 0, { depthMm: 2000 })],
      [
        door("door-a", A_EAST, 1800, { connectsToObjectId: "door-b" }),
        door("door-b", B_WEST, 200, { connectsToObjectId: "door-a" })
      ]
    );

    const a = getSharedOpeningStatus(base, "door-a");
    const b = getSharedOpeningStatus(base, "door-b");

    expect(reasonOf(a)).toBe("paired-overhang");
    expect(reasonOf(b)).toBe("paired-overhang");
    expect(sharedOpeningResolutions(a)).toEqual([]);
    expect(sharedOpeningResolutions(b)).toEqual([]);
  });

  it("reads counterpart-occupied and names the blocker without a picker", () => {
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [
        door("door-a", A_EAST, 1200),
        door("door-b", B_WEST, 1800, { connectsToObjectId: "door-b2" }),
        door("door-b2", B_EAST, 500, { connectsToObjectId: "door-b" })
      ]
    );
    const status = getSharedOpeningStatus(base, "door-a");

    expect(reasonOf(status)).toBe("counterpart-occupied");
    expect(status.kind === "conflict" && status.conflict.blockerId).toBe("door-b");
    expect(sharedOpeningResolutions(status)).toEqual([]);
    expect(candidatesOf(status)).toEqual([]);
  });

  it("reads blocked-mirror-slot and offers nothing", () => {
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [door("door-a", A_EAST, 1200), blockedZone("zone-b", B_WEST, 1800)]
    );
    const status = getSharedOpeningStatus(base, "door-a");

    expect(reasonOf(status)).toBe("blocked-mirror-slot");
    expect(status.kind === "conflict" && status.conflict.blockerId).toBe("zone-b");
    expect(sharedOpeningResolutions(status)).toEqual([]);
  });
});

describe("getSharedOpeningStatus — paired-geometry-mismatch", () => {
  it("reads the mismatch from both halves and offers Realign", () => {
    // Only x is mirrored, so a 900 mm door facing an 1800 mm one used to read
    // as perfectly healthy. There is no geometric answer to which size is
    // right, so the user's selection supplies the authority.
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [
        door("door-a", A_EAST, 1200, { connectsToObjectId: "door-b" }),
        door("door-b", B_WEST, 1800, { connectsToObjectId: "door-a", widthMm: 1800 })
      ]
    );

    const a = getSharedOpeningStatus(base, "door-a");
    const b = getSharedOpeningStatus(base, "door-b");

    expect(reasonOf(a)).toBe("paired-geometry-mismatch");
    expect(reasonOf(b)).toBe("paired-geometry-mismatch");
    expect(sharedOpeningResolutions(a)).toEqual(["realign"]);
    expect(sharedOpeningResolutions(b)).toEqual(["realign"]);
    expect(a.kind === "conflict" && a.partnerId).toBe("door-b");
    expect(b.kind === "conflict" && b.partnerId).toBe("door-a");
  });
});

// ---------------------------------------------------------------------------
// Scope. The analysis is deliberately scoped to this one opening and its wall,
// because this runs from a render path — but it must still see the two things
// that live outside that scope.
// ---------------------------------------------------------------------------

describe("getSharedOpeningStatus — scoped analysis still sees what it must", () => {
  // Four rooms in a row exercising three ladder rows at once: door-1/door-2
  // adopt, door-3 wants a twin, door-4/door-5 are a drifted pair.
  function mixed(): Project {
    return project(
      [room("room-a", 0), room("room-b", 4000), room("room-c", 8000), room("room-d", 12000)],
      [
        door("door-1", A_EAST, 1200),
        door("door-2", B_WEST, 1800),
        door("door-3", B_EAST, 1000),
        door("door-4", C_EAST, 1200, { connectsToObjectId: "door-5" }),
        door("door-5", D_WEST, 1700, { connectsToObjectId: "door-4" })
      ]
    );
  }

  it("sees a pair whose other half is on a wall the scope never names", () => {
    // Scope for door-5 is { openingIds: ["door-5"], wallIds: [D_WEST] } —
    // door-4 is on C_EAST, entirely outside it. The analyzer pulls a pair into
    // scope when EITHER half is in scope, which is what makes this work.
    const base = mixed();

    expect(getSharedOpeningStatus(base, "door-5")).toEqual({
      kind: "drifted",
      partnerId: "door-4"
    });
    expect(getSharedOpeningStatus(base, "door-4")).toEqual({
      kind: "drifted",
      partnerId: "door-5"
    });
  });

  it("sees a cluster keyed on a member outside the scope", () => {
    // The cluster conflict is keyed on door-a1 (wall A_EAST); selecting
    // door-b3 puts only door-b3 and B_WEST in scope. The analyzer pulls a
    // cluster into scope when ANY member is in scope.
    const base = project(
      [room("room-a", 0), room("room-b", 4000)],
      [
        door("door-a1", A_EAST, 1100, { widthMm: 1400 }),
        door("door-a2", A_EAST, 1900, { widthMm: 1400 }),
        door("door-b1", B_WEST, 2300, { widthMm: 1400 }),
        door("door-b2", B_WEST, 1500, { widthMm: 1400 }),
        door("door-b3", B_WEST, 700, { widthMm: 1400 })
      ]
    );

    expect(reasonOf(getSharedOpeningStatus(base, "door-b3"))).toBe(
      "ambiguous-counterpart-opening"
    );
  });

  it("reports only the selected opening's own problem", () => {
    // door-3 wants a twin on C_WEST. Scoping by wall pulls in every opening on
    // B_EAST, and the pass sees the whole project's graph regardless — but the
    // status is about door-3 and nothing else.
    const base = mixed();
    const status = getSharedOpeningStatus(base, "door-3");

    expect(reasonOf(status)).toBe("missing-twin");
    expect(status.kind === "conflict" && status.conflict.openingId).toBe("door-3");
    expect(status.kind === "conflict" && status.conflict.wallIds).toEqual([B_EAST, C_WEST]);
    // ...and the unrelated adopt/drift on the other boundaries say nothing here.
    expect(getSharedOpeningStatus(base, "door-1")).toEqual({ kind: "exposed" });
  });

  it("agrees with the unscoped issues selector on which reason each opening has", () => {
    // Cross-check against the whole-document pass: scoping must not change the
    // answer, only the cost of getting it.
    const base = mixed();
    const fromSelector = new Map(
      selectSharedOpeningConflicts(base).map((conflict) => [conflict.openingId, conflict.reason])
    );

    expect([...fromSelector.entries()]).toEqual([["door-3", "missing-twin"]]);
    for (const [openingId, reason] of fromSelector) {
      expect(reasonOf(getSharedOpeningStatus(base, openingId))).toBe(reason);
    }
  });
});

// ---------------------------------------------------------------------------
// The resolution table itself, over every reason in the union.
// ---------------------------------------------------------------------------

describe("sharedOpeningResolutions", () => {
  // A Record over the union, so a tenth reason is a compile error in the test
  // as well as in the implementation's `never` default.
  const EXPECTED: Record<SharedOpeningConflictReason, SharedOpeningResolution[]> = {
    "ambiguous-boundary-wall": ["resolve"],
    "ambiguous-counterpart-opening": ["resolve"],
    "overhangs-common-span": [],
    "paired-overhang": [],
    "paired-geometry-mismatch": ["realign"],
    "counterpart-occupied": [],
    "blocked-mirror-slot": [],
    "missing-twin": ["complete"],
    "boundary-lost": ["split", "keep-this-only"]
  };

  it.each(Object.keys(EXPECTED) as SharedOpeningConflictReason[])(
    "maps %s to its resolutions",
    (reason) => {
      const status: SharedOpeningStatus = {
        kind: "conflict",
        conflict: { id: `door-a:${reason}`, reason, openingId: "door-a", wallIds: [A_EAST] },
        partnerId: null,
        candidates: []
      };

      expect(sharedOpeningResolutions(status)).toEqual(EXPECTED[reason]);
    }
  );

  it("offers nothing for exposed or shared, and Realign only for drifted", () => {
    expect(sharedOpeningResolutions({ kind: "exposed" })).toEqual([]);
    expect(sharedOpeningResolutions({ kind: "shared", partnerId: "door-b" })).toEqual([]);
    expect(sharedOpeningResolutions({ kind: "drifted", partnerId: "door-b" })).toEqual(["realign"]);
  });
});
