import { expect, test, type Page } from "@playwright/test";
import { selectText, textPDF } from "./helpers";

const firstPage = "A quiet first page leaves room for a new idea.";
const secondPage = "A quiet second page has a story to remember.";

async function uploadBook(page: Page, filename = "original-book.pdf") {
  await page.goto("/");
  await expect(page.locator(".document-card")).toHaveCount(4);
  await page.getByLabel("Upload documents").setInputFiles({
    name: filename, mimeType: "application/pdf", buffer: textPDF([firstPage, secondPage])
  });
  await expect(page.locator(".document-card")).toHaveCount(5);
  const title = filename.replace(/\.pdf$/, "").replace(/[_-]/g, " ");
  const card = page.locator(".document-card").filter({ has: page.getByRole("link", { name: title, exact: true }) });
  const href = await card.getByRole("link", { name: `Read ${title}`, exact: true }).getAttribute("href");
  if (!href) throw new Error("The uploaded book has no reading link");
  return { card, title, href };
}

function renameDialog(page: Page) {
  return page.getByRole("dialog", { name: "Edit Book Name", exact: true });
}

async function saveName(page: Page, value: string) {
  const dialog = renameDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Book name", { exact: true }).fill(value);
  await dialog.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test("an uploaded PDF keeps its edited Unicode name and reading identity after reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".document-card")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Edit Book Name", exact: true })).toHaveCount(0);
  const { card, title, href } = await uploadBook(page);
  await card.getByRole("button", { name: "Edit Book Name", exact: true }).click();
  await expect(renameDialog(page).getByLabel("Book name", { exact: true })).toHaveValue(title);
  const name = "Sách của tôi — Những ngày yên tĩnh";
  await saveName(page, `  ${name}  `);
  await expect(page.locator(".document-title").filter({ hasText: name })).toHaveText(name);
  await expect(page.locator(".document-card").filter({ has: page.getByRole("link", { name, exact: true }) }).locator(".cover-title")).toHaveText(name);

  await page.reload();
  await page.getByLabel("Search documents", { exact: true }).fill(name);
  await expect(page.locator(".document-card")).toHaveCount(1);
  const readingLink = page.getByRole("link", { name: `Read ${name}`, exact: true });
  await expect(readingLink).toHaveAttribute("href", href);
  await readingLink.click();
  await expect(page.locator(".reading-heading h1")).toHaveText(name);
  await expect(page.getByTestId("reader-text")).toHaveText(firstPage);
  await expect(page.getByLabel("Current page", { exact: true }).locator("option")).toHaveCount(2);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByTestId("reader-text")).toHaveText(secondPage);
  await page.reload();
  await expect(page.locator(".reading-heading h1")).toHaveText(name);
  await expect(page.getByTestId("reader-text")).toHaveText(secondPage);
  await expect(page.getByLabel("Current page", { exact: true })).toHaveValue("1");
});

test("renaming from Reader and Favorites preserves progress, saved work and current source names", async ({ page }) => {
  const { card, href } = await uploadBook(page, "reader-book.pdf");
  await card.getByRole("link", { name: "Read reader book", exact: true }).click();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByTestId("reader-text")).toHaveText(secondPage);
  await page.getByRole("button", { name: "Add to favorites", exact: true }).click();
  await selectText(page, "quiet");
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await selectText(page, "story to remember");
  await page.getByRole("button", { name: "Add note about selected text", exact: true }).click();
  await page.getByLabel("Your note", { exact: true }).fill("Keep this thought after renaming.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await selectText(page, "quiet");
  await page.getByRole("button", { name: "Save word", exact: true }).click();
  await page.getByLabel("Vietnamese meaning", { exact: true }).fill("yên tĩnh");
  await page.getByRole("button", { name: "Save word", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();

  await page.getByRole("button", { name: "Edit Book Name", exact: true }).click();
  await saveName(page, "Renamed Reader Book");
  await expect(page.locator(".reading-heading h1")).toHaveText("Renamed Reader Book");
  await expect(page.getByLabel("Current page", { exact: true })).toHaveValue("1");
  await expect(page.locator("mark.text-highlight")).toHaveText("quiet");
  await page.reload();
  await expect(page.getByTestId("reader-text")).toHaveText(secondPage);
  await expect(page.locator("mark.text-highlight")).toHaveText("quiet");
  await expect(page.getByRole("button", { name: "Remove from favorites", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Toggle notebook", exact: true }).click();
  await expect(page.locator(".margin-note")).toContainText("Keep this thought after renaming.");

  await page.goto("/favorites");
  await expect(page.locator(".document-title")).toHaveText("Renamed Reader Book");
  await page.getByRole("button", { name: "Edit Book Name", exact: true }).click();
  const finalName = "Favorite Book Final";
  await saveName(page, finalName);
  await expect(page.locator(".document-title")).toHaveText(finalName);
  await page.reload();
  await expect(page.locator(".document-title")).toHaveText(finalName);

  await page.goto("/notes");
  await expect(page.locator(".note-source").getByRole("link", { name: finalName, exact: true })).toHaveAttribute("href", `${href}?page=2`);
  await expect(page.locator(".note-body")).toHaveText("Keep this thought after renaming.");
  await page.goto("/vocabulary");
  await expect(page.locator(".word-source")).toContainText(finalName);
  await page.getByLabel("Search vocabulary", { exact: true }).fill("Renamed Reader Book");
  await expect(page.locator(".word-card")).toHaveCount(0);
  await page.getByLabel("Search vocabulary", { exact: true }).fill(finalName);
  await expect(page.locator(".word-card")).toHaveCount(1);
  const source = page.locator(".word-source").getByRole("link");
  await expect(source).toHaveAttribute("href", `${href}?page=2`);
  await source.click();
  await expect(page.locator(".reading-heading h1")).toHaveText(finalName);
  await expect(page.getByTestId("reader-text")).toHaveText(secondPage);
});

test("cancelling or submitting invalid names preserves the saved name", async ({ page }) => {
  const { card, title } = await uploadBook(page, "editable.pdf");
  await card.getByRole("button", { name: "Edit Book Name", exact: true }).click();
  let dialog = renameDialog(page);
  await dialog.getByLabel("Book name", { exact: true }).fill("Discard this draft");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(card.locator(".document-title")).toHaveText(title);

  await card.getByRole("button", { name: "Edit Book Name", exact: true }).click();
  dialog = renameDialog(page);
  const input = dialog.getByLabel("Book name", { exact: true });
  await expect(input).toHaveValue(title);
  await expect(input).toHaveAttribute("maxlength", "200");
  await input.fill("   ");
  await dialog.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a book name.");
  await expect(card.locator(".document-title")).toHaveText(title);

  // Exercise submit validation even if the browser's length constraint is bypassed.
  await input.evaluate((element) => element.removeAttribute("maxlength"));
  await input.fill("x".repeat(201));
  await dialog.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("200");
  await expect(card.locator(".document-title")).toHaveText(title);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
});

test("a 200-character unbroken Unicode name stays editable without overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { card, href } = await uploadBook(page, "mobile-book.pdf");
  await card.getByRole("button", { name: "Edit Book Name", exact: true }).click();
  await expect(renameDialog(page).getByLabel("Book name", { exact: true })).toBeFocused();
  const name = "\u0110".repeat(200);
  await saveName(page, name);
  await page.reload();
  const renamedCard = page.locator(".document-card").filter({ has: page.getByRole("link", { name, exact: true }) });
  await expect(renamedCard.locator(".document-title")).toHaveText(name);
  const libraryEdit = renamedCard.getByRole("button", { name: "Edit Book Name", exact: true });
  await libraryEdit.scrollIntoViewIfNeeded();
  await expect(libraryEdit).toBeInViewport();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await renamedCard.getByRole("link", { name: `Read ${name}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.locator(".reading-heading h1")).toHaveText(name);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const readerEdit = page.getByRole("button", { name: "Edit Book Name", exact: true });
  await readerEdit.scrollIntoViewIfNeeded();
  await expect(readerEdit).toBeInViewport();
  await readerEdit.click();
  const input = renameDialog(page).getByLabel("Book name", { exact: true });
  await expect(input).toHaveValue(name);
  await expect(input).toBeFocused();
  await renameDialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".reading-heading h1")).toHaveText(name);
});

test("a storage failure keeps the rename draft and allows a successful retry", async ({ page }) => {
  const { card, title } = await uploadBook(page, "storage-check.pdf");
  await card.getByRole("button", { name: "Edit Book Name", exact: true }).click();
  const dialog = renameDialog(page);
  await dialog.getByLabel("Book name", { exact: true }).fill("A name worth keeping");
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    const scope = window as unknown as { restoreBookNameTransactions: () => void };
    scope.restoreBookNameTransactions = () => { IDBDatabase.prototype.transaction = original; };
    IDBDatabase.prototype.transaction = function (storeNames: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
      const stores = typeof storeNames === "string" ? [storeNames] : Array.from(storeNames);
      if (this.name === "folio-reading" && mode === "readwrite" && stores.includes("documents")) {
        throw new DOMException("Storage is unavailable for this test", "QuotaExceededError");
      }
      return original.call(this, storeNames, mode, options);
    };
  });
  await dialog.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Could not save the book name.");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Book name", { exact: true })).toHaveValue("A name worth keeping");
  await expect(card.locator(".document-title")).toHaveText(title);

  await page.evaluate(() => (window as unknown as { restoreBookNameTransactions: () => void }).restoreBookNameTransactions());
  await dialog.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "A name worth keeping", exact: true })).toBeVisible();
});
