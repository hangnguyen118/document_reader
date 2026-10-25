import { expect, test, type Page } from "@playwright/test";
import type { VocabularyItem } from "../../lib/types";

function pagination(page: Page) {
  return page.getByRole("navigation", { name: "Vocabulary pagination", exact: true });
}

function vocabulary(count: number): VocabularyItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `vocabulary-pagination-${index + 1}`, term: `Term-${String(index + 1).padStart(4, "0")}`,
    meaning: index === 1 ? "Deep hidden meaning" : `Saved meaning ${index + 1}`, context: "",
    documentId: "", documentTitle: index === 0 ? "Hidden source name" : "Added by you",
    page: 0, createdAt: 1_700_000_000_000 + index
  }));
}

async function seedWords(page: Page, records: VocabularyItem[]) {
  await page.goto("/vocabulary");
  await expect(page.getByRole("button", { name: "Add a word", exact: true })).toBeVisible();
  await page.evaluate((records) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("folio-reading", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("vocabulary", "readwrite");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
      for (const record of records) tx.objectStore("vocabulary").put(record);
    };
  }), records);
  await page.reload();
  await expect(page.locator(".word-card")).toHaveCount(Math.min(12, records.length));
}

async function addWord(page: Page, term: string) {
  await page.getByRole("button", { name: "Add a word", exact: true }).click();
  await page.getByLabel("English word or phrase", { exact: true }).fill(term);
  await page.getByLabel("Vietnamese meaning", { exact: true }).fill(`Meaning of ${term}`);
  await page.getByRole("button", { name: "Save word", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}

test("vocabulary shows twelve words per page and every saved word is reachable in order", async ({ page }) => {
  const records = vocabulary(30);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seedWords(page, records);
  const nav = pagination(page);
  await expect(nav.getByLabel("Words per page", { exact: true })).toHaveValue("12");
  await expect(nav.getByRole("status")).toHaveText("Showing 1–12 of 30 words. Page 1 of 3.");
  await expect(nav.getByRole("button", { name: "Previous page", exact: true })).toBeDisabled();
  const terms: string[] = [];
  for (let number = 1; number <= 3; number++) {
    await expect(nav.getByRole("button", { name: `Page ${number}`, exact: true })).toHaveAttribute("aria-current", "page");
    terms.push(...await page.locator(".word-card h2").allTextContents());
    if (number < 3) await nav.getByRole("button", { name: "Next page", exact: true }).click();
  }
  expect(terms).toEqual(records.slice().reverse().map((word) => word.term));
  expect(new Set(terms).size).toBe(30);
  await expect(page.locator(".word-card")).toHaveCount(6);
  await expect(nav.getByRole("status")).toHaveText("Showing 25–30 of 30 words. Page 3 of 3.");
  await expect(nav.getByRole("button", { name: "Next page", exact: true })).toBeDisabled();
  await nav.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(nav.getByRole("status")).toHaveText("Showing 13–24 of 30 words. Page 2 of 3.");
  await nav.getByRole("button", { name: "Page 1", exact: true }).click();
  await expect(page.locator(".word-card h2")).toHaveText(records.slice().reverse().slice(0, 12).map((word) => word.term));
  expect(errors).toEqual([]);
});

test("search covers all saved terms, meanings and sources and page size changes restart at page one", async ({ page }) => {
  const records = vocabulary(30);
  await seedWords(page, records);
  const nav = pagination(page);
  const search = page.getByLabel("Search vocabulary", { exact: true });
  await nav.getByRole("button", { name: "Page 3", exact: true }).click();
  for (const [query, term] of [[records[0].term, records[0].term], ["Deep hidden meaning", records[1].term], ["Hidden source name", records[0].term]]) {
    await search.fill(query);
    await expect(page.locator(".word-card h2")).toHaveText(term);
    await expect(nav.getByRole("status")).toHaveText("Showing 1–1 of 1 word. Page 1 of 1.");
  }
  await search.fill("");
  await expect(nav.getByRole("button", { name: "Page 1", exact: true })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("button", { name: "Page 3", exact: true }).click();
  await nav.getByLabel("Words per page", { exact: true }).selectOption("24");
  await expect(page.locator(".word-card")).toHaveCount(24);
  await expect(nav.getByRole("status")).toHaveText("Showing 1–24 of 30 words. Page 1 of 2.");
  await nav.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator(".word-card")).toHaveCount(6);
  await nav.getByLabel("Words per page", { exact: true }).selectOption("48");
  await expect(page.locator(".word-card")).toHaveCount(30);
  await expect(nav.getByRole("status")).toHaveText("Showing 1–30 of 30 words. Page 1 of 1.");
  await expect(nav.getByRole("button", { name: "Next page", exact: true })).not.toBeVisible();
  await nav.getByLabel("Words per page", { exact: true }).selectOption("12");
  await expect(page.locator(".word-card")).toHaveCount(12);
  await expect(nav.getByRole("button", { name: "Page 1", exact: true })).toHaveAttribute("aria-current", "page");
});

test("adding across the page boundary and deleting the final page keep the stored current page valid", async ({ page }) => {
  const records = vocabulary(12);
  await seedWords(page, records);
  const nav = pagination(page);
  await expect(nav.getByRole("status")).toHaveText("Showing 1–12 of 12 words. Page 1 of 1.");
  await addWord(page, "Boundary word");
  await expect(nav.getByRole("status")).toHaveText("Showing 1–12 of 13 words. Page 1 of 2.");
  await nav.getByRole("button", { name: "Page 2", exact: true }).click();
  await expect(page.locator(".word-card h2")).toHaveText(records[0].term);
  await page.getByRole("button", { name: `Delete ${records[0].term}`, exact: true }).click();
  await expect(page.locator(".word-card")).toHaveCount(12);
  await expect(nav.getByRole("status")).toHaveText("Showing 1–12 of 12 words. Page 1 of 1.");
  await addWord(page, "New after clamp");
  await expect(nav.getByRole("button", { name: "Page 1", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".word-card h2").first()).toHaveText("New after clamp");
  await nav.getByRole("button", { name: "Page 2", exact: true }).click();
  await expect(page.locator(".word-card h2")).toHaveText(records[1].term);
  await page.reload();
  await expect(nav.getByRole("status")).toHaveText("Showing 1–12 of 13 words. Page 1 of 2.");
  await page.getByLabel("Search vocabulary", { exact: true }).fill(records[0].term);
  await expect(page.locator(".word-card")).toHaveCount(0);
});

test("selection persists across pages, searches and page sizes while Select All includes the whole collection", async ({ page }) => {
  const records = vocabulary(30);
  await seedWords(page, records);
  const nav = pagination(page);
  const selected = (index: number) => page.getByRole("checkbox", { name: `Select ${records[index].term}`, exact: true });
  await selected(29).check();
  await nav.getByRole("button", { name: "Page 3", exact: true }).click();
  await selected(0).check();
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
  await page.getByLabel("Search vocabulary", { exact: true }).fill(records[0].term);
  await expect(selected(0)).toBeChecked();
  await nav.getByLabel("Words per page", { exact: true }).selectOption("24");
  await page.getByLabel("Search vocabulary", { exact: true }).fill("");
  await expect(selected(29)).toBeChecked();
  await nav.getByRole("button", { name: "Page 2", exact: true }).click();
  await expect(selected(0)).toBeChecked();
  await nav.getByLabel("Words per page", { exact: true }).selectOption("48");
  await expect(selected(0)).toBeChecked();
  await expect(selected(29)).toBeChecked();
  await page.getByLabel("Search vocabulary", { exact: true }).fill(records[0].term);
  const all = page.getByRole("checkbox", { name: "Select all vocabulary", exact: true });
  await all.check();
  await expect(page.getByText("30 selected", { exact: true })).toBeVisible();
  await page.getByLabel("Search vocabulary", { exact: true }).fill("");
  for (const word of records) await expect(page.getByRole("checkbox", { name: `Select ${word.term}`, exact: true })).toBeChecked();
  await selected(29).uncheck();
  await expect(page.getByText("29 selected", { exact: true })).toBeVisible();
  expect(await all.evaluate((input) => (input as HTMLInputElement).indeterminate)).toBe(true);
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
  await expect(all).not.toBeChecked();
});

test("empty, single-word and no-match lists retain usable page size controls", async ({ page }) => {
  await seedWords(page, []);
  const nav = pagination(page);
  await expect(nav.getByRole("status")).toHaveText("No vocabulary to display.");
  await expect(nav.getByLabel("Words per page", { exact: true })).toHaveValue("12");
  await expect(nav.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Select all vocabulary", exact: true })).toBeDisabled();
  await addWord(page, "Only word");
  await expect(page.locator(".word-card")).toHaveCount(1);
  await expect(nav.getByRole("status")).toHaveText("Showing 1–1 of 1 word. Page 1 of 1.");
  await nav.getByLabel("Words per page", { exact: true }).selectOption("24");
  await page.getByLabel("Search vocabulary", { exact: true }).fill("Nothing matches");
  await expect(page.getByRole("heading", { name: "No matching words.", exact: true })).toBeVisible();
  await expect(nav.getByRole("status")).toHaveText("No vocabulary to display.");
  await expect(nav.getByLabel("Words per page", { exact: true })).toHaveValue("24");
  await page.getByLabel("Search vocabulary", { exact: true }).fill("");
  await page.getByRole("button", { name: "Delete Only word", exact: true }).click();
  await expect(nav.getByRole("status")).toHaveText("No vocabulary to display.");
  await expect(nav.getByLabel("Words per page", { exact: true })).toHaveValue("24");
  await expect(page.getByRole("heading", { name: "Every collection begins with one word.", exact: true })).toBeVisible();
});

test("a hundred pages support direct jumps and bounded navigation on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const records = vocabulary(1200);
  await seedWords(page, records);
  const nav = pagination(page);
  const goTo = nav.getByLabel("Go to vocabulary page", { exact: true });
  await expect(goTo.locator("option")).toHaveCount(100);
  await goTo.selectOption("50");
  await expect(nav.getByRole("status")).toHaveText("Showing 589–600 of 1200 words. Page 50 of 100.");
  await expect(page.locator(".word-card h2").first()).toHaveText(records[611].term);
  expect(await nav.getByRole("button", { name: /^Page \d+$/ }).count()).toBeLessThanOrEqual(7);
  await nav.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(goTo).toHaveValue("49");
  await nav.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(goTo).toHaveValue("50");
  await goTo.selectOption("100");
  await expect(page.locator(".word-card h2")).toHaveText(records.slice(0, 12).reverse().map((word) => word.term));
  await expect(nav.getByRole("status")).toHaveText("Showing 1189–1200 of 1200 words. Page 100 of 100.");
  await expect(nav.getByRole("button", { name: "Next page", exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await nav.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await nav.getByRole("button", { name: "Page 1", exact: true }).click();
  await expect(goTo).toHaveValue("1");
  await expect(nav.getByRole("button", { name: "Previous page", exact: true })).toBeDisabled();
  await nav.getByLabel("Words per page", { exact: true }).selectOption("48");
  await expect(page.locator(".word-card")).toHaveCount(48);
  await expect(goTo.locator("option")).toHaveCount(25);
  await expect(goTo).toHaveValue("1");
});
