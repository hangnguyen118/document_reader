import JSZip from "jszip";

/** Unicode Word text, including combining accents split across differently styled runs. */
export async function vietnameseDOCX() {
  const heading = "PHẦN I. BẢN DỊCH ĐẦY ĐỦ";
  const prose = "  “Đọc sách”: Ắ, Ấ, Ễ, Ộ, Ự; đừng bỏ lỡ — giữ  nguyên dấu câu.";
  const paragraphs = [heading, prose, heading.normalize("NFD"), prose.normalize("NFD")];
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const run = (text: string, index: number) => `<w:r><w:rPr><w:rFonts w:ascii="${index % 2 ? "Times New Roman" : "Cambria"}" w:hAnsi="${index % 2 ? "Times New Roman" : "Cambria"}"/><w:lang w:val="vi-VN"/></w:rPr><w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;
  const body = paragraphs.map((text, index) => `<w:p>${index < 2 ? run(text, index) : Array.from(text).map(run).join("")}</w:p>`).join("");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return { buffer: await zip.generateAsync({ type: "nodebuffer" }), paragraphs, text: paragraphs.join("\n\n") };
}
