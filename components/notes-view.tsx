"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, NotebookPen, Pencil, Search, Trash2 } from "lucide-react";
import { useReading } from "./providers";
import { Loading } from "./loading";
import { NoteDialog } from "./note-dialog";
import type { Note } from "@/lib/types";

export function NotesView() {
  const { notes, documents, ready, removeNote, notify } = useReading(); const [query, setQuery] = useState(""); const [editing, setEditing] = useState<Note | null>(null);
  if (!ready) return <Loading />;
  const list = [...notes].filter((note) => `${note.body} ${note.quote} ${documents.find((doc) => doc.id === note.documentId)?.title}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt);
  const current = documents.find((doc) => doc.id === editing?.documentId);
  return <div><div className="page-eyebrow"><span className="status-dot" />THOUGHTS ALONG THE WAY</div><div className="page-heading"><div><h1>Room for your <em>thoughts.</em></h1><p>The ideas you wanted to hold onto, gathered in one place.</p></div><span className="heading-icon"><NotebookPen size={32} strokeWidth={1.2} /></span></div><div className="list-toolbar"><label className="search-input"><Search size={15} /><input placeholder="Find a thought…" aria-label="Search notes" value={query} onChange={(event) => setQuery(event.target.value)} /></label><span>{list.length} notes</span></div>{list.length ? <div className="notes-grid">{list.map((note) => { const document = documents.find((doc) => doc.id === note.documentId); return <article className="note-card" key={note.id}><div className="note-source"><Link href={`/read/${note.documentId}?page=${note.page + 1}`}>{document?.title ?? "Your document"}</Link><span>Page {note.page + 1}</span></div>{note.quote && <blockquote>{note.quote}</blockquote>}<p className="note-body">{note.body}</p><div className="note-card-footer"><span>{new Date(note.updatedAt).toLocaleDateString("en", { month: "short", day: "numeric" })}</span><button type="button" className="icon-button" aria-label="Edit note" onClick={() => setEditing(note)}><Pencil size={14} /></button><button type="button" className="icon-button" aria-label="Delete note" onClick={() => { void removeNote(note.id).then(() => notify("Note removed.")).catch(() => {}); }}><Trash2 size={14} /></button></div></article>; })}</div> : <div className="empty-state"><NotebookPen size={32} strokeWidth={1.3} /><h2>{query ? "No thoughts match that search." : "Leave yourself a little margin."}</h2><p>{query ? "Try another phrase." : "Open a document and add a note whenever an idea finds you."}</p><Link href="/" className="text-link">Find your next read <ArrowRight size={14} /></Link></div>}{current && <NoteDialog open={Boolean(editing)} document={current} item={editing ?? undefined} onClose={() => setEditing(null)} />}</div>;
}
