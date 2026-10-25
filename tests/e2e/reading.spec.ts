import { expect, test } from "@playwright/test";
import { mockSpeech, selectText, textDOCX, textPDF } from "./helpers";

test("library favorites persist and filter to the selected document", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/"); await expect(page.getByRole("heading", { name: "A little reading. A world of possibility." })).toBeVisible();
  await expect(page.locator(".document-card")).toHaveCount(4);
  await page.getByRole("button", { name: "Add The art of paying attention to favorites" }).click();
  await page.reload(); await page.getByRole("link", { name: "Favorites", exact: true }).click();
  await expect(page.locator(".document-card")).toHaveCount(1); await expect(page.locator(".document-title")).toHaveText("The art of paying attention");
  expect(errors).toEqual([]);
});
test("TXT and Markdown uploads persist as safe text", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Upload documents").setInputFiles([{ name: "a-quiet-page.txt", mimeType: "text/plain", buffer: Buffer.from("A quiet page for reading.\n\nRemember this new idea.") }, { name: "markdown.md", mimeType: "text/markdown", buffer: Buffer.from("# A new chapter\n\n<script>window.injected = true</script>") }]);
  await expect(page.locator(".document-card")).toHaveCount(6); await page.reload(); await expect(page.locator(".document-card")).toHaveCount(6);
  await page.getByRole("link", { name: "Read markdown", exact: true }).click();
  await expect(page.getByTestId("reader-text")).toContainText("<script>window.injected = true</script>");
  expect(await page.evaluate(() => (window as unknown as { injected?: boolean }).injected)).toBeUndefined();
});
test("actual PDF pages and DOCX content are extracted locally", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Upload documents").setInputFiles([{ name: "two-pages.pdf", mimeType: "application/pdf", buffer: textPDF(["A quiet morning leaves room for a new idea.", "The second page has another story to tell."]) }, { name: "a-small-story.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: await textDOCX("A small story worth remembering.") }]);
  await expect(page.locator(".document-card")).toHaveCount(6);
  await page.getByRole("link", { name: "Read two pages", exact: true }).click(); await expect(page.getByTestId("reader-text")).toContainText("A quiet morning");
  await page.getByRole("button", { name: "Next page", exact: true }).click(); await expect(page.getByTestId("reader-text")).toContainText("The second page");
  await page.reload(); await expect(page.getByTestId("reader-text")).toContainText("The second page");
  await page.getByRole("link", { name: "Back to library", exact: true }).click(); await page.getByRole("link", { name: "Read a small story", exact: true }).click();
  await expect(page.getByTestId("reader-text")).toContainText("A small story worth remembering.");
});
test("PDFs with more than 300 pages import fully and persist the last page", async ({ page }) => {
  const pages = Array.from({ length: 301 }, (_, index) => `Page ${index + 1}: Learning React without a page limit.`);
  await page.goto("/");
  await page.getByLabel("Upload documents").setInputFiles({ name: "learningreact-long.pdf", mimeType: "application/pdf", buffer: textPDF(pages) });
  await expect(page.locator(".document-card")).toHaveCount(5, { timeout: 15_000 });
  await page.getByRole("link", { name: "Read learningreact long", exact: true }).click();
  await expect(page.getByTestId("reader-text")).toHaveText(pages[0]);
  await expect(page.getByRole("combobox", { name: "Current page" }).locator("option")).toHaveCount(pages.length);
  await page.getByRole("combobox", { name: "Current page" }).selectOption("150");
  await expect(page.getByTestId("reader-text")).toHaveText(pages[150]);
  await page.getByRole("combobox", { name: "Current page" }).selectOption("300");
  await expect(page.getByTestId("reader-text")).toHaveText(pages[300]);
  await expect(page.getByRole("button", { name: "Next page", exact: true })).toBeDisabled();
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("reader-text")).toHaveText(pages[300]);
  await expect(page.getByRole("combobox", { name: "Current page" })).toHaveValue("300");
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(page.getByTestId("reader-text")).toHaveText(pages[299]);
});

test("selected highlights and notes remain associated with the page", async ({ page }) => {
  await page.goto("/read/attention"); await expect(page.getByTestId("reader-text")).toContainText("particular kind of quiet");
  const original = await page.getByTestId("reader-text").textContent();
  await selectText(page, "particular kind of quiet"); await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect(page.locator("mark.text-highlight")).toHaveText("particular kind of quiet");
  await expect(page.getByTestId("reader-text")).toHaveText(original!);
  await selectText(page, "the soft rustle of leaves outside"); await page.getByRole("button", { name: "Add note about selected text" }).click();
  await page.getByLabel("Your note", { exact: true }).fill("Notice the little details around you."); await page.getByRole("button", { name: "Save note", exact: true }).click();
  await page.reload(); await expect(page.locator("mark.text-highlight")).toHaveText("particular kind of quiet");
  await page.getByRole("button", { name: "Toggle notebook" }).click(); await expect(page.locator(".margin-note")).toContainText("Notice the little details around you.");
  await page.getByRole("button", { name: "Highlights 1", exact: true }).click(); await page.getByRole("button", { name: "Set green highlight" }).click(); await expect(page.locator("mark.text-highlight")).toHaveClass(/highlight-green/);
  await page.getByRole("button", { name: "Next page", exact: true }).click(); await expect(page.locator("mark.text-highlight")).toHaveCount(0);
  await page.getByRole("button", { name: "Page 1", exact: true }).click(); await expect(page.locator("mark.text-highlight")).toHaveCount(1);
});
test("browser speech reads selection, whole document, pauses, resumes, and stops", async ({ page }) => {
  await mockSpeech(page); await page.goto("/read/attention");
  await selectText(page, "particular kind of quiet"); await page.getByRole("button", { name: "Listen", exact: true }).last().click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { speechCalls: { text: string }[] }).speechCalls[0]?.text)).toBe("particular kind of quiet");
  await page.getByRole("button", { name: "Stop reading" }).click();
  await page.getByLabel("Reading scope", { exact: true }).selectOption("document"); await page.getByRole("button", { name: "Listen", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click(); await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click(); await page.getByRole("button", { name: "Stop reading" }).click();
  await expect(page.locator(".spoken-text")).toHaveCount(0);
});
test("mobile navigation, reading settings, and dark mode persist", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/"); await expect(page.locator(".document-card")).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click(); await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Dark For quieter hours", exact: true }).click();
  await page.getByLabel("Reading font", { exact: true }).selectOption("sans"); await page.getByLabel("Text size", { exact: false }).fill("24");
  await page.reload(); await expect(page.locator("html")).toHaveAttribute("data-theme", "dark"); await expect(page.getByLabel("Reading font", { exact: true })).toHaveValue("sans");
  await page.goto("/read/attention"); await expect(page.getByTestId("reader-text")).toHaveCSS("font-size", "24px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
