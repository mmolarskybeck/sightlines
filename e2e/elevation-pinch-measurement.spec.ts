import { expect, test, gotoApp, switchView } from "./fixtures";
import type { Page } from "playwright/test";

// Trusted-touch synthesis is required here: only real (isTrusted) touch events
// exercise the pointerdown-capture ordering under test. Synthetic
// page.evaluate-dispatched events cannot validate viewport-vs-Measure capture,
// so every gesture below is driven through a CDP Input.dispatchTouchEvent.
test.use({ hasTouch: true });

type Point = { x: number; y: number };

async function dispatchPinch(
  page: Page,
  center: Point,
  fromSpread: number,
  toSpread: number,
  steps: number
) {
  const cdp = await page.context().newCDPSession(page);
  const points = (spread: number) => [
    { x: center.x - spread / 2, y: center.y, id: 0 },
    { x: center.x + spread / 2, y: center.y, id: 1 }
  ];

  // Two fingers land together: the first is recorded by the viewport engine,
  // the second promotes the gesture to a pinch.
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points(fromSpread)
  });

  for (let step = 1; step <= steps; step += 1) {
    const spread = fromSpread + ((toSpread - fromSpread) * step) / steps;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(spread)
    });
  }

  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function touchTap(page: Page, x: number, y: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 0 }]
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function viewBoxWidth(page: Page) {
  const svg = page.locator("svg.elevation-svg").first();
  const viewBox = await svg.getAttribute("viewBox");
  if (!viewBox) throw new Error("Elevation svg has no viewBox.");
  return Number(viewBox.split(/\s+/)[2]);
}

test("trusted two-finger pinch zooms the elevation viewport", async ({ page }) => {
  await gotoApp(page);
  await switchView(page, "Elevation");
  const svg = page.locator("svg.elevation-svg").first();
  await expect(svg).toBeVisible();

  const box = await svg.boundingBox();
  if (!box) throw new Error("Elevation svg has no bounding box.");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  const startWidth = await viewBoxWidth(page);
  // Spread the fingers apart to zoom in; the viewBox width should shrink.
  await dispatchPinch(page, center, 80, 400, 8);

  await expect
    .poll(() => viewBoxWidth(page), { timeout: 4000 })
    .toBeLessThan(startWidth);
});

test("pinch during an in-flight measurement clears it and pinches, Measure stays armed", async ({
  page
}) => {
  await gotoApp(page);
  await switchView(page, "Elevation");
  const svg = page.locator("svg.elevation-svg").first();
  await expect(svg).toBeVisible();

  await page.keyboard.press("m");
  const measure = page.getByRole("button", { name: "Measure", exact: true });
  await expect(measure).toHaveAttribute("aria-pressed", "true");

  const box = await svg.boundingBox();
  if (!box) throw new Error("Elevation svg has no bounding box.");

  // Begin a measurement well away from where the pinch will land so the pinch's
  // first finger falls on the bare wall, not the measurement overlay.
  const tap = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.4 };
  await touchTap(page, tap.x, tap.y);
  const measurementGroup = page.getByRole("group", { name: /^Measurement,/ });
  await expect(measurementGroup).toBeVisible();

  const startWidth = await viewBoxWidth(page);
  const center = { x: box.x + box.width * 0.65, y: box.y + box.height * 0.6 };
  await dispatchPinch(page, center, 80, 420, 8);

  // 1 + 2. The second touch claimed the viewport and cleared the in-progress
  // measurement — no lingering group and no bogus completed measurement.
  await expect(measurementGroup).toHaveCount(0);
  // 3. Measure remains armed.
  await expect(measure).toHaveAttribute("aria-pressed", "true");
  // 4. The viewport pinched.
  await expect
    .poll(() => viewBoxWidth(page), { timeout: 4000 })
    .toBeLessThan(startWidth);
});
