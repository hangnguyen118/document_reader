import test from "node:test";
import assert from "node:assert/strict";
import { normalizeText, paginateText, segmentText, selectionOffsets, splitForSpeech } from "../../lib/text";

const segmenter = new Intl.Segmenter("vi", { granularity: "grapheme" });
const capitals = "ẮẰẲẴẶẤẦẨẪẬẾỀỂỄỆỐỒỔỖỘỚỜỞỠỢỨỪỬỮỰÝỲỶỸỴĐ";

function assertWholeGraphemes(text: string, parts: { start: number; text: string }[]) {
  const boundaries = new Set([text.length, ...Array.from(segmenter.segment(text), ({ index }) => index)]);
  assert.equal(parts.map((part) => part.text).join(""), text);
  for (const part of parts) {
    assert.ok(boundaries.has(part.start), `Start ${part.start} splits a grapheme`);
    assert.ok(boundaries.has(part.start + part.text.length), `End ${part.start + part.text.length} splits a grapheme`);
    assert.equal(part.text, text.slice(part.start, part.start + part.text.length));
  }
}

test("Vietnamese normalization keeps composed and decomposed source, punctuation and spacing intact", () => {
  const text = `${capitals}\n${capitals.toLowerCase()}\n\n${capitals.normalize("NFD")}\t“Đọc  sách”, rõ ràng!`;
  assert.equal(normalizeText(text), text);
  assert.equal(paginateText(text).join(""), text);
});

test("highlight and speech ranges inside stacked accents expand only for presentation", () => {
  const letter = "Ắ".normalize("NFD");
  const text = `${letter} đọc sách.`;
  const ranges = [{ start: 1, end: 2, id: "highlight" }, { start: 2, end: 3, id: "speech" }];
  const originals = structuredClone(ranges);
  const parts = segmentText(text, ranges);
  assertWholeGraphemes(text, parts);
  assert.equal(parts[0].text, letter);
  assert.deepEqual(parts[0].ranges.map((range) => range.id), ["highlight", "speech"]);
  assert.deepEqual(ranges, originals, "Never rewrite persisted UTF-16 offsets");
});

test("every interior cut in Vietnamese letters, surrogate pairs and joined emoji stays intact", () => {
  const text = `${capitals}${capitals.toLowerCase()}`.normalize("NFD") + "👩🏽‍💻";
  for (let offset = 1; offset < text.length; offset++) {
    const parts = segmentText(text, [{ start: offset, end: offset + 1, id: "speech" }]);
    assertWholeGraphemes(text, parts);
  }
});

test("pagination and speech fallback cuts preserve complete graphemes and raw offsets", () => {
  const text = `${capitals}${capitals.toLowerCase()}`.normalize("NFD") + "👩🏽‍💻";
  for (const limit of [1, 2, 3, 7, 12, 45]) {
    let offset = 0;
    const pages = paginateText(text, limit).map((text) => {
      const part = { text, start: offset }; offset += text.length; return part;
    });
    assertWholeGraphemes(text, pages);
    assertWholeGraphemes(text, splitForSpeech(text, limit));
  }
});

test("selection offsets expand to whole letters without normalizing the selected source", () => {
  const text = `“${"Ắ".normalize("NFD")}, tiếng Việt.”`;
  // Minimal DOM range doubles keep this unit focused on offset calculations;
  // browser selection and saved highlights are exercised by the E2E suite.
  const root = { textContent: text, contains: () => true } as unknown as HTMLElement;
  const selection = {
    isCollapsed: false, rangeCount: 1,
    getRangeAt: () => ({
      startContainer: {}, endContainer: {}, startOffset: 2,
      toString: () => text.slice(2, 3),
      cloneRange: () => ({ selectNodeContents() {}, setEnd() {}, toString: () => text.slice(0, 2) })
    })
  } as unknown as Selection;
  const result = selectionOffsets(root, selection);
  assert.deepEqual(result, { start: 1, end: 4, text: text.slice(1, 4) });
  assert.equal(selectionOffsets(root, null), null);
});
