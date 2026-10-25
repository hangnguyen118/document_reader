import test from "node:test";
import assert from "node:assert/strict";
import { eligibleVocabulary, quizOptions, shuffle } from "../../lib/quiz";
import type { VocabularyItem } from "../../lib/types";

const word = (term: string, meaning: string): VocabularyItem => ({ id: term, term, meaning, context: "", documentId: "", documentTitle: "Test", page: 0, createdAt: 0 });
test("quiz distractors come only from the current learning session", () => {
  const words = [word("quiet", "yên tĩnh"), word("wonder", "điều kỳ diệu"), word("patience", "sự kiên nhẫn"), word("attention", "sự chú ý"), word("habit", "thói quen")];
  const options = quizOptions(words[0], words, () => 0.3);
  assert.equal(options.length, 4); assert.ok(options.includes(words[0].meaning));
  assert.ok(options.every((option) => words.some((item) => item.meaning === option)));
  assert.equal(new Set(options).size, options.length);
});
test("duplicate meanings never become ambiguous answer choices", () => {
  const words = [word("quiet", "yên tĩnh"), word("silent", "yên tĩnh"), word("habit", "thói quen")];
  assert.deepEqual([...quizOptions(words[0], words)].sort(), ["yên tĩnh", "thói quen"].sort());
});
test("shuffling preserves the collection without mutating its source", () => {
  const input = [1, 2, 3, 4]; const result = shuffle(input, () => 0);
  assert.deepEqual(input, [1, 2, 3, 4]); assert.deepEqual([...result].sort(), input); assert.notDeepEqual(result, input);
});
test("learning excludes words without a term or meaning", () => {
  assert.deepEqual(eligibleVocabulary([word("a", "b"), word("empty", " "), word(" ", "meaning")]).map((item) => item.term), ["a"]);
});
