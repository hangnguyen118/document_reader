import { expect, test, type Page } from "@playwright/test";
import type { ReadingDocument } from "../../lib/types";

function defaultBooksToggle(page: Page) {
  return page.getByRole("switch", { name: "Show default books", exact: true });
}

function allCount(page: Page) {
  return page.getByRole("button", { name: /^All documents/ }).locator("span");
}

async function openLibrary(page: Page) {
  await page.goto("/");
  await expect(page.locator(".document-card")).toHaveCount(4);
  await expect(defaultBooksToggle(page)).toBeChecked();
}

async function savedReadingData(page: Page) {
  return page.evaluate(() => new Promise<Record<string, unknown[]>>((resolve, reject) => {
    const request = indexedDB.open("folio-reading", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const stores = ["documents", "highlights", "notes", "vocabulary"];
      const tx = db.transaction(stores, "readonly");
      const result: Record<string, unknown[]> = {};
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
      for (const store of stores) {
        const records = tx.objectStore(store).getAll();
        records.onsuccess = () => { result[store] = records.result; };
      }
    };
  }));
}

test("default books start visible and the switch persists across reloads and Library/Favorites", async ({ page }) => {
  await openLibrary(page);
  const titles = await page.locator(".document-title").allTextContents();
  await expect(allCount(page)).toHaveText("4");
  await expect(page.locator(".featured-read")).toBeVisible();

  await defaultBooksToggle(page).uncheck();
  await expect(defaultBooksToggle(page)).not.toBeChecked();
  await expect(page.locator(".document-card")).toHaveCount(0);
  await expect(page.locator(".featured-read")).toHaveCount(0);
  await expect(allCount(page)).toHaveText("0");

  await page.reload();
  await expect(defaultBooksToggle(page)).not.toBeChecked();
  await expect(page.locator(".document-card")).toHaveCount(0);
  await page.goto("/favorites");
  await expect(defaultBooksToggle(page)).not.toBeChecked();
  await defaultBooksToggle(page).check();
  await expect(defaultBooksToggle(page)).toBeChecked();
  await page.goto("/");
  await expect(defaultBooksToggle(page)).toBeChecked();
  await expect(page.locator(".document-title")).toHaveText(titles);
  await expect(allCount(page)).toHaveText("4");
});

test("hiding default books preserves their favorite, progress, notes, highlights and vocabulary", async ({ page }) => {
  await openLibrary(page);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("folio-reading", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["documents", "highlights", "notes", "vocabulary"], "readwrite");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
      const document = tx.objectStore("documents").get("attention");
      document.onsuccess = () => tx.objectStore("documents").put({ ...document.result, favorite: true, currentPage: 1, lastReadAt: Date.UTC(2030, 0, 1) });
      tx.objectStore("notes").put({ id: "default-book-note", documentId: "attention", page: 1, quote: "Reading offers", body: "Keep this thought.", createdAt: 1, updatedAt: 1 });
      tx.objectStore("highlights").put({ id: "default-book-highlight", documentId: "attention", page: 1, start: 0, end: 5, text: "There", color: "yellow", createdAt: 1 });
      tx.objectStore("vocabulary").put({ id: "default-book-word", term: "attention", meaning: "sự chú ý", context: "Reading offers a gentle form of practice.", documentId: "attention", documentTitle: "The art of paying attention", page: 1, createdAt: 1 });
    };
  }));
  await page.reload();
  await expect(page.locator(".featured-read h2")).toHaveText("The art of paying attention");
  const favoriteCount = page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("link", { name: "Favorites", exact: true }).locator(".nav-count");
  await expect(favoriteCount).toHaveText("1");
  const before = await savedReadingData(page);

  await defaultBooksToggle(page).uncheck();
  await expect(page.locator(".document-card")).toHaveCount(0);
  await expect(page.locator(".featured-read")).toHaveCount(0);
  await expect(favoriteCount).toHaveCount(0);
  expect(await savedReadingData(page)).toEqual(before);
  await page.goto("/favorites");
  await expect(defaultBooksToggle(page)).not.toBeChecked();
  await expect(page.locator(".document-card")).toHaveCount(0);
  await defaultBooksToggle(page).check();
  await expect(page.locator(".document-title")).toHaveText("The art of paying attention");
  await expect(favoriteCount).toHaveText("1");
  await expect(page.getByRole("button", { name: "Remove The art of paying attention from favorites", exact: true })).toBeVisible();
  expect(await savedReadingData(page)).toEqual(before);
});

test("a visibility storage failure keeps default books visible and allows a successful retry", async ({ page }) => {
  await openLibrary(page);
  const before = await savedReadingData(page);
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    const scope = window as unknown as { restoreDefaultBooksTransactions: () => void };
    scope.restoreDefaultBooksTransactions = () => { IDBDatabase.prototype.transaction = original; };
    IDBDatabase.prototype.transaction = function (storeNames: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
      const stores = typeof storeNames === "string" ? [storeNames] : Array.from(storeNames);
      if (this.name === "folio-reading" && mode === "readwrite" && stores.includes("settings")) {
        throw new DOMException("Storage is unavailable for this test", "QuotaExceededError");
      }
      return original.call(this, storeNames, mode, options);
    };
  });
  // A failed save intentionally leaves the checked value unchanged.
  await defaultBooksToggle(page).click();
  await expect(page.locator('.storage-error[role="alert"]')).toContainText("Your changes could not be saved on this device.");
  await expect(defaultBooksToggle(page)).toBeChecked();
  await expect(defaultBooksToggle(page)).toBeEnabled();
  await expect(page.locator(".document-card")).toHaveCount(4);
  await expect(allCount(page)).toHaveText("4");
  expect(await savedReadingData(page)).toEqual(before);

  await page.evaluate(() => (window as unknown as { restoreDefaultBooksTransactions: () => void }).restoreDefaultBooksTransactions());
  await defaultBooksToggle(page).uncheck();
  await expect(defaultBooksToggle(page)).not.toBeChecked();
  await expect(page.locator(".document-card")).toHaveCount(0);
  await expect(page.locator('.storage-error[role="alert"]')).toHaveCount(0);
  await page.reload();
  await expect(defaultBooksToggle(page)).not.toBeChecked();
  await expect(page.locator(".document-card")).toHaveCount(0);
  expect(await savedReadingData(page)).toEqual(before);
});

test("uploaded books can still be added, renamed, read, favorited and deleted while defaults are hidden", async ({ page }) => {
  await openLibrary(page);
  await defaultBooksToggle(page).uncheck();
  await expect(page.locator(".document-card")).toHaveCount(0);
  const before = await savedReadingData(page);
  await page.getByLabel("Upload documents", { exact: true }).setInputFiles({
    name: "personal-story.txt", mimeType: "text/plain", buffer: Buffer.from("My own story is still available when default books are hidden.")
  });
  await expect(page.locator(".document-title")).toHaveText("personal story");
  await expect(allCount(page)).toHaveText("1");
  await page.getByRole("button", { name: "Edit Book Name", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Book Name", exact: true });
  await dialog.getByLabel("Book name", { exact: true }).fill("My private story");
  await dialog.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".document-title")).toHaveText("My private story");
  await page.getByRole("button", { name: "Add My private story to favorites", exact: true }).click();
  await page.getByRole("link", { name: "Read My private story", exact: true }).click();
  await expect(page.getByTestId("reader-text")).toHaveText("My own story is still available when default books are hidden.");
  await page.goto("/favorites");
  await expect(defaultBooksToggle(page)).not.toBeChecked();
  await expect(page.locator(".document-title")).toHaveText("My private story");
  await defaultBooksToggle(page).check();
  await expect(page.locator(".document-title")).toHaveText("My private story");
  await defaultBooksToggle(page).uncheck();
  await page.getByRole("button", { name: "Delete My private story", exact: true }).click();
  await page.getByRole("dialog", { name: "Remove document?", exact: true }).getByRole("button", { name: "Remove document", exact: true }).click();
  await expect(page.locator(".document-card")).toHaveCount(0);
  expect(await savedReadingData(page)).toEqual(before);
});

test("toggling defaults keeps pagination, search, sort and upload filters consistent", async ({ page }) => {
  await openLibrary(page);
  const records: ReadingDocument[] = Array.from({ length: 26 }, (_, index) => ({
    id: `toggle-book-${index}`, title: `${index < 13 ? "Uploaded" : "Default"} fixture ${String(index % 13 + 1).padStart(2, "0")}`,
    type: "TXT", author: "Visibility test", description: "A book for checking visible shelf pages.", category: "Test shelf",
    pages: ["The book contents stay saved."], wordCount: 6, uploaded: index < 13, favorite: false,
    currentPage: 0, createdAt: Date.UTC(2030, 0, 1) + index, lastReadAt: null, cover: "sage"
  }));
  await page.evaluate((records) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("folio-reading", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("documents", "readwrite");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
      for (const record of records) tx.objectStore("documents").put(record);
    };
  }), records);
  await page.reload();
  const nav = page.getByRole("navigation", { name: "Document pagination", exact: true });
  await nav.getByRole("button", { name: "Page 3", exact: true }).click();
  await expect(page.locator(".document-card")).toHaveCount(6);
  await defaultBooksToggle(page).uncheck();
  await expect(nav.getByRole("status")).toHaveText("Showing 1–12 of 13 documents");
  await expect(nav.getByRole("button", { name: "Page 1", exact: true })).toHaveAttribute("aria-current", "page");
  expect((await page.locator(".document-title").allTextContents()).every((title) => title.startsWith("Uploaded fixture"))).toBe(true);
  await expect(allCount(page)).toHaveText("13");

  await page.getByLabel("Search documents", { exact: true }).fill("Default fixture");
  await expect(page.locator(".document-card")).toHaveCount(0);
  await page.getByLabel("Search documents", { exact: true }).fill("");
  await page.getByRole("button", { name: "My uploads", exact: true }).click();
  await page.getByLabel("Sort documents", { exact: true }).selectOption("title");
  await expect(page.locator(".document-title").first()).toHaveText("Uploaded fixture 01");
  await nav.getByRole("button", { name: "Page 2", exact: true }).click();
  await expect(page.locator(".document-title")).toHaveText("Uploaded fixture 13");
  await defaultBooksToggle(page).check();
  await expect(nav.getByRole("status")).toHaveText("Showing 1–12 of 13 documents");
  await page.getByRole("button", { name: /^All documents/ }).click();
  await expect(nav.getByRole("status")).toHaveText("Showing 1–12 of 30 documents");
  await expect(allCount(page)).toHaveText("30");
});
