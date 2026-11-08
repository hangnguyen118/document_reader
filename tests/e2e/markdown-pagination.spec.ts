import { expect, test, type Page } from "@playwright/test";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { MARKDOWN_PAGE_TARGET } from "../../lib/markdown";
import { selectText } from "./helpers";

function readingSource(chapters = 12) {
  const sentence = "Read carefully and give each idea enough room to develop. A familiar story rewards a thoughtful second reading. ";
  const paragraph = sentence.repeat(Math.ceil(MARKDOWN_PAGE_TARGET / 4 / sentence.length));
  return ["# A paginated book", "", ...Array.from({ length: chapters }, (_, index) => [
    `## Chapter ${index + 1}`,
    `Passage ${index + 1}: ${paragraph}`
  ].join("\n\n")), ""].join("\n\n");
}

async function uploadReading(page: Page, source = readingSource(), name = "paginated-book.md") {
  await page.goto("/");
  await page.getByLabel("Upload documents", { exact: true }).setInputFiles({ name, mimeType: "text/markdown", buffer: Buffer.from(source, "utf8") });
  const title = name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
  await page.getByRole("link", { name: `Read ${title}`, exact: true }).click();
  await expect(page).toHaveURL(/\/read\/[^/?#]+$/);
  const currentPage = page.getByRole("combobox", { name: "Current page", exact: true });
  await expect.poll(() => currentPage.locator("option").count()).toBeGreaterThan(2);
  return { currentPage, pageCount: await currentPage.locator("option").count(), title, url: page.url() };
}

async function savedReading(page: Page) {
  const id = new URL(page.url()).pathname.split("/").pop()!;
  return page.evaluate(async (documentId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("folio-reading");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const record = await new Promise<{ pages: string[]; currentPage: number }>((resolve, reject) => {
        const request = db.transaction("documents").objectStore("documents").get(documentId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const highlights = await new Promise<{ page: number; start: number; coordinateSpace?: string }[]>((resolve, reject) => {
        const request = db.transaction("highlights").objectStore("highlights").index("documentId").getAll(documentId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const notes = await new Promise<{ page: number; quote: string }[]>((resolve, reject) => {
        const request = db.transaction("notes").objectStore("notes").index("documentId").getAll(documentId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return { record, highlights, notes };
    } finally { db.close(); }
  }, id);
}

test("Markdown pages support navigation, resume, saved page URLs and cross-page heading links", async ({ page }) => {
  const source = readingSource();
  const { currentPage, pageCount, title, url } = await uploadReading(page, source);
  const previous = page.getByRole("button", { name: "Previous page", exact: true });
  const next = page.getByRole("button", { name: "Next page", exact: true });
  await expect(currentPage).toHaveValue("0");
  await expect(previous).toBeDisabled();
  await expect(page.locator(".markdown-preview h1")).toHaveText("A paginated book");
  const firstPageText = await page.locator(".markdown-preview").innerText();
  await next.click();
  await expect(currentPage).toHaveValue("1");
  expect(await page.locator(".markdown-preview").innerText()).not.toBe(firstPageText);
  await previous.click();
  await expect(currentPage).toHaveValue("0");

  await currentPage.selectOption(String(pageCount - 1));
  await expect(next).toBeDisabled();
  await expect(page.locator(".markdown-preview h2").last()).toHaveText("Chapter 12");
  await expect.poll(async () => (await savedReading(page)).record.currentPage).toBe(pageCount - 1);
  expect((await savedReading(page)).record.pages).toEqual([source]);
  await page.reload();
  await expect(currentPage).toHaveValue(String(pageCount - 1));
  await page.getByRole("link", { name: "Back to library", exact: true }).click();
  await page.getByRole("link", { name: `Read ${title}`, exact: true }).click();
  await expect(currentPage).toHaveValue(String(pageCount - 1));

  await page.goto(`${url}?page=2`);
  await expect(currentPage).toHaveValue("1");
  await page.locator(".markdown-toc summary").click();
  await page.getByRole("navigation", { name: "Table of contents", exact: true }).getByRole("link", { name: "Chapter 12", exact: true }).click();
  await expect(page).toHaveURL(/#md-chapter-12$/);
  await expect(currentPage).toHaveValue(String(pageCount - 1));
  await expect(page.locator("#md-chapter-12")).toBeVisible();
  await previous.click();
  await expect(currentPage).toHaveValue(String(pageCount - 2));
  await page.goto(`${url}?page=9999`);
  await expect(currentPage).toHaveValue(String(pageCount - 1));
});

test("Markdown larger than one million characters uploads and retains its final page after reload", async ({ page }) => {
  const imageUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG0cAAAAASUVORK5CYII=";
  const source = `${readingSource(270)}\n\n## End of chapter 2\n\nThe final passage is preserved.\n\n![Chapter illustration][illustration]\n\n[illustration]: ${imageUrl}\n`;
  expect(source.length).toBeGreaterThan(1_000_000);
  const { currentPage, pageCount } = await uploadReading(page, source, "chuong2.md");
  await expect(currentPage).toHaveValue("0");
  await expect(page.locator(".markdown-preview h1")).toHaveText("A paginated book");
  await expect(page.getByRole("button", { name: "Previous page", exact: true })).toBeDisabled();

  await currentPage.selectOption(String(pageCount - 1));
  await expect(page.locator(".markdown-preview h2").last()).toHaveText("End of chapter 2");
  await expect(page.locator(".markdown-preview")).toContainText("The final passage is preserved.");
  await expect(page.getByRole("img", { name: "Chapter illustration", exact: true })).toHaveAttribute("src", imageUrl);
  await expect(page.getByRole("button", { name: "Next page", exact: true })).toBeDisabled();
  await expect.poll(async () => (await savedReading(page)).record.currentPage).toBe(pageCount - 1);

  await page.reload();
  await expect(currentPage).toHaveValue(String(pageCount - 1));
  await expect(currentPage.locator("option")).toHaveCount(pageCount);
  await expect(page.locator(".markdown-preview h2").last()).toHaveText("End of chapter 2");
  await expect(page.getByRole("img", { name: "Chapter illustration", exact: true })).toHaveAttribute("src", imageUrl);
  expect((await savedReading(page)).record.pages).toEqual([source]);
});

test("Markdown highlights and notes retain their rendered offsets and reading page", async ({ page }) => {
  const { currentPage } = await uploadReading(page);
  await currentPage.selectOption("1");
  const passage = (await page.locator(".markdown-preview p").first().textContent())!;
  await selectText(page, passage);
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect.poll(async () => (await page.locator("mark.text-highlight").allTextContents()).join("")).toBe(passage);
  await selectText(page, passage);
  await page.getByRole("button", { name: "Add note about selected text", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "A thought to keep", exact: true });
  await expect(dialog.locator(".modal-description")).toContainText("Page 2");
  await dialog.getByLabel("Your note", { exact: true }).fill("This thought belongs to the second reading page.");
  await dialog.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const saved = await savedReading(page);
  expect(saved.highlights).toHaveLength(1);
  expect(saved.highlights[0]).toMatchObject({ page: 1, coordinateSpace: "markdown-preview" });
  expect(saved.highlights[0].start).toBeGreaterThan(0);
  expect(saved.notes).toMatchObject([{ page: 1, quote: passage }]);

  await page.reload();
  await expect(currentPage).toHaveValue("1");
  await expect.poll(async () => (await page.locator("mark.text-highlight").allTextContents()).join("")).toBe(passage);
  await currentPage.selectOption("2");
  await expect(page.locator("mark.text-highlight")).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle notebook", exact: true }).click();
  await expect(page.locator(".margin-note")).toContainText("This thought belongs to the second reading page.");
  await page.getByRole("button", { name: "Highlights 1", exact: true }).click();
  await page.getByRole("button", { name: "Page 2", exact: true }).click();
  await expect(currentPage).toHaveValue("1");
  await expect.poll(async () => (await page.locator("mark.text-highlight").allTextContents()).join("")).toBe(passage);
});

test("a legacy continuous Markdown note opens its quoted reading page without rewriting saved data", async ({ page }) => {
  const source = readingSource();
  const note = { id: "legacy-late-note", documentId: "legacy-continuous-markdown", page: 0, quote: "Passage 12:", body: "Return to this late passage from My notes.", createdAt: 1, updatedAt: 1 };
  await page.goto("/");
  await expect(page.getByLabel("Upload documents", { exact: true })).toBeAttached();
  await page.evaluate(({ source, note }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("folio-reading");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["documents", "notes"], "readwrite");
      const original = tx.objectStore("documents").get("attention");
      original.onsuccess = () => {
        const { markdownPageCount: _count, ...base } = original.result;
        tx.objectStore("documents").put({ ...base, id: note.documentId, title: "Legacy continuous book", type: "MD", pages: [source], currentPage: 0, uploaded: true });
        tx.objectStore("notes").put(note);
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), { source, note });
  await page.goto("/notes");
  const card = page.locator(".note-card").filter({ hasText: note.body });
  await card.getByRole("link", { name: "Legacy continuous book", exact: true }).click();
  await expect(page).toHaveURL(/note=legacy-late-note/);
  const currentPage = page.getByRole("combobox", { name: "Current page", exact: true });
  await expect.poll(async () => Number(await currentPage.inputValue())).toBeGreaterThan(0);
  await expect(page.locator(".markdown-preview p").filter({ hasText: /^Passage 12:/ })).toBeVisible();
  const saved = await savedReading(page);
  expect(saved.record.pages).toEqual([source]);
  expect(saved.notes).toEqual([note]);
});

test("Markdown folder images and reference definitions remain valid on different reading pages", async ({ page }, testInfo) => {
  const sentence = "Images and words explain this part of the story together. ";
  const paragraph = sentence.repeat(Math.ceil(MARKDOWN_PAGE_TARGET / 4 / sentence.length));
  const source = ["# An illustrated book", ...Array.from({ length: 8 }, (_, index) => [
    `## Illustration ${index + 1}`,
    `Picture passage ${index + 1}. ${paragraph}`,
    `![Diagram ${index + 1}][image${index % 2}]`
  ].join("\n\n")), "[image0]: ./images/first.png", "[image1]: ./images/second.png", ""].join("\n\n");
  const folder = testInfo.outputPath("illustrated-markdown");
  await mkdir(path.join(folder, "images"), { recursive: true });
  await writeFile(path.join(folder, "illustrated.md"), source, "utf8");
  for (const name of ["first.png", "second.png"]) await copyFile(path.resolve("public/images/read_book.png"), path.join(folder, "images", name));
  await page.goto("/");
  await page.getByLabel("Upload Markdown folder", { exact: true }).setInputFiles(folder);
  await page.getByRole("link", { name: "Read illustrated", exact: true }).click();
  const currentPage = page.getByRole("combobox", { name: "Current page", exact: true });
  await expect.poll(() => currentPage.locator("option").count()).toBeGreaterThan(1);
  const pageCount = await currentPage.locator("option").count();
  const altTexts: string[] = [];
  let lastImagePage = 0;
  for (let index = 0; index < pageCount; index++) {
    await currentPage.selectOption(String(index));
    await expect(currentPage).toHaveValue(String(index));
    const images = page.locator(".markdown-preview img");
    const expectedImages = page.locator('.markdown-preview [role="img"], .markdown-preview img');
    if (!await expectedImages.count()) continue;
    await expect.poll(() => images.count()).toBe(await expectedImages.count());
    for (const image of await images.all()) {
      await expect(image).toHaveAttribute("src", /^blob:/);
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0)).toBe(true);
      altTexts.push((await image.getAttribute("alt"))!);
      lastImagePage = index;
    }
  }
  expect(altTexts).toEqual(Array.from({ length: 8 }, (_, index) => `Diagram ${index + 1}`));
  expect(lastImagePage).toBeGreaterThan(0);
  await currentPage.selectOption(String(lastImagePage));
  await page.reload();
  await expect(currentPage).toHaveValue(String(lastImagePage));
  const image = page.locator(".markdown-preview img").first();
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate((node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0)).toBe(true);
  expect((await savedReading(page)).record.pages).toEqual([source]);
});

test("Markdown speech distinguishes the current page and whole document and follows page transitions", async ({ page }) => {
  await page.addInitScript(() => {
    class Utterance {
      text: string; lang = ""; rate = 1; voice = null;
      onend: (() => void) | null = null; onerror = null;
      onboundary: ((event: { charIndex: number; charLength: number }) => void) | null = null;
      constructor(text: string) { this.text = text; }
    }
    const state = { calls: [] as string[], current: null as Utterance | null };
    (window as unknown as { paginatedSpeech: typeof state }).paginatedSpeech = state;
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: Utterance });
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
      getVoices: () => [{ name: "Test English", voiceURI: "en-test", lang: "en-US", localService: true }],
      addEventListener() {}, removeEventListener() {}, pause() {}, resume() {},
      cancel() { state.current = null; },
      speak(utterance: Utterance) { state.calls.push(utterance.text); state.current = utterance; utterance.onboundary?.({ charIndex: 0, charLength: 1 }); }
    } });
  });
  const source = readingSource(8);
  const { currentPage, pageCount } = await uploadReading(page, source, "spoken-pages.md");
  await currentPage.selectOption("1");
  const visibleText = (await page.locator(".markdown-preview [data-markdown-start]").allTextContents()).join("");
  await page.getByRole("combobox", { name: "Reading scope", exact: true }).selectOption("page");
  const finishSpeech = async () => {
    const visited = new Set<string>();
    for (let index = 0; index < Math.ceil(source.length / 100) + 10; index++) {
      visited.add(await currentPage.inputValue());
      const advanced = await page.evaluate(() => {
        const state = (window as unknown as { paginatedSpeech: { current: { onend?: (() => void) | null } | null } }).paginatedSpeech;
        const current = state.current;
        if (!current) return false;
        state.current = null;
        current.onend?.();
        return true;
      });
      if (!advanced) return visited;
    }
    throw new Error("Speech did not finish within the fixture's bounded passage count");
  };
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  const pageVisits = await finishSpeech();
  await expect(currentPage).toHaveValue("1");
  expect([...pageVisits]).toEqual(["1"]);
  const spoken = await page.evaluate(() => (window as unknown as { paginatedSpeech: { calls: string[] } }).paginatedSpeech.calls.join(""));
  const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
  expect(normalize(spoken)).toBe(normalize(visibleText));

  await page.evaluate(() => { (window as unknown as { paginatedSpeech: { calls: string[] } }).paginatedSpeech.calls = []; });
  await page.getByRole("combobox", { name: "Reading scope", exact: true }).selectOption("document");
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  const allVisits = await finishSpeech();
  expect(allVisits.size).toBe(pageCount);
  await expect(currentPage).toHaveValue(String(pageCount - 1));
  const allSpoken = await page.evaluate(() => (window as unknown as { paginatedSpeech: { calls: string[] } }).paginatedSpeech.calls.join(""));
  expect(allSpoken).toContain("A paginated book");
  expect(allSpoken).toContain("Chapter 8");
  expect(allSpoken).not.toContain("# ");
  await expect(page.locator(".spoken-text")).toHaveCount(0);
});
