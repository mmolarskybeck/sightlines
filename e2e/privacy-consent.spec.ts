import { expect, gotoApp, test } from "./fixtures";

const PRIVACY_STORAGE_KEY = "sightlines.privacyPreferences.v1";

test("fresh and declined devices send no optional telemetry", async ({ page }) => {
  const optionalRequests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      url.includes("cloudflareinsights.com") ||
      url.includes("/api/analytics") ||
      url.includes("sentry.io")
    ) {
      optionalRequests.push(url);
    }
  });

  await gotoApp(page);

  const notice = page.getByRole("complementary", {
    name: "Help improve Sightlines"
  });
  await expect(notice).toBeVisible();
  expect(optionalRequests).toEqual([]);

  await notice.getByRole("button", { name: "No thanks" }).click();
  await expect(notice).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate((key) => window.localStorage.getItem(key), PRIVACY_STORAGE_KEY)
    )
    .toContain('"decision":"declined"');

  await page.reload();
  await expect(page.locator(".app-main")).toBeVisible();
  await expect(page.getByText("Help improve Sightlines")).toHaveCount(0);
  expect(optionalRequests).toEqual([]);
});

test("privacy categories remain independently configurable", async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        decision: "declined",
        preferences: { usageAnalytics: false, crashReports: false }
      })
    );
  }, PRIVACY_STORAGE_KEY);
  await gotoApp(page);

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const usage = settings.getByRole("switch", {
    name: "Anonymous usage analytics"
  });
  const crashes = settings.getByRole("switch", {
    name: "Anonymous crash reports"
  });

  await expect(usage).not.toBeChecked();
  await expect(crashes).not.toBeChecked();

  await usage.click();
  await expect(usage).toBeChecked();
  await expect(crashes).not.toBeChecked();

  await crashes.click();
  await expect(usage).toBeChecked();
  await expect(crashes).toBeChecked();

  await usage.click();
  await expect(usage).not.toBeChecked();
  await expect(crashes).toBeChecked();
});
