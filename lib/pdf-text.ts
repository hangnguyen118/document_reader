import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";
import { normalizeText } from "./text";

export function extractPdfText(items: readonly (TextItem | TextMarkedContent)[]): string {
  // PDF.js includes explicit/inferred spaces in `str`. An item boundary can be
  // inside a word or even between a letter and its combining accents.
  return normalizeText(items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : "") : "").join(""));
}
