import { expect, test } from "@playwright/test";

async function addWord(page: import("@playwright/test").Page, term: string, meaning: string) {
  await page.getByRole("button", { name: "Add a word", exact: true }).click();
  await page.getByLabel("English word or phrase", { exact: true }).fill(term);
  await page.getByLabel("Vietnamese meaning", { exact: true }).fill(meaning);
  await page.getByRole("button", { name: "Save word", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}
test("vocabulary supports adding, editing, finding and persistent collection", async ({ page }) => {
  await page.goto("/vocabulary"); await addWord(page, "quiet", "yên tĩnh"); await addWord(page, "wonder", "điều kỳ diệu");
  await page.reload(); await expect(page.locator(".word-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Edit quiet", exact: true }).click(); await page.getByLabel("Vietnamese meaning", { exact: true }).fill("sự yên tĩnh"); await page.getByRole("button", { name: "Save word", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("Search vocabulary").fill("quiet"); await expect(page.locator(".word-card")).toHaveCount(1); await expect(page.locator(".word-meaning")).toHaveText("sự yên tĩnh");
});
test("learning offers only meanings from the selected words and completes a session", async ({ page }) => {
  await page.goto("/vocabulary"); await addWord(page, "quiet", "yên tĩnh"); await addWord(page, "wonder", "điều kỳ diệu"); await addWord(page, "habit", "thói quen");
  await page.goto("/learn"); await page.getByRole("button", { name: "Multiple choice", exact: false }).click();
  await page.getByRole("button", { name: "Start practice", exact: true }).click();
  const meanings: Record<string, string> = { quiet: "yên tĩnh", wonder: "điều kỳ diệu", habit: "thói quen" };
  for (let index = 0; index < 3; index++) {
    const term = await page.locator(".quiz-card h2").textContent();
    const options = await page.locator(".quiz-options button").allTextContents();
    expect(options).toHaveLength(3); expect(options.every((option) => Object.values(meanings).some((meaning) => option.includes(meaning)))).toBe(true);
    await page.locator(".quiz-options button").filter({ hasText: meanings[term!] }).click();
    await expect(page.getByRole("status")).toContainText("That's right");
    await page.getByRole("button", { name: index === 2 ? "See results" : "Next word", exact: true }).click();
  }
  await expect(page.locator(".session-score strong")).toHaveText("3 / 3"); await expect(page.getByText("You practiced 3 words.")).toBeVisible();
});
test("flashcards reveal meanings and require two distinct meanings for quizzes", async ({ page }) => {
  await page.goto("/vocabulary"); await addWord(page, "quiet", "yên tĩnh");
  await page.goto("/learn"); await page.getByRole("button", { name: "Multiple choice", exact: false }).click(); await expect(page.getByRole("button", { name: "Start practice", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Flashcards", exact: false }).click(); await page.getByRole("button", { name: "Start practice", exact: true }).click();
  await expect(page.getByRole("button", { name: "Got it", exact: false })).toBeDisabled();
  await page.getByRole("button", { name: "Reveal meaning", exact: true }).click(); await expect(page.locator(".flashcard strong")).toHaveText("yên tĩnh");
  await page.getByRole("button", { name: "Got it", exact: false }).click(); await expect(page.getByText("You practiced 1 word.")).toBeVisible();
});
