import { describe, expect, it } from "vitest";
import { getProjectPlaceableWalls } from "../geometry/placeableWalls";
import type { CaseWallObject, Project, WallTextWallObject } from "../project";
import { createSampleProject } from "../sample/sampleProject";
import { feetToMm, inchesToMm } from "../units/length";
import { isOpeningSlotFree } from "./openingSlots";

function southWall(project: Project) {
  const wall = getProjectPlaceableWalls(project).find((candidate) => candidate.id === "wall-south");
  if (!wall) throw new Error("fixture is missing wall-south");
  return wall;
}

describe("isOpeningSlotFree", () => {
  it("is free even when a wall label sits in the requested slot — wall text never blocks an opening", () => {
    const project = createSampleProject();
    const label: WallTextWallObject = {
      id: "label-1",
      kind: "wall-text",
      wallId: "wall-south",
      xMm: feetToMm(10),
      yMm: inchesToMm(57),
      widthMm: feetToMm(4),
      heightMm: feetToMm(1)
    };
    const withLabel: Project = { ...project, wallObjects: [label] };

    const free = isOpeningSlotFree(
      withLabel,
      southWall(withLabel),
      { widthMm: feetToMm(3), heightMm: inchesToMm(80) },
      inchesToMm(40),
      feetToMm(10),
      null
    );

    expect(free).toBe(true);
  });

  it("is free even when a display case sits in the requested slot — a case never blocks an opening", () => {
    const project = createSampleProject();
    const vitrine: CaseWallObject = {
      id: "case-1",
      kind: "case",
      wallId: "wall-south",
      xMm: feetToMm(10),
      yMm: inchesToMm(38),
      widthMm: feetToMm(5),
      heightMm: feetToMm(1),
      depthMm: feetToMm(1)
    };
    const withCase: Project = { ...project, wallObjects: [vitrine] };

    const free = isOpeningSlotFree(
      withCase,
      southWall(withCase),
      { widthMm: feetToMm(3), heightMm: inchesToMm(80) },
      inchesToMm(40),
      feetToMm(10),
      null
    );

    expect(free).toBe(true);
  });

  it("is not free when another architectural opening occupies the slot", () => {
    const project = createSampleProject();
    const door = {
      id: "door-1",
      kind: "door" as const,
      blocksPlacement: true as const,
      wallId: "wall-south",
      xMm: feetToMm(10),
      yMm: inchesToMm(40),
      widthMm: feetToMm(3),
      heightMm: inchesToMm(80)
    };
    const withDoor: Project = { ...project, wallObjects: [door] };

    const free = isOpeningSlotFree(
      withDoor,
      southWall(withDoor),
      { widthMm: feetToMm(3), heightMm: inchesToMm(80) },
      inchesToMm(40),
      feetToMm(10),
      null
    );

    expect(free).toBe(false);
  });
});
