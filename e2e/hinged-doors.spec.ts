import type { Locator, Page } from "playwright/test";
import { expect, gotoApp, hideFontLab, test } from "./fixtures";
import { doorSwingPlanGlyph } from "../src/domain/geometry/doorGlyphs";
import { WALL_OBJECT_PLAN_DEPTH_MM } from "../src/domain/geometry/planObjects";
import {
  BLOCKED_ZONE_HEIGHT_MM,
  BLOCKED_ZONE_WIDTH_MM,
  DOOR_HEIGHT_MM,
  DOOR_WIDTH_MM,
  WINDOW_HEIGHT_MM,
  WINDOW_WIDTH_MM
} from "../src/domain/placement/createOpening";
// Type-only: erased at compile time, so this carries no runtime coupling to
// project.ts (which the domain modules above already avoid pulling in for
// their own exports — see the import-safety check this file's setup relied
// on: nothing under src/domain/{geometry,placement} touches window/document).
import type { DoorLeaf } from "../src/domain/project";

const SCHEMA_VERSION = 5;
const ROOM_WIDTH_MM = 4000;
// Wall elevation height, unrelated to a room's floor-plan depth (the `depthMm`
// param below) — every wall needs one regardless of how deep the room is.
const ROOM_HEIGHT_MM = 2500;

type RoomOptions = {
  roomId: string;
  name: string;
  depthMm: number;
};

// A single axis-aligned rectangular room, north/east/south/west walls, origin
// at (0,0) — the minimal fixture both tests below need. Mirrors
// shared-openings.spec.ts's rectangularRoom, trimmed to one room (no
// offsetX/offsetY: neither test here needs a second room or a shared wall).
function rectangularRoom({ roomId, name, depthMm }: RoomOptions) {
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
    offsetXMm: 0,
    offsetYMm: 0,
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

type WallObjectOptions = {
  id: string;
  kind: "door" | "window" | "blocked-zone";
  wallId: string;
  xMm: number;
  widthMm: number;
  heightMm: number;
  // Only meaningful (and only ever passed) for a door — DoorWallObject is the
  // sole branch of the union that carries it (project.ts's split union), so
  // there is no "leaf on a window" case to even express here.
  leaf?: DoorLeaf;
};

function wallObject({ id, kind, wallId, xMm, widthMm, heightMm, leaf }: WallObjectOptions) {
  const base = {
    id,
    wallId,
    xMm,
    yMm: 1200,
    widthMm,
    heightMm,
    blocksPlacement: true as const
  };
  if (kind === "door") return { ...base, kind: "door" as const, ...(leaf ? { leaf } : {}) };
  if (kind === "window") return { ...base, kind: "window" as const };
  return { ...base, kind: "blocked-zone" as const };
}

type StoredProject = ReturnType<typeof projectWith>;

function projectWith(
  id: string,
  rooms: ReturnType<typeof rectangularRoom>[],
  wallObjects: ReturnType<typeof wallObject>[] = []
) {
  const now = "2099-01-01T00:00:00.000Z";
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    title: `Hinged doors ${id}`,
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

// Seeds IndexedDB directly and reloads through the real open path — same
// technique as shared-openings.spec.ts, so the app boots once to create the
// current schema, then the seeded record becomes the newest project.
async function seedProject(page: Page, project: StoredProject) {
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

// Model mm -> live screen pixels, via the plan SVG's own current CTM. Zoom-
// and pan-agnostic (reads the real transform each call), same helper
// shared-openings.spec.ts uses for its click-precision tests.
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

test.describe("hinged doors", () => {
  test("the Type row draws and removes the plan swing arc; only a door gets the row", async ({
    page
  }) => {
    // One room, one of each opening kind, each on its own wall so their thin
    // hit-rects can never overlap and confuse which element a click landed on.
    const project = projectWith(
      "toggle",
      [rectangularRoom({ roomId: "main", name: "Main Gallery", depthMm: ROOM_HEIGHT_MM })],
      [
        wallObject({
          id: "door-a",
          kind: "door",
          wallId: "main-wall-north",
          xMm: 1200,
          widthMm: DOOR_WIDTH_MM,
          heightMm: DOOR_HEIGHT_MM
        }),
        wallObject({
          id: "window-a",
          kind: "window",
          wallId: "main-wall-east",
          xMm: 1200,
          widthMm: WINDOW_WIDTH_MM,
          heightMm: WINDOW_HEIGHT_MM
        }),
        wallObject({
          id: "zone-a",
          kind: "blocked-zone",
          wallId: "main-wall-west",
          xMm: 1200,
          widthMm: BLOCKED_ZONE_WIDTH_MM,
          heightMm: BLOCKED_ZONE_HEIGHT_MM
        })
      ]
    );
    await seedProject(page, project);

    const inspector = page.getByRole("complementary", { name: "Inspector" });
    // Radix's single ToggleGroup is a radiogroup named by aria-labelledby ->
    // the "Type" row label (OpeningInspector.tsx's doorTypeLabelId), exactly
    // what OpeningInspector.test.tsx already pins at the component level —
    // this is the same query against the REAL rendered app.
    const typeGroup = inspector.getByRole("radiogroup", { name: "Type" });

    // --- A plain (doorway) door: Type row present, defaulted to Doorway,
    //     still drawing the old void chevron, no swing arc anywhere. ---
    await page.locator(".plan-object--door").click();
    await expect(typeGroup).toBeVisible();
    await expect(inspector.getByRole("radio", { name: "Doorway", checked: true })).toBeVisible();
    await expect(page.locator(".plan-object-mark--door-swing")).toHaveCount(0);
    await expect(page.locator(".plan-object-mark--door")).toHaveCount(1);

    // --- Switch to Hinged door: the chevron is replaced by the swing glyph
    //     (PlanObject.tsx's `kind === "door" && swing` branch), never both at
    //     once. ---
    await inspector.getByRole("radio", { name: "Hinged door" }).click();
    await expect(page.locator(".plan-object-mark--door-swing")).toHaveCount(1);
    await expect(page.locator(".plan-object-mark--door")).toHaveCount(0);

    const arcPath = page.locator(".plan-object-mark--door-swing path");
    const initialD = await arcPath.getAttribute("d");

    // --- Flip hinge redraws the arc. The store picks the initial handing
    //     (room-aware default, OpeningInspector never computes it — see
    //     updateDoorLeaf's contract), so this deliberately does not assert
    //     WHICH quadrant either drawing lands in, only that flipping the
    //     hinge visibly changes what's drawn. ---
    await inspector.getByRole("button", { name: "Flip hinge" }).click();
    await expect.poll(() => arcPath.getAttribute("d")).not.toBe(initialD);

    // --- Back to Doorway: swing arc gone, chevron restored. ---
    await inspector.getByRole("radio", { name: "Doorway" }).click();
    await expect(page.locator(".plan-object-mark--door-swing")).toHaveCount(0);
    await expect(page.locator(".plan-object-mark--door")).toHaveCount(1);

    // --- A window never gets the Type row: hinging is a DOOR concept only
    //     (DoorWallObject is the only branch of the union carrying `leaf` —
    //     project.ts's split union makes "a hinged window" unrepresentable,
    //     and the inspector's `door` narrowing mirrors that). ---
    await page.locator(".plan-object--window").click();
    await expect(inspector.getByRole("radiogroup", { name: "Type" })).toHaveCount(0);

    // --- Neither does a blocked zone. ---
    await page.locator(".plan-object--blocked-zone").click();
    await expect(inspector.getByRole("radiogroup", { name: "Type" })).toHaveCount(0);
  });

  test("the swing arc is pointer-transparent over the wall's own resize handle", async ({
    page
  }) => {
    // THE important test in this file. It guards a known trap in this
    // project: a plan resize handle sits right at a wall's own midpoint
    // (RoomResizeHandles.tsx), and a hinged door's swing arc is the one plan
    // glyph allowed to paint OUTSIDE its object's thin rect (PlanObject.tsx's
    // comment on the door-swing branch). If the arc ever picked up a hit
    // target, it would compete with that handle for exactly the pixels this
    // test clicks.
    //
    // Rather than hand-deriving the arc's trigonometry (fragile, and a
    // second copy of doorGlyphs.ts's own math to keep in sync), this test
    // calls the SAME function PlanObject.tsx renders through
    // (doorSwingPlanGlyphFor -> doorSwingPlanGlyph, planScene.ts) to find a
    // point strictly on the arc's curve, then solves backward for a door
    // position and room depth that put that exact point on the south wall's
    // own resize-handle center. Any future change to the glyph's
    // construction moves this test's target along with it, instead of
    // silently drifting out of sync with what actually gets drawn.
    const leaf: DoorLeaf = { hingeAtStart: true, swingsToLeft: true };
    const glyph = doorSwingPlanGlyph({
      widthMm: DOOR_WIDTH_MM,
      // The same fixed nominal depth getRenderedWallObjectPlanRect/
      // getWallObjectPlanRect use for every non-case wall object
      // (planScene.ts passes restRect.depthMm straight through) — matching
      // it here is what keeps this test's geometry identical to the app's.
      depthMm: WALL_OBJECT_PLAN_DEPTH_MM,
      hingeAtStart: leaf.hingeAtStart,
      swingsToLeft: leaf.swingsToLeft
    });
    // Index 4 of the default 8-segment flattening is 45° into the 90° sweep:
    // strictly INTERIOR to the arc's curve, clear of index 0 (shared with the
    // leaf line's open tip) and index 8 (the latch jamb, which sits exactly
    // on the door's own opening-rect edge). Landing the test point there
    // means a hit can only be explained by the arc's own pointer-events:none
    // treatment, never by ambiguity with the door's thin rect.
    const target = glyph.arcPolyline()[4]!;

    // The south wall's own handle sits at (roomWidth/2, roomDepth) — the
    // same (wall.start+wall.end)/2 formula RoomResizeHandles.tsx uses.
    // Solve backward: pick the door's wall position and the room's depth so
    // this exact arc point lands there.
    const handleXMm = ROOM_WIDTH_MM / 2;
    const doorXMm = handleXMm - target.xMm;
    const roomDepthMm = target.yMm;

    const project = projectWith(
      "pointer-transparency",
      [rectangularRoom({ roomId: "main", name: "Main Gallery", depthMm: roomDepthMm })],
      [
        wallObject({
          id: "door-a",
          kind: "door",
          wallId: "main-wall-north",
          xMm: doorXMm,
          widthMm: DOOR_WIDTH_MM,
          heightMm: DOOR_HEIGHT_MM,
          leaf
        })
      ]
    );
    await seedProject(page, project);

    // Confirm the premise before testing the transparency: the arc really is
    // drawn (this door was seeded pre-hinged, so no inspector step is needed
    // — the swing renders unconditionally off `object.leaf`, independent of
    // selection, per planScene.ts).
    await expect(page.locator(".plan-object-mark--door-swing")).toHaveCount(1);

    // Select the ROOM, not the door — Selection is one discriminated union
    // (selectionSlice.ts), so selecting an opening and selecting a room are
    // mutually exclusive, and only a room selection draws RoomResizeHandles
    // (PlanHandlesLayer.tsx). The door itself needs no selection at all: its
    // swing already renders regardless.
    await page.locator("polygon.room-hit").click({ position: { x: 10, y: 10 } });
    const handle = page.locator(".resize-handle.handle-hit");
    await expect(handle).not.toHaveCount(0);

    const svg = page.locator("svg.plan-svg");
    const point = await screenPoint(svg, handleXMm, roomDepthMm);

    // What ACTUALLY receives the hit at that pixel — read via the real
    // browser hit-test, not inferred from a bounding-box overlap. `.
    // plan-object-mark--door-swing` carries `pointer-events: none`
    // (global.css, right beside the trap comment this test is named for)
    // specifically so this resolves to the handle even though the arc's
    // stroke visually covers the same pixel.
    const hitClass = await page.evaluate(
      ({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        return element?.closest(".resize-handle, .plan-object--door")?.getAttribute("class") ?? null;
      },
      point
    );
    expect(hitClass).toContain("resize-handle");
    expect(hitClass).not.toContain("plan-object--door");

    // Functional proof, not just a static DOM query: actually drag from that
    // pixel and confirm a ROOM dimension moves while the door stays exactly
    // where it was. If the arc had swallowed the click, either the door
    // would have moved (or been selected) or nothing would have happened —
    // never the wall.
    const before = await readStoredProject(page, project.id);
    const verticesBefore = before.floor.rooms[0]!.room.vertices;

    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    const grown = await screenPoint(svg, handleXMm, roomDepthMm + 200);
    await page.mouse.move(grown.x, grown.y, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const stored = await readStoredProject(page, project.id);
        return stored.floor.rooms[0]!.room.vertices;
      })
      .not.toEqual(verticesBefore);

    const after = await readStoredProject(page, project.id);
    const door = after.wallObjects.find((object) => object.id === "door-a")!;
    expect(door.wallId).toBe("main-wall-north");
    expect(door.xMm).toBeCloseTo(doorXMm);
  });

  // The Type control's LAYOUT, which shipped broken twice before this test
  // existed. Both regressions were invisible to every other check: the
  // component test asserts behavior, tsc has nothing to say about a stylesheet,
  // and the tests above click the segments happily while "Hinged door" is
  // painting past the panel edge.
  //
  // The mechanism is worth stating, because it is what makes this fragile: the
  // segmented track is shared with the topbar, where `.seg-item` is
  // `white-space: nowrap` and the track sizes to its content. Give that track a
  // column narrower than its longest label and the text does not wrap, ellipse,
  // or scroll — it simply paints outside and is clipped by the panel. So a
  // clean `getBoundingClientRect` on the track proves nothing on its own; the
  // assertion has to reach the TEXT.
  test("the Type control fits its panel and matches the panel's label type", async ({
    page
  }) => {
    const project = projectWith(
      "layout",
      [rectangularRoom({ roomId: "main", name: "Main Gallery", depthMm: ROOM_HEIGHT_MM })],
      [
        wallObject({
          id: "door-a",
          kind: "door",
          wallId: "main-wall-north",
          xMm: 1200,
          widthMm: DOOR_WIDTH_MM,
          heightMm: DOOR_HEIGHT_MM
        })
      ]
    );
    await seedProject(page, project);

    const inspector = page.getByRole("complementary", { name: "Inspector" });

    // Two viewports, because the failure is width-dependent: at 1500 the old
    // label-left row had just enough room for "Doorway" but not "Hinged door".
    // 1100 is deliberately just above SINGLE_PANE_WORKSPACE_MEDIA_QUERY
    // (max-width: 1080px, App.tsx) — the narrowest layout that still shows the
    // inspector beside the canvas, and therefore the tightest the Type row ever
    // has to survive. Below 1080 the workspace goes single-pane and the panel
    // is not rendered at all, so there is nothing to measure there.
    //
    // Resize BEFORE selecting, and re-select each time: a viewport change drops
    // the current selection, so selecting first and then resizing unmounts the
    // inspector out from under the assertions.
    for (const width of [1500, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator(".plan-object--door").click();
      await expect(inspector.getByRole("radiogroup", { name: "Type" })).toBeVisible();

      const metrics = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('aside[aria-label="Inspector"]');
        // Found by ROLE, deliberately not by `.inspector-seg-toggle`. That class
        // is the current fix; probing for it would make this test pass or fail
        // on the fix's presence rather than on the layout it produces, so
        // deleting the class would read as "selector missing" instead of "the
        // control overflows" — and a different future fix would look like a
        // regression. The radiogroup is what the control IS.
        const track = panel?.querySelector<HTMLElement>('[role="radiogroup"]');
        if (!panel || !track) return null;
        const items = [...track.querySelectorAll<HTMLElement>(".seg-item")];
        const typeLabel = document.querySelector<HTMLElement>(".inspector-action-group-label");
        // A neighbouring numeric field's label ("Width"), the type the Type
        // row has to sit beside without looking borrowed from another screen.
        const fieldLabel = document.querySelector<HTMLElement>(".field-control > span");
        const font = (el: HTMLElement | null) =>
          el ? { size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight } : null;
        const panelRect = panel.getBoundingClientRect();
        const panelStyle = getComputedStyle(panel);
        return {
          panelInnerRight: panelRect.right - parseFloat(panelStyle.paddingRight || "0"),
          trackRight: track.getBoundingClientRect().right,
          items: items.map((item) => ({
            text: (item.textContent ?? "").trim(),
            // scrollWidth > clientWidth is the ONLY reliable signal that nowrap
            // text is overflowing its own box — the box itself measures clean.
            scrollWidth: item.scrollWidth,
            clientWidth: item.clientWidth,
            right: item.getBoundingClientRect().right,
            font: font(item)
          })),
          typeLabelFont: font(typeLabel),
          fieldLabelFont: font(fieldLabel)
        };
      });

      expect(metrics, `metrics at ${width}px`).not.toBeNull();
      const { items, typeLabelFont, fieldLabelFont } = metrics!;
      expect(items).toHaveLength(2);
      expect(items.map((item) => item.text)).toEqual(["Doorway", "Hinged door"]);

      for (const item of items) {
        // No clipped label, and nothing painting past the panel's inner edge.
        expect(item.scrollWidth, `"${item.text}" overflows its box at ${width}px`)
          .toBeLessThanOrEqual(item.clientWidth);
        expect(item.right, `"${item.text}" escapes the panel at ${width}px`)
          .toBeLessThanOrEqual(metrics!.panelInnerRight);
        // Sized as a peer of the panel's own labels, not at the topbar's scale.
        expect(item.font).toEqual(typeLabelFont);
        expect(item.font).toEqual(fieldLabelFont);
      }

      expect(metrics!.trackRight).toBeLessThanOrEqual(metrics!.panelInnerRight);
      // Equal halves: the two segments split the track rather than each
      // claiming its content width (which is what overflowed it).
      expect(items[0]!.clientWidth).toBe(items[1]!.clientWidth);
    }
  });
});
