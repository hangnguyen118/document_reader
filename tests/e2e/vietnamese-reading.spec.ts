import { expect, test, type Page } from "@playwright/test";
import { mockSpeech, selectText, textDOCX } from "./helpers";
import { vietnameseDOCX } from "../fixtures/vietnamese-docx";

const capitals = Array.from("ÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ").join(" ");
const decomposed = `${capitals}\n${capitals.toLowerCase()}`.normalize("NFD");
const source = `${capitals}\n${capitals.toLowerCase()}\n\n“TIẾNG VIỆT”, dấu câu: 1–2; (rõ ràng)!\n\t${decomposed}`;

async function expectIntactText(page: Page, text: string) {
  await expect(page.getByTestId("reader-text")).toBeVisible();
  expect(await page.getByTestId("reader-text").textContent()).toBe(text);
  const splitGraphemes = await page.getByTestId("reader-text").evaluate((root) => {
    const text = root.textContent ?? "";
    const boundaries = new Set([0, text.length, ...Array.from(new Intl.Segmenter("vi", { granularity: "grapheme" }).segment(text), ({ index }) => index)]);
    let offset = 0;
    return Array.from(root.childNodes).flatMap((node) => {
      offset += node.textContent?.length ?? 0;
      return boundaries.has(offset) ? [] : [offset];
    });
  });
  expect(splitGraphemes).toEqual([]);
}

async function expectReadingFont(page: Page, font: "serif" | "sans") {
  const reader = page.getByTestId("reader-text");
  await expect(reader).toHaveAttribute("data-reading-font", font);
  const loaded = await reader.evaluate(async (root) => {
    const style = getComputedStyle(root);
    await document.fonts.load(`${style.fontSize} ${style.fontFamily}`, root.textContent ?? "");
    await document.fonts.ready;
    return Array.from(document.fonts).some((face) => style.fontFamily.includes(face.family.replace(/["']/g, "")) && face.status === "loaded");
  });
  expect(loaded).toBe(true);
  // Inspect actual glyph fonts as well as CSS: a missing Vietnamese glyph can
  // otherwise silently fall back to another family with incompatible metrics.
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("DOM.enable");
    await client.send("CSS.enable");
    const { root } = await client.send("DOM.getDocument");
    const { nodeId } = await client.send("DOM.querySelector", { nodeId: root.nodeId, selector: '[data-testid="reader-text"] > :first-child' });
    const { fonts } = await client.send("CSS.getPlatformFontsForNode", { nodeId });
    expect(fonts.length).toBeGreaterThan(0);
    for (const face of fonts) {
      expect(face.isCustomFont).toBe(true);
      expect(face.familyName).toBe(font === "serif" ? "Noto Serif" : "Noto Sans");
    }
  } finally { await client.detach(); }
}

test("Vietnamese UTF-8 TXT, Markdown and DOCX retain composed and combining text", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Upload documents").setInputFiles([
    { name: "vietnamese-txt.txt", mimeType: "text/plain", buffer: Buffer.from(source, "utf8") },
    { name: "vietnamese-markdown.md", mimeType: "text/markdown", buffer: Buffer.from(source, "utf8") },
    { name: "vietnamese-docx.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: await textDOCX(source) }
  ]);
  await expect(page.locator(".document-card")).toHaveCount(7);
  for (const name of ["vietnamese txt", "vietnamese markdown", "vietnamese docx"]) {
    await page.getByRole("link", { name: `Read ${name}`, exact: true }).click();
    await expectIntactText(page, source);
    await expectReadingFont(page, "serif");
    await page.reload();
    await expectIntactText(page, source);
    await page.getByRole("link", { name: "Back to library", exact: true }).click();
  }
});

test("existing decomposed documents keep saved UTF-16 offsets while rendering whole Vietnamese letters", async ({ page }) => {
  const text = "ẮẤỆỨ — tiếng Việt; nội dung gốc.\n\nDòng thứ hai!".normalize("NFD");
  await page.goto("/");
  await expect(page.locator(".document-card")).toHaveCount(4);
  await page.evaluate(async (text) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("folio-reading", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["documents", "highlights"], "readwrite");
        const request = tx.objectStore("documents").get("attention");
        request.onsuccess = () => tx.objectStore("documents").put({ ...request.result, id: "vietnamese-existing", title: "Vietnamese existing", pages: [text], currentPage: 0, uploaded: true });
        // An older saved range selected only the breve inside the first NFD letter.
        tx.objectStore("highlights").put({ id: "vietnamese-partial", documentId: "vietnamese-existing", page: 0, start: 1, end: 2, text: text.slice(1, 2), color: "yellow", createdAt: 1 });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, text);
  await page.goto("/read/vietnamese-existing");
  await expectIntactText(page, text);
  await expect(page.locator("mark.text-highlight")).toHaveText("Ắ".normalize("NFD"));
  // Programmatic/keyboard selections can end inside an NFD grapheme. Capturing
  // the selection must give notes and vocabulary the complete accented letter.
  await selectText(page, "\u0323");
  await page.getByRole("button", { name: "Add note about selected text" }).click();
  const noteDialog = page.getByRole("dialog", { name: "A thought to keep", exact: true });
  await expect(noteDialog.locator(".saved-context")).toHaveText("Ệ".normalize("NFD"));
  await noteDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const quote = "tiếng Việt".normalize("NFD");
  await selectText(page, quote);
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect(page.locator("mark.text-highlight")).toHaveCount(2);
  await expectIntactText(page, text);
  await page.reload();
  await expectIntactText(page, text);
  await expect(page.locator("mark.text-highlight")).toHaveText(["Ắ".normalize("NFD"), quote]);
  const persisted = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("folio-reading", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const read = (store: string, key: string) => new Promise<Record<string, unknown>>((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return { document: await read("documents", "vietnamese-existing"), highlight: await read("highlights", "vietnamese-partial") };
    } finally { db.close(); }
  });
  expect(persisted.document.pages).toEqual([text]);
  expect(persisted.highlight).toMatchObject({ start: 1, end: 2, text: text.slice(1, 2) });
});

test("Vietnamese DOCX glyphs and speech boundaries use complete local fonts", async ({ page }, testInfo) => {
  const text = `${"ẮẤỆỨ".normalize("NFD")}\n\n${capitals}\n${capitals.toLowerCase()}\n\n${decomposed}`;
  await mockSpeech(page);
  await page.goto("/");
  await page.getByLabel("Upload documents").setInputFiles({ name: "vietnamese-speech.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: await textDOCX(text) });
  await expect(page.locator(".document-card")).toHaveCount(5);
  await page.getByRole("link", { name: "Read vietnamese speech", exact: true }).click();
  await expectIntactText(page, text);
  const readingUrl = page.url();
  for (const font of ["serif", "sans"] as const) {
    await page.goto("/settings");
    await page.getByLabel("Reading font", { exact: true }).selectOption(font);
    await page.getByLabel("Line spacing", { exact: true }).selectOption("1.6");
    await page.getByRole("button", { name: "Dark For quieter hours", exact: true }).click();
    await page.goto(readingUrl);
    await expectIntactText(page, text);
    await expectReadingFont(page, font);
    const screenshot = testInfo.outputPath(`vietnamese-docx-${font}.png`);
    await page.getByTestId("reader-text").screenshot({ path: screenshot });
    await testInfo.attach(`vietnamese-docx-${font}`, { path: screenshot, contentType: "image/png" });
    await page.evaluate(() => {
      window.speechSynthesis.speak = (utterance) => {
        utterance.onboundary?.call(utterance, { charIndex: 1, charLength: 1 } as SpeechSynthesisEvent);
      };
    });
    await page.getByRole("button", { name: "Listen", exact: true }).click();
    await expect(page.locator(".spoken-text")).toHaveText("Ắ".normalize("NFD"));
    await expectIntactText(page, text);
    await page.getByRole("button", { name: "Stop reading", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expectIntactText(page, text);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
  }
});

test("Vietnamese DOCX remains readable and selectable without Intl.Segmenter", async ({ page }) => {
  const text = "ẮẤỆỨ — tiếng Việt có dấu.\n\nGiữ nguyên nội dung!".normalize("NFD");
  await mockSpeech(page);
  await page.addInitScript(() => { Object.defineProperty(Intl, "Segmenter", { value: undefined, configurable: true }); });
  await page.goto("/");
  await page.getByLabel("Upload documents").setInputFiles({ name: "vietnamese-legacy.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: await textDOCX(text) });
  await expect(page.locator(".document-card")).toHaveCount(5);
  await page.getByRole("link", { name: "Read vietnamese legacy", exact: true }).click();
  const reader = page.getByTestId("reader-text");
  await expect(reader).toBeVisible();
  expect(await reader.textContent()).toBe(text);
  await selectText(page, "\u0323");
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect(page.locator("mark.text-highlight")).toHaveText("Ệ".normalize("NFD"));
  await page.reload();
  await expect(page.locator("mark.text-highlight")).toHaveText("Ệ".normalize("NFD"));
  expect(await reader.textContent()).toBe(text);
  await page.evaluate(() => {
    window.speechSynthesis.speak = (utterance) => {
      utterance.onboundary?.call(utterance, { charIndex: 1, charLength: 1 } as SpeechSynthesisEvent);
    };
  });
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.locator(".spoken-text")).toHaveText("Ắ".normalize("NFD"));
  expect(await reader.textContent()).toBe(text);
  expect((await reader.locator(":scope > *").allTextContents()).every((part) => !/^\p{M}/u.test(part))).toBe(true);
});

test("the reported PHẦN heading keeps its stacked accents across DOCX runs", async ({ page }, testInfo) => {
  const fixture = await vietnameseDOCX();
  await page.goto("/");
  await page.getByLabel("Upload documents").setInputFiles({
    name: "reported-heading.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: fixture.buffer
  });
  await page.getByRole("link", { name: "Read reported heading", exact: true }).click();
  await expectIntactText(page, fixture.text);
  await expectReadingFont(page, "serif");
  const reader = page.getByTestId("reader-text");
  const screenshot = testInfo.outputPath("reported-docx-heading.png");
  await reader.screenshot({ path: screenshot });
  await testInfo.attach("reported-docx-heading", { path: screenshot, contentType: "image/png" });
  await selectText(page, "\u0300");
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect(page.locator("mark.text-highlight")).toHaveText("Ầ".normalize("NFD"));
  await expectIntactText(page, fixture.text);
  await page.reload();
  await expect(page.locator("mark.text-highlight")).toHaveText("Ầ".normalize("NFD"));
  await expectIntactText(page, fixture.text);
  await expectReadingFont(page, "serif");
});
