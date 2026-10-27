import { countWords, paginateText } from "./text";
import { extractPdfText } from "./pdf-text";
import { decodeDocumentText } from "./document-text";
import type { DocumentType, ReadingDocument } from "./types";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const formats: Record<string, DocumentType> = { pdf: "PDF", docx: "DOCX", txt: "TXT", md: "MD", markdown: "MD" };

export async function importDocument(file: File): Promise<ReadingDocument> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = formats[extension];
  if (!type) throw new Error("Choose a PDF, DOCX, TXT, or Markdown file.");
  if (file.size > MAX_FILE_BYTES) throw new Error("This file is too large. Choose a file smaller than 20 MB.");
  let pages: string[];
  if (type === "PDF") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    try {
      const pdf = await loadingTask.promise;
      pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(extractPdfText(content.items));
        page.cleanup();
      }
    } catch (error) {
      if (error instanceof Error && error.name === "PasswordException") throw new Error("This PDF is password protected. Upload an unlocked copy.");
      throw error;
    } finally { await loadingTask.destroy(); }
    if (!pages.some((page) => page.trim())) throw new Error("This PDF has no selectable text. Scanned PDFs need OCR, which is outside this version.");
  } else if (type === "DOCX") {
    const mammoth = await import("mammoth/mammoth.browser");
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    pages = paginateText(result.value);
  } else {
    pages = paginateText(decodeDocumentText(await file.arrayBuffer()));
  }
  if (!pages.length || !pages.some((page) => page.trim())) throw new Error("This document does not contain readable text.");
  if (pages.join("").length > 1_000_000) throw new Error("Please choose a document with fewer than one million characters.");
  return {
    id: crypto.randomUUID(), title: file.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " "), type, pages,
    author: "Your upload", description: `${type} document · ${pages.length} ${pages.length === 1 ? "page" : "pages"}`,
    category: "Personal library", wordCount: countWords(pages.join("\n")), uploaded: true, favorite: false,
    currentPage: 0, createdAt: Date.now(), lastReadAt: null, cover: "sand"
  };
}
