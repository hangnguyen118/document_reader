import test from "node:test";
import assert from "node:assert/strict";
import { decodeDocumentText } from "../../lib/document-text";
import { importDocument } from "../../lib/import-document";

const content = "TIẾNG VIỆT: Ắ Ấ Ễ Ộ Ự; “Đọc sách”.\r\n\r\nA\u0306\u0301, Đọc sách! Đừng bỏ lỡ — giữ  nguyên dấu câu.";
const utf16 = Buffer.from(content, "utf16le");
const cases = [
  { name: "UTF-8", bytes: Buffer.from(content, "utf8") },
  { name: "UTF-8 with BOM", bytes: Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(content, "utf8")]) },
  { name: "UTF-16 little endian with BOM", bytes: Buffer.concat([Buffer.from([0xFF, 0xFE]), utf16]) },
  { name: "UTF-16 big endian with BOM", bytes: Buffer.concat([Buffer.from([0xFE, 0xFF]), Buffer.from(utf16).swap16()]) }
];

for (const { name, bytes } of cases) {
  test(`${name} text preserves Vietnamese code points, punctuation, and line structure`, async () => {
    assert.equal(decodeDocumentText(new Uint8Array(bytes).buffer), content);
    for (const extension of ["txt", "md"]) {
      const document = await importDocument(new File([new Uint8Array(bytes)], `vietnamese.${extension}`));
      assert.equal(document.pages.join(""), content.replace(/\r\n/g, "\n"));
      assert.equal(document.type, extension.toUpperCase());
      assert.ok(document.pages[0].includes("A\u0306\u0301"), "Decomposed accents remain unchanged");
    }
  });
}

test("Unicode text decoding preserves interior BOM characters and empty input", () => {
  assert.equal(decodeDocumentText(new ArrayBuffer(0)), "");
  const text = "Đọc\uFEFF sách.";
  assert.equal(decodeDocumentText(new TextEncoder().encode(text).buffer), text);
});
