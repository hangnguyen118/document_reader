export const countWords = (text: string) => text.trim() ? text.trim().split(/\s+/u).length : 0;
export const normalizeText = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();

/** Split plain text at paragraph/sentence boundaries without losing content. */
export function paginateText(input: string, target = 2600): string[] {
  const text = normalizeText(input);
  if (!text) return [];
  const pages: string[] = [];
  let remaining = text;
  while (remaining.length > target) {
    let split = remaining.lastIndexOf("\n\n", target);
    if (split < target / 2) split = remaining.lastIndexOf(". ", target) + 1;
    if (split < target / 2) split = remaining.lastIndexOf(" ", target);
    if (split <= 0) split = target;
    pages.push(remaining.slice(0, split));
    remaining = remaining.slice(split); // Preserve whitespace so joining pages reproduces the text.
  }
  if (remaining) pages.push(remaining);
  return pages;
}

export function splitForSpeech(text: string, maxLength = 240): { text: string; start: number }[] {
  const chunks: { text: string; start: number }[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxLength, text.length);
    if (end < text.length) {
      const sentence = Math.max(text.lastIndexOf(". ", end), text.lastIndexOf("? ", end), text.lastIndexOf("! ", end));
      const space = text.lastIndexOf(" ", end);
      if (sentence > start + maxLength / 3) end = sentence + 1;
      else if (space > start) end = space + 1;
    }
    const chunk = text.slice(start, end);
    if (chunk.trim()) chunks.push({ text: chunk, start });
    start = end;
  }
  return chunks;
}

export interface TextRange { start: number; end: number; id?: string }
export function segmentText(text: string, ranges: TextRange[]) {
  const valid = ranges.filter((r) => r.start >= 0 && r.end <= text.length && r.end > r.start);
  const bounds = [...new Set([0, text.length, ...valid.flatMap((r) => [r.start, r.end])])].sort((a, b) => a - b);
  return bounds.slice(0, -1).map((start, index) => {
    const end = bounds[index + 1];
    return { start, end, text: text.slice(start, end), ranges: valid.filter((r) => r.start <= start && r.end >= end) };
  });
}

export function selectionOffsets(root: HTMLElement, selection: Selection | null): { start: number; end: number; text: string } | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const prefix = range.cloneRange(); prefix.selectNodeContents(root); prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  const text = range.toString();
  return text.trim() ? { start, end: start + text.length, text } : null;
}
