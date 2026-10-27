import { expect, test } from "@playwright/test";
import { vietnamesePDF } from "../fixtures/vietnamese-pdf";
import { selectText } from "./helpers";

test("Vietnamese PDF import preserves split accents, punctuation, pages, and highlights after reload", async ({ page }) => {
  const fixture = await vietnamesePDF();
  await page.goto("/");
  await page.getByLabel("Upload documents").setInputFiles({
    name: "vietnamese-accents.pdf", mimeType: "application/pdf", buffer: fixture.buffer
  });
  await page.getByRole("link", { name: "Read vietnamese accents", exact: true }).click();
  const reader = page.getByTestId("reader-text");
  expect(await reader.textContent()).toBe(fixture.pages[0]);
  await selectText(page, "A\u0306\u0301, Đọc sách!");
  await page.getByRole("button", { name: "Highlight", exact: true }).click();
  await expect(page.locator("mark.text-highlight")).toHaveText("A\u0306\u0301, Đọc sách!");
  expect(await reader.textContent()).toBe(fixture.pages[0]);
  await page.reload();
  await expect(page.locator("mark.text-highlight")).toHaveText("A\u0306\u0301, Đọc sách!");
  expect(await reader.textContent()).toBe(fixture.pages[0]);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(reader).toHaveText(fixture.pages[1]);
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(reader).toHaveText(fixture.pages[1]);
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(page.locator("mark.text-highlight")).toHaveText("A\u0306\u0301, Đọc sách!");
  expect(await reader.textContent()).toBe(fixture.pages[0]);
});
