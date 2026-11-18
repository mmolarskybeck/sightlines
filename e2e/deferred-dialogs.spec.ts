import type { Locator } from "playwright/test";
import { expect, gotoApp, test } from "./fixtures";

// The project manager's code is fetched on first open (DeferredDialog), not
// with the app. These pin the behaviors lazy loading can break: nothing is
// fetched before intent, first open lands focus inside the dialog, close and
// reopen work, and a failed chunk download is recoverable instead of fatal.
// The route pattern matches both the dev module (ProjectManager.tsx) and the
// built chunk (ProjectManager-<hash>.js).
const PROJECT_MANAGER_MODULE = /\/ProjectManager[-.][^/]*$/;

test("project manager loads on demand and survives close/reopen", async ({ page }) => {
  const fetched: string[] = [];
  page.on("request", (request) => {
    if (PROJECT_MANAGER_MODULE.test(new URL(request.url()).pathname)) fetched.push(request.url());
  });
  await gotoApp(page);
  expect(fetched).toEqual([]);

  const trigger = page.getByRole("button", { name: "Manage projects" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Projects" });
  await expect(dialog.locator(".project-manager-list")).toBeVisible();
  expect(fetched.length).toBeGreaterThan(0);
  await expectFocusInside(dialog);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await trigger.click();
  await expect(dialog.locator(".project-manager-list")).toBeVisible();
  await expectFocusInside(dialog);
});

test("a slow project manager download shows a loading shell, then the dialog", async ({ page }) => {
  await gotoApp(page);
  await page.route(PROJECT_MANAGER_MODULE, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });

  await page.getByRole("button", { name: "Manage projects" }).click();
  const dialog = page.getByRole("dialog", { name: "Projects" });
  await expect(dialog.getByText("Loading…")).toBeVisible();
  await expect(dialog.locator(".project-manager-list")).toBeVisible();
  await expect(dialog.getByText("Loading…")).toHaveCount(0);
  await expectFocusInside(dialog);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("a failed project manager download is contained and recovers on reload", async ({
  page,
  consoleGuard
}) => {
  consoleGuard.allow(
    /Failed to load resource|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/
  );
  await gotoApp(page);
  await page.route(PROJECT_MANAGER_MODULE, (route) => route.abort());

  const trigger = page.getByRole("button", { name: "Manage projects" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Projects" });
  await expect(dialog.getByRole("alert")).toContainText("couldn’t load");
  // Contained to the dialog: Escape closes it and the app is still usable.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".app-main")).toBeVisible();

  await page.unroute(PROJECT_MANAGER_MODULE);
  await trigger.click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Reload page" }).click();
  await expect(page.locator(".app-main")).toBeVisible();
  await page.getByRole("button", { name: "Manage projects" }).click();
  await expect(dialog.locator(".project-manager-list")).toBeVisible();
});

async function expectFocusInside(dialog: Locator) {
  await expect
    .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);
}
