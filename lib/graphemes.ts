export interface GraphemeSegments {
  containing(offset: number): { index: number; segment: string } | undefined;
}

let nativeSegmenter: Intl.Segmenter | undefined;
const mark = /\p{M}/u;
const isRegionalIndicator = (code: number) => code >= 0x1F1E6 && code <= 0x1F1FF;
const isControl = (code: number) => code <= 0x1F || (code >= 0x7F && code <= 0x9F) || code === 0x2028 || code === 0x2029;

/** Native Unicode segmentation, with a Vietnamese-safe fallback for older browsers. */
export function segmentGraphemes(text: string): GraphemeSegments {
  if (typeof Intl.Segmenter === "function") {
    nativeSegmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return nativeSegmenter.segment(text);
  }

  // Firefox 111–124 supports the app but has no Intl.Segmenter. This fallback
  // preserves combining letters, code points, and common emoji sequences; native
  // segmentation supplies the full script-specific Unicode rules when available.
  const boundaries = [0];
  let offset = 0;
  let previous = -1;
  let regionalRun = 0;
  for (const symbol of text) {
    const code = symbol.codePointAt(0)!;
    const extension = mark.test(symbol) || code === 0x200C
      || (code >= 0x1F3FB && code <= 0x1F3FF)
      || (code >= 0xE0020 && code <= 0xE007F);
    const joins = (previous === 0x0D && code === 0x0A)
      || (!isControl(previous) && !isControl(code)
        && (extension || code === 0x200D || previous === 0x200D
          || (isRegionalIndicator(code) && isRegionalIndicator(previous) && regionalRun % 2 === 1)));
    if (offset > 0 && !joins) boundaries.push(offset);
    regionalRun = isRegionalIndicator(code) ? regionalRun + 1 : 0;
    previous = code;
    offset += symbol.length;
  }
  boundaries.push(text.length);

  return {
    containing(offset) {
      const index = Number.isNaN(offset) ? 0 : Math.trunc(offset);
      if (index < 0 || index >= text.length || !Number.isFinite(index)) return undefined;
      // Find the last boundary at or before the requested UTF-16 offset.
      let low = 0;
      let high = boundaries.length - 1;
      while (low + 1 < high) {
        const middle = (low + high) >>> 1;
        if (boundaries[middle] <= index) low = middle;
        else high = middle;
      }
      return { index: boundaries[low], segment: text.slice(boundaries[low], boundaries[low + 1]) };
    }
  };
}
