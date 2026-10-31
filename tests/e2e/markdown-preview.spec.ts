import { expect, test, type Page } from "@playwright/test";
import { mockSpeech, selectText } from "./helpers";

const markdown = [
  "# Tài liệu Tiếng Việt 📖",
  "",
  "Một đoạn **in đậm**, *in nghiêng*, ~~gạch ngang~~ và `inlineCode`.",
  "",
  "[Jump to part two](#part-two) · [Open documentation](https://example.com/docs)",
  "",
  "## Part two",
  "### Heading three",
  "#### Heading four",
  "##### Heading five",
  "###### Heading six",
  "",
  "1. First ordered item",
  "2. Second ordered item",
  "   - Nested item",
  "     - Deeply nested item",
  "",
  "- Unordered item",
  "- [x] Completed task",
  "- [ ] Pending task",
  "",
  "> A quotation worth remembering.",
  "",
  "---",
  "",
  "| Name | Meaning |",
  "| --- | --- |",
  "| Sách | Book |",
  "| Đọc | Read |",
  "",
  "![Reading illustration](/images/read_book.png)",
  "",
  "```javascript",
  'const greeting = "Xin chào";',
  "console.log(greeting);",
  "```",
  "",
  "```python",
  'def greet(name):\n    return f"Chào {name}"',
  "```",
  "",
  "```typescript",
  'const title: string = "Tài liệu";',
  "```",
  "",
  "```html",
  '<article class="document">Read me</article>',
  "```",
  "",
  "```css",
  ".document { color: rebeccapurple; }",
  "```",
  "",
  "```json",
  '{ "title": "Đọc sách", "ready": true }',
  "```",
  "",
  "```bash",
  'echo "Xin chào"',
  "```",
  "",
  "```unrecognized-language",
  "unknown <syntax> & Unicode: ẮẤỆỨ",
  "```",
  "",
  "```",
  "plain <code> & text",
  "```",
  "",
  "<script>window.markdownAttack = true</script>",
  "",
  '<img src="x" onerror="window.markdownAttack = true">',
  "",
  "[Unsafe link](javascript:alert(1))",
  "",
  "## Selectable passage",
  "Before **tiếng Việt** after. Keep the original source safe.",
  ""
].join("\n");

async function uploadMarkdown(page: Page, source = markdown, name = "markdown-preview.md") {
  await page.goto("/");
  await page.getByLabel("Upload documents").setInputFiles({ name, mimeType: "text/markdown", buffer: Buffer.from(source, "utf8") });
  const title = name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
  await page.getByRole("link", { name: `Read ${title}`, exact: true }).click();
  await expect(page.locator(".markdown-preview")).toBeVisible();
}

async function savedMarkdown(page: Page) {
  const id = new URL(page.url()).pathname.split("/").pop()!;
  return page.evaluate(async (documentId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("folio-reading", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ pages: string[]; type: string }>((resolve, reject) => {
        const request = db.transaction("documents").objectStore("documents").get(documentId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }, id);
}

test("Markdown uploads render semantic GFM safely and preserve their exact source", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await uploadMarkdown(page);
  const preview = page.locator(".markdown-preview");
  for (let level = 1; level <= 6; level++) await expect(preview.locator(`h${level}`)).toHaveCount(1 + (level === 2 ? 1 : 0));
  await expect(preview.locator("h1")).toHaveText("Tài liệu Tiếng Việt 📖");
  await expect(preview.locator("strong").first()).toHaveText("in đậm");
  await expect(preview.locator("em")).toHaveText("in nghiêng");
  await expect(preview.locator("del")).toHaveText("gạch ngang");
  await expect(preview.locator("p > code")).toHaveText("inlineCode");
  await expect(preview.locator("ol > li")).toHaveCount(2);
  await expect(preview.locator("ol ul ul li")).toHaveText("Deeply nested item");
  await expect(preview.locator('input[type="checkbox"]')).toHaveCount(2);
  await expect(preview.locator('input[type="checkbox"]').first()).toBeChecked();
  await expect(preview.locator('input[type="checkbox"]').last()).not.toBeChecked();
  await expect(preview.locator('input[type="checkbox"]').first()).toBeDisabled();
  const ordinaryBullet = preview.locator(".contains-task-list > li:not(.task-list-item)");
  await expect(ordinaryBullet).toHaveText("Unordered item");
  await expect(ordinaryBullet).not.toHaveCSS("list-style-type", "none");
  await expect(preview.locator("blockquote")).toContainText("A quotation worth remembering.");
  await expect(preview.locator("hr")).toHaveCount(1);
  await expect(preview.locator("table th")).toHaveText(["Name", "Meaning"]);
  await expect(preview.locator("table tbody tr")).toHaveCount(2);
  await expect(preview.getByRole("img", { name: "Reading illustration" })).toHaveAttribute("src", "/images/read_book.png");
  await expect(preview.getByRole("link", { name: "Open documentation", exact: true })).toHaveAttribute("href", "https://example.com/docs");
  await expect(preview.getByRole("link", { name: "Jump to part two", exact: true })).toHaveAttribute("href", "#md-part-two");
  await expect(preview.locator("h2").first()).toHaveAttribute("id", "md-part-two");
  await preview.getByRole("link", { name: "Jump to part two", exact: true }).click();
  await expect(page).toHaveURL(/#md-part-two$/);
  await expect(preview.locator("script, [onerror]")).toHaveCount(0);
  expect(await preview.locator('a[href^="javascript:"]').count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { markdownAttack?: boolean }).markdownAttack)).toBeUndefined();
  expect(await savedMarkdown(page)).toMatchObject({ type: "MD", pages: [markdown] });
  await page.reload();
  await expect(page.locator(".markdown-preview h1")).toHaveText("Tài liệu Tiếng Việt 📖");
  expect((await savedMarkdown(page)).pages).toEqual([markdown]);
  expect(errors).toEqual([]);
});

test("code blocks highlight known languages, copy original code and handle fallback languages", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await uploadMarkdown(page);
  const blocks = page.locator(".markdown-code-block");
  await expect(blocks).toHaveCount(9);
  const javascript = blocks.first();
  await javascript.scrollIntoViewIfNeeded();
  await expect(javascript.locator("code")).toContainText('const greeting = "Xin chào";');
  await expect.poll(async () => javascript.locator("code span").count()).toBeGreaterThan(1);
  await expect.poll(async () => javascript.locator("code span").evaluateAll((spans) => new Set(spans.map((span) => getComputedStyle(span).color)).size)).toBeGreaterThan(1);
  await javascript.locator(".markdown-copy-button").click();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe('const greeting = "Xin chào";\nconsole.log(greeting);\n');
  for (let index = 1; index < 7; index++) {
    await blocks.nth(index).scrollIntoViewIfNeeded();
    await expect.poll(async () => blocks.nth(index).locator("code span").count()).toBeGreaterThan(1);
  }
  await expect(blocks.nth(1).locator("code")).toContainText('def greet(name):');
  await expect(blocks.nth(7).locator("code")).toContainText("unknown <syntax> & Unicode: ẮẤỆỨ");
  await expect(blocks.nth(8).locator("code")).toContainText("plain <code> & text");
  await expect(blocks.nth(7).locator("syntax")).toHaveCount(0);
});

test("rendered Markdown supports saved highlights, selected notes, and speech", async ({ page }) => {
  await mockSpeech(page);
  await uploadMarkdown(page);
  await page.locator(".markdown-preview p").filter({ hasText: "Before tiếng Việt after." }).scrollIntoViewIfNeeded();
  const highlightedPassage = "Before tiếng Việt after.";
  await selectText(page, highlightedPassage);
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect.poll(async () => (await page.locator("mark.text-highlight").allTextContents()).join("")).toBe(highlightedPassage);
  await selectText(page, "Keep the original source safe.");
  await page.getByRole("button", { name: "Add note about selected text" }).click();
  const dialog = page.getByRole("dialog", { name: "A thought to keep", exact: true });
  await expect(dialog.locator(".saved-context")).toHaveText("Keep the original source safe.");
  await dialog.getByLabel("Your note", { exact: true }).fill("Rendered text stays connected to the original document.");
  await dialog.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect.poll(async () => (await page.locator("mark.text-highlight").allTextContents()).join("")).toBe(highlightedPassage);
  await page.getByRole("button", { name: "Toggle notebook" }).click();
  await expect(page.locator(".margin-note")).toContainText("Rendered text stays connected to the original document.");
  await page.getByRole("button", { name: "Close notebook" }).click();
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { speechCalls: { text: string }[] }).speechCalls.length)).toBeGreaterThan(0);
  const spoken = await page.evaluate(() => (window as unknown as { speechCalls: { text: string }[] }).speechCalls[0].text);
  expect(spoken).not.toContain("# ");
  expect(spoken).not.toContain("**");
  expect((await savedMarkdown(page)).pages).toEqual([markdown]);
});

test("Markdown remains responsive in light and dark themes with wide tables, images and code", async ({ page }, testInfo) => {
  const longLine = "const value = " + '"long-code-"'.repeat(60) + ";";
  await uploadMarkdown(page, markdown + `\n\n\`\`\`typescript\n${longLine}\n\`\`\`\n`);
  const url = page.url();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ["Light A fresh page", "Dark For quieter hours"]) {
    await page.goto("/settings");
    await page.getByRole("button", { name: theme, exact: true }).click();
    await page.goto(url);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.startsWith("Light") ? "light" : "dark");
    await expect(page.locator(".markdown-preview h1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const code = page.locator(".markdown-code-block pre").last();
    expect(await code.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    const image = page.getByRole("img", { name: "Reading illustration" });
    expect(await image.evaluate((node) => node.getBoundingClientRect().width <= node.parentElement!.getBoundingClientRect().width)).toBe(true);
    const screenshot = testInfo.outputPath(`markdown-${theme.startsWith("Light") ? "light" : "dark"}-mobile.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach(`markdown-${theme.startsWith("Light") ? "light" : "dark"}-mobile`, { path: screenshot, contentType: "image/png" });
  }
});

test("long Markdown keeps fenced blocks, tables and final headings intact", async ({ page }) => {
  const source = ["# Long document", "", ...Array.from({ length: 100 }, (_, index) => `## Section ${index + 1}\n\nNội dung tiếng Việt ${index + 1}. ${"A paragraph with useful information. ".repeat(4)}\n\n| Column | Value |\n| --- | --- |\n| Row ${index + 1} | Đọc sách |\n`), "```json", JSON.stringify({ content: "large code block ".repeat(300) }, null, 2), "```", "", "## Final heading", ""].join("\n");
  await uploadMarkdown(page, source, "long-markdown.markdown");
  await expect(page.locator(".markdown-preview h2")).toHaveCount(101);
  await expect(page.locator(".markdown-preview table")).toHaveCount(100);
  await expect(page.locator(".markdown-code-block")).toHaveCount(1);
  await expect(page.locator(".markdown-preview h2").last()).toHaveText("Final heading");
  expect((await savedMarkdown(page)).pages).toEqual([source]);
});

test("empty and incomplete Markdown have a readable preview without replacing source", async ({ page }) => {
  await uploadMarkdown(page, "", "empty-markdown.md");
  await expect(page.locator(".markdown-preview")).toContainText(/empty|no content/i);
  expect((await savedMarkdown(page)).pages).toEqual([""]);
  const source = "# Unfinished document\n\n**An unmatched marker\n\n```javascript\nconst unfinished = true;";
  await uploadMarkdown(page, source, "incomplete-markdown.md");
  await expect(page.locator(".markdown-preview h1")).toHaveText("Unfinished document");
  await expect(page.locator(".markdown-preview")).toContainText("An unmatched marker");
  await expect(page.locator(".markdown-code-block code")).toContainText("const unfinished = true;");
  expect((await savedMarkdown(page)).pages).toEqual([source]);
});

test("previously paginated Markdown reconnects fences and retains source-based annotations", async ({ page }) => {
  const pages = ["# Existing Markdown\n\n```javascript\nconst message = ", '"Xin chào";\n```\n\nKeep legacy words.\n'];
  await page.goto("/");
  await expect(page.locator(".document-card")).toHaveCount(4);
  await page.evaluate(async (sourcePages) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("folio-reading", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["documents", "highlights"], "readwrite");
        const request = tx.objectStore("documents").get("attention");
        request.onsuccess = () => tx.objectStore("documents").put({ ...request.result, id: "legacy-markdown", title: "Legacy Markdown", type: "MD", pages: sourcePages, currentPage: 1, uploaded: true });
        const quote = "Keep legacy words.";
        const start = sourcePages[1].indexOf(quote);
        tx.objectStore("highlights").put({ id: "legacy-markdown-highlight", documentId: "legacy-markdown", page: 1, start, end: start + quote.length, text: quote, color: "green", createdAt: 1 });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, pages);
  await page.goto("/read/legacy-markdown");
  await expect(page.locator(".markdown-preview h1")).toHaveText("Existing Markdown");
  await expect(page.locator(".markdown-code-block code")).toHaveText('const message = "Xin chào";\n');
  await expect(page.locator("mark.text-highlight")).toHaveText("Keep legacy words.");
  expect((await savedMarkdown(page)).pages).toEqual(pages);
  await page.reload();
  await expect(page.locator("mark.text-highlight")).toHaveText("Keep legacy words.");
  expect((await savedMarkdown(page)).pages).toEqual(pages);
});

test("syntax-token selections stay accurate and navigation clears code from the previous document", async ({ page }) => {
  const code = 'const original = "first document";';
  await uploadMarkdown(page, `# First document\n\n\`\`\`javascript\n${code}\n\`\`\`\n`, "first-code.md");
  const block = page.locator(".markdown-code-block");
  await block.scrollIntoViewIfNeeded();
  await expect.poll(async () => block.locator("code span").count()).toBeGreaterThan(1);
  await selectText(page, code);
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect.poll(async () => (await page.locator("mark.text-highlight").allTextContents()).join("")).toBe(code);
  await page.getByRole("link", { name: "Back to library", exact: true }).click();
  const source = "# Next document\n\n```unknown-language\nnext <code> & text\n```\n\n```\nplain final code\n```\n";
  await page.getByLabel("Upload documents").setInputFiles({ name: "next-code.md", mimeType: "text/markdown", buffer: Buffer.from(source) });
  await page.getByRole("link", { name: "Read next code", exact: true }).click();
  await expect(page.locator(".markdown-preview h1")).toHaveText("Next document");
  await expect(page.locator(".markdown-code-block code")).toHaveText(["next <code> & text\n", "plain final code\n"]);
  await expect(page.locator(".markdown-preview")).not.toContainText(code);
  await expect(page.locator("mark.text-highlight")).toHaveCount(0);
  expect((await savedMarkdown(page)).pages).toEqual([source]);
});
