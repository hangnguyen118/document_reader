import { expect, test, type Page } from "@playwright/test";
import type { ReadingDocument } from "../../lib/types";

function pagination(page: Page) {
  return page.getByRole("navigation", { name: "Document pagination", exact: true });
}

function documents(count: number, uploaded: boolean, favorite = false): ReadingDocument[] {
  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    const shelf = uploaded ? "Uploaded" : "Curated";
    return {
      id: `pagination-${shelf.toLowerCase()}-${number}`, title: `${shelf} ${number}`,
      type: "TXT", author: "Pagination test", description: `${shelf} reading fixture.`,
      category: `${shelf} shelf`, pages: [`The content of ${shelf} ${number}.`], wordCount: 7,
      uploaded, favorite, currentPage: 0, createdAt: Date.UTC(2030, 0, 1) + (uploaded ? 1000 : 0) + index,
      lastReadAt: null, cover: "sage"
    };
  });
}

async function seedLibrary(page: Page, records: ReadingDocument[]) {
  await page.goto("/");
  await expect(page.locator(".document-card")).toHaveCount(4);
  await page.evaluate((records) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("folio-reading", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("documents", "readwrite");
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
      for (const record of records) transaction.objectStore("documents").put(record);
    };
  }), records);
  await page.reload();
  await expect(page.locator(".document-card")).toHaveCount(Math.min(12, records.length + 4));
}

for (const { tab, total, lastPageCount } of [
  { tab: "All documents", total: 30, lastPageCount: 6 },
  { tab: "Folio readings", total: 17, lastPageCount: 5 },
  { tab: "My uploads", total: 13, lastPageCount: 1 }
]) {
  test(`${tab} displays only the selected page and makes every document reachable`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await seedLibrary(page, [...documents(13, false), ...documents(13, true)]);
    await page.getByRole("button", { name: new RegExp(`^${tab}`) }).click();
    const nav = pagination(page);
    await expect(page.locator(".document-card")).toHaveCount(12);
    await expect(nav.getByRole("status")).toHaveText(`Showing 1–12 of ${total} documents`);
    await expect(nav.getByRole("button", { name: "Previous page", exact: true })).toBeDisabled();
    await expect(nav.getByRole("button", { name: "Page 1", exact: true })).toHaveAttribute("aria-current", "page");

    const lastPage = Math.ceil(total / 12);
    await nav.getByRole("button", { name: `Page ${lastPage}`, exact: true }).click();
    await expect(page.locator(".document-card")).toHaveCount(lastPageCount);
    await expect(nav.getByRole("status")).toHaveText(`Showing ${(lastPage - 1) * 12 + 1}–${total} of ${total} documents`);
    await expect(nav.getByRole("button", { name: "Next page", exact: true })).toBeDisabled();
    await nav.getByRole("button", { name: "Previous page", exact: true }).click();
    await expect(nav.getByRole("button", { name: `Page ${lastPage - 1}`, exact: true })).toHaveAttribute("aria-current", "page");
    if (lastPage > 2) await nav.getByRole("button", { name: "Page 1", exact: true }).click();

    const titles: string[] = [];
    for (let number = 1; number <= lastPage; number++) {
      await expect(nav.getByRole("button", { name: `Page ${number}`, exact: true })).toHaveAttribute("aria-current", "page");
      titles.push(...await page.locator(".document-title").allTextContents());
      if (number < lastPage) await nav.getByRole("button", { name: "Next page", exact: true }).click();
    }
    expect(titles).toHaveLength(total);
    expect(new Set(titles).size).toBe(total);
    const uploadedTitles = documents(13, true).map((document) => document.title);
    const curatedTitles = documents(13, false).map((document) => document.title);
    for (const title of tab === "My uploads" ? uploadedTitles : tab === "Folio readings" ? curatedTitles : [...uploadedTitles, ...curatedTitles]) {
      expect(titles).toContain(title);
    }
    if (tab === "My uploads") expect(titles.every((title) => title.startsWith("Uploaded "))).toBe(true);
    if (tab === "Folio readings") expect(titles.some((title) => title.startsWith("Uploaded "))).toBe(false);
    expect(errors).toEqual([]);
  });
}

test("search, sort and shelf changes restart at the first page of the complete matching list", async ({ page }) => {
  await seedLibrary(page, [...documents(13, false), ...documents(13, true)]);
  const nav = pagination(page);
  await nav.getByRole("button", { name: "Page 3", exact: true }).click();
  await page.getByLabel("Search documents", { exact: true }).fill("Uploaded");
  await expect(nav.getByRole("button", { name: "Page 1", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".document-title").first()).toHaveText("Uploaded 13");
  await nav.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator(".document-title")).toHaveText("Uploaded 01");

  await page.getByLabel("Sort documents", { exact: true }).selectOption("title");
  await expect(nav.getByRole("button", { name: "Page 1", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".document-title")).toHaveText(documents(12, true).map((document) => document.title));
  await nav.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator(".document-title")).toHaveText("Uploaded 13");

  await page.getByLabel("Search documents", { exact: true }).fill("");
  await expect(nav.getByRole("button", { name: "Page 1", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".document-title").first()).toHaveText("A quieter kind of morning");
  await nav.getByRole("button", { name: "Page 2", exact: true }).click();
  await page.getByRole("button", { name: "Folio readings", exact: true }).click();
  await expect(nav.getByRole("button", { name: "Page 1", exact: true })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("button", { name: "Next page", exact: true }).click();
  await page.getByRole("button", { name: "My uploads", exact: true }).click();
  await expect(nav.getByRole("button", { name: "Page 1", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".document-title").first()).toHaveText("Uploaded 01");

  await nav.getByRole("button", { name: "Next page", exact: true }).click();
  await page.getByLabel("Search documents", { exact: true }).fill("No document matches this phrase");
  await expect(page.locator(".document-card")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Nothing on this shelf yet.", exact: true })).toBeVisible();
  await expect(nav).not.toBeVisible();
  await page.getByLabel("Search documents", { exact: true }).fill("Uploaded 01");
  await expect(page.locator(".document-title")).toHaveText("Uploaded 01");
  await expect(nav).not.toBeVisible();
});

test("deleting the last book on the last page returns to a valid page even after another upload", async ({ page }) => {
  await seedLibrary(page, documents(13, true));
  await page.getByRole("button", { name: "My uploads", exact: true }).click();
  await page.getByLabel("Sort documents", { exact: true }).selectOption("title");
  const nav = pagination(page);
  await nav.getByRole("button", { name: "Page 2", exact: true }).click();
  await expect(page.locator(".document-title")).toHaveText("Uploaded 13");
  await page.getByRole("button", { name: "Delete Uploaded 13", exact: true }).click();
  await page.getByRole("dialog", { name: "Remove document?", exact: true }).getByRole("button", { name: "Remove document", exact: true }).click();
  await expect(page.locator(".document-card")).toHaveCount(12);
  await expect(nav).not.toBeVisible();

  await page.getByLabel("Upload documents", { exact: true }).setInputFiles({ name: "uploaded-14.txt", mimeType: "text/plain", buffer: Buffer.from("A new document after deleting the previous final page.") });
  await expect(nav.getByRole("button", { name: "Page 1", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".document-card")).toHaveCount(12);
  await nav.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator(".document-title")).toHaveText("uploaded 14");
  await page.reload();
  await page.getByLabel("Search documents", { exact: true }).fill("Uploaded 13");
  await expect(page.locator(".document-card")).toHaveCount(0);
});

test("renaming and removing a favorite on page two preserve the book and keep Favorites on a valid page", async ({ page }) => {
  await seedLibrary(page, documents(13, true, true));
  await page.goto("/favorites");
  await expect(page.locator(".document-card")).toHaveCount(12);
  await page.getByLabel("Sort documents", { exact: true }).selectOption("title");
  const nav = pagination(page);
  await nav.getByRole("button", { name: "Page 2", exact: true }).click();
  await expect(page.locator(".document-title")).toHaveText("Uploaded 13");
  const href = await page.getByRole("link", { name: "Read Uploaded 13", exact: true }).getAttribute("href");
  await page.getByRole("button", { name: "Edit Book Name", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Book Name", exact: true });
  await dialog.getByLabel("Book name", { exact: true }).fill("Uploaded 13 revised");
  await dialog.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".document-title")).toHaveText("Uploaded 13 revised");
  await page.getByRole("button", { name: "Remove Uploaded 13 revised from favorites", exact: true }).click();
  await expect(page.locator(".document-card")).toHaveCount(12);
  await expect(nav).not.toBeVisible();
  await page.reload();
  await expect(page.locator(".document-card")).toHaveCount(12);
  await page.goto("/");
  await page.getByLabel("Search documents", { exact: true }).fill("Uploaded 13 revised");
  await expect(page.locator(".document-title")).toHaveText("Uploaded 13 revised");
  await expect(page.getByRole("link", { name: "Read Uploaded 13 revised", exact: true })).toHaveAttribute("href", href!);
  await expect(page.getByRole("button", { name: "Add Uploaded 13 revised to favorites", exact: true })).toBeVisible();
});

test("empty and single-page shelves gain pagination after a real upload crosses twelve documents", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".document-card")).toHaveCount(4);
  await expect(pagination(page)).not.toBeVisible();
  await page.getByRole("button", { name: "My uploads", exact: true }).click();
  await expect(page.locator(".document-card")).toHaveCount(0);
  await expect(pagination(page)).not.toBeVisible();
  await page.getByLabel("Upload documents", { exact: true }).setInputFiles(Array.from({ length: 12 }, (_, index) => ({
    name: `book-${String(index + 1).padStart(2, "0")}.txt`, mimeType: "text/plain", buffer: Buffer.from(`Reading book ${index + 1}.`)
  })));
  await expect(page.locator(".document-card")).toHaveCount(12);
  await expect(pagination(page)).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Upload document", exact: true })).toBeEnabled();
  await page.getByLabel("Sort documents", { exact: true }).selectOption("title");
  await page.getByLabel("Upload documents", { exact: true }).setInputFiles({ name: "book-13.txt", mimeType: "text/plain", buffer: Buffer.from("The thirteenth book is ready to read.") });
  await expect(pagination(page)).toBeVisible();
  await expect(page.locator(".document-card")).toHaveCount(12);
  await expect(page.locator(".document-title").filter({ hasText: "book 13" })).toHaveCount(0);
  await pagination(page).getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator(".document-title")).toHaveText("book 13");
  await page.getByRole("link", { name: "Read book 13", exact: true }).click();
  await expect(page.getByTestId("reader-text")).toHaveText("The thirteenth book is ready to read.");
});

test("many pages remain usable on a narrow screen without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedLibrary(page, documents(108, true));
  await page.getByRole("button", { name: "My uploads", exact: true }).click();
  const nav = pagination(page);
  await nav.getByRole("button", { name: "Page 9", exact: true }).click();
  await expect(nav.getByRole("button", { name: "Page 9", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".document-card")).toHaveCount(12);
  await expect(nav.getByRole("button", { name: "Next page", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await nav.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  for (let number = 8; number >= 5; number--) {
    await nav.getByRole("button", { name: "Previous page", exact: true }).click();
    await expect(nav.getByRole("button", { name: `Page ${number}`, exact: true })).toHaveAttribute("aria-current", "page");
  }
  await expect(nav.getByRole("status")).toHaveText("Showing 49–60 of 108 documents");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await nav.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await nav.getByRole("button", { name: "Page 1", exact: true }).click();
  await expect(nav.getByRole("button", { name: "Page 1", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("button", { name: "Previous page", exact: true })).toBeDisabled();
  await nav.getByRole("button", { name: "Page 9", exact: true }).click();
  await expect(nav.getByRole("button", { name: "Page 9", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("button", { name: "Next page", exact: true })).toBeDisabled();
});
