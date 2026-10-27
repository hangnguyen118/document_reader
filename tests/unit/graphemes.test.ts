import test from "node:test";
import assert from "node:assert/strict";
import { segmentGraphemes } from "../../lib/graphemes";

const nativeSegmenter = new Intl.Segmenter("vi", { granularity: "grapheme" });

function withoutNativeSegmenter(run: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, "Segmenter")!;
  try {
    Object.defineProperty(Intl, "Segmenter", { configurable: true, value: undefined });
    run();
  } finally {
    Object.defineProperty(Intl, "Segmenter", descriptor);
  }
}

function expectNativeBoundaries(text: string) {
  const fallback = segmentGraphemes(text);
  const expected = nativeSegmenter.segment(text);
  for (let offset = 0; offset < text.length; offset++) {
    const segment = expected.containing(offset)!;
    assert.deepEqual(fallback.containing(offset), { index: segment.index, segment: segment.segment }, `UTF-16 offset ${offset}`);
  }
  assert.equal(fallback.containing(-1), undefined);
  assert.equal(fallback.containing(text.length), undefined);
  assert.equal(fallback.containing(Infinity), undefined);
}

test("native grapheme queries preserve Vietnamese text and UTF-16 indices", () => {
  const text = "Ắ ĐỌC sách, 👩🏽‍💻!".normalize("NFD");
  const segments = segmentGraphemes(text);
  for (const { index, segment } of nativeSegmenter.segment(text)) {
    assert.equal(segments.containing(index)?.segment, segment);
  }
});

test("without Intl.Segmenter every Vietnamese combining letter stays together", () => {
  const capitals = "ẮẰẲẴẶẤẦẨẪẬẾỀỂỄỆỐỒỔỖỘỚỜỞỠỢỨỪỬỮỰÝỲỶỸỴĐ";
  withoutNativeSegmenter(() => {
    expectNativeBoundaries(`${capitals}\n${capitals.toLowerCase()}\n\n${capitals.normalize("NFD")} “giữ nguyên”, dấu câu!`);
    expectNativeBoundaries("");
    expectNativeBoundaries("\u0301\u0306A\u0306\u0301\tE\u0323\u0302");
  });
});

test("fallback preserves surrogate pairs, emoji modifiers, joiners, flags and CRLF", () => {
  withoutNativeSegmenter(() => {
    expectNativeBoundaries("A👩🏽‍💻👨‍👩‍👧‍👦❤️1️⃣🇻🇳🇺🇸🇦\r\nB\n\u0301C");
    expectNativeBoundaries("🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}!");
  });
});
