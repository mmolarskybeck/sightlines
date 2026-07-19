import { test as base, expect, type Locator, type Page } from "playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const DEFAULT_ARTWORK = path.join(
  REPO_ROOT,
  "fixtures/artworks/rijks-aic/images/aic-great-wave-off-kanagawa.jpg"
);

export async function hideFontLab(page: Page) {
  const hide = page.getByRole("button", { name: "Hide", exact: true });
  if (await hide.count()) await hide.first().click();
}

export async function gotoApp(page: Page) {
  await page.goto("/");
  await expect(page.locator(".app-main")).toBeVisible();
  await hideFontLab(page);
}

export async function switchView(page: Page, name: "Plan" | "Elevation" | "3D") {
  await page.getByRole("radio", { name, exact: true }).click();
}

export async function clickCanvasAt(svg: Locator, xRatio: number, yRatio: number) {
  const bounds = await svg.boundingBox();
  if (!bounds) throw new Error("The drawing surface has no bounding box.");
  await svg.click({
    position: { x: bounds.width * xRatio, y: bounds.height * yRatio }
  });
}

export async function addArtwork(page: Page, fixturePath: string = DEFAULT_ARTWORK) {
  await page
    .locator('input[type="file"][aria-label="Add artwork images"]')
    .setInputFiles(fixturePath);

  const artwork = page.locator("li.checklist-row").first();
  await expect(artwork).toBeVisible();
  return artwork;
}

export async function placeArtworkOnWall(page: Page) {
  await switchView(page, "Elevation");
  const elevation = page.locator("svg:has(rect.wall-fill)").first();
  await expect(elevation).toBeVisible();
  const artwork = page.locator("li.checklist-row").first();
  await artwork.dragTo(elevation, { targetPosition: { x: 450, y: 400 } });
  await expect(elevation.locator("rect.artwork-outline")).toHaveCount(1);
  return elevation;
}

type ConsoleGuardFixture = {
  allow: (pattern: RegExp) => void;
};

export const test = base.extend<{ consoleGuard: ConsoleGuardFixture }>({
  consoleGuard: [
    async ({ page }, use) => {
      const messages: string[] = [];
      const allowPatterns: RegExp[] = [];

      page.on("console", (message) => {
        if (message.type() === "error") messages.push(message.text());
      });
      page.on("pageerror", (error) => messages.push(error.message));

      const guard: ConsoleGuardFixture = {
        allow(pattern: RegExp) {
          allowPatterns.push(pattern);
        }
      };

      await use(guard);

      const unexpected = messages.filter(
        (message) => !allowPatterns.some((pattern) => pattern.test(message))
      );
      expect(unexpected).toEqual([]);
    },
    { auto: true }
  ]
});

export { expect };
