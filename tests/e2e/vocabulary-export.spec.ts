import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import type { VocabularyItem } from "../../lib/types";

function vocabulary(count: number): VocabularyItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `export-word-${index}`, term: ["điều kỳ diệu", "=SUM(1,2)", 'word <tag> & "quote"'][index] ?? `Vocabulary-${String(index + 1).padStart(3, "0")}`,
    meaning: `Nghĩa tiếng Việt ${index + 1}`, context: index % 2 ? "" : `Context ${index + 1}`,
    documentId: "", documentTitle: "Added by you", page: 0, createdAt: 1_700_000_000_000 + index
  }));
}

async function persistWords(page: Page, records: VocabularyItem[]) {
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
}

async function seedWords(page: Page, records: VocabularyItem[]) {
  await page.goto("/vocabulary");
  await expect(page.getByRole("button", { name: "Add a word", exact: true })).toBeVisible();
  await persistWords(page, records);
  await page.reload();
  await expect(page.locator(".word-card")).toHaveCount(Math.min(12, records.length));
}

function exportDialog(page: Page) {
  return page.getByRole("dialog", { name: "Export Vocabulary", exact: true });
}

async function prepareExport(page: Page, format: "xlsx" | "pdf", selected = false) {
  await page.getByRole("button", { name: "Export Vocabulary", exact: true }).click();
  const dialog = exportDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: selected ? /^Export Selected/ : /^Export All/ }).check();
  await dialog.getByLabel("File format", { exact: true }).selectOption(format);
  return dialog;
}

async function downloadFile(page: Page, dialog: Locator) {
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download file", exact: true }).click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  return download;
}

async function downloadBytes(download: Download) {
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path!);
}

async function spreadsheetValues(page: Page, download: Download) {
  const zip = await JSZip.loadAsync(await downloadBytes(download));
  expect(zip.file("[Content_Types].xml")).not.toBeNull();
  const sheetPath = Object.keys(zip.files).find((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path));
  expect(sheetPath).toBeDefined();
  const worksheet = await zip.file(sheetPath!)!.async("string");
  const sharedStrings = await zip.file("xl/sharedStrings.xml")?.async("string") ?? "<sst />";
  return page.evaluate(({ worksheet, sharedStrings }) => {
    const parser = new DOMParser();
    const shared = Array.from(parser.parseFromString(sharedStrings, "application/xml").getElementsByTagName("si"), (item) =>
      Array.from(item.getElementsByTagName("t"), (text) => text.textContent ?? "").join(""));
    return Array.from(parser.parseFromString(worksheet, "application/xml").getElementsByTagName("row"), (row) => {
      const values = ["", "", ""];
      for (const cell of Array.from(row.getElementsByTagName("c"))) {
        if (cell.getElementsByTagName("f").length) throw new Error("Vocabulary must be exported as text, not an Excel formula");
        const reference = cell.getAttribute("r") ?? "";
        const column = Array.from(reference.match(/^[A-Z]+/)?.[0] ?? "", (character) => character.charCodeAt(0) - 64)
          .reduce((index, value) => index * 26 + value, 0) - 1;
        if (column < 0) throw new Error("Spreadsheet cells must have column references");
        if (column === 0 && reference !== "A1" && ![null, "n"].includes(cell.getAttribute("t"))) throw new Error("STT must be a numeric cell");
        const value = cell.getElementsByTagName("v")[0]?.textContent ?? "";
        values[column] = cell.getAttribute("t") === "s" ? shared[Number(value)] : cell.getAttribute("t") === "inlineStr"
          ? Array.from(cell.getElementsByTagName("t"), (text) => text.textContent ?? "").join("") : value;
      }
      return values;
    });
  }, { worksheet, sharedStrings });
}

async function pdfContents(download: Download) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = await downloadBytes(download);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  try {
    const pdf = await loading.promise;
    const pages: string[] = [];
    const rows: string[][] = [];
    const headers = ["STT", "Word / Phrase", "Meaning"];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const items = content.items.flatMap((item) => "str" in item && item.str.trim()
        ? [{ text: item.str, x: item.transform[4], y: item.transform[5] }] : []);
      pages.push(items.map((item) => item.text).join(" "));
      const heading = headers.map((label) => items.find((item) => item.text === label));
      for (const item of heading) expect(item, `Page ${number} must repeat all three column headers`).toBeDefined();
      const headerY = heading[0]!.y;
      expect(items.filter((item) => Math.abs(item.y - headerY) < 0.5).sort((a, b) => a.x - b.x).map((item) => item.text)).toEqual(headers);
      const termX = heading[1]!.x;
      const meaningX = heading[2]!.x;
      const footerY = items.find((item) => item.text === `Page ${number}`)!.y;
      const body = items.filter((item) => item.y < headerY - 1 && item.y > footerY + 1);
      const numbers = body.filter((item) => item.x < termX - 1 && /^\d+$/.test(item.text));
      for (let index = 0; index < numbers.length; index++) {
        const startY = numbers[index].y;
        const endY = numbers[index + 1]?.y ?? footerY;
        const cells = body.filter((item) => item.y <= startY + 0.5 && item.y > endY + 0.5 && item.x >= termX - 1);
        const text = (meaning: boolean) => cells.filter((item) => (item.x >= meaningX - 1) === meaning).map((item) => item.text).join(" ").replace(/\s+/g, " ");
        rows.push([numbers[index].text, text(false), text(true)]);
      }
    }
    return { pages: pdf.numPages, text: pages.join("\n"), rows };
  } finally { await loading.destroy(); }
}

for (const format of ["xlsx", "pdf"] as const) {
  for (const selected of [false, true]) {
    test(`${format} exports ${selected ? "only selected words across pages and searches" : "all persisted words despite pagination and search"}`, async ({ page }) => {
      const records = vocabulary(55);
      await seedWords(page, records);
      const pagination = page.getByRole("navigation", { name: "Vocabulary pagination", exact: true });
      await page.getByRole("checkbox", { name: `Select ${records[54].term}`, exact: true }).check();
      await pagination.getByRole("button", { name: "Page 5", exact: true }).click();
      await page.getByRole("checkbox", { name: `Select ${records[0].term}`, exact: true }).check();
      await page.getByLabel("Search vocabulary", { exact: true }).fill(records[54].term);
      await expect(page.locator(".word-card")).toHaveCount(1);
      await expect(page.getByRole("checkbox", { name: `Select ${records[54].term}`, exact: true })).toBeChecked();
      await expect(page.getByText("2 selected", { exact: true })).toBeVisible();

      // Exports must use current persisted meanings even while the view holds its earlier snapshot.
      const fresh = { ...records[0], id: "export-fresh", term: "Persisted-after-view-loaded", meaning: "Nghĩa của từ được lưu sau khi mở trang", createdAt: records[54].createdAt + 1 };
      const edited = { ...records[0], meaning: "Ý nghĩa đã được chỉnh sửa trong dữ liệu lưu trữ" };
      await persistWords(page, [fresh, edited]);
      const expected = selected ? [records[54], edited] : [fresh, ...records.slice(1).reverse(), edited];
      const download = await downloadFile(page, await prepareExport(page, format, selected));
      expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
      if (format === "xlsx") {
        expect(await spreadsheetValues(page, download)).toEqual([["STT", "Word / Phrase", "Meaning"], ...expected.map((word, index) => [String(index + 1), word.term, word.meaning])]);
      } else {
        const pdf = await pdfContents(download);
        expect(pdf.rows).toEqual(expected.map((word, index) => [String(index + 1), word.term.normalize("NFC"), word.meaning.normalize("NFC")]));
        expect(pdf.rows.map((row) => row[2])).not.toContain(records[0].meaning);
        if (selected) {
          for (const word of [fresh, ...records.slice(1, 54)]) {
            expect(pdf.text).not.toContain(word.term);
          }
        } else expect(pdf.pages).toBeGreaterThan(1);
      }
      await expect(page.locator(".word-card")).toHaveCount(1);
      await page.getByLabel("Search vocabulary", { exact: true }).fill("");
      await expect(page.getByRole("checkbox", { name: `Select ${records[54].term}`, exact: true })).toBeChecked();
      await pagination.getByRole("button", { name: "Page 5", exact: true }).click();
      await expect(page.getByRole("checkbox", { name: `Select ${records[0].term}`, exact: true })).toBeChecked();
      await expect(page.locator(".word-card").filter({ has: page.getByRole("heading", { name: records[0].term, exact: true }) }).locator(".word-meaning")).toHaveText(records[0].meaning);
    });
  }
}

for (const format of ["xlsx", "pdf"] as const) {
  test(`${format} leaves empty and absent saved meanings blank without adding fallback text`, async ({ page }) => {
    const records = vocabulary(3).map((word, index) => ({
      ...word, term: `missing-meaning-${index}`, meaning: ["", null, undefined][index] as unknown as string
    }));
    await seedWords(page, records);
    const download = await downloadFile(page, await prepareExport(page, format));
    const expected = records.slice().reverse().map((word, index) => [String(index + 1), word.term, ""]);
    if (format === "xlsx") expect(await spreadsheetValues(page, download)).toEqual([["STT", "Word / Phrase", "Meaning"], ...expected]);
    else expect((await pdfContents(download)).rows).toEqual(expected);
  });
}

test("global select all, partial selection and deletion maintain accurate counts while filtering", async ({ page }) => {
  const records = vocabulary(4);
  await seedWords(page, records);
  const all = page.getByRole("checkbox", { name: "Select all vocabulary", exact: true });
  await page.getByLabel("Search vocabulary", { exact: true }).fill(records[0].term);
  await all.check();
  await expect(page.getByText("4 selected", { exact: true })).toBeVisible();
  await page.getByLabel("Search vocabulary", { exact: true }).fill("");
  for (const word of records) await expect(page.getByRole("checkbox", { name: `Select ${word.term}`, exact: true })).toBeChecked();
  await page.getByRole("checkbox", { name: `Select ${records[1].term}`, exact: true }).uncheck();
  await expect(page.getByText("3 selected", { exact: true })).toBeVisible();
  expect(await all.evaluate((input) => (input as HTMLInputElement).indeterminate)).toBe(true);
  await page.getByRole("button", { name: `Delete ${records[0].term}`, exact: true }).click();
  await expect(page.locator(".word-card")).toHaveCount(3);
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
  await all.check();
  await all.uncheck();
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
  const dialog = await prepareExport(page, "xlsx", true);
  await expect(dialog.getByRole("button", { name: "Download file", exact: true })).toBeDisabled();
  await expect(dialog.getByText(/select at least one/i)).toBeVisible();
});

test("an empty collection cannot export either scope", async ({ page }) => {
  await seedWords(page, []);
  const dialog = await prepareExport(page, "xlsx");
  await expect(dialog.getByRole("button", { name: "Download file", exact: true })).toBeDisabled();
  await dialog.getByRole("radio", { name: /^Export Selected/ }).check();
  await expect(dialog.getByRole("button", { name: "Download file", exact: true })).toBeDisabled();
  await expect(dialog.getByText(/select at least one/i)).toBeVisible();
});

test("PDF font failure shows an error and allows a successful retry", async ({ page }) => {
  await seedWords(page, vocabulary(1));
  await page.route("**/fonts/NotoSans-Regular.ttf", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  const dialog = await prepareExport(page, "pdf");
  await dialog.getByRole("button", { name: "Download file", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/could not|unable|failed/i);
  await expect(dialog.getByRole("button", { name: "Download file", exact: true })).toBeEnabled();
  await page.unroute("**/fonts/NotoSans-Regular.ttf");
  const pdf = await pdfContents(await downloadFile(page, dialog));
  expect(pdf.text).toContain("điều kỳ diệu");
  expect(pdf.text).toContain("Nghĩa tiếng Việt 1");
});

test("download failure keeps selections and allows a successful retry", async ({ page }) => {
  const records = vocabulary(2);
  await seedWords(page, records);
  await page.getByRole("checkbox", { name: `Select ${records[0].term}`, exact: true }).check();
  const dialog = await prepareExport(page, "xlsx", true);
  await page.evaluate(() => {
    const original = URL.createObjectURL;
    (window as unknown as { restoreExportDownload: () => void }).restoreExportDownload = () => { URL.createObjectURL = original; };
    URL.createObjectURL = () => { throw new Error("Download unavailable for this test"); };
  });
  await dialog.getByRole("button", { name: "Download file", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/could not|unable|failed/i);
  await page.evaluate(() => (window as unknown as { restoreExportDownload: () => void }).restoreExportDownload());
  expect(await spreadsheetValues(page, await downloadFile(page, dialog))).toEqual([["STT", "Word / Phrase", "Meaning"], ["1", records[0].term, records[0].meaning]]);
  await expect(page.getByRole("checkbox", { name: `Select ${records[0].term}`, exact: true })).toBeChecked();
});

for (const field of ["term", "meaning"] as const) {
  test(`unsupported PDF glyphs in ${field} show an Excel suggestion and keep Excel export available`, async ({ page }) => {
    const record = { ...vocabulary(1)[0], [field]: "漢字 🦉" };
    await seedWords(page, [record]);
    const dialog = await prepareExport(page, "pdf");
    await dialog.getByRole("button", { name: "Download file", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(/Excel/i);
    await expect(dialog.getByRole("button", { name: "Download file", exact: true })).toBeEnabled();
    await dialog.getByLabel("File format", { exact: true }).selectOption("xlsx");
    const download = await downloadFile(page, dialog);
    expect(await spreadsheetValues(page, download)).toEqual([["STT", "Word / Phrase", "Meaning"], ["1", record.term, record.meaning]]);
    await expect(page.locator(".word-card h2")).toHaveText(record.term);
    await expect(page.locator(".word-meaning")).toHaveText(record.meaning);
  });
}
