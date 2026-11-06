"use client";

import Link from "next/link";
import { ArrowUpRight, Clock3, Heart, ListMinus, Pencil, Trash2 } from "lucide-react";
import { BookCover } from "./book-cover";
import { AddToPlaylist } from "./add-to-playlist";
import { useReading } from "./providers";
import { documentPageCount } from "@/lib/text";
import type { ReadingDocument } from "@/lib/types";

export function BookCard({ document, onEditName, onDelete, onRemoveFromPlaylist, removingFromPlaylist = false }: {
  document: ReadingDocument;
  onEditName?: () => void;
  onDelete?: () => void;
  onRemoveFromPlaylist?: () => void;
  removingFromPlaylist?: boolean;
}) {
  const { updateDocument } = useReading();
  return <article className="document-card">
    <div className="document-cover-wrap">
      <Link href={`/read/${document.id}`} aria-label={`Read ${document.title}`}><BookCover document={document} /></Link>
      <button type="button" className={`favorite-button ${document.favorite ? "is-favorite" : ""}`}
        aria-label={`${document.favorite ? "Remove" : "Add"} ${document.title} ${document.favorite ? "from" : "to"} favorites`} aria-pressed={document.favorite}
        onClick={() => { void updateDocument(document.id, { favorite: !document.favorite }).catch(() => {}); }}>
        <Heart size={15} fill={document.favorite ? "currentColor" : "none"} />
      </button>
    </div>
    <div className="document-card-content">
      <div className="document-category"><span>{document.category}</span><span>{document.type}</span></div>
      <div className="document-title-row"><Link href={`/read/${document.id}`} className="document-title">{document.title}</Link><AddToPlaylist document={document} /></div>
      <p>{document.description}</p>
      {document.uploaded && onEditName && <button type="button" className="text-link edit-book-name document-rename-button" onClick={onEditName}><Pencil size={12} />Edit Book Name</button>}
      <div className="document-meta">
        <span><Clock3 size={12} />{Math.max(1, Math.ceil(document.wordCount / 200))} min read</span><span>{documentPageCount(document)} pages</span>
        <Link href={`/read/${document.id}`} aria-label={`Open ${document.title}`}><ArrowUpRight size={15} /></Link>
        {document.uploaded && onDelete && <button type="button" aria-label={`Delete ${document.title}`} onClick={onDelete}><Trash2 size={13} /></button>}
      </div>
      {onRemoveFromPlaylist && <button type="button" className="remove-from-playlist" aria-label={`Remove ${document.title} from playlist`} disabled={removingFromPlaylist} onClick={onRemoveFromPlaylist}><ListMinus size={14} />{removingFromPlaylist ? "Removing…" : "Remove from playlist"}</button>}
    </div>
  </article>;
}
