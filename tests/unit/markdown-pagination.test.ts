import test from "node:test";
import assert from "node:assert/strict";
import type { Element, Root, RootContent } from "hast";
import { MARKDOWN_PAGE_TARGET, markdownHighlightRanges, markdownNodeText, parseMarkdown } from "../../lib/markdown";
import { markdownPageForOffset, markdownPreviewOffset } from "../../lib/markdown-pagination";
import { segmentGraphemes } from "../../lib/graphemes";

function elements(node: Root | RootContent, name?: string): Element[] {
  const children = "children" in node ? node.children.flatMap((child) => elements(child, name)) : [];
  return node.type === "element" && (!name || node.tagName === name) ? [node, ...children] : children;
}

test("Markdown render pages keep every character and document-global selection marker", () => {
  const source = Array.from({ length: 40 }, (_, index) => `## Section ${index + 1}\n\nParagraph ${index + 1}. ${"Read this useful thought. ".repeat(25)}`).join("\n\n");
  const model = parseMarkdown(source);
  assert.ok(model.pages.length > 1);
  assert.equal(model.pages.map((page) => page.text).join(""), model.text);
  assert.equal(markdownNodeText(model.tree), model.text);
  let end = 0;
  for (const page of model.pages) {
    assert.equal(page.start, end);
    assert.equal(page.end, page.start + page.text.length);
    assert.equal(markdownNodeText(page.tree), page.text);
    for (const span of elements(page.tree, "span")) {
      if (span.properties.dataMarkdownStart === undefined) continue;
      const start = Number(span.properties.dataMarkdownStart);
      assert.ok(start >= page.start && start <= page.end);
      assert.equal(model.text.slice(start, start + markdownNodeText(span).length), markdownNodeText(span));
    }
    end = page.end;
  }
  assert.equal(end, model.text.length);
});

test("headings retain stable IDs, point to their render page and stay with the following content", () => {
  const source = Array.from({ length: 12 }, (_, index) => `## Same heading\n\n${"A full paragraph follows this heading. ".repeat(Math.ceil(MARKDOWN_PAGE_TARGET / 100))} Passage ${index}.`).join("\n\n");
  const first = parseMarkdown(source);
  assert.ok(first.pages.length > 1);
  assert.deepEqual(parseMarkdown(source).headings, first.headings);
  assert.equal(new Set(first.headings.map((heading) => heading.id)).size, first.headings.length);
  for (const [index, heading] of first.headings.entries()) {
    const page = first.pages[heading.page];
    assert.ok(elements(page.tree, "h2").some((element) => element.properties.id === heading.id));
    assert.ok(page.text.includes(`Passage ${index}.`));
  }
});

test("code blocks, tables, nested lists and quotes remain complete on one render page", () => {
  const code = `const original = "${"long code ".repeat(Math.ceil(MARKDOWN_PAGE_TARGET / 10) + 10)}";\n`;
  const table = `| Column | Value |\n| --- | --- |\n${Array.from({ length: Math.ceil(MARKDOWN_PAGE_TARGET / 100) + 10 }, (_, index) => `| ${index} | ${"wide cell ".repeat(10)} |`).join("\n")}`;
  const list = Array.from({ length: Math.ceil(MARKDOWN_PAGE_TARGET / 100) + 10 }, (_, index) => `- Item ${index}: ${"nested idea ".repeat(10)}\n  - Child ${index}`).join("\n");
  const quote = `> ${"A quoted passage remains together. ".repeat(Math.ceil(MARKDOWN_PAGE_TARGET / 30) + 10)}`;
  const source = `# Atomic blocks\n\n${"Opening text. ".repeat(80)}\n\n\`\`\`javascript\n${code}\`\`\`\n\n${table}\n\n${list}\n\n${quote}\n\nFinal paragraph.`;
  const model = parseMarkdown(source);
  assert.ok(model.pages.length > 1);
  for (const tag of ["pre", "table", "ul", "blockquote"]) {
    const original = elements(model.tree, tag);
    const paginated = model.pages.flatMap((page) => elements(page.tree, tag));
    assert.deepEqual(paginated, original);
    assert.ok(markdownNodeText(original[0]).length > MARKDOWN_PAGE_TARGET, `${tag} should exercise an oversized atomic block`);
  }
  assert.equal(markdownNodeText(elements(model.tree, "code")[0]), code);
  assert.equal(model.pages.map((page) => page.text).join(""), model.text);
});

test("long formatted paragraphs paginate without flattening formatting or splitting Unicode graphemes", () => {
  const phrase = "a\u0302\u0301👩🏽‍💻";
  const source = `# Long paragraph\n\n**${phrase.repeat(Math.ceil(MARKDOWN_PAGE_TARGET * 2 / phrase.length))}** [${"linked words ".repeat(Math.ceil(MARKDOWN_PAGE_TARGET * 2 / 13))}](https://example.com) after.`;
  const model = parseMarkdown(source);
  assert.ok(model.pages.length > 2);
  assert.equal(model.pages.map((page) => page.text).join(""), model.text);
  assert.equal(markdownNodeText(model.tree), model.text);
  assert.equal(elements(model.tree, "strong").length, 1, "The full-document tree must remain unsplit");
  assert.ok(model.pages.flatMap((page) => elements(page.tree, "strong")).length > 1);
  assert.ok(model.pages.flatMap((page) => elements(page.tree, "a")).length > 1);
  const graphemes = segmentGraphemes(model.text);
  for (const page of model.pages) {
    if (page.end < model.text.length) assert.equal(graphemes.containing(page.end)?.index, page.end);
    for (const span of elements(page.tree, "span")) {
      const start = Number(span.properties.dataMarkdownStart);
      assert.equal(model.text.slice(start, start + markdownNodeText(span).length), markdownNodeText(span));
    }
  }
});

test("reference images and links resolve from the whole document across page boundaries", () => {
  const source = `# Reference images\n\n![First][picture]\n\n${Array.from({ length: 14 }, (_, index) => `Paragraph ${index}. ${"More words. ".repeat(Math.ceil(MARKDOWN_PAGE_TARGET / 100))}`).join("\n\n")}\n\n![Last][picture]\n\n[picture]: ../assets/H%C3%ACnh%201.png "Original title"`;
  const model = parseMarkdown(source);
  const imagePages = model.pages.flatMap((page, index) => elements(page.tree, "img").map((image) => ({ index, image })));
  assert.equal(imagePages.length, 2);
  assert.notEqual(imagePages[0].index, imagePages[1].index);
  for (const { index, image } of imagePages) {
    assert.equal(image.properties.src, "../assets/H%C3%ACnh%201.png");
    assert.equal(image.properties.title, "Original title");
    assert.deepEqual(model.pages[index].imageSources, ["../assets/H%C3%ACnh%201.png"]);
  }
  assert.deepEqual(imagePages.map(({ image }) => image.properties.alt), ["First", "Last"]);
  assert.equal(model.pages.map((page) => page.text).join(""), model.text);
});

test("image-only paragraphs contribute to pagination even without readable text", () => {
  const imageCount = 80;
  const model = parseMarkdown(Array.from({ length: imageCount }, (_, index) => `![Illustration ${index}](./${index}.png)`).join("\n\n"));
  assert.ok(model.text.length < MARKDOWN_PAGE_TARGET);
  assert.ok(model.pages.length > 1);
  assert.deepEqual(model.pages.flatMap((page) => page.imageSources), model.imageSources);
  assert.equal(model.pages.flatMap((page) => elements(page.tree, "img")).length, imageCount);
});

test("splitting an inline paragraph keeps boundary images once and preserves their link wrapper", () => {
  const source = `**${"a".repeat(MARKDOWN_PAGE_TARGET)}** [![Boundary image](./boundary.png)](https://example.com) ${"b".repeat(MARKDOWN_PAGE_TARGET)} end.`;
  const model = parseMarkdown(source);
  assert.ok(model.pages.length > 1);
  assert.equal(model.pages.map((page) => page.text).join(""), model.text);
  const images = model.pages.flatMap((page) => elements(page.tree, "img"));
  assert.equal(images.length, 1);
  assert.equal(images[0].properties.alt, "Boundary image");
  assert.deepEqual(model.pages.flatMap((page) => page.imageSources), ["./boundary.png"]);
  assert.ok(model.pages.some((page) => elements(page.tree, "a").some((link) => elements(link, "img").length === 1)));
});

test("offset helpers locate page boundaries and legacy source coordinates without rewriting annotations", () => {
  const quote = "A legacy quotation";
  const source = `${Array.from({ length: 12 }, (_, index) => `Paragraph ${index}. ${"A thoughtful sentence. ".repeat(Math.ceil(MARKDOWN_PAGE_TARGET / 200))}`).join("\n\n")}\n\n**${quote}** at the end.`;
  const model = parseMarkdown(source);
  const sourceOffset = source.indexOf(quote);
  const offset = markdownPreviewOffset(model, sourceOffset);
  assert.equal(offset, model.text.indexOf(quote));
  const index = markdownPageForOffset(model.pages, offset);
  assert.ok(index > 0);
  assert.ok(model.pages[index].text.includes(quote));
  assert.equal(markdownPageForOffset(model.pages, model.pages[1].start), 1);
  assert.equal(markdownPageForOffset(model.pages, -1), 0);
  assert.equal(markdownPageForOffset(model.pages, Number.NaN), 0);
  assert.equal(markdownPageForOffset(model.pages, model.text.length + 100), model.pages.length - 1);
  const highlight = { id: "old", documentId: "markdown", page: 0, start: sourceOffset, end: sourceOffset + quote.length, text: quote, color: "yellow" as const, createdAt: 1 };
  const original = { ...highlight };
  assert.equal(markdownHighlightRanges(model, [highlight])[0].start, offset);
  assert.deepEqual(highlight, original);
});

test("empty and short Markdown have one stable page", () => {
  for (const source of ["", "# Heading\n\nShort **formatted** text.", "\n\n"]) {
    const model = parseMarkdown(source);
    assert.equal(model.pages.length, 1);
    assert.equal(model.pages[0].start, 0);
    assert.equal(model.pages[0].end, model.text.length);
    assert.equal(markdownNodeText(model.pages[0].tree), model.text);
  }
});

test("Markdown fits 15,000 rendered characters per paragraph before splitting and retains formatting", () => {
  for (const length of [14_999, 15_000, 15_001]) {
    const text = "a".repeat(length);
    const model = parseMarkdown(`**${text}**`);
    assert.equal(model.text, text);
    assert.equal(model.pages.length, length > 15_000 ? 2 : 1);
    assert.equal(model.pages[0].text.length, Math.min(length, 15_000));
    assert.equal(model.pages.map((page) => page.text).join(""), text);
    assert.equal(elements(model.tree, "strong").length, 1);
    for (const page of model.pages) {
      assert.equal(elements(page.tree, "strong").length, 1);
      assert.equal(markdownNodeText(page.tree), page.text);
    }
  }
});
