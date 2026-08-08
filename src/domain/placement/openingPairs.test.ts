import { describe, expect, it } from "vitest";
import type { Project, WallObject } from "../project";
import { clearOpeningPartners, normalizeOpeningPairs } from "./openingPairs";

function door(id: string, connectsToObjectId?: string, wallId = "wall-1"): WallObject {
  return {
    id,
    kind: "door",
    blocksPlacement: true,
    wallId,
    xMm: 1000,
    yMm: 1000,
    widthMm: 900,
    heightMm: 2100,
    ...(connectsToObjectId ? { connectsToObjectId } : {})
  };
}

function window(id: string, connectsToObjectId?: string, wallId = "wall-1"): WallObject {
  return {
    id,
    kind: "window",
    blocksPlacement: true,
    wallId,
    xMm: 1000,
    yMm: 1400,
    widthMm: 1200,
    heightMm: 1200,
    ...(connectsToObjectId ? { connectsToObjectId } : {})
  };
}

// normalizeOpeningPairs reads only wallObjects, so a minimal stand-in keeps
// these tests about pairing rather than floor geometry.
function projectWith(wallObjects: WallObject[]): Project {
  return { wallObjects } as unknown as Project;
}

function partnerOf(project: Project, id: string): string | undefined {
  const found = project.wallObjects.find((object) => object.id === id);
  return found && (found.kind === "door" || found.kind === "window")
    ? found.connectsToObjectId
    : undefined;
}

function artwork(id: string): WallObject {
  return {
    id,
    kind: "artwork",
    artworkId: `art-${id}`,
    wallId: "wall-1",
    xMm: 500,
    yMm: 1400,
    widthMm: 500,
    heightMm: 400
  };
}

describe("clearOpeningPartners", () => {
  it("returns the input array unchanged when nothing was removed", () => {
    const objects = [door("d1", "d2"), door("d2", "d1")];
    expect(clearOpeningPartners(objects, new Set())).toBe(objects);
  });

  it("drops connectsToObjectId on a survivor whose partner was removed", () => {
    const survivor = door("d1", "gone");
    const result = clearOpeningPartners([survivor], new Set(["gone"]));
    const [cleared] = result;
    expect(cleared.kind).toBe("door");
    expect("connectsToObjectId" in cleared).toBe(false);
  });

  it("leaves a survivor whose partner still exists untouched", () => {
    const survivor = door("d1", "d2");
    const result = clearOpeningPartners([survivor, door("d2", "d1")], new Set(["other"]));
    expect(result[0]).toBe(survivor);
    expect((result[0] as { connectsToObjectId?: string }).connectsToObjectId).toBe("d2");
  });

  it("ignores artworks and openings without a partner ref", () => {
    const objects = [artwork("a1"), door("d1")];
    const result = clearOpeningPartners(objects, new Set(["gone"]));
    expect(result[0]).toBe(objects[0]);
    expect(result[1]).toBe(objects[1]);
  });
});

describe("normalizeOpeningPairs", () => {
  it("severs both halves of a pair that ended up on one wall", () => {
    // The exact shape that made a document unsaveable: a paired door dragged
    // onto its own twin's face, so both halves report the same wallId.
    const before = projectWith([door("d1", "d2", "wall-1"), door("d2", "d1", "wall-1")]);

    const { project, repairedCount } = normalizeOpeningPairs(before);

    expect(partnerOf(project, "d1")).toBeUndefined();
    expect(partnerOf(project, "d2")).toBeUndefined();
    // One shared opening was disconnected, not two.
    expect(repairedCount).toBe(1);
  });

  it("keeps a pair on two different walls even when those walls are not twins", () => {
    // connectOpenings deliberately accepts non-facing walls and the inspector
    // labels the result "Misaligned". Silent repair must never delete that.
    const before = projectWith([
      door("d1", "d2", "wall-north"),
      door("d2", "d1", "wall-south")
    ]);

    const { project, repairedCount } = normalizeOpeningPairs(before);

    expect(project).toBe(before);
    expect(repairedCount).toBe(0);
    expect(partnerOf(project, "d1")).toBe("d2");
  });

  it("severs a dangling pointer, a non-reciprocal pointer, and a kind mismatch", () => {
    const dangling = normalizeOpeningPairs(projectWith([door("d1", "gone", "wall-1")]));
    expect(partnerOf(dangling.project, "d1")).toBeUndefined();

    // d2 points at d3, not back at d1.
    const oneSided = normalizeOpeningPairs(
      projectWith([
        door("d1", "d2", "wall-1"),
        door("d2", "d3", "wall-2"),
        door("d3", "d2", "wall-3")
      ])
    );
    expect(partnerOf(oneSided.project, "d1")).toBeUndefined();

    const mismatched = normalizeOpeningPairs(
      projectWith([door("d1", "w1", "wall-1"), window("w1", "d1", "wall-2")])
    );
    expect(partnerOf(mismatched.project, "d1")).toBeUndefined();
    expect(partnerOf(mismatched.project, "w1")).toBeUndefined();
  });

  it("severs a pair anchored to a partition face", () => {
    const before = projectWith([
      door("d1", "d2", "partition-1#a"),
      door("d2", "d1", "wall-2")
    ]);
    const { project } = normalizeOpeningPairs(before);
    expect(partnerOf(project, "d1")).toBeUndefined();
    expect(partnerOf(project, "d2")).toBeUndefined();
  });

  it("is idempotent", () => {
    const before = projectWith([door("d1", "d2", "wall-1"), door("d2", "d1", "wall-1")]);
    const once = normalizeOpeningPairs(before);
    const twice = normalizeOpeningPairs(once.project);

    expect(twice.repairedCount).toBe(0);
    expect(twice.project).toBe(once.project);
  });

  it("severs a pointer without disturbing the door's leaf", () => {
    // The pass stays pointer-only and geometry-free (it runs PRE-parse, on
    // untrusted input). Handing is reconciled later, in the post-parse
    // geometry-aware pass, so nothing here may read or rewrite it — but it must
    // not drop it either.
    const hinged = {
      ...door("d1", "d2", "wall-1"),
      leaf: { hingeAtStart: true, swingsToLeft: false }
    } as WallObject;
    const before = projectWith([hinged, door("d2", "d1", "wall-1")]);

    const { project, repairedCount } = normalizeOpeningPairs(before);

    expect(repairedCount).toBe(1);
    const repaired = project.wallObjects[0];
    expect(repaired.kind === "door" ? repaired.leaf : null).toEqual({
      hingeAtStart: true,
      swingsToLeft: false
    });
    expect(partnerOf(project, "d1")).toBeUndefined();
  });

  it("returns valid input untouched, including raw pre-parse documents", () => {
    const valid = projectWith([door("d1", "d2", "wall-1"), door("d2", "d1", "wall-2")]);
    expect(normalizeOpeningPairs(valid).project).toBe(valid);

    // migrateProject calls this before parseProject, so a document with no
    // usable wallObjects must pass through rather than throw.
    const raw = { floor: { rooms: [] } } as unknown as Project;
    expect(normalizeOpeningPairs(raw).project).toBe(raw);
    expect(normalizeOpeningPairs(raw).repairedCount).toBe(0);
  });
});
