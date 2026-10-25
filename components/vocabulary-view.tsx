"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Bookmark, GraduationCap, Pencil, Plus, Search, Trash2, Volume2 } from "lucide-react";
import { Badge, Button } from "@hangnguyen1902/theme";
import { useReading } from "./providers";
import { Loading } from "./loading";
import { VocabularyDialog } from "./vocabulary-dialog";
import { useSpeech } from "@/hooks/use-speech";
import type { VocabularyItem } from "@/lib/types";

export function VocabularyView() {
  const { vocabulary, documents, ready, removeVocabulary, notify } = useReading();
  const [query, setQuery] = useState(""); const [editing, setEditing] = useState<VocabularyItem | null>(null); const [adding, setAdding] = useState(false);
  const speech = useSpeech();
  if (!ready) return <Loading />;
  const sourceTitles = new Map(documents.map((document) => [document.id, document.title]));
  const sourceTitle = (word: VocabularyItem) => sourceTitles.get(word.documentId) ?? word.documentTitle;
  const words = [...vocabulary].filter((word) => `${word.term} ${word.meaning} ${sourceTitle(word)}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.createdAt - a.createdAt);
  return <div><div className="page-eyebrow"><span className="status-dot" />WORDS WORTH KEEPING</div><div className="page-heading"><div><h1>Your growing <em>vocabulary.</em></h1><p>A collection of discoveries, one word at a time.</p></div><Button leadingIcon={<Plus size={16} />} onClick={() => setAdding(true)}>Add a word</Button></div><div className="collection-banner"><span className="collection-banner-icon"><Bookmark size={23} strokeWidth={1.5} /></span><div><strong>{vocabulary.length} {vocabulary.length === 1 ? "word" : "words"} in your collection</strong><p>The words you save while reading become your practice material.</p></div><Link href="/learn" className="text-link">Practice your words <ArrowRight size={15} /></Link></div><div className="list-toolbar"><label className="search-input"><Search size={15} /><input placeholder="Find a word or meaning…" aria-label="Search vocabulary" value={query} onChange={(event) => setQuery(event.target.value)} /></label><span>{words.length} {words.length === 1 ? "word" : "words"}</span></div>{words.length ? <div className="vocabulary-list">{words.map((word) => <article className="word-card" key={word.id}><div className="word-card-heading"><h2>{word.term}</h2><button className="icon-button" type="button" aria-label={`Listen to ${word.term}`} onClick={() => speech.speak([{ text: word.term, page: 0 }], undefined, "en-US")}><Volume2 size={17} /></button><Badge tone="neutral">English → Vietnamese</Badge><div className="word-actions"><button type="button" className="icon-button" aria-label={`Edit ${word.term}`} onClick={() => setEditing(word)}><Pencil size={14} /></button><button type="button" className="icon-button" aria-label={`Delete ${word.term}`} onClick={() => { void removeVocabulary(word.id).then(() => notify("Word removed from your collection.")).catch(() => {}); }}><Trash2 size={14} /></button></div></div><p className="word-meaning">{word.meaning}</p>{word.context && <blockquote>{word.context}</blockquote>}<div className="word-source">From {sourceTitles.has(word.documentId) ? <Link href={`/read/${word.documentId}?page=${word.page + 1}`}>{sourceTitle(word)} <ArrowRight size={11} /></Link> : <span>{sourceTitle(word)}</span>}</div></article>)}</div> : <div className="empty-state"><Bookmark size={32} strokeWidth={1.3} /><h2>{query ? "No matching words." : "Every collection begins with one word."}</h2><p>{query ? "Try another word or meaning." : "Select a word while reading, or add one of your own."}</p><Button variant="outline" onClick={() => setAdding(true)}>Add your first word</Button></div>}{speech.error && <p className="inline-error" role="alert">{speech.error}</p>}<VocabularyDialog open={adding || Boolean(editing)} item={editing ?? undefined} onClose={() => { setAdding(false); setEditing(null); }} /></div>;
}
