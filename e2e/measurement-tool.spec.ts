import { expect, test, type Locator, type Page } from "playwright/test";

async function hideFontLab(page: Page) {
  const hide = page.getByRole("button", { name: "Hide", exact: true });
  if (await hide.count()) await hide.first().click();
}

async function clickCanvasAt(svg: Locator, xRatio: number, yRatio: number) {
  const bounds = await svg.boundingBox();
  if (!bounds) throw new Error("The drawing surface has no bounding box.");
  await svg.click({
    position: { x: bounds.width * xRatio, y: bounds.height * yRatio }
  });
}

test("creates and clears a temporary measurement while Measure stays armed", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".app-main")).toBeVisible();
  await hideFontLab(page);

  await expect(page.getByRole("radio", { name: "Plan", exact: true })).toBeChecked();
  const plan = page.locator("svg.plan-svg");
  await expect(plan).toBeVisible();

  await page.keyboard.press("m");
  const measure = page.getByRole("button", { name: "Measure", exact: true });
  await expect(measure).toHaveAttribute("aria-pressed", "true");
  await expect(plan).toHaveCSS("cursor", "crosshair");
  const roomHit = plan.locator(".room-hit").first();
  if (await roomHit.count()) await expect(roomHit).toHaveCSS("cursor", "crosshair");

  await clickCanvasAt(plan, 0.4, 0.5);
  await clickCanvasAt(plan, 0.6, 0.5);

  await expect(page.getByRole("group", { name: /^Measurement,/ })).toBeVisible();
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector).toContainText("Measurement");
  await expect(inspector).toContainText("Distance");
  await expect(inspector.locator(".inspector-summary-row-value")).not.toHaveText("");
  await expect(plan.locator(".measurement-handle")).toHaveCount(2);
  await expect(plan.locator(".measurement-handle-hit").first()).toHaveCSS("cursor", "grab");

  // Local undo clears temporary work without touching project history.
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("group", { name: /^Measurement,/ })).toHaveCount(0);
  await expect(measure).toHaveAttribute("aria-pressed", "true");

  // Delete owns the selected temporary result as well.
  await clickCanvasAt(plan, 0.4, 0.5);
  await clickCanvasAt(plan, 0.6, 0.5);
  await page.keyboard.press("Delete");
  await expect(page.getByRole("group", { name: /^Measurement,/ })).toHaveCount(0);
  await expect(measure).toHaveAttribute("aria-pressed", "true");

  // With no temporary work left, Escape disarms Measure.
  await page.keyboard.press("Escape");
  await expect(measure).toHaveAttribute("aria-pressed", "false");
});

test("switching 2D surfaces clears temporary work but keeps Measure armed", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".app-main")).toBeVisible();
  await hideFontLab(page);

  const plan = page.locator("svg.plan-svg");
  await page.keyboard.press("m");
  await clickCanvasAt(plan, 0.4, 0.5);
  await clickCanvasAt(plan, 0.6, 0.5);
  await expect(page.getByRole("group", { name: /^Measurement,/ })).toBeVisible();

  await page.getByRole("radio", { name: "Elevation", exact: true }).click();
  await expect(page.locator("svg.elevation-svg")).toBeVisible();
  await expect(page.getByRole("group", { name: /^Measurement,/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Measure", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});
