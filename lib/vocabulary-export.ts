import { loadVocabulary } from "./database";
import { VocabularyExportError } from "./vocabulary-export-error";
import type { VocabularyItem } from "./types";
import type { SheetData } from "write-excel-file/universal";

export type VocabularyExportFormat = "xlsx" | "pdf";
export type VocabularyExportScope = "all" | "selected";
export interface VocabularyExportRow { wordOrPhrase: string; meaning?: string }
export const VOCABULARY_EXPORT_HEADERS = ["STT", "Word / Phrase", "Meaning"];

/** Both formats share stored values, selection and ordering. Missing values remain empty. */
export function vocabularyExportRows(
  vocabulary: readonly VocabularyItem[],
  scope: VocabularyExportScope,
  selectedIds: ReadonlySet<string> = new Set()
): VocabularyExportRow[] {
  return vocabulary
    .filter((word) => scope === "all" || selectedIds.has(word.id))
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    .map((word) => ({ wordOrPhrase: word.term ?? "", meaning: word.meaning ?? "" }));
}

export async function createVocabularyExcel(rows: readonly VocabularyExportRow[]): Promise<Blob> {
  // Excel has a fixed sheet limit; fail explicitly instead of omitting records.
  if (rows.length > 1_048_575) throw new Error("The collection exceeds the Excel worksheet row limit.");
  const { default: writeExcelFile } = await import("write-excel-file/universal");
  const data: SheetData = [
    VOCABULARY_EXPORT_HEADERS.map((value) => ({ value, type: String, fontWeight: "bold", backgroundColor: "#F3E9DF" })),
    ...rows.map(({ wordOrPhrase, meaning }, index) => [
      { value: index + 1, type: Number, align: "center" as const, alignVertical: "top" as const },
      { value: wordOrPhrase, type: String, wrap: true, alignVertical: "top" as const },
      { value: meaning ?? "", type: String, wrap: true, alignVertical: "top" as const }
    ])
  ];
  return writeExcelFile(data, { sheet: "Vocabulary", columns: [{ width: 8 }, { width: 34 }, { width: 64 }], stickyRowsCount: 1 }).toBlob();
}

export async function createVocabularyPdf(rows: readonly VocabularyExportRow[], font: ArrayBuffer): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const pdf = new jsPDF({ format: "a4", compress: true, putOnlyUsedFonts: true });
  // Compose combining accents because jsPDF does not position them reliably in TTF text.
  const body = rows.map(({ wordOrPhrase, meaning }, index) => [
    String(index + 1), wordOrPhrase.normalize("NFC"), (meaning ?? "").normalize("NFC")
  ]);
  // Embed the font in the PDF so Vietnamese text also works away from the website.
  const bytes = new Uint8Array(font);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  pdf.addFileToVFS("NotoSans-Regular.ttf", btoa(binary));
  pdf.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
  pdf.setFont("NotoSans", "normal");
  // jsPDF silently drops missing glyphs. Refuse incomplete PDFs and keep Excel available.
  const metadata = pdf.getFont().metadata as { characterToGlyph?: (code: number) => number };
  if (typeof metadata.characterToGlyph !== "function") throw new Error("Could not load the PDF font.");
  for (const row of body) {
    for (const text of row) {
      for (const character of text) {
        if (character === "\n" || character === "\r" || character === "\t") continue;
        const code = character.codePointAt(0)!;
        if (code > 0xFFFF || metadata.characterToGlyph(code) === 0) {
          throw new VocabularyExportError("Some characters cannot be included in this PDF. Choose Excel to preserve the original text.");
        }
      }
    }
  }
  pdf.setFontSize(11);
  const numberColumnWidth = Math.max(16, pdf.getTextWidth(String(rows.length)) + 6);
  const wordColumnWidth = 60;
  const meaningColumnWidth = pdf.internal.pageSize.getWidth() - 30 - numberColumnWidth - wordColumnWidth;
  pdf.setProperties({ title: "Vocabulary", creator: "Folio" });
  pdf.setFontSize(18);
  pdf.text("Vocabulary", 15, 20);
  autoTable(pdf, {
    head: [VOCABULARY_EXPORT_HEADERS],
    body,
    startY: 28,
    margin: { top: 15, right: 15, bottom: 18, left: 15 },
    styles: { font: "NotoSans", fontStyle: "normal", fontSize: 11, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fontStyle: "normal", fillColor: [162, 105, 70] },
    columnStyles: {
      0: { cellWidth: numberColumnWidth, halign: "center" },
      1: { cellWidth: wordColumnWidth },
      2: { cellWidth: meaningColumnWidth }
    },
    rowPageBreak: "avoid",
    showHead: "everyPage",
    didDrawPage: ({ pageNumber }) => {
      pdf.setFont("NotoSans", "normal");
      pdf.setFontSize(9);
      pdf.text(`Page ${pageNumber}`, 15, pdf.internal.pageSize.getHeight() - 8);
    }
  });
  return pdf.output("blob");
}

export async function exportVocabularyFile(
  format: VocabularyExportFormat,
  scope: VocabularyExportScope,
  selectedIds: ReadonlySet<string>
): Promise<{ blob: Blob; fileName: string; count: number }> {
  if (scope === "selected" && selectedIds.size === 0) throw new Error("Select at least one word to export.");
  const rows = vocabularyExportRows(await loadVocabulary(), scope, selectedIds);
  if (rows.length === 0) throw new Error("There are no saved words to export.");
  let blob: Blob;
  if (format === "xlsx") {
    blob = await createVocabularyExcel(rows);
  } else {
    const response = await fetch("/fonts/NotoSans-Regular.ttf");
    if (!response.ok) throw new Error("Could not load the PDF font. Please try again.");
    blob = await createVocabularyPdf(rows, await response.arrayBuffer());
  }
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return { blob, fileName: `vocabulary-${scope}-${date}.${format}`, count: rows.length };
}

/** The browser owns the final save; this starts the download and cleans up its URL. */
export function downloadVocabularyFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  try {
    document.body.appendChild(link);
    link.click();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    link.remove();
  }
  // Allow the browser time to consume the Blob before releasing it.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
