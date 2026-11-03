import type { MarkdownDocument, MarkdownPage } from "./markdown";
import type { Highlight } from "./types";

/** A boundary belongs to the following page, except the document's final end. */
export function markdownPageForOffset(pages: readonly MarkdownPage[], offset: number): number {
  if (!pages.length || !Number.isFinite(offset) || offset <= 0) return 0;
  const index = pages.findIndex((page) => page.end > offset);
  return index < 0 ? pages.length - 1 : index;
}

/** Map legacy source coordinates without changing the stored Markdown pages. */
export function markdownPreviewOffset(model: MarkdownDocument, sourceOffset: number): number {
  if (!Number.isFinite(sourceOffset) || sourceOffset <= 0) return 0;
  for (const run of model.runs) {
    if (run.sourceStart === undefined || run.sourceEnd === undefined) continue;
    if (sourceOffset <= run.sourceStart) return run.start;
    if (sourceOffset <= run.sourceEnd) return run.start + Math.min(sourceOffset - run.sourceStart, run.end - run.start);
  }
  return model.text.length;
}

/** Keep annotations saved before preview support, without rewriting saved offsets. */
export function markdownHighlightRanges(model: MarkdownDocument, highlights: Highlight[]): Highlight[] {
  return highlights.flatMap((highlight) => {
    if (highlight.coordinateSpace === "markdown-preview") return [highlight];
    const run = model.runs.find((item) => item.sourceStart !== undefined && item.sourceEnd !== undefined && item.sourceStart <= highlight.start && item.sourceEnd >= highlight.start);
    if (!run || !highlight.text) return [];
    const estimated = run.start + Math.min(highlight.start - run.sourceStart!, run.end - run.start);
    let candidate = model.text.indexOf(highlight.text), nearest = -1;
    while (candidate >= 0) {
      if (nearest < 0 || Math.abs(candidate - estimated) < Math.abs(nearest - estimated)) nearest = candidate;
      candidate = model.text.indexOf(highlight.text, candidate + 1);
    }
    return nearest < 0 ? [] : [{ ...highlight, start: nearest, end: nearest + highlight.text.length }];
  });
}
