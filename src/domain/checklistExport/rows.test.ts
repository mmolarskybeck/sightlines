import { describe, expect, it } from "vitest";
import { CURRENT_ARTWORK_SCHEMA_VERSION, type Artwork, type Project } from "../project";
import { createSampleProject } from "../sample/sampleProject";
import {
  buildChecklistExportRows,
  buildChecklistExportTable,
  checklistExportHeaders,
  checklistExportUnit,
  formatChecklistDimensions,
  formatChecklistFraming
} from "./rows";

function artwork(id: string, overrides: Partial<Artwork> = {}): Artwork {
  return {
    id,
    schemaVersion: CURRENT_ARTWORK_SCHEMA_VERSION,
    title: `Work ${id}`,
    dimensions: { status: "known", widthMm: 500, heightMm: 400 },
    metadata: {},
    ...overrides
  };
}

function metricProject(base: Project): Project {
  return { ...base, unit: "m" };
}

function projectWithPlacements(): Project {
  const base = createSampleProject();
  const room = base.floor.rooms[0].room;
  return {
    ...base,
    checklistArtworkIds: ["art-wall", "art-floor", "art-unplaced", "art-missing"],
    wallObjects: [
      {
        id: "wo-1",
        kind: "artwork",
        wallId: room.walls[1].id,
        artworkId: "art-wall",
        xMm: 1200,
        yMm: 1450,
        widthMm: 500,
        heightMm: 400
      }
    ],
    floorObjects: [
      {
        id: "fo-1",
        kind: "artwork",
        artworkId: "art-floor",
        xMm: 1000,
        yMm: 1000,
        widthMm: 500,
        depthMm: 300,
        rotationDeg: 0,
        heightMm: 400,
        wallYMm: 1450
      }
    ]
  };
}

describe("buildChecklistExportRows", () => {
  it("emits one row per checklist id, in checklist order, placed or not", () => {
    const project = projectWithPlacements();
    const rows = buildChecklistExportRows(project, [
      artwork("art-wall"),
      artwork("art-floor"),
      artwork("art-unplaced")
    ]);

    expect(rows.map((row) => row.artworkId)).toEqual([
      "art-wall",
      "art-floor",
      "art-unplaced",
      "art-missing"
    ]);
    expect(rows.map((row) => row.projectIndex)).toEqual([0, 1, 2, 3]);
  });

  it("resolves a wall placement to its room and wall names and its wall index", () => {
    const project = projectWithPlacements();
    const [wallRow] = buildChecklistExportRows(project, [artwork("art-wall")]);

    expect(wallRow.placement).toMatchObject({
      kind: "wall",
      roomName: "Main Gallery",
      wallName: project.floor.rooms[0].room.walls[1].name,
      roomIndex: 0,
      wallIndex: 1,
      alongMm: 1200
    });
  });

  it("resolves a floor placement to the room whose polygon contains it", () => {
    const project = projectWithPlacements();
    const rows = buildChecklistExportRows(project, [artwork("art-floor")]);
    const floorRow = rows.find((row) => row.artworkId === "art-floor");

    expect(floorRow?.placement).toMatchObject({
      kind: "floor",
      roomName: "Main Gallery",
      wallName: null,
      roomIndex: 0,
      wallIndex: -1
    });
  });

  it("leaves a deleted library record as a null artwork rather than dropping the row", () => {
    const project = projectWithPlacements();
    const rows = buildChecklistExportRows(project, []);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.artwork === null)).toBe(true);
  });

  it("still counts a placement on a wall that no longer exists as placed", () => {
    const base = projectWithPlacements();
    const project: Project = {
      ...base,
      wallObjects: [{ ...base.wallObjects[0], wallId: "wall-gone" } as (typeof base.wallObjects)[number]]
    };
    const [wallRow] = buildChecklistExportRows(project, [artwork("art-wall")]);

    expect(wallRow.placement?.kind).toBe("wall");
    expect(wallRow.placement?.wallName).toBeNull();
    expect(wallRow.placement?.roomIndex).toBe(project.floor.rooms.length);
  });
});

describe("dimension and framing text", () => {
  it("uses inches on an imperial project and centimetres on a metric one", () => {
    const imperial = createSampleProject();
    expect(checklistExportUnit(imperial)).toBe("in");
    expect(checklistExportUnit(metricProject(imperial))).toBe("cm");
  });

  it("formats width × height, adding depth only when the record has one", () => {
    const project = metricProject(createSampleProject());
    const unit = checklistExportUnit(project);
    expect(formatChecklistDimensions(artwork("a"), unit)).toBe("50 cm × 40 cm");
    expect(
      formatChecklistDimensions(
        artwork("a", { dimensions: { status: "known", widthMm: 500, heightMm: 400, depthMm: 60 } }),
        unit
      )
    ).toBe("50 cm × 40 cm × 6 cm");
  });

  it("blanks the dimension text when either axis is unknown", () => {
    const unit = checklistExportUnit(metricProject(createSampleProject()));
    expect(
      formatChecklistDimensions(
        artwork("a", { dimensions: { status: "unknown", widthMm: 500 } }),
        unit
      )
    ).toBe("");
  });

  it("reads framing through effectiveFraming, honouring frameIncludedInImage", () => {
    const unit = checklistExportUnit(metricProject(createSampleProject()));
    expect(formatChecklistFraming(artwork("a"), unit)).toBe("");
    expect(
      formatChecklistFraming(
        artwork("a", { matWidthMm: 50, frame: { widthMm: 20, finish: "wood" } }),
        unit
      )
    ).toBe("5 cm mat; Wood frame, 2 cm");
    expect(
      formatChecklistFraming(
        artwork("a", {
          matWidthMm: 50,
          frame: { widthMm: 20, finish: "wood" },
          frameIncludedInImage: true
        }),
        unit
      )
    ).toBe("Frame included in image");
  });
});

describe("buildChecklistExportTable", () => {
  it("names the axis columns with the project's artwork unit", () => {
    expect(checklistExportHeaders("cm")).toContain("Height (cm)");
    expect(checklistExportHeaders("in")).toContain("Depth (in)");
  });

  it("uses headers the import wizard's aliases recognize", () => {
    expect(checklistExportHeaders("in")).toEqual([
      "#",
      "Artist",
      "Title",
      "Date",
      "Medium",
      "Dimensions",
      "Height (in)",
      "Width (in)",
      "Depth (in)",
      "Accession number",
      "Location / Lender",
      "Framing",
      "Status",
      "Room",
      "Wall",
      "Image file"
    ]);
  });

  it("numbers rows in the order it is given and fills the status/room/wall cells", () => {
    const project = projectWithPlacements();
    const rows = buildChecklistExportRows(project, [artwork("art-wall"), artwork("art-unplaced")]);
    const table = buildChecklistExportTable({
      project,
      rows: [rows[0], rows[2]],
      imagePaths: new Map([["art-wall", "images/001_Work-art-wall.jpg"]])
    });

    const statusIndex = table.headers.indexOf("Status");
    const roomIndex = table.headers.indexOf("Room");
    const imageIndex = table.headers.indexOf("Image file");
    expect(table.rows[0][0]).toBe(1);
    expect(table.rows[1][0]).toBe(2);
    expect(table.rows[0][statusIndex]).toBe("Placed");
    expect(table.rows[1][statusIndex]).toBe("Unplaced");
    expect(table.rows[0][roomIndex]).toBe("Main Gallery");
    expect(table.rows[1][roomIndex]).toBe("");
    expect(table.rows[0][imageIndex]).toBe("images/001_Work-art-wall.jpg");
    expect(table.rows[1][imageIndex]).toBe("");
  });

  it("writes numeric axis cells in the project's unit and blanks unknown ones", () => {
    const project = metricProject(projectWithPlacements());
    const rows = buildChecklistExportRows(project, [
      artwork("art-wall", { dimensions: { status: "known", widthMm: 500, heightMm: 400 } })
    ]);
    const table = buildChecklistExportTable({ project, rows: [rows[0]] });

    const heightIndex = table.headers.indexOf("Height (cm)");
    const depthIndex = table.headers.indexOf("Depth (cm)");
    expect(table.rows[0][heightIndex]).toBe(40);
    expect(table.rows[0][depthIndex]).toBeNull();
  });

  it("appends extra metadata columns, stripping the source: prefix", () => {
    const project = projectWithPlacements();
    const rows = buildChecklistExportRows(project, [
      artwork("art-wall", {
        metadata: {
          medium: "Oil on canvas",
          "source:Credit line": "Gift of the artist",
          dimensionSourceText: "20 x 16 in",
          dimensionRole: "framed",
          Insurance: 12000
        }
      })
    ]);
    const table = buildChecklistExportTable({ project, rows: [rows[0]] });

    expect(table.headers).toContain("Credit line");
    expect(table.headers).toContain("Insurance");
    expect(table.headers).not.toContain("dimensionSourceText");
    expect(table.headers).not.toContain("dimensionRole");
    expect(table.headers.filter((header) => header === "Medium")).toHaveLength(1);
    expect(table.rows[0][table.headers.indexOf("Medium")]).toBe("Oil on canvas");
    expect(table.rows[0][table.headers.indexOf("Credit line")]).toBe("Gift of the artist");
    expect(table.rows[0][table.headers.indexOf("Insurance")]).toBe(12000);
  });

  it("drops a source column whose header would duplicate a core one", () => {
    const project = projectWithPlacements();
    const rows = buildChecklistExportRows(project, [
      artwork("art-wall", {
        metadata: { "source:Height": "16 in", "source:Artist": "Agnes Martin" }
      })
    ]);
    const table = buildChecklistExportTable({ project, rows: [rows[0]] });

    expect(table.headers).not.toContain("Height");
    expect(table.headers.filter((header) => header === "Artist")).toHaveLength(1);
  });
});
