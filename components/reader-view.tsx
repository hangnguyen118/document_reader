"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookmarkPlus, Check, ChevronDown, ChevronLeft, ChevronRight, Heart, Highlighter, Languages, Minus, NotebookPen, Pause, Pencil, Play, Plus, Square, Trash2, Volume2, X } from "lucide-react";
import { Badge, Button, Spinner } from "@hangnguyen1902/theme";
import { useReading } from "./providers";
import { Loading } from "./loading";
import { Modal } from "./modal";
import { NoteDialog } from "./note-dialog";
import { VocabularyDialog } from "./vocabulary-dialog";
import { BookNameDialog } from "./book-name-dialog";
import { useSpeech } from "@/hooks/use-speech";
import { useTranslation } from "@/hooks/use-translation";
import { segmentText, selectionOffsets } from "@/lib/text";
import type { Highlight, HighlightColor, Note, TranslationProvider } from "@/lib/types";

interface SelectionTarget { start: number; end: number; text: string; page: number; x: number; y: number }
export function ReaderView({ documentId }: { documentId: string }) {
  const { documents, highlights, notes, settings, ready, updateDocument, updateSettings, saveHighlight, removeHighlight, removeNote, notify } = useReading();
  const searchParams = useSearchParams(); const requestedPage = searchParams.get("page");
  const document = documents.find((item) => item.id === documentId);
  const [page, setPage] = useState(0); const pageRef = useRef(0);
  const [scope, setScope] = useState("page");
  const [selection, setSelection] = useState<SelectionTarget | null>(null);
  const [notebook, setNotebook] = useState(false); const [notebookTab, setNotebookTab] = useState<"notes" | "highlights">("notes");
  const [activeHighlight, setActiveHighlight] = useState("");
  const [noteTarget, setNoteTarget] = useState<{ quote: string; page: number; item?: Note } | null>(null);
  const [vocabTarget, setVocabTarget] = useState<{ text: string; meaning: string; page: number } | null>(null);
  const [translationTarget, setTranslationTarget] = useState<SelectionTarget | null>(null);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const textElement = useRef<HTMLDivElement>(null); const speech = useSpeech(); const translator = useTranslation();
  const { clear: clearTranslation } = translator;
  const captureSelection = useCallback(() => {
    const root = textElement.current;
    const browserSelection = window.getSelection();
    if (!root) return;
    const offsets = selectionOffsets(root, browserSelection);
    if (!offsets) { setSelection(null); return; }
    const rect = browserSelection!.getRangeAt(0).getBoundingClientRect();
    const width = Math.min(390, window.innerWidth - 24);
    setSelection({ ...offsets, page, x: Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2)), y: Math.max(12, rect.top > 64 ? rect.top - 54 : rect.bottom + 8) });
  }, [page]);

  useEffect(() => {
    if (!ready || !document) return;
    const requested = requestedPage === null ? document.currentPage : Number(requestedPage) - 1;
    const initialPage = Number.isFinite(requested) ? Math.max(0, Math.min(document.pages.length - 1, Math.floor(requested))) : document.currentPage;
    setPage(initialPage); pageRef.current = initialPage;
    void updateDocument(document.id, { currentPage: initialPage, lastReadAt: Date.now() }).catch(() => {});
    void updateSettings({ lastDocumentId: document.id }).catch(() => {});
    // Entering the document or following a saved page updates the position once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, document?.id, requestedPage, updateDocument, updateSettings]);
  useEffect(() => { speech.stop(); setSelection(null); setTranslationTarget(null); setEditingBookId(null); clearTranslation(); }, [documentId, speech.stop, clearTranslation]);
  useEffect(() => {
    let frame = 0;
    const changed = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(captureSelection);
    };
    window.document.addEventListener("selectionchange", changed);
    return () => { window.cancelAnimationFrame(frame); window.document.removeEventListener("selectionchange", changed); };
  }, [captureSelection]);
  useEffect(() => {
    if (!selection) return;
    const close = () => setSelection(null);
    window.addEventListener("scroll", close, true); window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [selection]);

  function clearSelection() { setSelection(null); window.getSelection()?.removeAllRanges(); }
  function changePage(target: number, fromSpeech = false) {
    if (!document) return;
    const next = Math.max(0, Math.min(document.pages.length - 1, target));
    if (!fromSpeech) { speech.stop(); clearSelection(); }
    if (pageRef.current === next) return;
    setPage(next); pageRef.current = next;
    void updateDocument(document.id, { currentPage: next, lastReadAt: Date.now() }).catch(() => {});
    textElement.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  async function highlightSelection() {
    if (!selection || !document) return;
    const existing = highlights.find((item) => item.documentId === document.id && item.page === selection.page && item.start === selection.start && item.end === selection.end);
    try { if (!existing) await saveHighlight({ id: crypto.randomUUID(), documentId: document.id, page: selection.page, start: selection.start, end: selection.end, text: selection.text, color: "yellow", createdAt: Date.now() }); notify("A passage worth coming back to."); clearSelection(); }
    catch { /* The storage banner explains a failed save. */ }
  }
  function showHighlight(highlight: Highlight) {
    if (!window.getSelection()?.isCollapsed) return;
    setNotebook(true); setNotebookTab("highlights"); setActiveHighlight(highlight.id);
  }
  function startListening() {
    if (!document) return;
    if (speech.status === "playing") { speech.pause(); return; }
    if (speech.status === "paused") { speech.resume(); return; }
    speech.speak(scope === "document" ? document.pages.map((text, index) => ({ text, page: index })) : [{ text: document.pages[page], page }], (target) => changePage(target, true));
  }
  function translateSelection() {
    if (!selection) return;
    const target = selection;
    translator.prepare?.(settings.translationProvider);
    setTranslationTarget(target);
    clearSelection();
    void translator.translate(target.text, settings.translationProvider);
  }
  if (!ready) return <Loading label="Opening your reading room…" />;
  if (!document) return <div className="empty-state"><NotebookPen size={30} /><h1>This book is no longer on your shelf.</h1><p>It may have been removed from this device.</p><Link href="/" className="text-link">Back to your library <ArrowRight size={15} /></Link></div>;
  const text = document.pages[page] ?? "";
  const savedHighlights = highlights.filter((item) => item.documentId === document.id).sort((a, b) => a.page - b.page || a.start - b.start);
  const savedNotes = notes.filter((item) => item.documentId === document.id).sort((a, b) => b.updatedAt - a.updatedAt);
  const currentHighlights = savedHighlights.filter((item) => item.page === page);
  const speechRange = speech.position?.page === page ? { start: speech.position.start, end: speech.position.end, id: "speech" } : null;
  const segments = segmentText(text, [...currentHighlights, ...(speechRange ? [speechRange] : [])]);

  return <div className="reader-view"><div className="reader-toolbar"><Link href="/" className="text-link"><ArrowLeft size={15} /><span>Back to library</span></Link><div className="reader-title-small">{document.title}</div><div className="reader-tools"><button type="button" className={`icon-button ${document.favorite ? "favorited" : ""}`} aria-label={document.favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={document.favorite} onClick={() => { void updateDocument(document.id, { favorite: !document.favorite }).catch(() => {}); }}><Heart size={17} fill={document.favorite ? "currentColor" : "none"} /></button><button type="button" className={`icon-button ${notebook ? "is-active" : ""}`} aria-label="Toggle notebook" aria-expanded={notebook} onClick={() => setNotebook(!notebook)}><NotebookPen size={17} /></button><span className="toolbar-divider" /><button type="button" className="icon-button" aria-label="Decrease reading font size" disabled={settings.fontSize <= 16} onClick={() => { void updateSettings({ fontSize: settings.fontSize - 2 }).catch(() => {}); }}><Minus size={13} /></button><span className="font-size-label">Aa</span><button type="button" className="icon-button" aria-label="Increase reading font size" disabled={settings.fontSize >= 28} onClick={() => { void updateSettings({ fontSize: settings.fontSize + 2 }).catch(() => {}); }}><Plus size={13} /></button></div></div>
    <div className={`reader-layout ${notebook ? "with-notebook" : ""}`}><div className="reader-column"><div className="reading-meta"><span className="page-eyebrow">{document.category.toUpperCase()}</span><span>{document.type} · {document.pages.length} pages</span></div><header className="reading-heading"><div className="reading-title-row"><h1>{document.title}</h1>{document.uploaded && <button type="button" className="text-link edit-book-name" onClick={() => { clearSelection(); setEditingBookId(document.id); }}><Pencil size={13} />Edit Book Name</button>}</div><p>{document.description}</p><span>By {document.author}<span className="meta-dot" />{Math.max(1, Math.ceil(document.wordCount / 200))} min read</span></header><div className="listening-controls"><div className="listen-buttons"><Button size="sm" variant="soft" leadingIcon={speech.status === "playing" ? <Pause size={14} /> : <Play size={14} fill="currentColor" />} onClick={startListening} disabled={!speech.supported}>{speech.status === "playing" ? "Pause" : speech.status === "paused" ? "Resume" : "Listen"}</Button><select aria-label="Reading scope" value={scope} disabled={speech.status !== "idle"} onChange={(event) => setScope(event.target.value)}><option value="page">This page</option><option value="document">Whole document</option></select>{speech.status !== "idle" && <button type="button" className="icon-button" aria-label="Stop reading" onClick={speech.stop}><Square size={13} fill="currentColor" /></button>}</div><Link href="/settings" className="speech-setting">{settings.speechLanguage.startsWith("en") ? "English" : "Vietnamese"}<span className="meta-dot" />{settings.speechRate.toFixed(1)}×</Link></div>{speech.error && <p className="form-error" role="alert">{speech.error}</p>}
    <div className="reader-text" data-testid="reader-text" ref={textElement} style={{ fontSize: settings.fontSize, lineHeight: settings.lineHeight, fontFamily: settings.font === "serif" ? 'Georgia, "Times New Roman", serif' : "var(--hui-font-family-sans)" }} onMouseUp={captureSelection} onTouchEnd={() => setTimeout(captureSelection, 40)} onKeyUp={captureSelection}>{segments.map((segment) => {
      const highlight = currentHighlights.find((item) => segment.ranges.some((range) => range.id === item.id));
      const speaking = segment.ranges.some((range) => range.id === "speech");
      return highlight ? <mark key={segment.start} className={`text-highlight highlight-${highlight.color} ${activeHighlight === highlight.id ? "highlight-active" : ""} ${speaking ? "spoken-text" : ""}`} tabIndex={0} role="button" aria-label={`Highlight: ${highlight.text.slice(0, 80)}`} onClick={() => showHighlight(highlight)} onKeyDown={(event) => { if (event.key === "Enter") { setNotebook(true); setNotebookTab("highlights"); setActiveHighlight(highlight.id); } }}>{segment.text}</mark> : speaking ? <mark key={segment.start} className="spoken-text">{segment.text}</mark> : <span key={segment.start}>{segment.text}</span>;
    })}</div>{!text.trim() && <p className="empty-page">No text was found on this PDF page.</p>}
    <div className="reading-page-footer"><span>Take your time. The words will wait.</span><div className="page-navigation"><button type="button" className="icon-button" aria-label="Previous page" disabled={page === 0} onClick={() => changePage(page - 1)}><ChevronLeft size={18} /></button><label><select aria-label="Current page" value={page} onChange={(event) => changePage(Number(event.target.value))}>{document.pages.map((_, index) => <option key={index} value={index}>Page {index + 1}</option>)}</select><span>of {document.pages.length}</span></label><button type="button" className="icon-button" aria-label="Next page" disabled={page === document.pages.length - 1} onClick={() => changePage(page + 1)}><ChevronRight size={18} /></button></div></div><button type="button" className="margin-note-button" onClick={() => setNoteTarget({ quote: "", page })}><NotebookPen size={15} />Leave a thought in the margin</button><div className="reading-tip"><Highlighter size={13} />Select a passage to listen, highlight, translate, or keep a word.</div></div>
    {notebook && <aside className="notebook-panel" aria-label="Document notebook"><div className="notebook-heading"><NotebookPen size={17} /><h2>In the margins</h2><button type="button" className="icon-button" aria-label="Close notebook" onClick={() => setNotebook(false)}><X size={16} /></button></div><div className="notebook-tabs"><button type="button" aria-pressed={notebookTab === "notes"} onClick={() => setNotebookTab("notes")}>Notes <span>{savedNotes.length}</span></button><button type="button" aria-pressed={notebookTab === "highlights"} onClick={() => setNotebookTab("highlights")}>Highlights <span>{savedHighlights.length}</span></button></div>{notebookTab === "notes" ? <><Button size="sm" variant="outline" leadingIcon={<Plus size={14} />} onClick={() => setNoteTarget({ quote: "", page })}>Add a note</Button>{savedNotes.length ? savedNotes.map((note) => <div className="margin-note" key={note.id}><button type="button" className="margin-page-link" onClick={() => changePage(note.page)}>Page {note.page + 1}<ArrowRight size={11} /></button>{note.quote && <blockquote>{note.quote}</blockquote>}<p>{note.body}</p><div className="margin-actions"><button type="button" className="icon-button" aria-label="Edit note" onClick={() => setNoteTarget({ quote: note.quote, page: note.page, item: note })}><Pencil size={13} /></button><button type="button" className="icon-button" aria-label="Delete note" onClick={() => { void removeNote(note.id).then(() => notify("Note removed.")).catch(() => {}); }}><Trash2 size={13} /></button></div></div>) : <div className="notebook-empty"><NotebookPen size={24} strokeWidth={1.3} /><p>Your thoughts belong here.</p><span>Add a note about this page, or select a passage first.</span></div>}</> : savedHighlights.length ? savedHighlights.map((highlight) => <div className={`margin-highlight ${activeHighlight === highlight.id ? "active" : ""}`} key={highlight.id}><button type="button" className="margin-page-link" onClick={() => { changePage(highlight.page); setActiveHighlight(highlight.id); }}>Page {highlight.page + 1}<ArrowRight size={11} /></button><button type="button" className="highlight-quote" onClick={() => { changePage(highlight.page); setActiveHighlight(highlight.id); }}>{highlight.text}</button><div className="highlight-actions"><div className="highlight-colors">{(["yellow", "green", "pink"] as HighlightColor[]).map((color) => <button type="button" key={color} className={`highlight-${color}`} aria-label={`Set ${color} highlight`} aria-pressed={highlight.color === color} onClick={() => { void saveHighlight({ ...highlight, color }).catch(() => {}); }}>{highlight.color === color && <Check size={11} />}</button>)}</div><button type="button" className="icon-button" aria-label="Delete highlight" onClick={() => { void removeHighlight(highlight.id).then(() => notify("Highlight removed.")).catch(() => {}); }}><Trash2 size={13} /></button></div></div>) : <div className="notebook-empty"><Highlighter size={24} strokeWidth={1.3} /><p>Keep the lines that stay with you.</p><span>Select a passage and choose Highlight.</span></div>}</aside>}
    </div>
    {editingBookId === document.id && document.uploaded && <BookNameDialog key={document.id} document={document} onClose={() => setEditingBookId(null)} />}
    {selection && <div className="selection-toolbar" role="toolbar" aria-label="Selected text actions" style={{ left: selection.x, top: selection.y }} onPointerDown={(event) => event.preventDefault()}><button type="button" onClick={() => { speech.speak([{ text: selection.text, page: selection.page, offset: selection.start }]); clearSelection(); }}><Volume2 size={15} /><span>Listen</span></button><button type="button" onClick={() => { void highlightSelection(); }}><Highlighter size={15} /><span>Highlight</span></button><button type="button" onClick={translateSelection}><Languages size={15} /><span>Translate</span></button><button type="button" onClick={() => { translator.prepare?.(settings.translationProvider); setVocabTarget({ text: selection.text.trim(), meaning: "", page: selection.page }); clearSelection(); }}><BookmarkPlus size={15} /><span>Save word</span></button><button type="button" aria-label="Add note about selected text" onClick={() => { setNoteTarget({ quote: selection.text, page: selection.page }); clearSelection(); }}><NotebookPen size={15} /></button></div>}
    <NoteDialog open={Boolean(noteTarget)} document={document} page={noteTarget?.page ?? page} quote={noteTarget?.quote ?? ""} item={noteTarget?.item} onClose={() => setNoteTarget(null)} />
    <VocabularyDialog open={Boolean(vocabTarget)} document={document} page={vocabTarget?.page ?? page} initialTerm={vocabTarget?.text ?? ""} initialMeaning={vocabTarget?.meaning ?? ""} context={text.slice(Math.max(0, text.indexOf(vocabTarget?.text ?? "") - 70), Math.max(0, text.indexOf(vocabTarget?.text ?? "")) + (vocabTarget?.text.length ?? 0) + 120).trim()} onClose={() => setVocabTarget(null)} />
    <Modal open={Boolean(translationTarget)} title="A little understanding" onClose={() => { setTranslationTarget(null); translator.clear(); }}>
      <div className="translation-language-row"><span>English <ArrowRight size={13} />Vietnamese</span>
        <select aria-label="Translation provider" value={settings.translationProvider} onChange={(event) => {
          const provider = event.target.value as TranslationProvider;
          translator.prepare?.(provider);
          void updateSettings({ translationProvider: provider }).catch(() => {});
          if (translationTarget) void translator.translate(translationTarget.text, provider);
        }}><option value="auto">Automatic</option><option value="browser">Browser translator</option><option value="local">Downloaded model</option></select>
      </div>
      <blockquote className="translation-source">{translationTarget?.text}</blockquote>
      {translator.loading ? <div className="translation-status" role="status" aria-live="polite">
        <div className="translation-loading"><Spinner size="sm" /><span>{translator.status || "Finding the right words…"}</span></div>
        {translator.progress !== null && <progress className="translation-progress" aria-label="Translation progress" max={100} value={translator.progress} />}
      </div> : translator.error ? <div className="translation-error">
        <p role="alert">{translator.error}</p>
        <div className="translation-retry-actions"><button type="button" className="text-link" onClick={() => {
          translator.prepare?.(settings.translationProvider);
          if (translationTarget) void translator.translate(translationTarget.text, settings.translationProvider);
        }}>Try translation again</button><Link href="/settings" className="text-link">Translation settings <ArrowRight size={13} /></Link></div>
      </div> : <><div className="translation-result" lang="vi">{translator.translation}</div>
        {translator.engine && <p className="translation-engine">{translator.cached ? "Saved translation · " : ""}{translator.engine === "browser" ? "Browser translator" : "Downloaded model"}</p>}
      </>}
      <div className="translation-note">Your selected text is translated on this device. First use may download language files and take a few minutes. Check the result, especially for words with several meanings.</div>
      <div className="modal-actions"><Button variant="outline" onClick={() => { setTranslationTarget(null); translator.clear(); }}>Close</Button><Button leadingIcon={<BookmarkPlus size={15} />} disabled={!translator.translation || translator.loading} onClick={() => { if (translationTarget) setVocabTarget({ text: translationTarget.text, meaning: translator.translation, page: translationTarget.page }); setTranslationTarget(null); translator.clear(); }}>Save to vocabulary</Button></div>
    </Modal>
  </div>;
}
