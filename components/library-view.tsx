"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, BookOpen, ChevronDown, Clock3, FileUp, FolderUp, Library, Search, Sparkles, Upload, X } from "lucide-react";
import { Badge, Button } from "@hangnguyen1902/theme";
import { useReading } from "./providers";
import { Loading } from "./loading";
import { BookCover } from "./book-cover";
import { BookNameDialog } from "./book-name-dialog";
import { BookCard } from "./book-card";
import { DocumentPagination } from "./document-pagination";
import { Modal } from "./modal";
import { importDocument } from "@/lib/import-document";
import { documentPageCount } from "@/lib/text";
import type { MarkdownFolderEntry } from "@/lib/markdown-assets";
import type { ReadingDocument } from "@/lib/types";
import "./library-display-options.css";
import "./markdown-upload.css";

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
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [directorySupported, setDirectorySupported] = useState<boolean | null>(null);
  const [folderChoice, setFolderChoice] = useState<{ entries: MarkdownFolderEntry[]; markdown: MarkdownFolderEntry[] } | null>(null);
  const [selectedMarkdownPath, setSelectedMarkdownPath] = useState("");
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState<ReadingDocument | null>(null);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const importLock = useRef(false);
  const shelfDocuments = useMemo(() => documents.filter((document) => (settings.showDefaultBooks || document.uploaded) && (!favoritesOnly || document.favorite)), [documents, settings.showDefaultBooks, favoritesOnly]);
  const visible = useMemo(() => shelfDocuments.filter((document) => (filter === "all" || (filter === "uploads" ? document.uploaded : !document.uploaded)) && `${document.title} ${document.description} ${document.category}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) : (b.lastReadAt ?? b.createdAt) - (a.lastReadAt ?? a.createdAt)), [shelfDocuments, filter, query, sort]);
  const totalPages = Math.max(1, Math.ceil(visible.length / DOCUMENTS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageDocuments = visible.slice((currentPage - 1) * DOCUMENTS_PER_PAGE, currentPage * DOCUMENTS_PER_PAGE);
  // Keep the stored page valid after deletion, renaming, or removing a favorite.
  useEffect(() => { setPage((value) => Math.min(value, totalPages)); }, [totalPages]);
  useEffect(() => { setDirectorySupported("webkitdirectory" in window.document.createElement("input")); }, []);
  async function changeDefaultBooks(showDefaultBooks: boolean) {
    setPendingVisibility(showDefaultBooks);
    try { await updateSettings({ showDefaultBooks }); setPage(1); }
    catch { /* The provider displays storage errors and keeps the saved preference. */ }
    finally { setPendingVisibility(null); }
  }
  async function upload(files: FileList | File[]) {
    if (importLock.current || folderChoice) return;
    importLock.current = true; setUploadError(""); setUploadWarnings([]);
    let count = 0; const failures: string[] = []; const warnings: string[] = [];
    try {
      for (const file of Array.from(files)) {
        setBusy(`Opening ${file.name}…`);
        try {
          if (/\.(md|markdown)$/i.test(file.name)) {
            const { importMarkdownWithAssets } = await import("@/lib/markdown-assets");
            const result = await importMarkdownWithAssets(file, { onProgress: setBusy });
            setBusy(`Saving ${file.name}…`);
            await addDocument(result.document, result.assets);
            warnings.push(...result.warnings.map((warning) => `${file.name}: ${warning}`));
          } else {
            const document = await importDocument(file); await addDocument(document);
          }
          count++;
        }
        catch (error) { failures.push(`${file.name}: ${error instanceof Error ? error.message : "Could not read this file."}`); }
      }
      if (count) notify(`${count === 1 ? "Your document is" : `${count} documents are`} ready to read.`);
      if (failures.length) setUploadError(failures.join(" "));
      setUploadWarnings(warnings);
      if (count) setPage(1);
    } finally { setBusy(""); importLock.current = false; if (input.current) input.current.value = ""; }
  }
  async function saveMarkdownFolder(entry: MarkdownFolderEntry, entries: MarkdownFolderEntry[]) {
    const { importMarkdownWithAssets } = await import("@/lib/markdown-assets");
    const result = await importMarkdownWithAssets(entry.file, { markdownPath: entry.path, files: entries, onProgress: setBusy });
    setBusy(`Saving ${entry.file.name} and its images…`);
    await addDocument(result.document, result.assets);
    setUploadWarnings(result.warnings);
    setPage(1);
    notify(`Your document and ${result.assets.length} ${result.assets.length === 1 ? "image are" : "images are"} ready to read.`);
  }
  async function uploadFolder(files: FileList) {
    if (importLock.current || folderChoice) return;
    importLock.current = true; setBusy("Reading selected folder…"); setUploadError(""); setUploadWarnings([]);
    try {
      const { getMarkdownFolderEntries } = await import("@/lib/markdown-assets");
      const entries = getMarkdownFolderEntries(Array.from(files));
      const markdown = entries.filter((entry) => /\.(md|markdown)$/i.test(entry.path)).sort((a, b) => a.path.localeCompare(b.path));
      if (!markdown.length) throw new Error("This folder has no Markdown files. Choose a folder containing a .md or .markdown document and its images.");
      if (markdown.length > 1) { setSelectedMarkdownPath(markdown[0].path); setFolderChoice({ entries, markdown }); }
      else await saveMarkdownFolder(markdown[0], entries);
    } catch (error) { setUploadError(error instanceof Error ? error.message : "Could not import this folder."); }
    finally { setBusy(""); importLock.current = false; if (folderInput.current) folderInput.current.value = ""; }
  }
  async function importSelectedMarkdown() {
    if (importLock.current || !folderChoice) return;
    const entry = folderChoice.markdown.find((item) => item.path === selectedMarkdownPath);
    if (!entry) return;
    const entries = folderChoice.entries;
    importLock.current = true; setFolderChoice(null); setBusy(`Opening ${entry.file.name}…`);
    try { await saveMarkdownFolder(entry, entries); }
    catch (error) { setUploadError(error instanceof Error ? error.message : "Could not import this folder."); }
    finally { setBusy(""); importLock.current = false; }
  }
  if (!ready) return <Loading />;
  const recent = [...shelfDocuments].filter((item) => item.lastReadAt).sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0];
  const featured = recent ?? shelfDocuments.find((item) => item.id === "attention") ?? shelfDocuments[0];
  const editingBook = documents.find((item) => item.id === editingBookId && item.uploaded);
  return <div className="library-page" onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files); }}>
    <div className="page-eyebrow"><span className="status-dot" />YOUR PERSONAL READING SPACE</div><div className="page-heading"><div><h1>{favoritesOnly ? <>The ones you <em>come back to.</em></> : <>A little reading.<br />A world of <em>possibility.</em></>}</h1><p>{favoritesOnly ? "A shelf for the stories and ideas you want to keep close." : "Good words, a quiet moment, and something new to learn."}</p></div><div className="library-upload-actions"><Button onClick={() => input.current?.click()} loading={Boolean(busy)} disabled={Boolean(folderChoice)} leadingIcon={<PlusIcon />} className="upload-button">Upload document</Button><Button variant="outline" onClick={() => folderInput.current?.click()} disabled={!directorySupported || Boolean(busy) || Boolean(folderChoice)} leadingIcon={<FolderUp size={16} />}>Upload Markdown folder</Button></div></div>
    <input ref={input} type="file" multiple accept=".pdf,.docx,.txt,.md,.markdown" className="file-input" aria-label="Upload documents" onChange={(event) => { if (event.target.files) void upload(event.target.files); }} />
    <input ref={(element) => { folderInput.current = element; element?.setAttribute("webkitdirectory", ""); }} type="file" multiple className="file-input" aria-label="Upload Markdown folder" onChange={(event) => { if (event.target.files?.length) void uploadFolder(event.target.files); }} />
    {busy && <div className="inline-notice" role="status"><FileUp size={16} />{busy}</div>}{uploadError && <div className="inline-error" role="alert">{uploadError}<button type="button" aria-label="Dismiss upload error" onClick={() => setUploadError("")}><X size={15} /></button></div>}
    <p className="markdown-upload-help">For Markdown with images, choose <strong>Upload Markdown folder</strong> and select the common parent folder containing the document and all its image folders. Files stay on this device.</p>
    {directorySupported === false && <p className="inline-notice" role="status">Folder upload is unavailable in this browser. Use a current browser with folder selection to import Markdown images. Individual documents can still be uploaded.</p>}
    {uploadWarnings.length > 0 && <div className="markdown-upload-warnings" role="status"><strong>The document was saved with image warnings.</strong><p>Use Upload Markdown folder to include all referenced images.</p><ul>{uploadWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul><button type="button" className="text-link" onClick={() => setUploadWarnings([])}>Dismiss image warnings</button></div>}
    {!favoritesOnly && featured && <section className="featured-read"><div className="featured-content"><span className="featured-label"><BookOpen size={13} />{recent ? "CONTINUE READING" : "YOUR FIRST CHAPTER"}</span><h2>{featured.title}</h2><p>{featured.description}</p><div className="featured-meta"><span><Clock3 size={13} />{Math.max(1, Math.ceil(featured.wordCount / 200))} min read</span><span className="meta-dot" /><span>{recent ? `Page ${featured.currentPage + 1} of ${documentPageCount(featured)}` : `${documentPageCount(featured)} pages`}</span><Badge tone="neutral">{featured.category}</Badge></div><Link href={`/read/${featured.id}`} className="featured-link">{recent ? "Back to your book" : "Settle in and read"}<ArrowRight size={16} /></Link></div><div className="featured-cover"><BookCover document={featured} /></div><span className="feature-corner" aria-hidden="true"><Sparkles size={18} strokeWidth={1} /></span></section>}
    <div className="library-display-options">
      <label className="default-books-toggle">
        <input type="checkbox" role="switch" checked={pendingVisibility ?? settings.showDefaultBooks} disabled={pendingVisibility !== null} onChange={(event) => { void changeDefaultBooks(event.target.checked); }} />
        <span className="default-books-toggle-track" aria-hidden="true" />
        <span>Show default books</span>
      </label>
    </div>
    <div className="library-toolbar"><div className="library-tabs" aria-label="Document filters">{[{ value: "all", label: "All documents" }, { value: "curated", label: "Folio readings" }, { value: "uploads", label: "My uploads" }].map(({ value, label }) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value as typeof filter); setPage(1); }}>{label}{value === "all" && <span>{shelfDocuments.length}</span>}</button>)}</div><div className="library-tools"><label className="search-input"><Search size={15} /><input placeholder="Find something to read…" aria-label="Search documents" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label><div className="sort-select"><select aria-label="Sort documents" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="recent">Recently opened</option><option value="title">Title A–Z</option></select><ChevronDown size={13} /></div></div></div>
    {visible.length ? <div className="document-grid">{pageDocuments.map((document) => <BookCard key={document.id} document={document} onEditName={() => setEditingBookId(document.id)} onDelete={() => setRemoving(document)} />)}</div> : <div className="empty-state"><Library size={30} strokeWidth={1.3} /><h2>{query ? "Nothing on this shelf yet." : favoritesOnly ? "Keep your favorite reads close." : "Your next read is waiting."}</h2><p>{query ? "Try another title or clear the filters." : favoritesOnly ? "Tap the heart on a document to add it here." : settings.showDefaultBooks ? "Upload a document or explore the Folio readings." : "Upload a document or turn on Show default books to explore the Folio readings."}</p>{favoritesOnly && <Link href="/" className="text-link">Explore your library <ArrowRight size={14} /></Link>}</div>}
    <DocumentPagination page={currentPage} pageSize={DOCUMENTS_PER_PAGE} total={visible.length} onPageChange={setPage} />
    <button type="button" className={`upload-dropzone ${dragging ? "dragging" : ""}`} disabled={Boolean(busy)} onClick={() => input.current?.click()}><span className="dropzone-icon"><Upload size={20} strokeWidth={1.5} /></span><span><strong>Bring your own words.</strong><span>Drop a document here, or <b>browse files</b></span></span><span className="dropzone-formats">PDF · DOCX · TXT · MD<span>Up to 20 MB · stays on your device</span></span></button>
    <div className="page-bottom-note"><LeafIcon /><span>A good book asks for nothing but a little of your time.</span><span className="folio-signature">read. listen. learn.</span></div>
    <Modal open={Boolean(removing)} title="Remove document?" onClose={() => setRemoving(null)}><p className="modal-description">Remove “{removing?.title}” and its images, notes and highlights from this device? Your saved vocabulary will remain.</p><div className="modal-actions"><Button variant="outline" onClick={() => setRemoving(null)}>Keep document</Button><Button variant="danger" onClick={() => { if (removing) void deleteDocument(removing.id).then(() => { setRemoving(null); notify("Document removed from your library."); }).catch(() => {}); }}>Remove document</Button></div></Modal>
    <Modal open={Boolean(folderChoice)} title="Choose a Markdown document" onClose={() => setFolderChoice(null)}>
      <p className="modal-description">This folder contains multiple Markdown files. Choose a document to import with its referenced images.</p>
      <label className="form-label" htmlFor="markdown-folder-document">Markdown document</label>
      <select id="markdown-folder-document" className="form-input" value={selectedMarkdownPath} onChange={(event) => setSelectedMarkdownPath(event.target.value)}>{folderChoice?.markdown.map((entry) => <option key={entry.path} value={entry.path}>{entry.path}</option>)}</select>
      <div className="modal-actions"><Button variant="outline" onClick={() => setFolderChoice(null)}>Cancel</Button><Button onClick={() => { void importSelectedMarkdown(); }}>Import document</Button></div>
    </Modal>
    {editingBook && <BookNameDialog key={editingBook.id} document={editingBook} onClose={() => setEditingBookId(null)} />}
  </div>;
}
function PlusIcon() { return <span className="plus-symbol" aria-hidden="true">+</span>; }
function LeafIcon() { return <BookOpen size={13} strokeWidth={1.3} />; }
