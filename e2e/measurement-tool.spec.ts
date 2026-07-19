import { expect, test, clickCanvasAt, gotoApp } from "./fixtures";

test("creates and clears a temporary measurement while Measure stays armed", async ({ page }) => {
  await gotoApp(page);

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
  await gotoApp(page);

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

test("creates a temporary measurement with keyboard only, keeping Measure armed", async ({
  page
}) => {
  await gotoApp(page);

  const plan = page.locator("svg.plan-svg");
  await expect(plan).toBeVisible();
  await page.keyboard.press("m");
  const measure = page.getByRole("button", { name: "Measure", exact: true });
  await expect(measure).toHaveAttribute("aria-pressed", "true");

  // Focus the drawing surface itself, then drive the whole flow from the
  // keyboard: Enter begins at the viewport centre, arrows separate the
  // endpoints, Enter completes.
  await plan.focus();
  await page.keyboard.press("Enter");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  // The completed measurement and its inspector appear, and Measure is still armed.
  await expect(page.getByRole("group", { name: /^Measurement,/ })).toBeVisible();
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector).toContainText("Measurement");
  await expect(inspector).toContainText("Distance");
  await expect(plan.locator(".measurement-handle")).toHaveCount(2);
  await expect(measure).toHaveAttribute("aria-pressed", "true");
});
