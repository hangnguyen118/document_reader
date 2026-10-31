import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import GithubSlugger from "github-slugger";
import type { Element, Root, RootContent, Text } from "hast";
import type { Highlight } from "./types";

export interface MarkdownHeading { id: string; text: string; depth: number }
interface TextRun { start: number; end: number; sourceStart?: number; sourceEnd?: number }
export interface MarkdownDocument { tree: Root; text: string; headings: MarkdownHeading[]; runs: TextRun[] }

// No raw HTML or MDX evaluation: only the elements produced by these plugins
// reach React. Additional syntax can be added here without changing the reader.
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);

export function markdownNodeText(node: Root | RootContent): string {
  if (node.type === "text") return node.value;
  return "children" in node ? node.children.map(markdownNodeText).join("") : "";
}

export function safeMarkdownUrl(value: string, image = false): string | undefined {
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
        headings.push({ id, text, depth: Number(heading[1]) });
      }
      if (node.tagName === "a") {
        const href = safeMarkdownUrl(String(node.properties.href ?? ""));
        if (href) node.properties.href = href; else delete node.properties.href;
        node.properties.rel = ["noopener", "noreferrer"];
      }
      if (node.tagName === "img") {
        const src = safeMarkdownUrl(String(node.properties.src ?? ""), true);
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
  return { tree, text: chunks.join(""), headings, runs };
}

/** Keep annotations saved before preview support, without rewriting saved offsets. */
export function markdownHighlightRanges(model: MarkdownDocument, highlights: Highlight[]): Highlight[] {
  return highlights.flatMap((highlight) => {
    if (highlight.coordinateSpace === "markdown-preview") return [highlight];
    const run = model.runs.find((item) => item.sourceStart !== undefined && item.sourceEnd !== undefined && item.sourceStart <= highlight.start && item.sourceEnd >= highlight.start);
    if (!run || !highlight.text) return [];
    const estimated = run.start + Math.min(highlight.start - run.sourceStart!, run.end - run.start);
    let candidate = model.text.indexOf(highlight.text), nearest = -1;
    while (candidate >= 0) {
      if (nearest < 0 || Math.abs(candidate - estimated) < Math.abs(nearest - estimated)) nearest = candidate;
      candidate = model.text.indexOf(highlight.text, candidate + 1);
    }
    return nearest < 0 ? [] : [{ ...highlight, start: nearest, end: nearest + highlight.text.length }];
  });
}
