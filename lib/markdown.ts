import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import GithubSlugger from "github-slugger";
import type { Element, ElementContent, Root, RootContent, Text } from "hast";
import { segmentGraphemes } from "./graphemes";
import { isMarkdownDataImageUrl } from "./markdown-image-url";
import { TEXT_PAGE_TARGET } from "./text";

export { markdownHighlightRanges, markdownPageForOffset, markdownPreviewOffset } from "./markdown-pagination";

declare module "hast" {
  interface ElementData { markdownImageSource?: string }
}

export interface MarkdownHeading { id: string; text: string; depth: number; page: number }
interface TextRun { start: number; end: number; sourceStart?: number; sourceEnd?: number }
export interface MarkdownPage { tree: Root; start: number; end: number; text: string; imageSources: string[] }
export interface MarkdownDocument { tree: Root; text: string; headings: MarkdownHeading[]; runs: TextRun[]; imageSources: string[]; pages: MarkdownPage[] }
export const MARKDOWN_PAGE_TARGET = TEXT_PAGE_TARGET;
const IMAGE_PAGE_WEIGHT = 400;

// No raw HTML or MDX evaluation: only the elements produced by these plugins
// reach React. Additional syntax can be added here without changing the reader.
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);

export function markdownNodeText(node: Root | RootContent): string {
  if (node.type === "text") return node.value;
  return "children" in node ? node.children.map(markdownNodeText).join("") : "";
}

export function safeMarkdownUrl(value: string, image = false): string | undefined {
  // Only image sources get this narrow exception; links retain the same policy.
  if (/^data:/i.test(value)) return image && isMarkdownDataImageUrl(value) ? value : undefined;
  const url = value.trim();
  const protocol = url.replace(/[\u0000-\u0020\u007f]/g, "").match(/^([a-z][a-z\d+.-]*):/i)?.[1].toLowerCase();
  if (protocol && !(image ? ["http", "https"] : ["http", "https", "mailto", "tel"]).includes(protocol)) return undefined;
  // Backslashes can be interpreted as slashes by the browser URL parser.
  if (url.includes("\\")) return undefined;
  if (!image && url.startsWith("#")) return `#md-${url.slice(1)}`;
  return url || undefined;
}

/** Parse once per source, retaining positions for existing source-based highlights. */
export function parseMarkdown(source: string): MarkdownDocument {
  const tree = parser.runSync(parser.parse(source)) as Root;
  const headings: MarkdownHeading[] = [];
  const runs: TextRun[] = [];
  const chunks: string[] = [];
  const imageSources: string[] = [];
  let offset = 0;
  const slugger = new GithubSlugger();

  function record(node: Text) {
    const start = offset;
    chunks.push(node.value); offset += node.value.length;
    runs.push({ start, end: offset, sourceStart: node.position?.start.offset, sourceEnd: node.position?.end.offset });
    return start;
  }
  function prepare(parent: Root | Element, inCode = false) {
    // Formatting whitespace in tables is not document text; wrapping it would
    // create invalid spans between rows/cells and break React's table nesting.
    if (parent.type === "element" && ["table", "thead", "tbody", "tfoot", "tr", "ul", "ol"].includes(parent.tagName)) {
      parent.children = parent.children.filter((node) => node.type !== "text" || node.value.trim());
    }
    parent.children = parent.children.map((node): RootContent => {
      if (node.type === "text") {
        const start = record(node);
        if (inCode) return node;
        return { type: "element", tagName: "span", properties: { dataMarkdownStart: start }, children: [node] };
      }
      if (node.type !== "element") return node;
      const heading = /^h([1-6])$/.exec(node.tagName);
      if (heading) {
        const text = markdownNodeText(node);
        const id = `md-${slugger.slug(text)}`;
        node.properties.id = id;
        headings.push({ id, text, depth: Number(heading[1]), page: 0 });
      }
      if (node.tagName === "a") {
        const href = safeMarkdownUrl(String(node.properties.href ?? ""));
        if (href) node.properties.href = href; else delete node.properties.href;
        node.properties.rel = ["noopener", "noreferrer"];
      }
      if (node.tagName === "img") {
        const originalSource = String(node.properties.src ?? "");
        imageSources.push(originalSource);
        // Keep the original URL outside DOM properties for the internal asset
        // renderer, including invalid URLs which need an explanatory placeholder.
        node.data = { ...node.data, markdownImageSource: originalSource };
        const src = safeMarkdownUrl(originalSource, true);
        if (src) node.properties.src = src; else delete node.properties.src;
        node.properties.loading = "lazy";
        node.properties.decoding = "async";
      }
      if (node.tagName === "code" && parent.type === "element" && parent.tagName === "pre") {
        node.properties.dataMarkdownStart = offset;
        prepare(node, true);
      } else prepare(node, inCode);
      // Keep table cells and list items separated for selection and speech.
      // Place these inside the cell/item so marker spans remain valid HTML.
      if (["td", "th", "li"].includes(node.tagName)) {
        const separator: Text = { type: "text", value: node.tagName === "li" ? "\n" : "\t" };
        const start = record(separator);
        node.children.push({ type: "element", tagName: "span", properties: { dataMarkdownStart: start }, children: [separator] });
      }
      return node;
    });
  }
  prepare(tree);
  const text = chunks.join("");
  const pages = paginateMarkdownTree(tree, text);
  const headingPages = new Map<string, number>();
  pages.forEach((page, index) => visitElements(page.tree, (node) => {
    if (/^h[1-6]$/.test(node.tagName)) headingPages.set(String(node.properties.id), index);
  }));
  for (const heading of headings) heading.page = headingPages.get(heading.id) ?? 0;
  return { tree, text, headings, runs, imageSources, pages };
}

function visitElements(node: Root | RootContent, visit: (node: Element) => void) {
  if (node.type === "element") visit(node);
  if ("children" in node) for (const child of node.children) visitElements(child, visit);
}

function imageSourcesIn(node: Root | RootContent): string[] {
  const sources: string[] = [];
  visitElements(node, (element) => {
    if (element.tagName === "img") sources.push(element.data?.markdownImageSource ?? "");
  });
  return sources;
}

/** Clone just the intersecting inline tree, retaining document-global markers. */
function sliceParagraph(node: Element, start: number, end: number, length: number): Element {
  let offset = 0;
  function slice(child: ElementContent): ElementContent | undefined {
    const childStart = offset;
    const childLength = markdownNodeText(child).length;
    const childEnd = childStart + childLength;
    if (childLength === 0) {
      return childStart >= start && (childStart < end || childStart === end && end === length) ? child : undefined;
    }
    if (childEnd <= start || childStart >= end) { offset = childEnd; return undefined; }
    if (child.type === "text") {
      offset = childEnd;
      return { ...child, value: child.value.slice(Math.max(0, start - childStart), Math.min(childLength, end - childStart)) };
    }
    if (child.type !== "element") { offset = childEnd; return child; }
    const children = child.children.flatMap((item) => { const result = slice(item); return result ? [result] : []; });
    const properties = { ...child.properties };
    if (properties.dataMarkdownStart !== undefined) properties.dataMarkdownStart = Number(properties.dataMarkdownStart) + Math.max(0, start - childStart);
    return children.length ? { ...child, properties, children } : undefined;
  }
  return { ...node, children: node.children.flatMap((child) => { const result = slice(child); return result ? [result] : []; }) };
}

/** A long paragraph may span pages without reparsing or flattening formatting. */
function paragraphFragments(node: RootContent): RootContent[] {
  if (node.type !== "element" || node.tagName !== "p") return [node];
  const text = markdownNodeText(node);
  if (text.length <= MARKDOWN_PAGE_TARGET) return [node];
  const graphemes = segmentGraphemes(text);
  const fragments: RootContent[] = [];
  let start = 0;
  while (text.length - start > MARKDOWN_PAGE_TARGET) {
    const limit = start + MARKDOWN_PAGE_TARGET;
    let end = Math.max(text.lastIndexOf(". ", limit), text.lastIndexOf("? ", limit), text.lastIndexOf("! ", limit)) + 1;
    if (end < start + MARKDOWN_PAGE_TARGET / 2) end = text.lastIndexOf(" ", limit);
    if (end <= start) end = limit;
    const segment = graphemes.containing(end);
    end = segment ? segment.index > start ? segment.index : segment.index + segment.segment.length : end;
    fragments.push(sliceParagraph(node, start, end, text.length));
    start = end;
  }
  if (start < text.length) fragments.push(sliceParagraph(node, start, text.length, text.length));
  return fragments;
}

function paginateMarkdownTree(tree: Root, text: string): MarkdownPage[] {
  interface Unit { nodes: RootContent[]; weight: number }
  const units: Unit[] = [];
  const leading: RootContent[] = [];
  let headingPending = false;
  for (const original of tree.children) {
    const whitespace = original.type === "text" || original.type === "element" && original.tagName === "span";
    if (whitespace && !markdownNodeText(original).trim()) {
      if (units.length) { units.at(-1)!.nodes.push(original); units.at(-1)!.weight += markdownNodeText(original).length; }
      else leading.push(original);
      continue;
    }
    const heading = original.type === "element" && /^h[1-6]$/.test(original.tagName);
    for (const fragment of paragraphFragments(original)) {
      const weight = markdownNodeText(fragment).length + imageSourcesIn(fragment).length * IMAGE_PAGE_WEIGHT;
      if (headingPending && units.length) {
        units.at(-1)!.nodes.push(fragment); units.at(-1)!.weight += weight;
      } else units.push({ nodes: [...leading.splice(0), fragment], weight });
      headingPending = heading;
    }
  }
  const pages: MarkdownPage[] = [];
  let nodes: RootContent[] = [];
  let weight = 0;
  let offset = 0;
  function finish() {
    const pageTree: Root = { type: "root", children: nodes };
    const end = offset + markdownNodeText(pageTree).length;
    pages.push({ tree: pageTree, start: offset, end, text: text.slice(offset, end), imageSources: imageSourcesIn(pageTree) });
    offset = end; nodes = []; weight = 0;
  }
  for (const unit of units) {
    if (nodes.length && weight + unit.weight > MARKDOWN_PAGE_TARGET) finish();
    nodes.push(...unit.nodes); weight += unit.weight;
  }
  if (nodes.length || !pages.length) { nodes.push(...leading); finish(); }
  return pages;
}
