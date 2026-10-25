"use client";
import { useEffect, useState } from "react";
import { Button } from "@hangnguyen1902/theme";
import { Modal } from "./modal";
import { useReading } from "./providers";
import type { Note, ReadingDocument } from "@/lib/types";

export function NoteDialog({ open, onClose, document, page = 0, quote = "", item }: { open: boolean; onClose: () => void; document: ReadingDocument; page?: number; quote?: string; item?: Note }) {
  const { saveNote, notify } = useReading();
  const [body, setBody] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  useEffect(() => { if (open) { setBody(item?.body ?? ""); setError(""); } }, [open, item?.id]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!body.trim() || saving) return; setSaving(true);
    try {
      await saveNote({ id: item?.id ?? crypto.randomUUID(), documentId: document.id, page: item?.page ?? page, quote: item?.quote ?? quote, body: body.trim(), createdAt: item?.createdAt ?? Date.now(), updatedAt: Date.now() });
      notify("Your thought has a place to stay."); onClose();
    } catch { setError("Could not save this note. Please try again."); } finally { setSaving(false); }
  }
  return <Modal open={open} title={item ? "Edit note" : "A thought to keep"} onClose={onClose}><p className="modal-description">{document.title} · Page {(item?.page ?? page) + 1}</p>{(quote || item?.quote) && <blockquote className="saved-context">{item?.quote ?? quote}</blockquote>}<form onSubmit={save}><label className="field-label" htmlFor="note-body">Your note</label><textarea id="note-body" className="form-input" rows={6} value={body} maxLength={10_000} onChange={(event) => setBody(event.target.value)} placeholder="What does this bring to mind?" autoFocus required />{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>Save note</Button></div></form></Modal>;
}
