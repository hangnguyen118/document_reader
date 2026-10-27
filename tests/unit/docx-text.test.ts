import test from "node:test";
import assert from "node:assert/strict";
import { extractRawText } from "mammoth/mammoth.browser";
import { importDocument } from "../../lib/import-document";
import { vietnameseDOCX } from "../fixtures/vietnamese-docx";

test("DOCX extraction preserves Vietnamese headings, split combining marks, punctuation, and paragraph spacing", async () => {
  const fixture = await vietnameseDOCX();
  const bytes = new Uint8Array(fixture.buffer);
  const result = await extractRawText({ arrayBuffer: bytes.buffer });
  assert.equal(result.value, `${fixture.text}\n\n`);
  assert.deepEqual(result.messages, []);
  const document = await importDocument(new File([bytes], "vietnamese-heading.docx"));
  assert.equal(document.pages.join(""), fixture.text);
  assert.equal(document.type, "DOCX");
});
