import { segmentGraphemes, type GraphemeSegments } from "./graphemes";

export const countWords = (text: string) => text.trim() ? text.trim().split(/\s+/u).length : 0;
export const normalizeText = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();

function graphemeStart(segments: GraphemeSegments, offset: number) {
  return segments.containing(offset)?.index ?? offset;
}

function graphemeEnd(segments: GraphemeSegments, offset: number) {
  const segment = segments.containing(offset);
  return segment && offset > segment.index ? segment.index + segment.segment.length : offset;
}

// Prefer a boundary before the limit, but always keep at least one whole grapheme.
function graphemeSplit(segments: GraphemeSegments, offset: number, start: number) {
  const split = graphemeStart(segments, offset);
  return split > start ? split : graphemeEnd(segments, offset);
}

/** Split plain text at paragraph/sentence boundaries without losing content. */
export function paginateText(input: string, target = 2600): string[] {
  const text = normalizeText(input);
  if (!text) return [];
  const pages: string[] = [];
  const graphemes = segmentGraphemes(text);
  let start = 0;
  while (text.length - start > target) {
    const limit = start + target;
    let split = text.lastIndexOf("\n\n", limit);
    if (split < start + target / 2) split = text.lastIndexOf(". ", limit) + 1;
    if (split < start + target / 2) split = text.lastIndexOf(" ", limit);
    if (split <= start) split = limit;
    split = graphemeSplit(graphemes, split, start);
    pages.push(text.slice(start, split));
    start = split; // Preserve whitespace so joining pages reproduces the text.
  }
  if (start < text.length) pages.push(text.slice(start));
  return pages;
}

export function splitForSpeech(text: string, maxLength = 240): { text: string; start: number }[] {
  const chunks: { text: string; start: number }[] = [];
  const graphemes = segmentGraphemes(text);
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxLength, text.length);
    if (end < text.length) {
      const sentence = Math.max(text.lastIndexOf(". ", end), text.lastIndexOf("? ", end), text.lastIndexOf("! ", end));
      const space = text.lastIndexOf(" ", end);
      if (sentence > start + maxLength / 3) end = sentence + 1;
      else if (space > start) end = space + 1;
      end = graphemeSplit(graphemes, end, start);
    }
    const chunk = text.slice(start, end);
    if (chunk.trim()) chunks.push({ text: chunk, start });
    start = end;
  }
  return chunks;
}

export interface TextRange { start: number; end: number; id?: string }
export function segmentText(text: string, ranges: TextRange[]) {
  const graphemes = segmentGraphemes(text);
  // Only expand presentation ranges. Keep the source and persisted UTF-16 offsets
  // intact: NFC normalization would invalidate highlights in existing NFD books.
  const valid = ranges.filter((r) => r.start >= 0 && r.end <= text.length && r.end > r.start)
    .map((r) => ({ ...r, start: graphemeStart(graphemes, r.start), end: graphemeEnd(graphemes, r.end) }));
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
  const source = root.textContent ?? "";
  const graphemes = segmentGraphemes(source);
  const offset = prefix.toString().length;
  const start = graphemeStart(graphemes, offset);
  const end = graphemeEnd(graphemes, offset + range.toString().length);
  const text = source.slice(start, end);
  return text.trim() ? { start, end, text } : null;
}
