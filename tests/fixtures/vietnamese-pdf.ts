import { readFile } from "node:fs/promises";
import path from "node:path";
import { jsPDF } from "jspdf";

/** Real Unicode PDF with a font-run boundary inside an accented capital letter. */
export async function vietnamesePDF() {
  const pdf = new jsPDF({ unit: "pt", compress: true, putOnlyUsedFonts: true });
  const font = await readFile(path.join(process.cwd(), "public", "fonts", "NotoSans-Regular.ttf"));
  pdf.addFileToVFS("NotoSans-Regular.ttf", font.toString("base64"));
  pdf.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
  pdf.addFont("NotoSans-Regular.ttf", "NotoSansAccent", "normal");
  pdf.setFont("NotoSans");
  pdf.setFontSize(18);

  const heading = "TIẾNG VIỆT: Ắ Ấ Ễ Ộ Ự; “Đọc sách”.";
  pdf.text(heading, 50, 50);
  let x = 50;
  for (const [family, text] of [
    ["NotoSans", "A"], ["NotoSansAccent", "\u0306\u0301"],
    ["NotoSans", ", Đọc "], ["NotoSansAccent", "sách"], ["NotoSans", "!"]
  ]) {
    pdf.setFont(family);
    pdf.text(text, x, 90);
    x += pdf.getTextWidth(text);
  }

  pdf.addPage();
  pdf.setFont("NotoSans");
  const secondPage = "Trang thứ hai: ĐỪNG BỎ LỠ — giữ nguyên dấu câu.";
  pdf.text(secondPage, 50, 50);
  return { buffer: Buffer.from(pdf.output("arraybuffer")), pages: [`${heading}\nA\u0306\u0301, Đọc sách!`, secondPage] };
}
