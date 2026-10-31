import test from "node:test";
import assert from "node:assert/strict";
import type { Element, Root, RootContent } from "hast";
import { markdownHighlightRanges, markdownNodeText, parseMarkdown, safeMarkdownUrl } from "../../lib/markdown";
import type { Highlight } from "../../lib/types";

function elements(node: Root | RootContent, name?: string): Element[] {
  const children = "children" in node ? node.children.flatMap((child) => elements(child, name)) : [];
  return node.type === "element" && (!name || node.tagName === name) ? [node, ...children] : children;
}

function highlight(start: number, text: string, id = "legacy"): Highlight {
  return { id, documentId: "markdown", page: 0, start, end: start + text.length, text, color: "yellow", createdAt: 1 };
}

test("Markdown parsing exposes rendered Unicode text and GFM elements without evaluating raw HTML", () => {
  const source = "# Tài liệu 📖\n\n**Đậm**, *nghiêng* và ~~gạch~~, `const a = 1`.\n\n- [x] Đã đọc\n- [ ] Chưa đọc\n\n| Sách | Nghĩa |\n| --- | --- |\n| Đọc | Read |\n\n<script>window.attack = true</script>\n\n<img src=x onerror=attack()>\n";
  const model = parseMarkdown(source);
  assert.ok(model.text.includes("Tài liệu 📖"));
  assert.ok(model.text.includes("Đậm, nghiêng và gạch, const a = 1."));
  assert.ok(!model.text.includes("**"));
  assert.ok(!model.text.includes("window.attack"));
  assert.equal(markdownNodeText(model.tree), model.text);
  assert.equal(elements(model.tree, "strong").length, 1);
  assert.equal(elements(model.tree, "em").length, 1);
  assert.equal(elements(model.tree, "del").length, 1);
  assert.equal(elements(model.tree, "table").length, 1);
  assert.equal(elements(model.tree, "input").length, 2);
  assert.equal(elements(model.tree, "script").length, 0);
  assert.equal(elements(model.tree, "img").length, 0);
  for (const element of elements(model.tree)) assert.ok(!Object.keys(element.properties).some((name) => /^on/i.test(name)));
});

test("URL filtering rejects unsafe protocols and control-character evasions for links and images", () => {
  for (const url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\nscript:alert(1)", "java\tscript:alert(1)", "\u0000javascript:alert(1)", "vbscript:msgbox(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "https:\\example.com"]) {
    assert.equal(safeMarkdownUrl(url), undefined, url);
    assert.equal(safeMarkdownUrl(url, true), undefined, `image ${url}`);
  }
  for (const url of ["https://example.com/đọc", "http://example.com", "/images/read_book.png", "./relative-image.png", "../parent.png", "//example.com/image.png"]) {
    assert.equal(safeMarkdownUrl(url), url);
    assert.equal(safeMarkdownUrl(url, true), url);
  }
  assert.equal(safeMarkdownUrl("mailto:reader@example.com"), "mailto:reader@example.com");
  assert.equal(safeMarkdownUrl("tel:+84900000000"), "tel:+84900000000");
  assert.equal(safeMarkdownUrl("mailto:reader@example.com", true), undefined);
  assert.equal(safeMarkdownUrl("tel:+84900000000", true), undefined);
  assert.equal(safeMarkdownUrl("   "), undefined);
});

test("parsed unsafe URLs are removed after Markdown entities are decoded", () => {
  const model = parseMarkdown('[Unsafe](javascript:alert%281%29)\n\n[Encoded](javascript&colon;alert%281%29)\n\n![Unsafe image](data:image/svg+xml;base64,PHN2Zz4=)\n\n[Safe](https://example.com/docs)');
  const links = elements(model.tree, "a");
  assert.equal(links[0].properties.href, undefined);
  assert.equal(links[1].properties.href, undefined);
  assert.equal(elements(model.tree, "img")[0].properties.src, undefined);
  assert.equal(links[2].properties.href, "https://example.com/docs");
  assert.ok(links.every((link) => Array.isArray(link.properties.rel) && link.properties.rel.includes("noopener") && link.properties.rel.includes("noreferrer")));
});

test("heading IDs support Unicode, formatting, duplicates and document-scoped slug generation", () => {
  const source = "# Tiếng Việt\n\n## Tiếng Việt\n\n### Part *one*\n\n[Jump](#part-one)\n\n[Unicode heading](#tiếng-việt)";
  const first = parseMarkdown(source);
  assert.deepEqual(first.headings, [
    { id: "md-tiếng-việt", text: "Tiếng Việt", depth: 1 },
    { id: "md-tiếng-việt-1", text: "Tiếng Việt", depth: 2 },
    { id: "md-part-one", text: "Part one", depth: 3 }
  ]);
  assert.deepEqual(parseMarkdown(source).headings, first.headings);
  assert.deepEqual(elements(first.tree, "a").map((link) => decodeURIComponent(String(link.properties.href))), ["#md-part-one", "#md-tiếng-việt"]);
});

test("legacy source annotations map to their nearest matching rendered text without changing saved data", () => {
  const quote = "tiếng Việt";
  const source = `# Heading\n\nA **${quote}** and ${quote} again.\n`;
  const model = parseMarkdown(source);
  const first = highlight(source.indexOf(quote), quote, "first");
  const second = highlight(source.lastIndexOf(quote), quote, "second");
  const before = structuredClone([first, second]);
  const mapped = markdownHighlightRanges(model, [first, second]);
  assert.equal(mapped.length, 2);
  assert.equal(mapped[0].start, model.text.indexOf(quote));
  assert.equal(mapped[1].start, model.text.lastIndexOf(quote));
  assert.ok(mapped.every((item) => model.text.slice(item.start, item.end) === quote));
  assert.deepEqual([first, second], before);
  const preview = { ...highlight(3, "rendered"), coordinateSpace: "markdown-preview" as const };
  assert.deepEqual(markdownHighlightRanges(model, [preview]), [preview]);
  assert.deepEqual(markdownHighlightRanges(model, [highlight(source.length + 100, "absent")]), []);
});

test("incomplete Markdown renders as text or a code block while keeping code newlines intact", () => {
  const model = parseMarkdown("# Incomplete\n\n**Unclosed bold\n\n```javascript\nconst value = '<script>';\nconsole.log(value);");
  assert.equal(model.headings[0].text, "Incomplete");
  assert.ok(model.text.includes("**Unclosed bold"));
  const code = elements(model.tree, "pre")[0];
  assert.equal(markdownNodeText(code), "const value = '<script>';\nconsole.log(value);\n");
  assert.equal(elements(model.tree, "script").length, 0);
  assert.equal(parseMarkdown("").text, "");
  assert.deepEqual(parseMarkdown("").headings, []);
});
