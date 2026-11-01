import { expect, test } from "@playwright/test";
import { selectText, textPDF } from "./helpers";

test("Settings Back preserves the reading page, scroll, and reader controls after resizing text", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // The URL deliberately remains on page 2 after the reader advances to page 3.
  await page.goto("/read/attention?page=2");
  await expect(page.getByRole("combobox", { name: "Current page" })).toHaveValue("1");
  await page.getByRole("combobox", { name: "Reading scope" }).selectOption("document");
  await page.getByRole("button", { name: "Toggle notebook" }).click();
  await page.getByRole("button", { name: "Highlights 0", exact: true }).click();
  await page.getByRole("combobox", { name: "Current page" }).selectOption("2");
  await expect(page.getByTestId("reader-text")).toContainText("There is no perfect method");
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 500));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(500);
  const anchorTop = await page.getByTestId("reader-text").evaluate((root) => {
    const toolbarBottom = document.querySelector(".reader-toolbar")!.getBoundingClientRect().bottom;
    const caret = document.caretPositionFromPoint(root.getBoundingClientRect().left + 1, toolbarBottom + 2);
    if (!caret || !root.contains(caret.offsetNode)) throw new Error("A visible reading passage is required");
    const range = document.createRange();
    range.setStart(caret.offsetNode, caret.offset);
    range.collapse(true);
    (root as HTMLElement & { settingsTestAnchor: Range }).settingsTestAnchor = range;
    return range.getBoundingClientRect().top;
  });

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL("/settings");
  await expect(page.getByTestId("reader-text")).not.toBeVisible();
  await page.getByLabel("Text size", { exact: true }).fill("24");
  const back = page.getByRole("button", { name: "Back to reading", exact: true });
  await expect(back).toBeVisible();
  await expect(back).toBeEnabled();
  await back.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(back).toBeFocused();
  await expect(back).toHaveCSS("outline-style", "solid");
  await back.press("Enter");

  await expect(page).toHaveURL("/read/attention?page=2");
  await expect(page.getByRole("combobox", { name: "Current page" })).toHaveValue("2");
  await expect(page.getByTestId("reader-text")).toContainText("There is no perfect method");
  await expect(page.getByTestId("reader-text")).toHaveCSS("font-size", "24px");
  await expect(page.getByRole("combobox", { name: "Reading scope" })).toHaveValue("document");
  await expect(page.getByRole("button", { name: "Toggle notebook" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Highlights 0", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.getByTestId("reader-text").evaluate((root, top) => {
    const anchor = (root as HTMLElement & { settingsTestAnchor: Range }).settingsTestAnchor;
    return Math.abs(anchor.getBoundingClientRect().top - top);
  }, anchorTop)).toBeLessThan(2);
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Current page" })).toHaveValue("1");
  await expect(page.getByTestId("reader-text")).toContainText("We tend to imagine");
  await page.evaluate(() => window.scrollTo(0, 500));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(500);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Back to reading", exact: true }).click();
  await expect(page).toHaveURL("/read/attention?page=2");
  await expect.poll(() => page.evaluate(() => Math.abs(window.scrollY - 500))).toBeLessThan(2);
  expect(errors).toEqual([]);
});

test("Settings Back keeps a long Markdown passage visible when larger text reflows earlier content", async ({ page }) => {
  const paragraphs = Array.from({ length: 60 }, (_, index) => `Passage ${index + 1}: A quiet reading session gives each idea enough room to develop. Returning to a familiar passage helps us follow the story without searching for our place again. The words on this page remain ready for another thoughtful moment.`);
  await page.goto("/");
  await page.getByLabel("Upload documents").setInputFiles({
    name: "a-long-reading-session.md", mimeType: "text/markdown",
    buffer: Buffer.from(`# A long reading session\n\n${paragraphs.join("\n\n")}`)
  });
  await page.getByRole("link", { name: "Read a long reading session", exact: true }).click();
  const passage = page.getByTestId("reader-text").locator("p").filter({ hasText: /^Passage 36:/ });
  await expect(passage).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await passage.evaluate((element) => window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 100));
  await expect.poll(() => passage.evaluate((element) => Math.abs(element.getBoundingClientRect().top - 100))).toBeLessThan(1);
  const readingURL = page.url();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Text size", { exact: true }).fill("28");
  await expect(page.locator(".reading-preview")).toHaveCSS("font-size", "28px");
  await page.getByRole("button", { name: "Back to reading", exact: true }).click();
  await expect(page).toHaveURL(readingURL);
  await expect(page.getByTestId("reader-text")).toHaveCSS("font-size", "28px");
  // One enlarged line allows for reflow around the first visible text while
  // still proving that earlier paragraphs did not displace this passage.
  await expect.poll(() => passage.evaluate((element) => Math.abs(element.getBoundingClientRect().top - 100))).toBeLessThan(64);
});

test("mobile Settings Back returns to an uploaded book with updated reading preferences", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Upload documents").setInputFiles({
    name: "my-reading-settings.pdf",
    mimeType: "application/pdf",
    buffer: textPDF(["The opening page of my own book.", "A later page of my own book, ready to continue."])
  });
  await page.getByRole("link", { name: "Read my reading settings", exact: true }).click();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByTestId("reader-text")).toContainText("A later page of my own book");
  const readingURL = page.url();
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open navigation", exact: true })).toHaveAttribute("aria-expanded", "false");
  await page.getByLabel("Reading font", { exact: true }).selectOption("sans");
  await page.getByLabel("Text size", { exact: true }).fill("28");
  await page.getByLabel("Line spacing", { exact: true }).selectOption("2.2");
  const back = page.getByRole("button", { name: "Back to reading", exact: true });
  const bounds = await back.boundingBox();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await back.click();

  await expect(page).toHaveURL(readingURL);
  await expect(page.getByRole("combobox", { name: "Current page" })).toHaveValue("1");
  await expect(page.getByTestId("reader-text")).toContainText("A later page of my own book");
  await expect(page.getByTestId("reader-text")).toHaveCSS("font-size", "28px");
  await expect(page.getByTestId("reader-text")).toHaveCSS("line-height", "61.6px");
  await expect(page.getByTestId("reader-text")).toHaveAttribute("data-reading-font", "sans");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("the reader speech settings link supports repeated Back and browser forward navigation", async ({ page }) => {
  await page.goto("/read/morning");
  await page.getByRole("combobox", { name: "Current page" }).selectOption("1");
  await page.locator(".speech-setting").click();
  await page.getByLabel("Text size", { exact: true }).fill("22");
  await page.getByRole("button", { name: "Back to reading", exact: true }).click();
  await expect(page).toHaveURL("/read/morning");
  await expect(page.getByRole("combobox", { name: "Current page" })).toHaveValue("1");
  await expect(page.getByTestId("reader-text")).toHaveCSS("font-size", "22px");

  await page.goForward();
  await expect(page).toHaveURL("/settings");
  await page.getByLabel("Text size", { exact: true }).fill("26");
  await page.getByRole("button", { name: "Back to reading", exact: true }).click();
  await expect(page).toHaveURL("/read/morning");
  await expect(page.getByRole("combobox", { name: "Current page" })).toHaveValue("1");
  await expect(page.getByTestId("reader-text")).toHaveCSS("font-size", "26px");
});

test("translation settings can return to reading without a dialog blocking Settings", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "Translator", { configurable: true, value: undefined }));
  await page.goto("/settings");
  await page.getByRole("button", { name: /^Browser translator/ }).click();
  await page.getByRole("button", { name: "Back to library", exact: true }).click();
  await page.getByRole("link", { name: "Read The art of paying attention", exact: true }).click();
  await selectText(page, "quiet");
  await page.getByRole("button", { name: "Translate", exact: true }).click();
  await page.getByRole("link", { name: "Translation settings" }).click();
  await expect(page).toHaveURL("/settings");
  await page.getByLabel("Text size", { exact: true }).fill("24");
  await page.getByRole("button", { name: "Back to reading", exact: true }).click();
  await expect(page).toHaveURL("/read/attention");
  await expect(page.getByTestId("reader-text")).toContainText("particular kind of quiet");
  await expect(page.getByTestId("reader-text")).toHaveCSS("font-size", "24px");
});

test("reloading Settings reached from reading provides the standalone library fallback", async ({ page }) => {
  await page.goto("/read/attention");
  await page.getByRole("combobox", { name: "Current page" }).selectOption("1");
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to reading", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Back to library", exact: true }).click();
  await expect(page).toHaveURL("/");
  await page.getByRole("link", { name: "Read The art of paying attention", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Current page" })).toHaveValue("1");
});

for (const previouslyReading of [false, true]) {
  test(`direct Settings has a safe library fallback${previouslyReading ? " after reading another book" : " without prior history"}`, async ({ page }) => {
    if (previouslyReading) {
      await page.goto("/read/words");
      await expect(page.getByTestId("reader-text")).toBeVisible();
    }
    await page.goto("/settings");
    await page.getByLabel("Text size", { exact: true }).fill("24");
    await page.getByRole("button", { name: "Back to library", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "A little reading. A world of possibility." })).toBeVisible();
  });
}
