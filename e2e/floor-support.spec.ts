import { expect, test, addArtwork, clickCanvasAt, gotoApp } from "./fixtures";
import type { Locator, Page } from "playwright/test";

// Floor supports (pedestal / plinth) are standalone floor objects (schema v8,
// docs/floor-supports-spec.md) modelled on shelves: a support carries whatever
// works overlap its top face at the right height, and that "Support" reading
// is DERIVED on every render rather than stored on the work. That makes the
// interesting claims cross-cutting in exactly the shape e2e/shelf-snap.spec.ts
// already argues for shelves — a checklist drop, a plan drag, an inspector
// action and a delete all have to agree on the same seating, and a unit test
// can hold the store and one renderer together while another draws nothing.
//
// Plan's SVG user space is floor-space millimetres (see PlanView's viewBox),
// so getBBox on an object's own .plan-object-outline gives exact model
// numbers there. Playwright's boundingBox() inflates every rect by its stroke
// and shadow, which is enough to blur a real move from noise — so every
// geometry assertion below reads getBBox mm-space, the method
// e2e/shelf-snap.spec.ts uses for elevation. None of the objects here rotate,
// so an outline's own getBBox (unaffected by the ancestor <g>'s rotate
// transform) already equals its floor-space rect.

type MmBox = { x: number; y: number; width: number; height: number };

async function mmBoxOf(locator: Locator): Promise<MmBox> {
  return await locator.evaluate((element) => {
    const box = (element as SVGGraphicsElement).getBBox();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
}

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected the element to have a bounding box.");
  return box;
}

// A LengthField with a step control renders its two stepper buttons inside
// the label, so getByLabel resolves to three nodes. Address the input by
// role, anchored at the field's own name (e2e/shelf-snap.spec.ts's helper).
const lengthField = (inspector: Locator, label: string) =>
  inspector.getByRole("textbox", { name: new RegExp(`^${label}`) });

// The derived "Support" row's value cell — InspectorSummaryRow renders label
// and value as sibling spans inside one .inspector-summary-row, and "Support"
// is the only row with that exact label (docs/floor-supports-spec.md §7).
const supportRowValue = (inspector: Locator) =>
  inspector.locator(
    '.inspector-summary-row:has(.inspector-summary-row-label:text-is("Support")) .inspector-summary-row-value'
  );

// The first LengthField edit on a freshly opened panel leaves that field
// focused; the very next click is eaten by its own blur commit rather than
// reaching its real target. Clicking the panel heading first spends that
// blur harmlessly (trap noted in docs/decisions.md, 2026-09-18).
async function blurFocusedField(inspector: Locator) {
  await inspector.locator("h2").first().click();
}

// Places a pedestal on open floor via the Insert tool, widens it so the
// checklist drop below and the later plan-drag grab both land unambiguously
// inside its footprint (rather than the smaller work centred on it), then
// drags a checklist work onto its footprint. Ends with the work SELECTED and
// its Support row already read as "On pedestal" — the state both test (a)
// and test (c) build on.
async function placeWorkOnPedestal(page: Page) {
  await gotoApp(page);
  await addArtwork(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });

  const insert = page.getByRole("group", { name: "Insert" });
  await insert.getByRole("button", { name: "Pedestal", exact: true }).click();

  const plan = page.locator("svg.plan-svg").first();
  await expect(plan).toBeVisible();
  // Open floor, clear of the default room's walls.
  await clickCanvasAt(plan, 0.32, 0.55);

  const support = plan.locator(".plan-object--support");
  await expect(support).toHaveCount(1);

  // Placing selects the new pedestal, so its inspector (SupportInspector) is
  // already open. Widen it well past a default work's floor footprint so the
  // drop below lands centred well inside it, leaving a wide unambiguous
  // margin to grab the pedestal by later without touching the work.
  await lengthField(inspector, "Width").fill("1.6 m");
  await lengthField(inspector, "Width").press("Enter");
  await lengthField(inspector, "Depth").fill("1.6 m");
  await lengthField(inspector, "Depth").press("Enter");
  await blurFocusedField(inspector);

  const planBox = await boxOf(plan);
  const supportBox = await boxOf(support);
  await page.locator("li.checklist-row").first().dragTo(plan, {
    targetPosition: {
      x: supportBox.x + supportBox.width / 2 - planBox.x,
      y: supportBox.y + supportBox.height / 2 - planBox.y
    }
  });

  const artwork = plan.locator(".plan-object--artwork");
  await expect(artwork).toHaveCount(1);
  await artwork.click({ force: true });
  await expect(supportRowValue(inspector)).toHaveText(/^On pedestal/);

  return { inspector, plan, support, artwork };
}

test("a work dropped on a pedestal stands on it, and the pedestal drags the work with it", async ({
  page
}) => {
  const { plan, support, artwork } = await placeWorkOnPedestal(page);

  // --- Drag the pedestal in plan: the work rides along. -------------------
  const supportOutline = support.locator(".plan-object-outline");
  const workOutline = artwork.locator(".plan-object-outline");
  const beforeSupport = await mmBoxOf(supportOutline);
  const beforeWork = await mmBoxOf(workOutline);

  // Grab a corner of the (much wider) pedestal, clear of the smaller work
  // centred on it, so the drag begins on the SUPPORT's own hit rect.
  const supportBox = await boxOf(support);
  const grab = { x: supportBox.x + 10, y: supportBox.y + 10 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 140, grab.y + 70, { steps: 16 });
  await page.mouse.up();

  await expect
    .poll(async () => Math.round((await mmBoxOf(supportOutline)).x - beforeSupport.x))
    .toBeGreaterThan(60);

  const afterSupport = await mmBoxOf(supportOutline);
  const afterWork = await mmBoxOf(workOutline);
  const deltaX = afterSupport.x - beforeSupport.x;
  const deltaY = afterSupport.y - beforeSupport.y;

  expect(afterWork.x - beforeWork.x).toBeCloseTo(deltaX, 0);
  expect(afterWork.y - beforeWork.y).toBeCloseTo(deltaY, 0);
  // Rigid: neither rect changed shape, only position.
  expect(afterSupport.width).toBeCloseTo(beforeSupport.width, 0);
  expect(afterWork.width).toBeCloseTo(beforeWork.width, 0);

  void plan;
});

test('"Put on pedestal" creates a pedestal under a floor work, and "Set on floor" leaves the pedestal standing', async ({
  page
}) => {
  await gotoApp(page);
  await addArtwork(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });

  // A work placed directly on open floor (no support anywhere yet).
  const plan = page.locator("svg.plan-svg").first();
  await expect(plan).toBeVisible();
  const planBox = await boxOf(plan);
  await page.locator("li.checklist-row").first().dragTo(plan, {
    targetPosition: { x: planBox.width * 0.4, y: planBox.height * 0.45 }
  });

  const artwork = plan.locator(".plan-object--artwork");
  await expect(artwork).toHaveCount(1);
  await artwork.click({ force: true });
  await expect(inspector).toContainText("Position on floor");
  await expect(supportRowValue(inspector)).toHaveText("On the floor");
  await expect(plan.locator(".plan-object--support")).toHaveCount(0);

  await blurFocusedField(inspector);
  await inspector.getByRole("button", { name: "Put on pedestal", exact: true }).click();

  await expect(plan.locator(".plan-object--support")).toHaveCount(1);
  await expect(supportRowValue(inspector)).toHaveText(/^On pedestal/);

  await inspector.getByRole("button", { name: "Set on floor", exact: true }).click();

  await expect(supportRowValue(inspector)).toHaveText("On the floor");
  // The pedestal itself is untouched by taking the work off it.
  await expect(plan.locator(".plan-object--support")).toHaveCount(1);
});

test("deleting a pedestal sets its works on the floor", async ({ page }) => {
  const { inspector, plan, artwork } = await placeWorkOnPedestal(page);

  await inspector.getByRole("button", { name: "Select pedestal", exact: true }).click();
  await expect(inspector.getByRole("button", { name: "Delete pedestal", exact: true })).toBeVisible();

  await inspector.getByRole("button", { name: "Delete pedestal", exact: true }).click();

  // Exact copy the store emits (src/app/store/floorObjectSlice.ts), singular
  // work count for this one-rider setup.
  await expect(page.getByText("Pedestal removed; 1 work set on the floor.")).toBeVisible();

  await expect(plan.locator(".plan-object--support")).toHaveCount(0);
  await artwork.click({ force: true });
  await expect(supportRowValue(inspector)).toHaveText("On the floor");
});
