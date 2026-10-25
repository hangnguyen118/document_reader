import test from "node:test";
import assert from "node:assert/strict";
import { countWords, normalizeText, paginateText, segmentText, splitForSpeech } from "../../lib/text";
import { importDocument, MAX_FILE_BYTES } from "../../lib/import-document";

test("plain text pagination preserves all characters and paragraph boundaries", () => {
  const text = Array.from({ length: 25 }, (_, index) => `Paragraph ${index}. A quiet moment for reading and learning.`).join("\n\n");
  const pages = paginateText(text, 180);
  assert.ok(pages.length > 1); assert.equal(pages.join(""), text);
  assert.ok(pages.every((page) => page.length <= 180));
});
test("normalization supports Windows line endings and empty documents", () => {
  assert.equal(normalizeText("\r\n A\r\nB\u0000 \r\n"), "A\nB");
  assert.deepEqual(paginateText(" \n\t"), []); assert.equal(countWords(""), 0);
  assert.equal(countWords("There is\nmore to learn."), 5);
});
test("speech chunks preserve positions and do not skip words", () => {
  const text = "A quiet morning. A longer sentence that offers a little space for your thoughts and an invitation to learn.";
  const chunks = splitForSpeech(text, 45);
  assert.equal(chunks.map((chunk) => chunk.text).join(""), text);
  for (const chunk of chunks) { assert.equal(text.slice(chunk.start, chunk.start + chunk.text.length), chunk.text); assert.ok(chunk.text.length <= 45); }
});
test("overlapping highlights render without changing document text", () => {
  const text = "A small collection of words.";
  const parts = segmentText(text, [{ start: 2, end: 18, id: "a" }, { start: 8, end: 25, id: "b" }]);
  assert.equal(parts.map((part) => part.text).join(""), text);
  assert.ok(parts.some((part) => part.ranges.length === 2));
  assert.ok(parts.every((part) => part.text === text.slice(part.start, part.end)));
  assert.deepEqual(segmentText(text, [{ start: -1, end: 100 }]).map((part) => part.text), [text]);
});
test("TXT and Markdown uploads remain plain text with stable pages", async () => {
  const content = "# A quiet page\n\n<script>window.injected = true</script>\n\nTime to read.";
  const result = await importDocument(new File([content], "my-reading.md"));
  assert.equal(result.type, "MD"); assert.equal(result.title, "my reading");
  assert.equal(result.pages.join(""), content); assert.equal(result.uploaded, true);
  assert.equal(result.wordCount, countWords(content));
});
test("uploads reject empty, unsupported, and oversized files", async () => {
  await assert.rejects(() => importDocument(new File([" "], "empty.txt")), /readable text/);
  await assert.rejects(() => importDocument(new File(["text"], "old.doc")), /PDF, DOCX, TXT/);
  const file = new File(["text"], "large.txt"); Object.defineProperty(file, "size", { value: MAX_FILE_BYTES + 1 });
  await assert.rejects(() => importDocument(file), /20 MB/);
});
