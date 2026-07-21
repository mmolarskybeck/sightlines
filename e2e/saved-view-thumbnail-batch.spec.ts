import { expect, test } from "./fixtures";

test("reuses one offscreen canvas across a Saved-view thumbnail batch", async ({
  page
}) => {
  await page.goto("/?benchmark=renderer");
  await expect(page.locator(".app-main")).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(1, { timeout: 15_000 });

  const noThanks = page.getByRole("button", { name: "No thanks" });
  if (await noThanks.count()) await noThanks.click();

  await page.getByRole("button", { name: "Show saved views" }).click();
  await expect(page.getByRole("heading", { name: "Saved views" })).toBeVisible();

  await page.evaluate(() => {
    const samples: number[] = [document.querySelectorAll("canvas").length];
    const observer = new MutationObserver(() => {
      samples.push(document.querySelectorAll("canvas").length);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    (
      window as typeof window & {
        __savedViewCanvasProbe?: {
          samples: number[];
          stop: () => void;
        };
      }
    ).__savedViewCanvasProbe = {
      samples,
      stop: () => observer.disconnect()
    };
  });

  const saveView = page.getByRole("button", { name: "Save view", exact: true });
  for (let index = 0; index < 6; index += 1) await saveView.click();

  const thumbnails = page.locator("img.saved-view-thumbnail");
  await expect(thumbnails).toHaveCount(6, { timeout: 20_000 });
  await expect(page.locator("canvas")).toHaveCount(1, { timeout: 10_000 });

  const probe = await page.evaluate(() => {
    const value = (
      window as typeof window & {
        __savedViewCanvasProbe?: {
          samples: number[];
          stop: () => void;
        };
      }
    ).__savedViewCanvasProbe;
    value?.stop();
    return {
      samples: value?.samples ?? [],
      naturalSize: {
        width: document.querySelector<HTMLImageElement>("img.saved-view-thumbnail")
          ?.naturalWidth,
        height: document.querySelector<HTMLImageElement>("img.saved-view-thumbnail")
          ?.naturalHeight
      }
    };
  });

  expect(Math.max(...probe.samples)).toBe(2);
  expect(probe.samples.filter((count) => count === 2).length).toBeGreaterThan(1);
  expect(probe.samples.every((count) => count === 1 || count === 2)).toBe(true);
  expect(probe.naturalSize).toEqual({ width: 296, height: 184 });
});
