import test from "node:test";
import assert from "node:assert/strict";
import { importDocument, MAX_FILE_BYTES } from "../../lib/import-document";

test("Markdown imports retain exact source including CRLF, indentation, combining accents and final whitespace", async () => {
  const source = "\r\n# Tiếng Việt A\u0306\u0301 📖\r\n\r\n    indented code\r\n\r\n```typescript\r\nconst value = 1;  \r\n```\r\n\r\n";
  for (const extension of ["md", "markdown", "MD"]) {
    const result = await importDocument(new File([source], `original.${extension}`));
    assert.equal(result.type, "MD");
    assert.deepEqual(result.pages, [source]);
    assert.equal(result.currentPage, 0);
  }
});

test("long Markdown stays together so pagination cannot split fences, references or tables", async () => {
  const source = `# Long document\n\n${"A useful paragraph. ".repeat(500)}\n\n\`\`\`json\n${JSON.stringify({ value: "Long code ".repeat(700) }, null, 2)}\n\`\`\`\n\n| Heading | Value |\n| --- | --- |\n| A | B |\n`;
  const result = await importDocument(new File([source], "long.md"));
  assert.deepEqual(result.pages, [source]);
});

test("empty Markdown has a previewable record while empty TXT retains its existing validation", async () => {
  for (const source of ["", " \r\n\t "]) {
    const result = await importDocument(new File([source], "empty.md"));
    assert.deepEqual(result.pages, [source]);
    assert.equal(result.wordCount, 0);
  }
  await assert.rejects(importDocument(new File([""], "empty.txt")), /does not contain readable text/);
});

test("Markdown rejects binary content, malformed Unicode and read failures with actionable errors", async () => {
  await assert.rejects(importDocument(new File([new Uint8Array([0, 1, 2, 3])], "binary.md")), /binary data/i);
  await assert.rejects(importDocument(new File([new Uint8Array([0xC3, 0x28])], "invalid-utf8.md")), /UTF-8|could not be read/);
  const unreadable = new File(["# A heading"], "unreadable.md");
  Object.defineProperty(unreadable, "arrayBuffer", { value: async () => { throw new Error("Unable to read file"); } });
  await assert.rejects(importDocument(unreadable), /could not be read/i);
});

test("Markdown retains existing file and extracted text size limits", async () => {
  const oversized = new File(["# Markdown"], "oversized.md");
  Object.defineProperty(oversized, "size", { value: MAX_FILE_BYTES + 1 });
  await assert.rejects(importDocument(oversized), /too large/i);
  await assert.rejects(importDocument(new File(["a".repeat(1_000_001)], "too-long.md")), /one million characters/i);
});
