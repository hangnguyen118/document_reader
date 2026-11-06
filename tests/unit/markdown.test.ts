import test from "node:test";
import assert from "node:assert/strict";
import type { Element, Root, RootContent } from "hast";
import { markdownHighlightRanges, markdownNodeText, parseMarkdown, safeMarkdownUrl } from "../../lib/markdown";
import { isMarkdownDataImageUrl } from "../../lib/markdown-image-url";
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

test("supported raster Base64 data URLs are accepted only as image sources and preserved verbatim", () => {
  const payload = Buffer.from([0, 255, 254, 253, 252, 251, 250]).toString("base64");
  for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]) {
    const url = `data:${mime};base64,${payload}`;
    assert.equal(isMarkdownDataImageUrl(url), true, mime);
    assert.equal(safeMarkdownUrl(url, true), url, mime);
    assert.equal(safeMarkdownUrl(url), undefined, `link ${mime}`);
    const model = parseMarkdown(`![Embedded ${mime}](${url} "Original image")\n\n[Download](${url})`);
    const image = elements(model.tree, "img")[0];
    assert.equal(image.properties.src, url);
    assert.equal(image.data?.markdownImageSource, url);
    assert.equal(image.properties.alt, `Embedded ${mime}`);
    assert.equal(image.properties.title, "Original image");
    assert.equal(image.properties.loading, "lazy");
    assert.equal(image.properties.decoding, "async");
    assert.deepEqual(model.imageSources, [url]);
    assert.equal(elements(model.tree, "a")[0].properties.href, undefined);
  }
});

test("data image validation rejects unsupported MIME types, malformed syntax and invalid Base64", () => {
  const invalid = [
    "data:image/svg+xml;base64,PHN2Zz4=", "data:text/html;base64,PHNjcmlwdD4=",
    "data:application/javascript;base64,YWxlcnQoMSk=", "data:image/bmp;base64,Qk0=",
    "data:image/x-icon;base64,AAABAA==", "data:image/jpg;base64,/9j/", "data:;base64,AAAA",
    "data:image/png,AAAA", "data:image/png;base64", "data:image/png;base64,",
    "data:image/png;charset=utf-8;base64,AAAA", "data:image/png;base64;foo,AAAA",
    "data:image/png;base64,A", "data:image/png;base64,AA", "data:image/png;base64,AAA",
    "data:image/png;base64,A===", "data:image/png;base64,====", "data:image/png;base64,AA=A",
    "data:image/png;base64,AA==AAAA", "data:image/png;base64,AAA==", "data:image/png;base64,AAAA=",
    "data:image/png;base64,AB==", "data:image/png;base64,AAB=",
    "data:image/png;base64,AA-A", "data:image/png;base64,AA_A", "data:image/png;base64,AA$A",
    "data:image/png;base64,%2F%2F8=", "data:image/png;base64,AA AA",
    "data:image/png;base64,AA\nAA", "data:image/png;base64,AA\tAA", "data:image/png;base64,AA\u0000AA",
    " data:image/png;base64,AAAA", "data:image/png;base64,AAAA ", "data:image/png;base64,AAAA\n",
    "data:image/png;base64,AAAA#fragment", "data:image/png;base64,AAAA?query", "da\nta:image/png;base64,AAAA"
  ];
  for (const url of invalid) {
    assert.equal(isMarkdownDataImageUrl(url), false, url);
    assert.equal(safeMarkdownUrl(url, true), undefined, url);
    assert.equal(safeMarkdownUrl(url), undefined, `link ${url}`);
  }
  for (const payload of ["AA==", "AAA=", "AAAA", "/w==", "//8=", "////"]) {
    assert.equal(isMarkdownDataImageUrl(`data:image/png;base64,${payload}`), true, payload);
  }
  const upperCase = "DATA:IMAGE/PNG;BASE64,/w==";
  assert.equal(isMarkdownDataImageUrl(upperCase), true);
  assert.equal(safeMarkdownUrl(upperCase, true), upperCase);
  assert.equal(safeMarkdownUrl(upperCase), undefined);
});

test("embedded images survive mixed Markdown structures, references and pagination", () => {
  const url = "data:image/png;base64,AA==";
  const source = [
    `# Heading ![Heading image](${url})`,
    `Before ![Paragraph image](${url}) after.`,
    `- List ![List image](${url})`,
    `> Quote ![Quote image](${url})`,
    `| Picture |\n| --- |\n| ![Table image](${url}) |`,
    "![Reference image][embedded]",
    `[embedded]: ${url} "Reference title"`,
    `![Empty alt](${url})`,
    `![](${url})`,
    `\`![Code](${url})\``,
    `<img src="${url}" onerror="window.attack=true">`,
    "Remaining **Markdown** stays readable."
  ].join("\n\n");
  const model = parseMarkdown(source);
  const images = elements(model.tree, "img");
  assert.equal(images.length, 8);
  assert.deepEqual(images.map((image) => image.properties.alt), ["Heading image", "Paragraph image", "List image", "Quote image", "Table image", "Reference image", "Empty alt", ""]);
  assert.ok(images.every((image) => image.properties.src === url && image.data?.markdownImageSource === url));
  for (const tag of ["h1", "p", "li", "blockquote", "td"]) {
    assert.ok(elements(model.tree, tag).some((node) => elements(node, "img").length > 0), tag);
  }
  assert.equal(images[5].properties.title, "Reference title");
  assert.deepEqual(model.imageSources, Array(8).fill(url));
  assert.deepEqual(model.pages.flatMap((page) => page.imageSources), model.imageSources);
  assert.equal(model.pages.flatMap((page) => elements(page.tree, "img")).length, 8);
  assert.ok(model.text.includes("Remaining Markdown stays readable."));
  assert.ok(model.text.includes(`![Code](${url})`));
  assert.ok(!model.text.includes("window.attack"));
});

test("large embedded image URLs remain complete without entering rendered text or creating extra pages", () => {
  const url = `data:image/png;base64,${"/wD+".repeat(512 * 1024)}AA==`;
  assert.equal(isMarkdownDataImageUrl(url), true);
  assert.equal(safeMarkdownUrl(url, true), url);
  const model = parseMarkdown(`Before image.\n\n![Large image](${url})\n\nAfter image.`);
  const image = elements(model.tree, "img")[0];
  assert.equal(image.properties.src, url);
  assert.equal(image.data?.markdownImageSource, url);
  assert.deepEqual(model.imageSources, [url]);
  assert.equal(model.pages.length, 1);
  assert.ok(model.text.includes("Before image."));
  assert.ok(model.text.includes("After image."));
  assert.ok(!model.text.includes("data:"));
});

test("heading IDs support Unicode, formatting, duplicates and document-scoped slug generation", () => {
  const source = "# Tiếng Việt\n\n## Tiếng Việt\n\n### Part *one*\n\n[Jump](#part-one)\n\n[Unicode heading](#tiếng-việt)";
  const first = parseMarkdown(source);
  assert.deepEqual(first.headings, [
    { id: "md-tiếng-việt", text: "Tiếng Việt", depth: 1, page: 0 },
    { id: "md-tiếng-việt-1", text: "Tiếng Việt", depth: 2, page: 0 },
    { id: "md-part-one", text: "Part one", depth: 3, page: 0 }
  ]);
  assert.deepEqual(parseMarkdown(source).headings, first.headings);
  assert.deepEqual(elements(first.tree, "a").map((link) => decodeURIComponent(String(link.properties.href))), ["#md-part-one", "#md-tiếng-việt"]);
});

test("Markdown preserves inline and reference image sources and labels without changing code or links", () => {
  const source = [
    '![Inline](./images/inline.jpg "Image title")',
    "![Reference][picture]",
    "[picture]: images/reference.jpg",
    "![Parent](../assets/parent.jpg)",
    "![Remote](https://example.com/remote.jpg)",
    "![CDN](//example.com/cdn.jpg)",
    "![Unsafe](javascript:alert%281%29)",
    "[Link](./images/link.jpg)",
    "`![Example](./images/example.jpg)`",
    "```markdown\n![Code](./images/code.jpg)\n```"
  ].join("\n\n");
  const model = parseMarkdown(source);
  const images = elements(model.tree, "img");
  assert.deepEqual(images.map((image) => image.properties.src), [
    "./images/inline.jpg", "images/reference.jpg", "../assets/parent.jpg",
    "https://example.com/remote.jpg", "//example.com/cdn.jpg", undefined
  ]);
  assert.deepEqual(images.map((image) => image.data?.markdownImageSource), model.imageSources);
  assert.deepEqual(images.map((image) => image.properties.alt), ["Inline", "Reference", "Parent", "Remote", "CDN", "Unsafe"]);
  assert.equal(images[0].properties.title, "Image title");
  assert.equal(elements(model.tree, "a")[0].properties.href, "./images/link.jpg");
  assert.ok(model.text.includes("![Example](./images/example.jpg)"));
  assert.ok(model.text.includes("![Code](./images/code.jpg)"));
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
