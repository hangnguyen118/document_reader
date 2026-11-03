"use client";

import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Check, Copy } from "lucide-react";
import { toJsxRuntime, type ExtraProps } from "hast-util-to-jsx-runtime";
import type { Element } from "hast";
import type { ThemedTokenWithVariants } from "shiki/types";
import { markdownHighlightRanges, markdownNodeText, parseMarkdown, type MarkdownDocument } from "@/lib/markdown";
import { segmentText, type TextRange } from "@/lib/text";
import type { Highlight } from "@/lib/types";
import { MarkdownImage, MarkdownImages } from "./markdown-images";
import "./markdown-preview.css";

interface MarkdownPreviewProps {
  source: string;
  documentId: string;
  markdownPath?: string;
  page: number;
  highlights: Highlight[];
  activeHighlight: string;
  speechRange: TextRange | null;
  onHighlightClick: (highlight: Highlight) => void;
  onPageChange: (page: number) => void;
  onModelReady: (model: MarkdownDocument) => void;
}
interface ReadingRanges { highlights: Highlight[]; activeHighlight: string; speechRange: TextRange | null; onHighlightClick: (highlight: Highlight) => void }
const RangesContext = createContext<ReadingRanges>({ highlights: [], activeHighlight: "", speechRange: null, onHighlightClick: () => {} });

function ReadingText({ text, start, style }: { text: string; start: number; style?: CSSProperties }) {
  const state = useContext(RangesContext);
  const ranges = [...state.highlights, ...(state.speechRange ? [{ ...state.speechRange, id: "speech" }] : [])]
    .filter((range) => range.end > start && range.start < start + text.length)
    .map((range) => ({ ...range, start: Math.max(0, range.start - start), end: Math.min(text.length, range.end - start) }));
  const segments = ranges.length ? segmentText(text, ranges) : [{ start: 0, text, ranges: [] }];
  return <span data-markdown-start={start} style={style}>{segments.map((segment) => {
    const highlight = state.highlights.find((item) => segment.ranges.some((range) => range.id === item.id));
    const speaking = segment.ranges.some((range) => range.id === "speech");
    if (highlight) return <mark key={segment.start} className={`text-highlight highlight-${highlight.color} ${state.activeHighlight === highlight.id ? "highlight-active" : ""} ${speaking ? "spoken-text" : ""}`} role="button" tabIndex={0} aria-label={`Highlight: ${highlight.text.slice(0, 80)}`} onClick={() => state.onHighlightClick(highlight)} onKeyDown={(event) => { if (event.key === "Enter") state.onHighlightClick(highlight); }}>{segment.text}</mark>;
    return speaking ? <mark className="spoken-text" key={segment.start}>{segment.text}</mark> : <Fragment key={segment.start}>{segment.text}</Fragment>;
  })}</span>;
}

function MarkdownSpan({ node, children, ...props }: ExtraProps & React.ComponentPropsWithoutRef<"span">) {
  if (node?.properties.dataMarkdownStart === undefined) return <span {...props}>{children}</span>;
  return <ReadingText start={Number(node?.properties.dataMarkdownStart ?? 0)} text={String(children ?? "")} />;
}

const MarkdownCodeBlock = memo(function MarkdownCodeBlock({ node }: ExtraProps) {
  const codeNode = node?.children.find((child): child is Element => child.type === "element" && child.tagName === "code");
  const code = codeNode ? markdownNodeText(codeNode) : "";
  const start = Number(codeNode?.properties.dataMarkdownStart ?? 0);
  const classNames = codeNode?.properties.className;
  const language = (Array.isArray(classNames) ? classNames : []).map(String).find((value) => value.startsWith("language-"))?.slice(9) ?? "";
  const [highlightedCode, setHighlightedCode] = useState<{ code: string; language: string; tokens: ThemedTokenWithVariants[][] | null } | null>(null);
  const tokens = highlightedCode?.code === code && highlightedCode.language === language ? highlightedCode.tokens : null;
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [failedCopyCode, setFailedCopyCode] = useState<string | null>(null);
  const copied = copiedCode === code;
  const block = useRef<HTMLDivElement>(null);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Tokenize visible blocks only, and bound expensive work on very large fences.
    if (!language || code.length > 100_000) return;
    const highlight = () => {
      void import("@/lib/markdown-highlight").then((module) => module.highlightMarkdownCode(code, language)).then((result) => { if (!cancelled) setHighlightedCode({ code, language, tokens: result }); }).catch(() => { /* Keep readable plain code if a grammar cannot load. */ });
    };
    if (!("IntersectionObserver" in window) || !block.current) { highlight(); return () => { cancelled = true; }; }
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); highlight(); } }, { rootMargin: "400px" });
    observer.observe(block.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [code, language]);
  useEffect(() => () => { if (reset.current) clearTimeout(reset.current); }, []);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code); setFailedCopyCode(null);
      if (reset.current) clearTimeout(reset.current);
      reset.current = setTimeout(() => setCopiedCode(null), 2000);
    } catch { setFailedCopyCode(code); }
  }
  const highlighted = useMemo(() => {
    if (!tokens) return null;
    // Preserve the original line endings and final newline; Shiki supplies token
    // positions, so gaps can be filled straight from the unchanged code string.
    const result: ReactNode[] = [];
    let cursor = 0;
    for (const token of tokens.flat()) {
      if (token.offset > cursor) result.push(<ReadingText key={`gap-${cursor}`} start={start + cursor} text={code.slice(cursor, token.offset)} />);
      if (token.content) result.push(<ReadingText key={`token-${token.offset}`} start={start + token.offset} text={token.content} style={{ "--shiki-light": token.variants.light.color, "--shiki-dark": token.variants.dark.color } as CSSProperties} />);
      cursor = token.offset + token.content.length;
    }
    if (cursor < code.length) result.push(<ReadingText key={`gap-${cursor}`} start={start + cursor} text={code.slice(cursor)} />);
    return result;
  }, [tokens, code, start]);
  return <div className="markdown-code-block" ref={block}>
    <div className="markdown-code-header" data-reader-ignore="true"><span className="markdown-code-language">{language || "Plain text"}</span><button className="markdown-copy-button" type="button" aria-label="Copy code" onClick={() => { void copyCode(); }}>{copied ? <Check /> : <Copy />}{copied ? "Copied!" : "Copy"}</button><span role="status">{failedCopyCode === code ? "Could not copy. Select the code and copy it manually." : ""}</span></div>
    <pre tabIndex={0} aria-label={`${language || "Plain text"} code`}><code className={language ? `language-${language}` : undefined}>{highlighted ?? <ReadingText text={code} start={start} />}</code></pre>
  </div>;
});

function MarkdownTable({ children }: { children?: ReactNode }) {
  return <div className="markdown-table-scroll" tabIndex={0} role="region" aria-label="Scrollable Markdown table"><table>{children}</table></div>;
}

const components = { span: MarkdownSpan, pre: MarkdownCodeBlock, table: MarkdownTable, img: MarkdownImage };

export const MarkdownPreview = memo(function MarkdownPreview({ source, documentId, markdownPath, page, highlights, activeHighlight, speechRange, onHighlightClick, onPageChange, onModelReady }: MarkdownPreviewProps) {
  const parsed = useMemo(() => {
    try { return { model: parseMarkdown(source), error: false }; }
    catch { return { model: null, error: true }; }
  }, [source]);
  const model = parsed.model;
  const currentPage = model ? Math.max(0, Math.min(model.pages.length - 1, Number.isFinite(page) ? Math.floor(page) : 0)) : 0;
  const visiblePage = model?.pages[currentPage];
  const content = useMemo(() => visiblePage ? toJsxRuntime(visiblePage.tree, { Fragment, jsx, jsxs, components, passNode: true }) as ReactNode : null, [visiblePage]);
  const resolvedHighlights = useMemo(() => model ? markdownHighlightRanges(model, highlights) : [], [model, highlights]);
  const ranges = useMemo(() => ({ highlights: resolvedHighlights, activeHighlight, speechRange, onHighlightClick }), [resolvedHighlights, activeHighlight, speechRange, onHighlightClick]);
  const preview = useRef<HTMLDivElement>(null);
  const pendingAnchor = useRef<{ id: string; page: number } | null>(null);
  const pageChange = useRef(onPageChange);
  const renderedPage = useRef(currentPage);
  const scrollFrame = useRef(0);
  pageChange.current = onPageChange;
  renderedPage.current = currentPage;
  const scrollToPendingAnchor = useCallback(() => {
    const target = pendingAnchor.current;
    if (!target || target.page !== renderedPage.current) return;
    const element = preview.current?.querySelector<HTMLElement>(`#${CSS.escape(target.id)}`);
    if (element) {
      pendingAnchor.current = null;
      element.scrollIntoView({ block: "start" });
    }
  }, []);
  const requestAnchor = useCallback((hash: string) => {
    if (!model || !hash.startsWith("#md-")) return false;
    let id: string;
    try { id = decodeURIComponent(hash.slice(1)); } catch { return false; }
    const heading = model.headings.find((item) => item.id === id);
    if (!heading) return false;
    pendingAnchor.current = { id, page: heading.page };
    pageChange.current(heading.page);
    window.cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = window.requestAnimationFrame(scrollToPendingAnchor);
    return true;
  }, [model, scrollToPendingAnchor]);
  useEffect(() => { if (model) onModelReady(model); }, [model, onModelReady]);
  useEffect(() => {
    if (!model) return;
    // Let the reader restore its saved position first; an explicit heading URL
    // then selects its destination page. Page turns do not reapply an old hash.
    const initialFrame = window.requestAnimationFrame(() => { requestAnchor(window.location.hash); });
    const followHash = () => { requestAnchor(window.location.hash); };
    const followHistory = (event: PopStateEvent) => {
      if (requestAnchor(window.location.hash)) return;
      const position = event.state?.folioMarkdownPosition;
      if (position?.documentId === documentId && Number.isInteger(position.page)) {
        pendingAnchor.current = null;
        pageChange.current(position.page);
      }
    };
    window.addEventListener("hashchange", followHash);
    window.addEventListener("popstate", followHistory);
    return () => {
      window.cancelAnimationFrame(initialFrame);
      window.cancelAnimationFrame(scrollFrame.current);
      window.removeEventListener("hashchange", followHash);
      window.removeEventListener("popstate", followHistory);
      pendingAnchor.current = null;
    };
  }, [model, documentId, requestAnchor]);
  useEffect(() => { scrollToPendingAnchor(); }, [currentPage, model, scrollToPendingAnchor]);
  return <div className="markdown-preview" ref={preview} data-markdown-page={currentPage} onClick={(event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof window.Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>('a[href^="#md-"]');
    const hash = anchor?.getAttribute("href");
    if (!hash || !requestAnchor(hash)) return;
    event.preventDefault();
    if (window.location.hash !== hash) {
      window.history.replaceState({ ...window.history.state, folioMarkdownPosition: { documentId, page: currentPage } }, "", window.location.href);
      window.history.pushState({ ...window.history.state, folioMarkdownPosition: { documentId, page: pendingAnchor.current?.page ?? currentPage } }, "", hash);
    }
  }}>
    {parsed.error ? <p role="alert">This Markdown file could not be previewed. Try importing it again as UTF-8 text.</p> : !source.trim() ? <p className="markdown-empty">No content in this Markdown file.</p> : <>
      {model && model.headings.length > 1 && <details className="markdown-toc" data-reader-ignore="true"><summary>Table of contents</summary><nav aria-label="Table of contents"><ul>{model.headings.map((heading) => <li key={heading.id} style={{ marginLeft: `${(heading.depth - 1) * 0.65}em` }}><a href={`#${heading.id}`}>{heading.text}</a></li>)}</ul></nav></details>}
      {visiblePage && <MarkdownImages documentId={documentId} markdownPath={markdownPath} imageSources={visiblePage.imageSources}><RangesContext.Provider value={ranges}>{content}</RangesContext.Provider></MarkdownImages>}
    </>}
  </div>;
});
