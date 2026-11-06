"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@hangnguyen1902/theme";
import { Modal } from "./modal";
import { useReading } from "./providers";
import type { BookGroup } from "@/lib/types";

export function PlaylistDialog({ group, bookId, onClose }: { group?: BookGroup; bookId?: string; onClose: () => void }) {
  const { bookGroups, createPlaylist, updatePlaylist, notify } = useReading();
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [invalidName, setInvalidName] = useState(false);
  const savingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  function close() { if (!savingRef.current) onClose(); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const trimmedName = name.trim().replace(/\s+/g, " ");
    const duplicate = bookGroups.some((item) => item.id !== group?.id && item.name.toLowerCase() === trimmedName.toLowerCase());
    if (!trimmedName || trimmedName.length > 100 || duplicate) {
      setInvalidName(true);
      setError(!trimmedName ? "Enter a playlist name." : duplicate ? "A playlist with this name already exists." : "Keep the playlist name to 100 characters or fewer.");
      inputRef.current?.focus();
      return;
    }
    savingRef.current = true; setSaving(true); setError(""); setInvalidName(false);
    try {
      const input = { name: trimmedName, description: description.trim() };
      if (group) await updatePlaylist(group.id, input);
      else await createPlaylist(input, bookId);
      notify(group ? "Playlist updated." : bookId ? "Playlist created and book added." : "Playlist created.");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this playlist. Please try again.");
    } finally { savingRef.current = false; setSaving(false); }
  }

  return <Modal open title={group ? "Edit playlist" : "Create playlist"} onClose={close}>
    <p className="modal-description">{group ? "Give this collection a name and a little context." : bookId ? "Create a collection and add this book to it." : "Make a little space for books that belong together."}</p>
    <form onSubmit={save} noValidate>
      <label className="field-label" htmlFor={fieldId}>Playlist name</label>
      <input id={fieldId} ref={inputRef} className="form-input" value={name} maxLength={100} required disabled={saving}
        aria-invalid={invalidName} aria-describedby={error ? `${fieldId}-error` : undefined}
        onChange={(event) => { setName(event.target.value); setError(""); setInvalidName(false); }} />
      <label className="field-label" style={{ marginTop: 18 }} htmlFor={`${fieldId}-description`}>Description (optional)</label>
      <textarea id={`${fieldId}-description`} className="form-input" rows={3} maxLength={1000} value={description} disabled={saving}
        onChange={(event) => setDescription(event.target.value)} />
      {error && <p id={`${fieldId}-error`} className="form-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <Button type="button" variant="outline" disabled={saving} onClick={close}>Cancel</Button>
        <Button type="submit" loading={saving}>{group ? "Save changes" : "Create playlist"}</Button>
      </div>
    </form>
  </Modal>;
}
