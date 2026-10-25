"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, BookOpen, ChevronDown, Clock3, FileUp, Heart, Library, Pencil, Search, Sparkles, Trash2, Upload, X } from "lucide-react";
import { Badge, Button } from "@hangnguyen1902/theme";
import { useReading } from "./providers";
import { Loading } from "./loading";
import { BookCover } from "./book-cover";
import { BookNameDialog } from "./book-name-dialog";
import { DocumentPagination } from "./document-pagination";
import { Modal } from "./modal";
import { importDocument } from "@/lib/import-document";
import type { ReadingDocument } from "@/lib/types";
import "./library-display-options.css";

const DOCUMENTS_PER_PAGE = 12;

export function LibraryView({ favoritesOnly = false }: { favoritesOnly?: boolean }) {
  const { documents, settings, ready, addDocument, updateDocument, deleteDocument, updateSettings, notify } = useReading();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "uploads" | "curated">("all");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState("");
  const [pendingVisibility, setPendingVisibility] = useState<boolean | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState<ReadingDocument | null>(null);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const importLock = useRef(false);
  const shelfDocuments = useMemo(() => documents.filter((document) => (settings.showDefaultBooks || document.uploaded) && (!favoritesOnly || document.favorite)), [documents, settings.showDefaultBooks, favoritesOnly]);
  const visible = useMemo(() => shelfDocuments.filter((document) => (filter === "all" || (filter === "uploads" ? document.uploaded : !document.uploaded)) && `${document.title} ${document.description} ${document.category}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) : (b.lastReadAt ?? b.createdAt) - (a.lastReadAt ?? a.createdAt)), [shelfDocuments, filter, query, sort]);
  const totalPages = Math.max(1, Math.ceil(visible.length / DOCUMENTS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageDocuments = visible.slice((currentPage - 1) * DOCUMENTS_PER_PAGE, currentPage * DOCUMENTS_PER_PAGE);
  // Keep the stored page valid after deletion, renaming, or removing a favorite.
  useEffect(() => { setPage((value) => Math.min(value, totalPages)); }, [totalPages]);
  async function changeDefaultBooks(showDefaultBooks: boolean) {
    setPendingVisibility(showDefaultBooks);
    try { await updateSettings({ showDefaultBooks }); setPage(1); }
    catch { /* The provider displays storage errors and keeps the saved preference. */ }
    finally { setPendingVisibility(null); }
  }
  async function upload(files: FileList | File[]) {
    if (importLock.current) return;
    importLock.current = true; setUploadError("");
    let count = 0; const failures: string[] = [];
    try {
      for (const file of Array.from(files)) {
        setBusy(`Opening ${file.name}…`);
        try { const document = await importDocument(file); await addDocument(document); count++; }
        catch (error) { failures.push(`${file.name}: ${error instanceof Error ? error.message : "Could not read this file."}`); }
      }
      if (count) notify(`${count === 1 ? "Your document is" : `${count} documents are`} ready to read.`);
      if (failures.length) setUploadError(failures.join(" "));
    } finally { setBusy(""); importLock.current = false; if (input.current) input.current.value = ""; }
  }
  if (!ready) return <Loading />;
  const recent = [...shelfDocuments].filter((item) => item.lastReadAt).sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0];
  const featured = recent ?? shelfDocuments.find((item) => item.id === "attention") ?? shelfDocuments[0];
  const editingBook = documents.find((item) => item.id === editingBookId && item.uploaded);
  return <div className="library-page" onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files); }}>
    <div className="page-eyebrow"><span className="status-dot" />YOUR PERSONAL READING SPACE</div><div className="page-heading"><div><h1>{favoritesOnly ? <>The ones you <em>come back to.</em></> : <>A little reading.<br />A world of <em>possibility.</em></>}</h1><p>{favoritesOnly ? "A shelf for the stories and ideas you want to keep close." : "Good words, a quiet moment, and something new to learn."}</p></div><Button onClick={() => input.current?.click()} loading={Boolean(busy)} leadingIcon={<PlusIcon />} className="upload-button">Upload document</Button></div>
    <input ref={input} type="file" multiple accept=".pdf,.docx,.txt,.md,.markdown" className="file-input" aria-label="Upload documents" onChange={(event) => { if (event.target.files) void upload(event.target.files); }} />
    {busy && <div className="inline-notice" role="status"><FileUp size={16} />{busy}</div>}{uploadError && <div className="inline-error" role="alert">{uploadError}<button type="button" aria-label="Dismiss upload error" onClick={() => setUploadError("")}><X size={15} /></button></div>}
    {!favoritesOnly && featured && <section className="featured-read"><div className="featured-content"><span className="featured-label"><BookOpen size={13} />{recent ? "CONTINUE READING" : "YOUR FIRST CHAPTER"}</span><h2>{featured.title}</h2><p>{featured.description}</p><div className="featured-meta"><span><Clock3 size={13} />{Math.max(1, Math.ceil(featured.wordCount / 200))} min read</span><span className="meta-dot" /><span>{recent ? `Page ${featured.currentPage + 1} of ${featured.pages.length}` : `${featured.pages.length} pages`}</span><Badge tone="neutral">{featured.category}</Badge></div><Link href={`/read/${featured.id}`} className="featured-link">{recent ? "Back to your book" : "Settle in and read"}<ArrowRight size={16} /></Link></div><div className="featured-cover"><BookCover document={featured} /></div><span className="feature-corner" aria-hidden="true"><Sparkles size={18} strokeWidth={1} /></span></section>}
    <div className="library-display-options">
      <label className="default-books-toggle">
        <input type="checkbox" role="switch" checked={pendingVisibility ?? settings.showDefaultBooks} disabled={pendingVisibility !== null} onChange={(event) => { void changeDefaultBooks(event.target.checked); }} />
        <span className="default-books-toggle-track" aria-hidden="true" />
        <span>Show default books</span>
      </label>
    </div>
    <div className="library-toolbar"><div className="library-tabs" aria-label="Document filters">{[{ value: "all", label: "All documents" }, { value: "curated", label: "Folio readings" }, { value: "uploads", label: "My uploads" }].map(({ value, label }) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value as typeof filter); setPage(1); }}>{label}{value === "all" && <span>{shelfDocuments.length}</span>}</button>)}</div><div className="library-tools"><label className="search-input"><Search size={15} /><input placeholder="Find something to read…" aria-label="Search documents" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label><div className="sort-select"><select aria-label="Sort documents" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="recent">Recently opened</option><option value="title">Title A–Z</option></select><ChevronDown size={13} /></div></div></div>
    {visible.length ? <div className="document-grid">{pageDocuments.map((document) => <article className="document-card" key={document.id}><div className="document-cover-wrap"><Link href={`/read/${document.id}`} aria-label={`Read ${document.title}`}><BookCover document={document} /></Link><button type="button" className={`favorite-button ${document.favorite ? "is-favorite" : ""}`} aria-label={`${document.favorite ? "Remove" : "Add"} ${document.title} ${document.favorite ? "from" : "to"} favorites`} aria-pressed={document.favorite} onClick={() => { void updateDocument(document.id, { favorite: !document.favorite }).catch(() => {}); }}><Heart size={15} fill={document.favorite ? "currentColor" : "none"} /></button></div><div className="document-card-content"><div className="document-category"><span>{document.category}</span><span>{document.type}</span></div><Link href={`/read/${document.id}`} className="document-title">{document.title}</Link><p>{document.description}</p>{document.uploaded && <button type="button" className="text-link edit-book-name document-rename-button" onClick={() => setEditingBookId(document.id)}><Pencil size={12} />Edit Book Name</button>}<div className="document-meta"><span><Clock3 size={12} />{Math.max(1, Math.ceil(document.wordCount / 200))} min read</span><span>{document.pages.length} pages</span><Link href={`/read/${document.id}`} aria-label={`Open ${document.title}`}><ArrowUpRight size={15} /></Link>{document.uploaded && <button type="button" aria-label={`Delete ${document.title}`} onClick={() => setRemoving(document)}><Trash2 size={13} /></button>}</div></div></article>)}</div> : <div className="empty-state"><Library size={30} strokeWidth={1.3} /><h2>{query ? "Nothing on this shelf yet." : favoritesOnly ? "Keep your favorite reads close." : "Your next read is waiting."}</h2><p>{query ? "Try another title or clear the filters." : favoritesOnly ? "Tap the heart on a document to add it here." : settings.showDefaultBooks ? "Upload a document or explore the Folio readings." : "Upload a document or turn on Show default books to explore the Folio readings."}</p>{favoritesOnly && <Link href="/" className="text-link">Explore your library <ArrowRight size={14} /></Link>}</div>}
    <DocumentPagination page={currentPage} pageSize={DOCUMENTS_PER_PAGE} total={visible.length} onPageChange={setPage} />
    <button type="button" className={`upload-dropzone ${dragging ? "dragging" : ""}`} disabled={Boolean(busy)} onClick={() => input.current?.click()}><span className="dropzone-icon"><Upload size={20} strokeWidth={1.5} /></span><span><strong>Bring your own words.</strong><span>Drop a document here, or <b>browse files</b></span></span><span className="dropzone-formats">PDF · DOCX · TXT · MD<span>Up to 20 MB · stays on your device</span></span></button>
    <div className="page-bottom-note"><LeafIcon /><span>A good book asks for nothing but a little of your time.</span><span className="folio-signature">read. listen. learn.</span></div>
    <Modal open={Boolean(removing)} title="Remove document?" onClose={() => setRemoving(null)}><p className="modal-description">Remove “{removing?.title}” and its notes and highlights from this device? Your saved vocabulary will remain.</p><div className="modal-actions"><Button variant="outline" onClick={() => setRemoving(null)}>Keep document</Button><Button variant="danger" onClick={() => { if (removing) void deleteDocument(removing.id).then(() => { setRemoving(null); notify("Document removed from your library."); }).catch(() => {}); }}>Remove document</Button></div></Modal>
    {editingBook && <BookNameDialog key={editingBook.id} document={editingBook} onClose={() => setEditingBookId(null)} />}
  </div>;
}
function PlusIcon() { return <span className="plus-symbol" aria-hidden="true">+</span>; }
function LeafIcon() { return <BookOpen size={13} strokeWidth={1.3} />; }
