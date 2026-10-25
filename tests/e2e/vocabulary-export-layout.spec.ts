import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const longTerm = "Vocabulary".repeat(18);

async function seedLongWord(page: Page) {
  await page.goto("/vocabulary");
  await expect(page.getByRole("button", { name: "Add a word", exact: true })).toBeVisible();
  await page.evaluate((term) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("folio-reading", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("vocabulary", "readwrite");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
      tx.objectStore("vocabulary").put({
        id: "layout-long-word", term, meaning: "Một cụm từ dài để kiểm tra cách xuống dòng trên màn hình nhỏ.",
        context: "A long phrase should remain readable while choosing words to export.",
        documentId: "", documentTitle: "Added by you", page: 0, createdAt: 1
      });
    };
  }), longTerm);
  await page.reload();
  await expect(page.locator(".word-card")).toHaveCount(1);
}

async function expectCollectionFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(".word-card").evaluate((card) => card.scrollWidth <= card.clientWidth)).toBe(true);
  await expect(page.getByRole("checkbox", { name: `Select ${longTerm}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Edit ${longTerm}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Delete ${longTerm}`, exact: true })).toBeVisible();
}

async function openExportAndCheckFit(page: Page) {
  await page.getByRole("button", { name: "Export Vocabulary", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export Vocabulary", exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && element.scrollWidth <= element.clientWidth;
  })).toBe(true);
  await dialog.getByRole("radio", { name: "Export Selected", exact: true }).check();
  await expect(dialog.getByRole("button", { name: "Download file", exact: true })).toBeDisabled();
  await expect(dialog.getByText(/select at least one/i)).toBeVisible();
  await dialog.getByRole("radio", { name: "Export All", exact: true }).check();
  await expect(dialog.getByRole("button", { name: "Download file", exact: true })).toBeEnabled();
  return dialog;
}

for (const width of [320, 390, 1280]) {
  test(`vocabulary selection and export fit a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    await seedLongWord(page);
    await expectCollectionFits(page);
    await mkdir(".artifacts", { recursive: true });
    const label = width === 1280 ? "desktop" : width === 390 ? "mobile" : "mobile-320";
    await page.screenshot({ path: `.artifacts/export-${label}-collection.png`, fullPage: true });
    const dialog = await openExportAndCheckFit(page);
    await page.screenshot({ path: `.artifacts/export-${label}.png`, fullPage: true });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    if (width === 1280) {
      await page.goto("/settings");
      await page.getByRole("button", { name: /^Dark/ }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await page.goto("/vocabulary");
      await expectCollectionFits(page);
      await openExportAndCheckFit(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await page.screenshot({ path: ".artifacts/export-desktop-dark.png", fullPage: true });
    }
  });
}
