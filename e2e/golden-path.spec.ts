import { expect, test, type Page } from "playwright/test";
import path from "node:path";

const TEST_ARTWORK = path.resolve(
  "fixtures/artworks/rijks-aic/images/aic-great-wave-off-kanagawa.jpg"
);

async function hideFontLab(page: Page) {
  const hide = page.getByRole("button", { name: "Hide", exact: true });
  if (await hide.count()) await hide.first().click();
}

async function switchView(page: Page, name: "Plan" | "Elevation" | "3D") {
  await page.getByRole("radio", { name, exact: true }).click();
}

test("moves through the core artwork placement workflow", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator(".app-main")).toBeVisible();
  await hideFontLab(page);

  await expect(page.getByRole("radio", { name: "Plan", exact: true })).toBeChecked();

  await page
    .locator('input[type="file"][aria-label="Add artwork images"]')
    .setInputFiles(TEST_ARTWORK);

  const artwork = page.locator("li.checklist-row").first();
  await expect(artwork).toContainText("Unplaced");

  await switchView(page, "Elevation");
  const elevation = page.locator("svg:has(rect.wall-fill)").first();
  await expect(elevation).toBeVisible();
  await artwork.dragTo(elevation, { targetPosition: { x: 450, y: 400 } });

  await expect(artwork).not.toContainText("Unplaced");
  await expect(elevation.locator("rect.artwork-outline")).toHaveCount(1);

  await artwork.click();
  await expect(page.getByRole("complementary", { name: "Inspector" })).toContainText(
    /Position on .* wall/
  );

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(artwork).toContainText("Unplaced");

  await page.getByRole("button", { name: "Redo" }).click();
  await expect(artwork).not.toContainText("Unplaced");

  await switchView(page, "3D");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => consoleErrors).toEqual([]);
});
