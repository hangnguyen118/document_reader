import "fake-indexeddb/auto";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deleteDB } from "idb";
import JSZip from "jszip";
import { deleteRecord, loadVocabulary, saveRecord } from "../../lib/database";
import { createVocabularyExcel, createVocabularyPdf, exportVocabularyFile, vocabularyExportRows, type VocabularyExportRow } from "../../lib/vocabulary-export";
import type { VocabularyItem } from "../../lib/types";

beforeEach(async () => { await deleteDB("folio-reading"); });

function word(id: string, term: string, createdAt = 0, meaning = ""): VocabularyItem {
  return { id, term, createdAt, meaning, context: "", documentId: "", documentTitle: "Added by you", page: 0 };
}

function xmlText(value: string): string {
  return value.replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (match, number: string | undefined, named: string | undefined) =>
    number ? String.fromCodePoint(number.startsWith("x") ? parseInt(number.slice(1), 16) : Number(number))
      : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named!] ?? match));
}

function textNodes(xml: string) {
  return Array.from(xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), (match) => xmlText(match[1])).join("");
}

async function excelRows(blob: Blob): Promise<string[][]> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.ok(zip.file("[Content_Types].xml"));
  const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  assert.doesNotMatch(sheet, /<f[\s>]/, "Saved terms and meanings must never become spreadsheet formulas");
  const stringsXml = await zip.file("xl/sharedStrings.xml")?.async("string") ?? "";
  const strings = Array.from(stringsXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g), (match) => textNodes(match[1]));
  return Array.from(sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g), (row) => {
    const cells = Array.from(row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g), (cell) => {
      const body = cell[2] ?? "";
      const value = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
      const type = cell[1].match(/\bt="([^"]+)"/)?.[1];
      return type === "s" ? strings[Number(value)] : type === "inlineStr" ? textNodes(body) : xmlText(value);
    });
    return cells.length ? cells : [""];
  });
}

async function pdfFont() {
  const font = await readFile(new URL("../../public/fonts/NotoSans-Regular.ttf", import.meta.url));
  return new Uint8Array(font).buffer;
}

async function pdfRows(rows: readonly VocabularyExportRow[]) {
  const blob = await createVocabularyPdf(rows, await pdfFont());
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), "%PDF-");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({ data: bytes, useSystemFonts: false });
  try {
    const pdf = await loading.promise;
    const pages: { text: string; width: number; items: { text: string; x: number; y: number; width: number }[] }[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const items = content.items.flatMap((item) => "str" in item ? [{ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width }] : []);
      pages.push({ text: items.map((item) => item.text).join(" "), width: page.view[2] - page.view[0], items });
    }
    return pages;
  } finally { await loading.destroy(); }
}

const headers = ["STT", "Word / Phrase", "Meaning"];
type PdfPage = Awaited<ReturnType<typeof pdfRows>>[number];

function pdfColumns(page: PdfPage) {
  const heading = headers.map((text) => {
    const item = page.items.find((item) => item.text === text);
    assert.ok(item, `Each PDF page must contain the ${text} header`);
    return item;
  });
  assert.ok(heading[0].x < heading[1].x && heading[1].x < heading[2].x, "PDF columns must have the requested order");
  const body = page.items.filter((item) => item.text.trim() && item.y < heading[0].y - 1 && item.y > 30);
  return [
    body.filter((item) => item.x < heading[1].x - 1),
    body.filter((item) => item.x >= heading[1].x - 1 && item.x < heading[2].x - 1),
    body.filter((item) => item.x >= heading[2].x - 1)
  ];
}

function textWithoutWhitespace(text: string) { return text.replace(/\s+/g, ""); }

test("export mapping preserves stored terms, meanings, blanks and deterministic order without mutating vocabulary", () => {
  const records = [word("old", "  older phrase  ", 1, "  nghĩa cũ\nnguyên văn  "), word("b", "second", 2, "bình yên"), word("a", "first", 2, "điều kỳ diệu"),
    word("null", null as unknown as string, 0, null as unknown as string), word("missing", undefined as unknown as string), word("empty", "")];
  delete (records[4] as Partial<VocabularyItem>).meaning;
  const original = records.map((record) => ({ ...record }));
  records.forEach(Object.freeze); Object.freeze(records);
  assert.deepEqual(vocabularyExportRows(records, "all"), [
    { wordOrPhrase: "first", meaning: "điều kỳ diệu" }, { wordOrPhrase: "second", meaning: "bình yên" }, { wordOrPhrase: "  older phrase  ", meaning: "  nghĩa cũ\nnguyên văn  " },
    { wordOrPhrase: "", meaning: "" }, { wordOrPhrase: "", meaning: "" }, { wordOrPhrase: "", meaning: "" }
  ]);
  assert.deepEqual(vocabularyExportRows(records, "selected", new Set(["old", "b", "deleted"])), [{ wordOrPhrase: "second", meaning: "bình yên" }, { wordOrPhrase: "  older phrase  ", meaning: "  nghĩa cũ\nnguyên văn  " }]);
  assert.deepEqual(vocabularyExportRows(records, "selected"), []);
  assert.deepEqual(records, original);
});

test("PDF and Excel have exactly three columns and number every stored term/meaning row", async () => {
  const records = [
    word("1", "serenity", 5, "sự thanh thản; bình yên giữa những bộn bề"),
    word("2", "wonder", 4, "điều kỳ diệu\nsự ngạc nhiên & hứng khởi <nghĩa đã lưu>"),
    word("3", "no-meaning", 3),
    word("4", "null-meaning", 2, null as unknown as string),
    word("5", "missing-meaning", 1)
  ];
  delete (records[4] as Partial<VocabularyItem>).meaning;
  const rows = vocabularyExportRows(records, "all");
  const pages = await pdfRows(rows);
  const text = pages.map((page) => page.text).join(" ").replace(/\s+/g, " ");
  for (const [index, record] of records.entries()) {
    const expected = [String(index + 1), record.term, record.meaning].filter(Boolean).join(" ").replace(/\s+/g, " ");
    assert.ok(text.includes(expected), `PDF is missing the stored term/meaning pair: ${expected}`);
  }
  assert.doesNotMatch(text, /undefined|null(?=\s)|\uFFFD/);
  const term = pages[0].items.find((item) => item.text === "serenity")!;
  const meaning = pages[0].items.find((item) => item.text === records[0].meaning)!;
  assert.equal(meaning.y, term.y, "The meaning and term must start on the same table row");
  assert.ok(meaning.x > term.x + term.width, "The meaning must be in a separate column to the right of its term");
  assert.deepEqual(pdfColumns(pages[0])[0].map((item) => item.text), records.map((_, index) => String(index + 1)));
  assert.deepEqual(await excelRows(await createVocabularyExcel(rows)), [headers, ...records.map(({ term, meaning }, index) => [String(index + 1), term, meaning ?? ""])]);
});

test("PDF composes Vietnamese accents without changing stored values or Excel text", async () => {
  const term = "điều kỳ diệu";
  const meaning = "sự bình yên, hứng khởi, đầy đủ ý nghĩa";
  const rows = vocabularyExportRows([word("decomposed", term.normalize("NFD"), 0, meaning.normalize("NFD"))], "all");
  const original = rows.map((row) => ({ ...row }));
  const pages = await pdfRows(rows);
  const columns = pdfColumns(pages[0]);
  assert.equal(columns[1].map((item) => item.text).join(" "), term);
  assert.equal(columns[2].map((item) => item.text).join(" "), meaning);
  assert.doesNotMatch(pages[0].text, /[\u0300-\u036f\uFFFD]/);
  assert.deepEqual(rows, original);
  assert.deepEqual(await excelRows(await createVocabularyExcel(rows)), [headers, ["1", term.normalize("NFD"), meaning.normalize("NFD")]]);
});

test("Excel stores numeric sequence values and wraps both text columns with a wider Meaning column", async () => {
  const blob = await createVocabularyExcel([{ wordOrPhrase: "a long phrase ".repeat(15), meaning: "nghĩa dài có dấu ".repeat(50) }]);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const widths = Array.from(sheet.matchAll(/<col\b[^>]*\bwidth="([\d.]+)"[^>]*\/>/g), (match) => Number(match[1]));
  assert.equal(widths.length, 3, "The workbook must contain exactly three configured columns");
  assert.ok(widths[2] > widths[1] && widths[1] > widths[0], "Meaning needs more space than Word / Phrase and STT");
  const numberCell = sheet.match(/<c\b[^>]*\br="A2"[^>]*>[\s\S]*?<\/c>/)![0];
  assert.doesNotMatch(numberCell, /\bt="(?:s|inlineStr)"/, "STT values should be usable as numbers in spreadsheets");
  assert.match(numberCell, /<v>1<\/v>/);
  const styles = await zip.file("xl/styles.xml")!.async("string");
  const cellStyles = Array.from(styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)![1].matchAll(/<xf\b[^>]*?\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g), (match) => match[0]);
  for (const address of ["B2", "C2"]) {
    const cell = sheet.match(new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*>`))![0];
    const styleIndex = Number(cell.match(/\bs="(\d+)"/)![1]);
    assert.match(cellStyles[styleIndex], /\bwrapText="1"/, `${address} must wrap rather than hide long text`);
  }
  assert.match(sheet, /<pane\b[^>]*\bySplit="1"[^>]*\bstate="frozen"/, "The header should remain visible while scrolling");
});

test("Excel and PDF preserve Unicode, XML characters, formula-like values and empty row positions", async () => {
  const records = [word("1", "start-marker", 7), word("2", "điều kỳ diệu — bình yên", 6),
    word("3", '=SUM(1,2) <tag> & "quoted"', 5, '=SUM(3,4) <nghĩa> & "đã lưu"'), word("4", "", 4),
    word("5", null as unknown as string, 3), word("6", undefined as unknown as string, 2), word("7", "end-marker", 1)];
  const rows = vocabularyExportRows(records, "all");
  const excel = await createVocabularyExcel(rows);
  assert.match(excel.type, /spreadsheetml/);
  assert.deepEqual(await excelRows(excel), [headers, ...rows.map(({ wordOrPhrase, meaning }, index) => [String(index + 1), wordOrPhrase, meaning ?? ""])]);
  const pages = await pdfRows(rows);
  assert.equal(pages.length, 1);
  const columns = pdfColumns(pages[0]);
  assert.deepEqual(columns[0].map((item) => item.text), rows.map((_, index) => String(index + 1)));
  for (const [column, key] of [[1, "wordOrPhrase"], [2, "meaning"]] as const) {
    assert.equal(textWithoutWhitespace(columns[column].map((item) => item.text).join(" ")), textWithoutWhitespace(rows.map((row) => row[key] ?? "").join(" ")));
  }
  const compact = await pdfRows(rows.filter(({ wordOrPhrase }) => Boolean(wordOrPhrase)));
  const endPosition = pages[0].items.find((item) => item.text === "end-marker")!.y;
  const compactEndPosition = compact[0].items.find((item) => item.text === "end-marker")!.y;
  assert.ok(endPosition < compactEndPosition - 40, "Three empty rows must occupy space in the PDF rather than disappear");
});

test("export reloads all stored words and resolves selected IDs against current saved data", async () => {
  await saveRecord("vocabulary", word("first", "original", 1, "nghĩa cũ"));
  const initial = await loadVocabulary();
  await saveRecord("vocabulary", word("later", "added after initial load", 2, "nghĩa mới thêm"));
  await saveRecord("vocabulary", word("first", "edited since initial load", 1, "nghĩa đã sửa"));
  assert.equal(initial.length, 1);
  assert.equal((await loadVocabulary()).length, 2);
  const all = await exportVocabularyFile("xlsx", "all", new Set());
  assert.equal(all.count, 2);
  assert.match(all.fileName, /^vocabulary-all-\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.deepEqual(await excelRows(all.blob), [headers, ["1", "added after initial load", "nghĩa mới thêm"], ["2", "edited since initial load", "nghĩa đã sửa"]]);
  await deleteRecord("vocabulary", "later");
  const selected = await exportVocabularyFile("xlsx", "selected", new Set(["first", "later", "unknown"]));
  assert.equal(selected.count, 1);
  assert.deepEqual(await excelRows(selected.blob), [headers, ["1", "edited since initial load", "nghĩa đã sửa"]]);
  await assert.rejects(() => exportVocabularyFile("xlsx", "selected", new Set(["later"])), /no saved words/i);
});

test("export rejects empty selected IDs and an empty saved collection before file generation", async () => {
  await assert.rejects(() => exportVocabularyFile("xlsx", "selected", new Set()), /select at least one/i);
  await assert.rejects(() => exportVocabularyFile("pdf", "selected", new Set()), /select at least one/i);
  await assert.rejects(() => exportVocabularyFile("xlsx", "all", new Set()), /no saved words/i);
  await assert.rejects(() => exportVocabularyFile("pdf", "all", new Set()), /no saved words/i);
});

test("PDF wraps long phrases and Vietnamese meanings across pages without losing content or overflowing columns", async () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({
    wordOrPhrase: `Begin-${index}-${"UnbrokenVocabulary".repeat(9)}-End-${index}`,
    meaning: `Nghĩa-${index}: ${"sự bình yên, niềm hạnh phúc và những điều kỳ diệu. ".repeat(35)}Hết-nghĩa-${index}`
  }));
  const pages = await pdfRows(rows);
  assert.ok(pages.length > 3);
  const columns = pages.map(pdfColumns);
  assert.deepEqual(columns.flatMap((page) => page[0].map((item) => item.text)), rows.map((_, index) => String(index + 1)));
  for (const [column, key] of [[1, "wordOrPhrase"], [2, "meaning"]] as const) {
    const actual = columns.flatMap((page) => page[column].map((item) => item.text)).join(" ");
    assert.equal(textWithoutWhitespace(actual), textWithoutWhitespace(rows.map((row) => row[key]).join(" ")), `PDF lost content in ${headers[column]}`);
  }
  for (const [index, page] of pages.entries()) {
    const meaningStart = page.items.find((item) => item.text === "Meaning")!.x;
    for (const item of columns[index][1]) assert.ok(item.x + item.width < meaningStart, "A wrapped phrase must not overlap Meaning");
    for (const item of columns[index][2]) assert.ok(item.x + item.width <= page.width - 15 * 72 / 25.4 + 1, "A wrapped meaning must stay inside the table");
  }
});

test("PDF preserves the complete meaning when one vocabulary row spans multiple pages", async () => {
  // Imported historical records may exceed the current editor's length limit.
  const meaning = `Start-of-meaning ${"đầy đủ nghĩa tiếng Việt và các dấu chính xác. ".repeat(220)}End-of-meaning`;
  const rows = [{ wordOrPhrase: "oversize-entry", meaning }, { wordOrPhrase: "next-entry", meaning: "nghĩa tiếp theo" }];
  const pages = await pdfRows(rows);
  assert.ok(pages.length > 1);
  const columns = pages.map(pdfColumns);
  const text = columns.flatMap((page) => page[2].map((item) => item.text)).join(" ");
  assert.equal(textWithoutWhitespace(text), textWithoutWhitespace(rows.map((row) => row.meaning).join(" ")));
  assert.deepEqual(columns.flatMap((page) => page[0].map((item) => item.text)), ["1", "2"]);
});

test("PDF rejects unsupported CJK and emoji with an Excel suggestion instead of losing glyphs", async () => {
  const font = await pdfFont();
  for (const wordOrPhrase of ["漢字", "quiet 🦉"]) {
    const rows = [{ wordOrPhrase }];
    await assert.rejects(() => createVocabularyPdf(rows, font), /Excel/i);
    assert.deepEqual(await excelRows(await createVocabularyExcel(rows)), [headers, ["1", wordOrPhrase, ""]]);
    await assert.rejects(() => createVocabularyPdf([{ wordOrPhrase: "English term", meaning: wordOrPhrase }], font), /Excel/i);
    assert.deepEqual(await excelRows(await createVocabularyExcel([{ wordOrPhrase: "English term", meaning: wordOrPhrase }])), [headers, ["1", "English term", wordOrPhrase]]);
  }
});
