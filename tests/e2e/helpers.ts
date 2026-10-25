import type { Page } from "@playwright/test";
import JSZip from "jszip";

export async function selectText(page: Page, value: string) {
  await page.getByTestId("reader-text").evaluate((root, text) => {
    const full = root.textContent ?? ""; const start = full.indexOf(text);
    if (start < 0) throw new Error(`Cannot select ${text}`);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let offset = 0;
    let startNode: Node | null = null; let endNode: Node | null = null; let startOffset = 0; let endOffset = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode; const length = node.textContent?.length ?? 0;
      if (!startNode && start < offset + length) { startNode = node; startOffset = start - offset; }
      if (start + text.length <= offset + length) { endNode = node; endOffset = start + text.length - offset; break; }
      offset += length;
    }
    if (!startNode || !endNode) throw new Error("Selection nodes not found");
    const range = document.createRange(); range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, value);
}
export function textPDF(pages: string[]) {
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  pages.forEach((text, index) => {
    const content = `BT /F1 16 Tf 50 740 Td (${text.replace(/([\\()])/g, "\\$1")}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`, `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  });
  let pdf = "%PDF-1.7\n"; const offsets: number[] = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
export async function textDOCX(text: string) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}
export async function mockSpeech(page: Page) {
  await page.addInitScript(() => {
    const calls: { text: string; language: string }[] = [];
    (window as unknown as { speechCalls: typeof calls }).speechCalls = calls;
    class Utterance { text: string; lang = ""; rate = 1; voice = null; onend: (() => void) | null = null; onerror = null; onboundary: ((event: { charIndex: number; charLength: number }) => void) | null = null; constructor(text: string) { this.text = text; } }
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: Utterance });
    let timer: ReturnType<typeof setTimeout> | null = null; const events = new EventTarget();
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [{ name: "English test voice", voiceURI: "en-test", lang: "en-US", localService: true }, { name: "Vietnamese test voice", voiceURI: "vi-test", lang: "vi-VN", localService: true }], addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), speak: (utterance: Utterance) => { calls.push({ text: utterance.text, language: utterance.lang }); utterance.onboundary?.({ charIndex: 0, charLength: 5 }); timer = setTimeout(() => utterance.onend?.(), 600); }, pause() {}, resume() {}, cancel() { if (timer) clearTimeout(timer); } } });
  });
}
