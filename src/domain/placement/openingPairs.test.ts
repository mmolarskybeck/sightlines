import { describe, expect, it } from "vitest";
import type { WallObject } from "../project";
import { clearOpeningPartners } from "./openingPairs";

function door(id: string, connectsToObjectId?: string): WallObject {
  return {
    id,
    kind: "door",
    blocksPlacement: true,
    wallId: "wall-1",
    xMm: 1000,
    yMm: 1000,
    widthMm: 900,
    heightMm: 2100,
    ...(connectsToObjectId ? { connectsToObjectId } : {})
  };
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
