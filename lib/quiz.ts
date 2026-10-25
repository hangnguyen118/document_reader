import type { VocabularyItem } from "./types";

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const target = Math.min(index, Math.floor(random() * (index + 1)));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function quizOptions(current: VocabularyItem, session: VocabularyItem[], random: () => number = Math.random): string[] {
  const correct = current.meaning.trim();
  const others = [...new Set(session.map((item) => item.meaning.trim()).filter((meaning) => meaning && meaning !== correct))];
  return shuffle([correct, ...shuffle(others, random).slice(0, 3)], random);
}
export function eligibleVocabulary(items: VocabularyItem[]) { return items.filter((item) => item.term.trim() && item.meaning.trim()); }
