import { expect, test, addArtwork, gotoApp, placeArtworkOnWall, switchView } from "./fixtures";

// Floor supports (pedestal / plinth / plexi bonnet) are an ATTACHED block on a
// floor placement, which makes almost every claim about them a claim about two
// surfaces at once: the inspector writes one merged, normalised support, and
// plan, elevation and the ghost toggle all have to be reading the same resolved
// answer. A unit test can hold the store and any one renderer together while
// the other renderer draws nothing at all — the pedestal that never appears
// under the sculpture is precisely the failure this spec exists to catch.
//
// Everything below runs off ONE placed work, converted to the floor by the
// inspector's Type control (see artwork-placement-type.spec.ts).
async function placeFloorWorkOnPedestal(page: import("playwright/test").Page) {
  await gotoApp(page);
  await addArtwork(page);
  await placeArtworkOnWall(page);

  await page.locator("li.checklist-row").first().click();
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await inspector
    .getByRole("radiogroup", { name: "Placement type" })
    .getByRole("radio", { name: "Floor", exact: true })
    .click();
  await expect(inspector).toContainText("Position on floor");

  // "Stands on" replaces the monitor-only "On pedestal" switch: four mutually
  // exclusive states in one select. A bare floor work reads "Floor".
  const standsOn = inspector.getByRole("combobox", { name: "Stands on" });
  await expect(standsOn).toContainText("Floor");
  await standsOn.click();
  await page.getByRole("option", { name: "Pedestal", exact: true }).click();
  await expect(standsOn).toContainText("Pedestal");

  // The support fields arriving IS the confirmation that a support was written
  // to the placement, not just a label changed.
  await expect(inspector.getByLabel("Support width")).toBeVisible();
  // ...and "Height off floor" is withheld while a support is present: the
  // work's bottom edge is the support's top, so the suspension field would be
  // offering a number nothing reads.
  await expect(inspector.getByLabel("Height off floor")).toHaveCount(0);

  return inspector;
}

test("a pedestal draws under the work in plan, and the assembly drags as one object", async ({
  page
}) => {
  const inspector = await placeFloorWorkOnPedestal(page);

  // A wide pedestal, so the reveal around the work is big enough to grab by —
  // the thing being tested is that the support rect is part of the work's own
  // hit target, and that needs somewhere to press that is support and not work.
  await inspector.getByLabel("Support width").fill("1.6 m");
  await inspector.getByLabel("Support width").press("Enter");
  await inspector.getByLabel("Support depth").fill("1.6 m");
  await inspector.getByLabel("Support depth").press("Enter");

  await switchView(page, "Plan");
  const plan = page.locator("svg:has(.plan-object-hit)").first();
  await expect(plan).toBeVisible();

  // A SECOND rect beneath the work, in the same rotate group: the pedestal.
  const assembly = plan.locator(".plan-object:has(.plan-object-support)");
  await expect(assembly).toHaveCount(1);
  const supportRect = assembly.locator(".plan-object-support");
  const workRect = assembly.locator(".plan-object-outline");
  await expect(supportRect).toHaveCount(1);
  await expect(workRect).toHaveCount(1);

  // Walk the assembly off the wall into open floor FIRST, by the work rect.
  // The work was converted from a wall placement and still sits against that
  // wall, where a drag that stays inside the wall's capture radius re-adopts it
  // as a wall placement — which correctly parks the support in floor memory and
  // would leave nothing to measure below.
  const planBox = (await plan.boundingBox())!;
  const firstWork = (await workRect.boundingBox())!;
  await page.mouse.move(firstWork.x + firstWork.width / 2, firstWork.y + firstWork.height / 2);
  await page.mouse.down();
  await page.mouse.move(planBox.x + planBox.width * 0.45, planBox.y + planBox.height * 0.55, {
    steps: 14
  });
  await page.mouse.up();
  // The support survived a drag of the work itself — it is attached to the
  // placement, not to the spot on the floor.
  await expect(supportRect).toHaveCount(1);

  const supportBefore = (await supportRect.boundingBox())!;
  const workBefore = (await workRect.boundingBox())!;
  const hitBefore = (await assembly.locator(".plan-object-hit").boundingBox())!;
  // The support really is drawn wider than the work it carries (overhang off
  // grows the support, never shrinks the work).
  expect(supportBefore.width).toBeGreaterThan(workBefore.width);

  // Press on the pedestal's reveal — inside the support, outside the work's own
  // pointer rect. Asserted rather than assumed: if the work's hit rect covered
  // this point the drag below would prove nothing about the support.
  const grab = {
    x: supportBefore.x + 6,
    y: supportBefore.y + supportBefore.height / 2
  };
  expect(grab.x).toBeLessThan(hitBefore.x);

  const deltaX = 120;
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + deltaX, grab.y, { steps: 12 });
  await page.mouse.up();

  // BOTH rects travel, by the same amount: one placement, one offset, one drag.
  await expect
    .poll(async () => Math.round((await supportRect.boundingBox())!.x - supportBefore.x))
    .toBeGreaterThan(deltaX / 2);
  const supportAfter = (await supportRect.boundingBox())!;
  const workAfter = (await workRect.boundingBox())!;
  expect(workAfter.x - workBefore.x).toBeCloseTo(supportAfter.x - supportBefore.x, 0);
  expect(supportAfter.width).toBeCloseTo(supportBefore.width, 0);
  expect(workAfter.width).toBeCloseTo(workBefore.width, 0);
});

test("the elevation draws a supported ghost from the floor line, and H hides it", async ({
  page
}) => {
  await placeFloorWorkOnPedestal(page);

  await switchView(page, "Elevation");
  const elevation = page.locator("svg:has(rect.wall-fill)").first();
  await expect(elevation).toBeVisible();

  const ghost = elevation.locator("g.elevation-supported-artwork-ghost");
  await expect(ghost).toHaveCount(1);
  const support = ghost.locator(".supported-artwork-ghost-support");
  const work = ghost.locator(".supported-artwork-ghost-work");
  await expect(support).toHaveCount(1);
  await expect(work).toHaveCount(1);

  // The support box sits UNDER the work box: the ghost is drawn from the floor
  // line up, which is the whole point of a pedestal on an elevation.
  const supportBox = (await support.boundingBox())!;
  const workBox = (await work.boundingBox())!;
  expect(supportBox.y).toBeGreaterThan(workBox.y);

  // H joins this ghost to the rest of the ghost family (monitor, suspended,
  // floor case) rather than giving it a toggle of its own. Focus has to leave
  // the inspector's fields first — the shortcut is correctly ignored while an
  // editable element has it.
  await elevation.focus();
  await page.keyboard.press("h");
  await expect(ghost).toHaveCount(0);
  await page.keyboard.press("h");
  await expect(ghost).toHaveCount(1);
});

test("enabling the plexi bonnet grows a pedestal that was tight to the work", async ({
  page
}) => {
  const inspector = await placeFloorWorkOnPedestal(page);

  // Shrink the pedestal to the work's own footprint: typing anything smaller is
  // clamped UP to it while overhang is off, so this is the tightest legal
  // pedestal and the field reads back what was actually stored.
  const widthField = inspector.getByLabel("Support width");
  const depthField = inspector.getByLabel("Support depth");
  await widthField.fill("1 cm");
  await widthField.press("Enter");
  await depthField.fill("1 cm");
  await depthField.press("Enter");
  const tightWidth = await widthField.inputValue();
  const tightDepth = await depthField.inputValue();

  await switchView(page, "Plan");
  const plan = page.locator("svg:has(.plan-object-hit)").first();
  const assembly = plan.locator(".plan-object:has(.plan-object-support)");
  const supportRect = assembly.locator(".plan-object-support");
  const tightBox = (await supportRect.boundingBox())!;

  // The glass needs its own thickness plus clearance on every side, and the
  // bonnet's footprint IS the support's (USER DECISION 2026-09-17) — so the
  // support has to grow rather than the work being squeezed.
  await inspector.getByLabel("Plexi bonnet").click();

  await expect(assembly.locator(".plan-object-support-bonnet")).toHaveCount(1);
  await expect(widthField).not.toHaveValue(tightWidth);
  await expect(depthField).not.toHaveValue(tightDepth);
  const grownBox = (await supportRect.boundingBox())!;
  expect(grownBox.width).toBeGreaterThan(tightBox.width);
  expect(grownBox.height).toBeGreaterThan(tightBox.height);

  // Overhang is not a choice you get to make under glass: the switch stays, and
  // says why, rather than disappearing.
  await expect(inspector.getByLabel("Allow overhang")).toBeDisabled();
  await expect(inspector).toContainText("A bonnet keeps the work inside the support.");
});
