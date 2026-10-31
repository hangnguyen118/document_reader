"use client";

import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Check, Copy } from "lucide-react";
import { toJsxRuntime, type ExtraProps } from "hast-util-to-jsx-runtime";
import type { Element } from "hast";
import type { ThemedTokenWithVariants } from "shiki/types";
import { markdownHighlightRanges, markdownNodeText, parseMarkdown } from "@/lib/markdown";
import { segmentText, type TextRange } from "@/lib/text";
import type { Highlight } from "@/lib/types";
import "./markdown-preview.css";

interface MarkdownPreviewProps {
  source: string;
  highlights: Highlight[];
  activeHighlight: string;
  speechRange: TextRange | null;
  onHighlightClick: (highlight: Highlight) => void;
  onTextReady: (text: string) => void;
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

const components = { span: MarkdownSpan, pre: MarkdownCodeBlock, table: MarkdownTable };

export const MarkdownPreview = memo(function MarkdownPreview({ source, highlights, activeHighlight, speechRange, onHighlightClick, onTextReady }: MarkdownPreviewProps) {
  const parsed = useMemo(() => {
    try { return { model: parseMarkdown(source), error: false }; }
    catch { return { model: null, error: true }; }
  }, [source]);
  const model = parsed.model;
  const content = useMemo(() => model ? toJsxRuntime(model.tree, { Fragment, jsx, jsxs, components, passNode: true }) as ReactNode : null, [model]);
  const resolvedHighlights = useMemo(() => model ? markdownHighlightRanges(model, highlights) : [], [model, highlights]);
  const ranges = useMemo(() => ({ highlights: resolvedHighlights, activeHighlight, speechRange, onHighlightClick }), [resolvedHighlights, activeHighlight, speechRange, onHighlightClick]);
  useEffect(() => { onTextReady(model?.text ?? ""); }, [model, onTextReady]);
  useEffect(() => {
    if (!model || !window.location.hash.startsWith("#md-")) return;
    try { window.document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView(); } catch { /* Invalid fragments have no target. */ }
  }, [model]);
  return <div className="markdown-preview">
    {parsed.error ? <p role="alert">This Markdown file could not be previewed. Try importing it again as UTF-8 text.</p> : !source.trim() ? <p className="markdown-empty">No content in this Markdown file.</p> : <>
      {model && model.headings.length > 1 && <details className="markdown-toc" data-reader-ignore="true"><summary>Table of contents</summary><nav aria-label="Table of contents"><ul>{model.headings.map((heading) => <li key={heading.id} style={{ marginLeft: `${(heading.depth - 1) * 0.65}em` }}><a href={`#${heading.id}`}>{heading.text}</a></li>)}</ul></nav></details>}
      <RangesContext.Provider value={ranges}>{content}</RangesContext.Provider>
    </>}
  </div>;
});
