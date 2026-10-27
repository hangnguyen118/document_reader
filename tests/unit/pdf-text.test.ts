import test from "node:test";
import assert from "node:assert/strict";
import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";
import { extractPdfText } from "../../lib/pdf-text";
import { vietnamesePDF } from "../fixtures/vietnamese-pdf";

function text(str: string, hasEOL = false): TextItem {
  return { str, hasEOL, dir: "ltr", transform: [1, 0, 0, 1, 0, 0], width: 0, height: 18, fontName: "test" };
}

test("PDF extraction preserves run boundaries within Vietnamese graphemes, words, and punctuation", () => {
  const items: (TextItem | TextMarkedContent)[] = [
    { type: "beginMarkedContent", id: "heading" },
    text("A"), text("\u0306"), text("\u0301"), text(", "),
    text("Đ"), text("ỌC"), text(" "), text("SÁCH"), text("!", true),
    { type: "endMarkedContent", id: "heading" },
    text("Giữ  nguyên dấu câu: “đẹp”, đúng; đủ."), text("", true),
    text("Dòng tiếp theo.")
  ];
  assert.equal(extractPdfText(items), "A\u0306\u0301, ĐỌC SÁCH!\nGiữ  nguyên dấu câu: “đẹp”, đúng; đủ.\nDòng tiếp theo.");
  assert.equal(extractPdfText([]), "");
});

test("real embedded-font PDF keeps combining marks adjacent and retains both pages", async () => {
  const fixture = await vietnamesePDF();
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(fixture.buffer) });
  try {
    const pdf = await task.promise;
    assert.equal(pdf.numPages, fixture.pages.length);
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      if (number === 1) {
        const items = content.items.filter((item): item is TextItem => "str" in item);
        const accent = items.findIndex((item) => item.str === "\u0306\u0301");
        assert.ok(accent > 0, "The fixture must split the combining marks into a separate PDF.js item");
        assert.equal(items[accent - 1].str, "A");
        assert.equal(items[accent - 1].hasEOL, false);
      }
      assert.equal(extractPdfText(content.items), fixture.pages[number - 1]);
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
});
