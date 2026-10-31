import { segmentGraphemes } from "./graphemes";

/** Read offsets from content spans, excluding Copy controls and the contents list. */
export function markdownSelectionOffsets(root: HTMLElement, selection: Selection | null) {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const spans = Array.from(root.querySelectorAll<HTMLElement>("[data-markdown-start]"));
  const selected = spans.filter((span) => range.intersectsNode(span));
  if (!selected.length) return null;
  function boundary(span: HTMLElement, node: Node, nodeOffset: number, end: boolean) {
    const start = Number(span.dataset.markdownStart);
    const value = span.textContent ?? "";
    if (!span.contains(node)) return start + (end ? value.length : 0);
    const prefix = document.createRange(); prefix.selectNodeContents(span); prefix.setEnd(node, nodeOffset);
    const offset = prefix.toString().length;
    const grapheme = segmentGraphemes(value).containing(offset);
    return start + (grapheme && offset > grapheme.index ? end ? grapheme.index + grapheme.segment.length : grapheme.index : offset);
  }
  const start = boundary(selected[0], range.startContainer, range.startOffset, false);
  const last = selected[selected.length - 1];
  const end = boundary(last, range.endContainer, range.endOffset, true);
  const text = spans.map((span) => {
    const offset = Number(span.dataset.markdownStart), value = span.textContent ?? "";
    return value.slice(Math.max(0, start - offset), Math.max(0, Math.min(value.length, end - offset)));
  }).join("");
  return text.trim() && end > start ? { start, end, text } : null;
}
