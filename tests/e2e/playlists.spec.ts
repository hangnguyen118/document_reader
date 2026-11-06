import { expect, test, type Page } from "@playwright/test";
import { seedDocuments } from "../../lib/seed";

const firstBook = seedDocuments[0];
const secondBook = seedDocuments[1];

function playlistCard(page: Page, name: string) {
  return page.locator(".playlist-card").filter({ has: page.getByRole("link", { name: `Open playlist ${name}`, exact: true }) });
}

function createDialog(page: Page) {
  return page.getByRole("dialog", { name: "Create playlist", exact: true });
}

async function saveNewPlaylist(page: Page, name: string, description = "") {
  const dialog = createDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Playlist name", { exact: true }).fill(name);
  await dialog.getByLabel("Description (optional)", { exact: true }).fill(description);
  await dialog.getByRole("button", { name: "Create playlist", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

async function createPlaylist(page: Page, name: string, description = "") {
  await page.goto("/playlists");
  await page.getByRole("button", { name: "Create playlist", exact: true }).first().click();
  await saveNewPlaylist(page, name, description);
  await expect(playlistCard(page, name.trim())).toBeVisible();
}

async function openBookPlaylists(page: Page, title: string) {
  const trigger = page.getByRole("button", { name: `Add ${title} to playlist`, exact: true });
  await trigger.click();
  return page.getByRole("group", { name: "Add to playlist", exact: true });
}

async function saveMembership(page: Page, name: string, included = true) {
  const checkbox = page.getByRole("group", { name: "Add to playlist", exact: true }).getByRole("checkbox", { name, exact: true });
  await checkbox.setChecked(included);
  await expect(checkbox).toBeEnabled();
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
}

async function storedData(page: Page) {
  return page.evaluate(() => new Promise<{ documents: string[]; groups: number; items: number }>((resolve, reject) => {
    const request = indexedDB.open("folio-reading");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["documents", "bookGroups", "bookGroupItems"], "readonly");
      const documents = tx.objectStore("documents").getAllKeys();
      const groups = tx.objectStore("bookGroups").count();
      const items = tx.objectStore("bookGroupItems").count();
      tx.oncomplete = () => { db.close(); resolve({ documents: documents.result.map(String).sort(), groups: groups.result, items: items.result }); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}

test("playlist navigation, empty creation, validation and cancellation preserve saved groups", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".document-card")).toHaveCount(seedDocuments.length);
  await page.getByRole("link", { name: "My Playlist", exact: true }).click();
  await expect(page).toHaveURL(/\/playlists$/);
  await expect(page.getByRole("heading", { name: "My Playlist", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("link", { name: "My Playlist", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".playlist-card")).toHaveCount(0);

  await page.getByRole("button", { name: "Create playlist", exact: true }).first().click();
  const dialog = createDialog(page);
  await expect(dialog.getByLabel("Playlist name", { exact: true })).toBeFocused();
  await dialog.getByLabel("Playlist name", { exact: true }).fill("   ");
  await dialog.getByRole("button", { name: "Create playlist", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(page.locator(".playlist-card")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("button", { name: "Create playlist", exact: true }).first().click();
  await saveNewPlaylist(page, "  Quiet reading  ", "  A little room for books.  ");
  const card = playlistCard(page, "Quiet reading");
  await expect(card).toContainText("A little room for books.");
  await expect(card).toContainText("0 books");
  await page.getByRole("button", { name: "Create playlist", exact: true }).first().click();
  await dialog.getByLabel("Playlist name", { exact: true }).fill("quiet READING");
  await dialog.getByRole("button", { name: "Create playlist", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(page.locator(".playlist-card")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await expect(playlistCard(page, "Quiet reading")).toContainText("0 books");
});

test("book popovers create with membership, toggle multiple playlists and persist without duplicate entries", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".document-card")).toHaveCount(seedDocuments.length);
  let popover = await openBookPlaylists(page, firstBook.title);
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "Create new playlist", exact: true }).click();
  await saveNewPlaylist(page, "Everyday learning");
  await expect(page.getByRole("button", { name: `Add ${firstBook.title} to playlist`, exact: true })).toBeFocused();
  await expect(page).toHaveURL(/\/$/);
  popover = await openBookPlaylists(page, firstBook.title);
  await expect(popover.getByRole("checkbox", { name: "Everyday learning", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(popover).not.toBeVisible();

  await createPlaylist(page, "Favorites for later");
  await page.goto("/");
  popover = await openBookPlaylists(page, firstBook.title);
  const later = popover.getByRole("checkbox", { name: "Favorites for later", exact: true });
  await saveMembership(page, "Favorites for later");
  await expect(later).toBeChecked();
  await saveMembership(page, "Favorites for later", false);
  await expect(later).not.toBeChecked();
  await saveMembership(page, "Favorites for later");
  await expect(later).toBeChecked();
  await expect(popover.getByRole("checkbox", { name: "Everyday learning", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await page.reload();
  popover = await openBookPlaylists(page, firstBook.title);
  await expect(popover.getByRole("checkbox", { name: "Everyday learning", exact: true })).toBeChecked();
  await expect(popover.getByRole("checkbox", { name: "Favorites for later", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  expect((await storedData(page)).items).toBe(2);

  await page.goto("/playlists");
  await expect(playlistCard(page, "Everyday learning")).toContainText("1 book");
  await expect(playlistCard(page, "Favorites for later")).toContainText("1 book");
});

test("playlist detail reuses uploaded and Folio books in added order and preserves the reading flow", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await createPlaylist(page, "Mixed sources", "Uploads and Folio readings together.");
  await page.goto("/");
  await page.getByLabel("Upload documents", { exact: true }).setInputFiles({
    name: "personal-playlist-book.txt", mimeType: "text/plain", buffer: Buffer.from("A personal book remains available in the original library.")
  });
  await expect(page.locator(".document-card")).toHaveCount(seedDocuments.length + 1);
  let popover = await openBookPlaylists(page, "personal playlist book");
  await saveMembership(page, "Mixed sources");
  await page.keyboard.press("Escape");
  popover = await openBookPlaylists(page, firstBook.title);
  await saveMembership(page, "Mixed sources");
  await page.keyboard.press("Escape");
  await page.goto("/playlists");
  await playlistCard(page, "Mixed sources").getByRole("link", { name: "Open playlist Mixed sources", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mixed sources", exact: true })).toBeVisible();
  await expect(page.getByText("Uploads and Folio readings together.", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("link", { name: "My Playlist", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".document-title")).toHaveText(["personal playlist book", firstBook.title]);
  const detailURL = page.url();
  await page.reload();
  await expect(page.locator(".document-title")).toHaveText(["personal playlist book", firstBook.title]);
  await page.getByRole("link", { name: "Read personal playlist book", exact: true }).click();
  await expect(page.getByTestId("reader-text")).toHaveText("A personal book remains available in the original library.");
  await page.goto(detailURL);
  await page.getByRole("link", { name: `Read ${firstBook.title}`, exact: true }).click();
  await expect(page.getByTestId("reader-text")).toContainText("particular kind of quiet");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByTestId("reader-text")).toContainText("meaningful change must be dramatic");
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
  await page.goto(detailURL);
  await page.getByRole("link", { name: `Read ${firstBook.title}`, exact: true }).click();
  await expect(page.getByTestId("reader-text")).toContainText("meaningful change must be dramatic");
  expect(errors).toEqual([]);
});

test("editing, removing memberships and deleting playlists keep the original library books", async ({ page }) => {
  await createPlaylist(page, "Before editing", "Original description.");
  await page.goto("/");
  let popover = await openBookPlaylists(page, firstBook.title);
  await saveMembership(page, "Before editing");
  await page.keyboard.press("Escape");
  popover = await openBookPlaylists(page, secondBook.title);
  await saveMembership(page, "Before editing");
  await page.keyboard.press("Escape");
  const before = await storedData(page);
  await page.goto("/playlists");
  await playlistCard(page, "Before editing").getByRole("button", { name: "Manage Before editing", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit playlist", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit playlist", exact: true });
  await edit.getByLabel("Playlist name", { exact: true }).fill("After editing");
  await edit.getByLabel("Description (optional)", { exact: true }).fill("Updated description.");
  await edit.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(edit).not.toBeVisible();
  await expect(playlistCard(page, "After editing")).toContainText("Updated description.");
  await playlistCard(page, "After editing").getByRole("link", { name: "Open playlist After editing", exact: true }).click();
  await page.getByRole("button", { name: `Remove ${firstBook.title} from playlist`, exact: true }).click();
  await expect(page.locator(".document-title")).toHaveText([secondBook.title]);
  await page.getByRole("button", { name: `Remove ${secondBook.title} from playlist`, exact: true }).click();
  await expect(page.locator(".document-card")).toHaveCount(0);
  expect((await storedData(page)).documents).toEqual(before.documents);
  await page.reload();
  await expect(page.locator(".document-card")).toHaveCount(0);
  await page.goto("/");
  popover = await openBookPlaylists(page, firstBook.title);
  await saveMembership(page, "After editing");
  await page.keyboard.press("Escape");
  await page.goto("/playlists");
  const card = playlistCard(page, "After editing");
  await expect(card).toContainText("1 book");
  await card.getByRole("button", { name: "Manage After editing", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete playlist", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Delete playlist?", exact: true });
  await expect(confirmation).toContainText(/books/i);
  await confirmation.getByRole("button", { name: "Keep playlist", exact: true }).click();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Manage After editing", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete playlist", exact: true }).click();
  await confirmation.getByRole("button", { name: "Delete playlist", exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(page.locator(".playlist-card")).toHaveCount(0);
  expect(await storedData(page)).toEqual({ documents: before.documents, groups: 0, items: 0 });
  await page.goto("/");
  await expect(page.locator(".document-card")).toHaveCount(seedDocuments.length);
});

test("a playlist storage error keeps the draft and permits retry without partial creation", async ({ page }) => {
  await page.goto("/playlists");
  await page.getByRole("button", { name: "Create playlist", exact: true }).first().click();
  const dialog = createDialog(page);
  await dialog.getByLabel("Playlist name", { exact: true }).fill("Retry this playlist");
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    (window as unknown as { restorePlaylistTransactions: () => void }).restorePlaylistTransactions = () => { IDBDatabase.prototype.transaction = original; };
    IDBDatabase.prototype.transaction = function (storeNames: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
      const stores = typeof storeNames === "string" ? [storeNames] : Array.from(storeNames);
      if (this.name === "folio-reading" && mode === "readwrite" && stores.includes("bookGroups")) throw new DOMException("Storage unavailable for test", "QuotaExceededError");
      return original.call(this, storeNames, mode, options);
    };
  });
  await dialog.getByRole("button", { name: "Create playlist", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Playlist name", { exact: true })).toHaveValue("Retry this playlist");
  await expect(page.locator(".playlist-card")).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { restorePlaylistTransactions: () => void }).restorePlaylistTransactions());
  await dialog.getByRole("button", { name: "Create playlist", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(playlistCard(page, "Retry this playlist")).toBeVisible();
  await page.reload();
  await expect(page.locator(".playlist-card")).toHaveCount(1);
});

test("a failed membership near the mobile viewport bottom rolls back and keeps the popover usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await createPlaylist(page, "Retry membership");
  await page.goto("/");
  await expect(page.locator(".document-card")).toHaveCount(seedDocuments.length);
  const trigger = page.getByRole("button", { name: `Add ${firstBook.title} to playlist`, exact: true });
  // Keep the trigger close to the lower edge so a growing error cannot fit below it.
  await trigger.evaluate((button) => {
    window.scrollBy(0, button.getBoundingClientRect().bottom - window.innerHeight + 24);
  });
  await expect.poll(() => trigger.evaluate((button) => window.innerHeight - button.getBoundingClientRect().bottom)).toBeLessThan(40);
  await trigger.click();
  const popover = page.getByRole("group", { name: "Add to playlist", exact: true });
  const checkbox = popover.getByRole("checkbox", { name: "Retry membership", exact: true });
  await expect(checkbox).not.toBeChecked();
  const originalHeight = await popover.evaluate((panel) => panel.getBoundingClientRect().height);

  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    (window as unknown as { restorePlaylistMembershipWrites: () => void }).restorePlaylistMembershipWrites = () => { IDBObjectStore.prototype.add = original; };
    IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
      if (this.name === "bookGroupItems") throw new DOMException("Storage unavailable for test", "QuotaExceededError");
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
  await checkbox.click();
  await expect(popover.getByRole("alert")).toHaveText("Could not update this playlist. Please try again.");
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toBeEnabled();
  expect((await storedData(page)).items).toBe(0);
  await expect.poll(() => popover.evaluate((panel) => panel.getBoundingClientRect().height)).toBeGreaterThan(originalHeight);
  await expect.poll(() => popover.evaluate((panel) => {
    const bounds = panel.getBoundingClientRect();
    return bounds.left >= 11 && bounds.top >= 11 && bounds.right <= window.innerWidth - 11 && bounds.bottom <= window.innerHeight - 11;
  })).toBe(true);

  await page.evaluate(() => (window as unknown as { restorePlaylistMembershipWrites: () => void }).restorePlaylistMembershipWrites());
  await saveMembership(page, "Retry membership");
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeEnabled();
  await expect(popover.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
  expect((await storedData(page)).items).toBe(1);
  await page.keyboard.press("Escape");
  await expect(popover).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.reload();
  await trigger.click();
  await expect(page.getByRole("group", { name: "Add to playlist", exact: true }).getByRole("checkbox", { name: "Retry membership", exact: true })).toBeChecked();
});

test("missing book references and missing playlists render without crashing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await createPlaylist(page, "A missing book");
  const href = await playlistCard(page, "A missing book").getByRole("link", { name: "Open playlist A missing book", exact: true }).getAttribute("href");
  if (!href) throw new Error("Missing playlist detail link");
  const groupId = decodeURIComponent(href.split("/").at(-1)!);
  await page.evaluate((groupId) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("folio-reading");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("bookGroupItems", "readwrite");
      tx.objectStore("bookGroupItems").put({ id: "missing-reference", groupId, bookId: "no-such-book", addedAt: Date.now(), order: 0 });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), groupId);
  await page.reload();
  await expect(playlistCard(page, "A missing book")).toContainText("0 books");
  await page.goto(href);
  await expect(page.getByRole("heading", { name: "A missing book", exact: true })).toBeVisible();
  await expect(page.locator(".document-card")).toHaveCount(0);
  await page.goto("/playlists/not-a-real-playlist");
  await expect(page.getByRole("link", { name: /playlist/i }).last()).toBeVisible();
  await expect(page.locator(".document-card")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("mobile playlist controls support keyboard creation and fit the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".document-card")).toHaveCount(seedDocuments.length);
  const trigger = page.getByRole("button", { name: `Add ${firstBook.title} to playlist`, exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const popover = page.getByRole("group", { name: "Add to playlist", exact: true });
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "Create new playlist", exact: true }).click();
  const dialog = createDialog(page);
  await expect(dialog.getByLabel("Playlist name", { exact: true })).toBeFocused();
  const name = "\u0110".repeat(90);
  await saveNewPlaylist(page, name, "A long playlist name on a narrow screen.");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("link", { name: "My Playlist", exact: true }).click();
  await expect(playlistCard(page, name)).toContainText("1 book");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await playlistCard(page, name).getByRole("link", { name: `Open playlist ${name}`, exact: true }).click();
  await expect(page.locator(".document-card")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Edit playlist", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit playlist", exact: true }).getByLabel("Playlist name", { exact: true })).toBeFocused();
});
