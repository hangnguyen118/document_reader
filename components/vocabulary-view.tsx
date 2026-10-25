"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Bookmark, Download, Pencil, Plus, Search, Trash2, Volume2 } from "lucide-react";
import { Badge, Button } from "@hangnguyen1902/theme";
import { useReading } from "./providers";
import { Loading } from "./loading";
import { VocabularyDialog } from "./vocabulary-dialog";
import { VocabularyExportDialog } from "./vocabulary-export-dialog";
import { VocabularyPagination } from "./vocabulary-pagination";
import { useSpeech } from "@/hooks/use-speech";
import type { VocabularyItem } from "@/lib/types";
import "./vocabulary-export.css";

export function VocabularyView() {
  const { vocabulary, documents, ready, removeVocabulary, notify } = useReading();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [editing, setEditing] = useState<VocabularyItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const speech = useSpeech();

  const sourceTitles = new Map(documents.map((document) => [document.id, document.title]));
  const sourceTitle = (word: VocabularyItem) => sourceTitles.get(word.documentId) ?? word.documentTitle;
  const words = [...vocabulary].filter((word) => `${word.term} ${word.meaning} ${sourceTitle(word)}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.createdAt - a.createdAt);
  const totalPages = Math.max(1, Math.ceil(words.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageWords = words.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  // Reconcile the stored page as results shrink, so a later addition cannot restore an invalid page.
  useEffect(() => { setPage((value) => Math.min(value, totalPages)); }, [totalPages]);
  // Derive selection from current records so deleted words never count or export.
  const selectedIds = new Set(vocabulary.filter((word) => selection.has(word.id)).map((word) => word.id));
  const allSelected = vocabulary.length > 0 && selectedIds.size === vocabulary.length;

  if (!ready) return <Loading />;

  function toggleWord(id: string) {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function deleteWord(id: string) {
    try {
      await removeVocabulary(id);
      setSelection((current) => { const next = new Set(current); next.delete(id); return next; });
      notify("Word removed from your collection.");
    } catch { /* The reading provider displays storage errors. */ }
  }

  return <div className="vocabulary-page">
    <div className="page-eyebrow"><span className="status-dot" />WORDS WORTH KEEPING</div>
    <div className="page-heading">
      <div><h1>Your growing <em>vocabulary.</em></h1><p>A collection of discoveries, one word at a time.</p></div>
      <div className="vocabulary-heading-actions">
        <Button variant="outline" leadingIcon={<Download size={16} />} onClick={() => setExporting(true)}>Export Vocabulary</Button>
        <Button leadingIcon={<Plus size={16} />} onClick={() => setAdding(true)}>Add a word</Button>
      </div>
    </div>
    <div className="collection-banner">
      <span className="collection-banner-icon"><Bookmark size={23} strokeWidth={1.5} /></span>
      <div><strong>{vocabulary.length} {vocabulary.length === 1 ? "word" : "words"} in your collection</strong><p>The words you save while reading become your practice material.</p></div>
      <Link href="/learn" className="text-link">Practice your words <ArrowRight size={15} /></Link>
    </div>
    <div className="list-toolbar">
      <label className="search-input"><Search size={15} /><input placeholder="Find a word or meaning…" aria-label="Search vocabulary" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
      <span>{words.length} {words.length === 1 ? "word" : "words"}</span>
    </div>
    <div className="vocabulary-selection-toolbar">
      <label className="vocabulary-select-all">
        <input
          type="checkbox"
          aria-label="Select all vocabulary"
          aria-describedby="vocabulary-selection-help"
          checked={allSelected}
          disabled={!vocabulary.length}
          ref={(element) => { if (element) element.indeterminate = selectedIds.size > 0 && !allSelected; }}
          onChange={() => setSelection(allSelected ? new Set() : new Set(vocabulary.map((word) => word.id)))}
        />
        Select All
      </label>
      <span role="status" aria-live="polite">{selectedIds.size} selected</span>
      {selectedIds.size > 0 && <button className="text-link" type="button" onClick={() => setSelection(new Set())}>Clear selection</button>}
      <p id="vocabulary-selection-help">Select All includes every word in your collection, including words on other pages or hidden by search.</p>
    </div>
    {words.length ? <div className="vocabulary-list">
      {pageWords.map((word) => <article className={`word-card${selectedIds.has(word.id) ? " word-card-selected" : ""}`} key={word.id}>
        <div className="word-card-heading">
          <input className="vocabulary-word-checkbox" type="checkbox" aria-label={`Select ${word.term}`} checked={selectedIds.has(word.id)} onChange={() => toggleWord(word.id)} />
          <h2>{word.term}</h2>
          <button className="icon-button" type="button" aria-label={`Listen to ${word.term}`} onClick={() => speech.speak([{ text: word.term, page: 0 }], undefined, "en-US")}><Volume2 size={17} /></button>
          <Badge tone="neutral">English → Vietnamese</Badge>
          <div className="word-actions">
            <button type="button" className="icon-button" aria-label={`Edit ${word.term}`} onClick={() => setEditing(word)}><Pencil size={14} /></button>
            <button type="button" className="icon-button" aria-label={`Delete ${word.term}`} onClick={() => { void deleteWord(word.id); }}><Trash2 size={14} /></button>
          </div>
        </div>
        <p className="word-meaning">{word.meaning}</p>
        {word.context && <blockquote>{word.context}</blockquote>}
        <div className="word-source">From {sourceTitles.has(word.documentId) ? <Link href={`/read/${word.documentId}?page=${word.page + 1}`}>{sourceTitle(word)} <ArrowRight size={11} /></Link> : <span>{sourceTitle(word)}</span>}</div>
      </article>)}
    </div> : <div className="empty-state">
      <Bookmark size={32} strokeWidth={1.3} />
      <h2>{query ? "No matching words." : "Every collection begins with one word."}</h2>
      <p>{query ? "Try another word or meaning." : "Select a word while reading, or add one of your own."}</p>
      <Button variant="outline" onClick={() => setAdding(true)}>Add your first word</Button>
    </div>}
    <VocabularyPagination
      page={currentPage}
      pageSize={pageSize}
      total={words.length}
      onPageChange={setPage}
      onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
    />
    {speech.error && <p className="inline-error" role="alert">{speech.error}</p>}
    <VocabularyDialog open={adding || Boolean(editing)} item={editing ?? undefined} onClose={() => { setAdding(false); setEditing(null); }} />
    {exporting && <VocabularyExportDialog open totalCount={vocabulary.length} selectedIds={selectedIds} onClose={() => setExporting(false)} />}
  </div>;
}
