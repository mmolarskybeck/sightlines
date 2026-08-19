import { describe, expect, it } from "vitest";
import { CURRENT_ARTWORK_SCHEMA_VERSION, type Artwork } from "../project";
import { compareChecklistText, sortChecklistExportRows } from "./sort";
import type { ChecklistExportPlacement, ChecklistExportRow } from "./types";

function artwork(overrides: Partial<Artwork>): Artwork {
  return {
    id: overrides.id ?? "a",
    schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
    dimensions: { status: "unknown" },
    metadata: {},
    ...overrides
  };
}

function row(
  projectIndex: number,
  overrides: Partial<ChecklistExportRow> = {}
): ChecklistExportRow {
  return {
    artworkId: `art-${projectIndex}`,
    artwork: null,
    projectIndex,
    placement: null,
    ...overrides
  };
}

function wallPlacement(
  roomIndex: number,
  wallIndex: number,
  alongMm: number
): ChecklistExportPlacement {
  return {
    kind: "wall",
    roomName: `Room ${roomIndex}`,
    wallName: `Wall ${wallIndex}`,
    roomIndex,
    wallIndex,
    alongMm
  };
}

describe("compareChecklistText", () => {
  it("is case and accent insensitive", () => {
    expect(compareChecklistText("agnes", "Ágnes")).toBe(0);
  });

  it("sorts blanks last, not first", () => {
    expect(compareChecklistText(undefined, "Agnes")).toBe(1);
    expect(compareChecklistText("Agnes", "   ")).toBe(-1);
    expect(compareChecklistText("", undefined)).toBe(0);
  });
});

describe("sortChecklistExportRows", () => {
  const rows = [
    row(0, { artwork: artwork({ id: "a0", artist: "Zoe", title: "Bee", accessionNumber: "B.2" }) }),
    row(1, { artwork: artwork({ id: "a1", artist: "Amy", title: "Cat", accessionNumber: "A.1" }) }),
    row(2, { artwork: artwork({ id: "a2", title: "Ant" }) })
  ];

  it("keeps checklist order by default", () => {
    expect(sortChecklistExportRows(rows, "project").map((entry) => entry.projectIndex)).toEqual([
      0, 1, 2
    ]);
  });

  it("orders by artist with un-attributed works last", () => {
    expect(sortChecklistExportRows(rows, "artist").map((entry) => entry.projectIndex)).toEqual([
      1, 0, 2
    ]);
  });

  it("orders by title", () => {
    expect(sortChecklistExportRows(rows, "title").map((entry) => entry.projectIndex)).toEqual([
      2, 0, 1
    ]);
  });

  it("orders by accession number, blanks last", () => {
    expect(sortChecklistExportRows(rows, "accession").map((entry) => entry.projectIndex)).toEqual([
      1, 0, 2
    ]);
  });

  it("walks rooms, then walls, then left-to-right along each wall", () => {
    const placed = [
      row(0, { placement: wallPlacement(1, 0, 500) }),
      row(1, { placement: wallPlacement(0, 1, 200) }),
      row(2, { placement: wallPlacement(0, 0, 900) }),
      row(3, { placement: wallPlacement(0, 0, 100) })
    ];
    expect(sortChecklistExportRows(placed, "placement").map((entry) => entry.projectIndex)).toEqual(
      [3, 2, 1, 0]
    );
  });

  it("puts floor works after wall works and unplaced works last", () => {
    const mixed = [
      row(0),
      row(1, {
        placement: {
          kind: "floor",
          roomName: "Main",
          wallName: null,
          roomIndex: 0,
          wallIndex: -1,
          alongMm: 0
        }
      }),
      row(2, { placement: wallPlacement(5, 0, 0) })
    ];
    expect(sortChecklistExportRows(mixed, "placement").map((entry) => entry.projectIndex)).toEqual([
      2, 1, 0
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [row(1), row(0)];
    sortChecklistExportRows(input, "project");
    expect(input.map((entry) => entry.projectIndex)).toEqual([1, 0]);
  });
});
