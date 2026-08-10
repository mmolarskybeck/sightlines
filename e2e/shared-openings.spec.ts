import type { Locator, Page } from "playwright/test";
import { expect, gotoApp, hideFontLab, test } from "./fixtures";

const SCHEMA_VERSION = 5;
const ROOM_WIDTH_MM = 4000;
const ROOM_HEIGHT_MM = 2500;

type RoomOptions = {
  roomId: string;
  name: string;
  offsetXMm: number;
  offsetYMm?: number;
  depthMm?: number;
};

type DoorOptions = {
  id: string;
  wallId: string;
  xMm: number;
  partnerId?: string;
};

type StoredProject = ReturnType<typeof projectWith>;

function rectangularRoom({
  roomId,
  name,
  offsetXMm,
  offsetYMm = 0,
  depthMm = 3000
}: RoomOptions) {
  const vertex = (corner: string, xMm: number, yMm: number) => ({
    id: `${roomId}-v-${corner}`,
    xMm,
    yMm
  });
  const wall = (side: string, from: string, to: string) => ({
    id: `${roomId}-wall-${side}`,
    roomId,
    name: `${side[0].toUpperCase()}${side.slice(1)} wall`,
    startVertexId: `${roomId}-v-${from}`,
    endVertexId: `${roomId}-v-${to}`,
    heightMm: ROOM_HEIGHT_MM
  });

  return {
    roomId,
    offsetXMm,
    offsetYMm,
    rotationDeg: 0,
    room: {
      id: roomId,
      name,
      heightMm: ROOM_HEIGHT_MM,
      freestandingWalls: [],
      vertices: [
        vertex("nw", 0, 0),
        vertex("ne", ROOM_WIDTH_MM, 0),
        vertex("se", ROOM_WIDTH_MM, depthMm),
        vertex("sw", 0, depthMm)
      ],
      walls: [
        wall("north", "nw", "ne"),
        wall("east", "ne", "se"),
        wall("south", "se", "sw"),
        wall("west", "sw", "nw")
      ]
    }
  };
}

function door({ id, wallId, xMm, partnerId }: DoorOptions) {
  return {
    id,
    kind: "door" as const,
    wallId,
    xMm,
    yMm: 1015,
    widthMm: 915,
    heightMm: 2030,
    blocksPlacement: true as const,
    ...(partnerId === undefined ? {} : { connectsToObjectId: partnerId })
  };
}

function projectWith(
  id: string,
  rooms: ReturnType<typeof rectangularRoom>[],
  wallObjects: ReturnType<typeof door>[] = []
) {
  const now = "2099-01-01T00:00:00.000Z";
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    title: `Shared opening ${id}`,
    unit: "ft" as const,
    defaultWallHeightMm: 3657.6,
    defaultCenterlineHeightMm: 1447.8,
    checklistArtworkIds: [],
    wallObjects,
    floorObjects: [],
    referenceMeasurements: [],
    savedViews: [],
    createdAt: now,
    updatedAt: now,
    floor: { rooms }
  };
}

function abuttingRooms(secondOffsetXMm = ROOM_WIDTH_MM) {
  return [
    rectangularRoom({ roomId: "main", name: "Main Gallery", offsetXMm: 0, depthMm: 3000 }),
    // Deliberately shallower and vertically offset. The shared run is the
    // intersection y=400..2800, not either wall's midpoint/full extent.
    rectangularRoom({
      roomId: "gallery-2",
      name: "Gallery 2",
      offsetXMm: secondOffsetXMm,
      offsetYMm: 400,
      depthMm: 2400
    })
  ];
}

function pairedDoors(worldYMm = 1100) {
  return [
    // Render the Main Gallery half last so pointer tests deterministically grab
    // that face when the paired plan glyphs coincide.
    door({
      id: "door-gallery-2",
      wallId: "gallery-2-wall-west",
      xMm: 2800 - worldYMm,
      partnerId: "door-main"
    }),
    door({
      id: "door-main",
      wallId: "main-wall-east",
      xMm: worldYMm,
      partnerId: "door-gallery-2"
    })
  ];
}

async function seedProject(page: Page, project: StoredProject) {
  // Boot once so the app creates the current IndexedDB schema, then put this
  // project in as the newest record and reload through the real open path.
  await gotoApp(page);
  await page.evaluate(async (record) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open("sightlines", 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("projects", "readwrite");
      transaction.objectStore("projects").put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  }, project);

  await page.reload();
  await expect(page.locator(".app-main")).toBeVisible();
  await hideFontLab(page);
  await expect(page.getByRole("textbox", { name: "Project title" }).first()).toHaveValue(
    project.title
  );
}

async function readStoredProject(page: Page, projectId: string) {
  return page.evaluate(async (id) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open("sightlines", 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise<StoredProject>((resolve, reject) => {
      const request = db.transaction("projects", "readonly").objectStore("projects").get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return record;
  }, projectId);
}

async function screenPoint(svg: Locator, xMm: number, yMm: number) {
  return svg.evaluate(
    (element, point) => {
      const svgElement = element as SVGSVGElement;
      const matrix = svgElement.getScreenCTM();
      if (!matrix) throw new Error("Plan SVG has no screen transform.");
      const svgPoint = svgElement.createSVGPoint();
      svgPoint.x = point.xMm;
      svgPoint.y = point.yMm;
      const transformed = svgPoint.matrixTransform(matrix);
      return { x: transformed.x, y: transformed.y };
    },
    { xMm, yMm }
  );
}

async function dragByModelDelta(
  page: Page,
  locator: Locator,
  svg: Locator,
  deltaXMm: number,
  deltaYMm: number
) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Drag target has no bounding box.");
  const origin = await screenPoint(svg, 0, 0);
  const delta = await screenPoint(svg, deltaXMm, deltaYMm);
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + delta.x - origin.x, start.y + delta.y - origin.y, {
    steps: 12
  });
  await page.mouse.up();
}

async function disablePlanSnap(page: Page) {
  const snap = page.getByRole("button", { name: "Snap", exact: true });
  if ((await snap.getAttribute("aria-pressed")) === "true") await snap.click();
}

async function selectRoom(page: Page, index: number) {
  const rooms = page.locator("polygon.room-hit");
  await expect(rooms).toHaveCount(2);
  await rooms.nth(index).click({ position: { x: 60, y: 60 } });
  await expect(rooms.nth(index)).toHaveClass(/selected/);
  return rooms.nth(index);
}

function storedDoors(project: StoredProject) {
  return project.wallObjects.map((object) => ({
    id: object.id,
    wallId: object.wallId,
    xMm: Math.round(object.xMm),
    partner: object.connectsToObjectId ?? null
  }));
}

test.describe("shared openings", () => {
  test("placing a door on the common wall creates both faces and a quiet inspector status", async ({
    page
  }) => {
    const project = projectWith("place", abuttingRooms());
    await seedProject(page, project);

    // Select Gallery 2 first so its west resize handle exists. Its handle sits
    // at y=1600; place at y=1100, inside the true shared y-range, so the handle
    // cannot swallow the click and differing room depths stay covered.
    await selectRoom(page, 1);
    await page.locator('.tool-cluster:visible').getByRole("button", { name: "Door" }).click();
    const svg = page.locator("svg.plan-svg");
    // Stay just inside Main Gallery so the tie between the two coincident wall
    // hit regions resolves to its east wall (and the status reads left→right).
    const point = await screenPoint(svg, ROOM_WIDTH_MM - 50, 1100);
    await page.mouse.click(point.x, point.y);

    const doors = page.locator(".plan-object--door");
    await expect(doors).toHaveCount(2);
    const inspector = page.getByRole("complementary", { name: "Inspector" });
    await expect(inspector.getByRole("status")).toHaveText(
      "Connects Main Gallery ↔ Gallery 2"
    );
    await expect(inspector.getByRole("combobox", { name: "Resolve shared opening" })).toHaveCount(0);
    await expect(inspector.getByRole("button", { name: /Disconnect/i })).toHaveCount(0);
    await expect(page.locator("button.status-badge")).toHaveText(/Saved/);
  });

  test("dragging either face moves its twin and refuses an overhang past the common span", async ({
    page
  }) => {
    const project = projectWith("paired-drag", abuttingRooms(), pairedDoors());
    await seedProject(page, project);
    await disablePlanSnap(page);

    const svg = page.locator("svg.plan-svg");
    const mainDoor = page.locator(".plan-object--door").last();
    await dragByModelDelta(page, mainDoor, svg, 0, 350);

    await expect
      .poll(async () => storedDoors(await readStoredProject(page, project.id)))
      .toEqual([
        {
          id: "door-gallery-2",
          wallId: "gallery-2-wall-west",
          xMm: 1350,
          partner: "door-main"
        },
        { id: "door-main", wallId: "main-wall-east", xMm: 1450, partner: "door-gallery-2" }
      ]);

    // Main Gallery continues to y=3000, but Gallery 2 stops at y=2800. This
    // proposed center would fit the selected wall while the door overhangs the
    // rooms' common run, so the atomic pair move must be refused.
    await dragByModelDelta(page, page.locator(".plan-object--door").last(), svg, 0, 1000);
    await expect(
      page.getByText(
        "This opening is shared with the room next door, so it can’t leave the wall the two rooms share."
      )
    ).toBeVisible();
    expect(storedDoors(await readStoredProject(page, project.id))).toEqual([
      {
        id: "door-gallery-2",
        wallId: "gallery-2-wall-west",
        xMm: 1350,
        partner: "door-main"
      },
      { id: "door-main", wallId: "main-wall-east", xMm: 1450, partner: "door-gallery-2" }
    ]);
  });

  test("moving rooms apart preserves the pair and offers both boundary-lost resolutions", async ({
    page
  }) => {
    const project = projectWith("boundary-lost", abuttingRooms(), pairedDoors());
    await seedProject(page, project);
    await disablePlanSnap(page);

    const svg = page.locator("svg.plan-svg");
    const room = await selectRoom(page, 1);
    await dragByModelDelta(page, room, svg, 900, 0);

    await page.locator(".plan-object--door").last().click();
    const inspector = page.getByRole("complementary", { name: "Inspector" });
    await expect(inspector).toContainText(
      /(?:Main Gallery and Gallery 2|Gallery 2 and Main Gallery) no longer share a wall here/
    );
    await expect(
      inspector.getByRole("button", { name: "Keep both as separate doors" })
    ).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Keep this door only" })).toBeVisible();

    await inspector.getByRole("button", { name: "Keep both as separate doors" }).click();
    await expect(page.locator(".plan-object--door")).toHaveCount(2);
    await expect(inspector.getByRole("button", { name: "Keep this door only" })).toHaveCount(0);

    // Undo the split, then exercise the other resolution from the restored
    // boundary-lost state.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(inspector.getByRole("button", { name: "Keep this door only" })).toBeVisible();
    await inspector.getByRole("button", { name: "Keep this door only" }).click();
    await expect(page.locator(".plan-object--door")).toHaveCount(1);
  });

  test("one Undo reverses both a room move and the pairing it triggered", async ({ page }) => {
    const rooms = abuttingRooms(4500);
    const exposed = [
      door({ id: "door-gallery-2", wallId: "gallery-2-wall-west", xMm: 1700 }),
      door({ id: "door-main", wallId: "main-wall-east", xMm: 1100 })
    ];
    const project = projectWith("single-undo", rooms, exposed);
    await seedProject(page, project);
    await disablePlanSnap(page);

    const svg = page.locator("svg.plan-svg");
    const room = await selectRoom(page, 1);
    await dragByModelDelta(page, room, svg, -500, 0);

    await expect
      .poll(async () => {
        const stored = await readStoredProject(page, project.id);
        return {
          offsetXMm: Math.round(stored.floor.rooms[1].offsetXMm),
          doors: storedDoors(stored)
        };
      })
      .toEqual({
        offsetXMm: 4000,
        doors: [
          {
            id: "door-gallery-2",
            wallId: "gallery-2-wall-west",
            xMm: 1700,
            partner: "door-main"
          },
          { id: "door-main", wallId: "main-wall-east", xMm: 1100, partner: "door-gallery-2" }
        ]
      });

    await page.getByRole("button", { name: "Undo" }).click();
    await expect
      .poll(async () => {
        const stored = await readStoredProject(page, project.id);
        return {
          offsetXMm: Math.round(stored.floor.rooms[1].offsetXMm),
          doors: storedDoors(stored)
        };
      })
      .toEqual({
        offsetXMm: 4500,
        doors: [
          {
            id: "door-gallery-2",
            wallId: "gallery-2-wall-west",
            xMm: 1700,
            partner: null
          },
          { id: "door-main", wallId: "main-wall-east", xMm: 1100, partner: null }
        ]
      });
  });

  test("a legacy one-sided opening is repaired from the issues rail and saves cleanly", async ({
    page
  }) => {
    const project = projectWith("missing-twin", abuttingRooms(), [
      door({ id: "door-main", wallId: "main-wall-east", xMm: 1100 })
    ]);
    await seedProject(page, project);

    const issue = page.getByRole("button", {
      name: /Door in Main Gallery: This door appears on the Main Gallery side of the wall but not on the Gallery 2 side\./
    });
    await expect(issue).toBeVisible();
    await issue.click();

    const inspector = page.getByRole("complementary", { name: "Inspector" });
    await inspector.getByRole("button", { name: "Complete shared opening" }).click();
    await expect(page.locator(".plan-object--door")).toHaveCount(2);
    await expect(inspector.getByRole("status")).toHaveText(
      "Connects Main Gallery ↔ Gallery 2"
    );
    await expect(page.locator("button.status-badge")).toHaveText(/Saved/);
    await expect
      .poll(async () => storedDoors(await readStoredProject(page, project.id)))
      .toEqual([
        { id: "door-main", wallId: "main-wall-east", xMm: 1100, partner: expect.any(String) },
        expect.objectContaining({
          wallId: "gallery-2-wall-west",
          xMm: 1700,
          partner: "door-main"
        })
      ]);
  });
});
