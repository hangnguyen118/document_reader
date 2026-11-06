"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, BookOpen, ListMusic, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@hangnguyen1902/theme";
import { useReading } from "./providers";
import { Loading } from "./loading";
import { BookCover } from "./book-cover";
import { BookCard } from "./book-card";
import { BookNameDialog } from "./book-name-dialog";
import { PlaylistDialog } from "./playlist-dialog";
import { PlaylistDeleteDialog } from "./playlist-delete-dialog";
import type { BookGroup, ReadingDocument } from "@/lib/types";
import "./playlists.css";

function PlaylistActions({ group, onEdit, onDelete }: { group: BookGroup; onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    function outside(event: PointerEvent) { if (!container.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function keydown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); return; }
    const entries = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = entries.indexOf(document.activeElement as HTMLElement);
    let next = index;
    if (event.key === "ArrowDown") next = (index + 1) % entries.length;
    else if (event.key === "ArrowUp") next = (index - 1 + entries.length) % entries.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = entries.length - 1;
    else return;
    event.preventDefault(); entries[next]?.focus();
  }

  function choose(action: () => void) { setOpen(false); trigger.current?.focus(); action(); }

  return <div ref={container} className="playlist-actions" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button ref={trigger} type="button" className="icon-button" title="Playlist options" aria-label={`Manage ${group.name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={19} /></button>
    {open && <div ref={menu} id={id} className="playlist-action-menu" role="menu" aria-label={`Actions for ${group.name}`} onKeyDown={keydown}>
      <Link role="menuitem" href={`/playlists/${group.id}`} onClick={() => setOpen(false)}><BookOpen size={14} />Open playlist</Link>
      <button type="button" role="menuitem" onClick={() => choose(onEdit)}><Pencil size={14} />Edit playlist</button>
      <button type="button" role="menuitem" className="playlist-delete-action" onClick={() => choose(onDelete)}><Trash2 size={14} />Delete playlist</button>
    </div>}
  </div>;
}

function PlaylistPreview({ documents }: { documents: ReadingDocument[] }) {
  if (!documents.length) return <div className="playlist-preview playlist-preview-empty"><ListMusic size={37} strokeWidth={1.1} /><span>A little room for your next reads.</span></div>;
  return <div className="playlist-preview" aria-hidden="true">{documents.slice(0, 3).map((document) => <div className="playlist-preview-book" key={document.id}><BookCover document={document} compact /></div>)}</div>;
}

export function PlaylistsView() {
  const { bookGroups, bookGroupItems, documents, ready, error } = useReading();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BookGroup | null>(null);
  const [removing, setRemoving] = useState<BookGroup | null>(null);
  const playlistDocuments = useMemo(() => {
    const byId = new Map(documents.map((document) => [document.id, document]));
    const byGroup = new Map<string, ReadingDocument[]>();
    for (const item of [...bookGroupItems].sort((a, b) => a.order - b.order || a.addedAt - b.addedAt)) {
      const document = byId.get(item.bookId);
      if (document) { const list = byGroup.get(item.groupId) ?? []; list.push(document); byGroup.set(item.groupId, list); }
    }
    return byGroup;
  }, [documents, bookGroupItems]);

  if (!ready) return <Loading label="Opening your playlists…" />;
  const groups = [...bookGroups].sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name));
  return <div className="playlists-page">
    <div className="page-eyebrow"><span className="status-dot" />READS THAT BELONG TOGETHER</div>
    <div className="page-heading"><div><h1>My Playlist</h1><p>A place for every reading mood. Gather your books into collections of your own.</p></div><Button type="button" className="upload-button" onClick={() => setCreating(true)}><Plus size={15} />Create playlist</Button></div>
    {groups.length ? <>
      <div className="playlist-overview-meta">{groups.length} {groups.length === 1 ? "playlist" : "playlists"}<span>Saved on this device</span></div>
      <div className="playlist-grid">{groups.map((group) => {
        const books = playlistDocuments.get(group.id) ?? [];
        return <article className="playlist-card" key={group.id}>
          <Link href={`/playlists/${group.id}`} className="playlist-card-link" aria-label={`Open playlist ${group.name}`}><PlaylistPreview documents={books} /><div className="playlist-card-heading"><h2>{group.name}</h2>{group.description && <p>{group.description}</p>}</div></Link>
          <div className="playlist-card-footer"><span><BookOpen size={13} />{books.length} {books.length === 1 ? "book" : "books"}</span><PlaylistActions group={group} onEdit={() => setEditing(group)} onDelete={() => setRemoving(group)} /></div>
        </article>;
      })}</div>
    </> : <div className="empty-state"><ListMusic size={34} strokeWidth={1.2} /><h2>{error ? "Your playlists are unavailable." : "Make room for a collection."}</h2><p>{error ? "Check your browser storage and refresh to try again." : "Keep books for a project, a language, or a quiet afternoon together."}</p>{!error && <Button type="button" variant="outline" onClick={() => setCreating(true)}><Plus size={15} />Create your first playlist</Button>}</div>}
    {creating && <PlaylistDialog onClose={() => setCreating(false)} />}
    {editing && <PlaylistDialog group={editing} onClose={() => setEditing(null)} />}
    {removing && <PlaylistDeleteDialog group={removing} onClose={() => setRemoving(null)} />}
  </div>;
}

export function PlaylistDetailView({ id }: { id: string }) {
  const { bookGroups, bookGroupItems, documents, ready, error, setPlaylistMembership, notify } = useReading();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingBook, setEditingBook] = useState<ReadingDocument | null>(null);
  const [removing, setRemoving] = useState<string[]>([]);
  const [removeError, setRemoveError] = useState("");
  const removalLocks = useRef(new Set<string>());
  const group = bookGroups.find((item) => item.id === id);
  const books = useMemo(() => {
    const byId = new Map(documents.map((document) => [document.id, document]));
    return bookGroupItems.filter((item) => item.groupId === id).sort((a, b) => a.order - b.order || a.addedAt - b.addedAt).flatMap((item) => { const document = byId.get(item.bookId); return document ? [document] : []; });
  }, [documents, bookGroupItems, id]);

  async function removeBook(document: ReadingDocument) {
    if (removalLocks.current.has(document.id)) return;
    removalLocks.current.add(document.id); setRemoving((current) => [...current, document.id]); setRemoveError("");
    try { await setPlaylistMembership(id, document.id, false); notify(`“${document.title}” removed from this playlist. Your book is still in your library.`); }
    catch { setRemoveError("Could not remove this book from the playlist. Please try again."); }
    finally { removalLocks.current.delete(document.id); setRemoving((current) => current.filter((item) => item !== document.id)); }
  }

  if (!ready) return <Loading label="Opening your playlist…" />;
  if (!group) return <div className="empty-state"><ListMusic size={34} strokeWidth={1.2} /><h1>{error ? "Your playlist is unavailable." : "Playlist not found."}</h1><p>{error ? "Check your browser storage and refresh to try again." : "It may have been deleted from this device."}</p><Link href="/playlists" className="text-link"><ArrowLeft size={14} />Back to My Playlist</Link></div>;

  return <div className="playlists-page">
    <Link href="/playlists" className="text-link playlist-back-link"><ArrowLeft size={14} />My Playlist</Link>
    <div className="page-eyebrow"><ListMusic size={13} />YOUR READING COLLECTION</div>
    <div className="page-heading playlist-detail-heading"><div><h1>{group.name}</h1>{group.description && <p className="playlist-description">{group.description}</p>}<p className="playlist-book-count">{books.length} {books.length === 1 ? "book" : "books"}</p></div><div className="playlist-heading-actions"><Button type="button" variant="outline" onClick={() => setEditing(true)}><Pencil size={14} />Edit playlist</Button><PlaylistActions group={group} onEdit={() => setEditing(true)} onDelete={() => setDeleting(true)} /></div></div>
    {removeError && <p className="form-error" role="alert">{removeError}</p>}
    {books.length ? <div className="document-grid">{books.map((document) => <BookCard key={document.id} document={document} onEditName={document.uploaded ? () => setEditingBook(document) : undefined} onRemoveFromPlaylist={() => { void removeBook(document); }} removingFromPlaylist={removing.includes(document.id)} />)}</div> : <div className="empty-state"><BookOpen size={33} strokeWidth={1.2} /><h2>Your next chapter belongs here.</h2><p>Add books using the Add to playlist button beside a book title in your library.</p><Link href="/" className="text-link">Explore your library<ArrowRight size={14} /></Link></div>}
    {editing && <PlaylistDialog group={group} onClose={() => setEditing(false)} />}
    {deleting && <PlaylistDeleteDialog group={group} onClose={() => setDeleting(false)} onDeleted={() => router.replace("/playlists")} />}
    {editingBook && documents.some((document) => document.id === editingBook.id) && <BookNameDialog key={editingBook.id} document={editingBook} onClose={() => setEditingBook(null)} />}
  </div>;
}
