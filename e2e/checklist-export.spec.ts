import { readFile } from "node:fs/promises";
import { addArtwork, expect, gotoApp, test } from "./fixtures";

test("downloads the checklist as PDF and Excel through the shared dialog", async ({ page }) => {
  await gotoApp(page);
  await addArtwork(page);

  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: /Export checklist/ }).click();

  const dialog = page.getByRole("dialog", { name: "Export checklist" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Downloads a single \.pdf file/)).toBeVisible();

  const pdfDownloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export checklist" }).click();
  const pdfDownload = await pdfDownloadPromise;
  expect(pdfDownload.suggestedFilename()).toMatch(/-checklist\.pdf$/);
  const pdfPath = await pdfDownload.path();
  expect(pdfPath).not.toBeNull();
  expect((await readFile(pdfPath!)).subarray(0, 5).toString("ascii")).toBe("%PDF-");

  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: /Export checklist/ }).click();
  await dialog.getByRole("combobox", { name: "Format" }).click();
  await page.getByRole("option", { name: "Excel (.xlsx)" }).click();
  await dialog.getByRole("combobox", { name: "Images" }).click();
  await page.getByRole("option", { name: "No images" }).click();
  await expect(dialog.getByText(/Downloads a single \.xlsx file/)).toBeVisible();

  const xlsxDownloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export checklist" }).click();
  const xlsxDownload = await xlsxDownloadPromise;
  expect(xlsxDownload.suggestedFilename()).toMatch(/-checklist\.xlsx$/);
  const xlsxPath = await xlsxDownload.path();
  expect(xlsxPath).not.toBeNull();
  expect((await readFile(xlsxPath!)).subarray(0, 2).toString("ascii")).toBe("PK");
});
