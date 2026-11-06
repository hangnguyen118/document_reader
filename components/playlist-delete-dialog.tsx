"use client";

import { useRef, useState } from "react";
import { Button } from "@hangnguyen1902/theme";
import { Modal } from "./modal";
import { useReading } from "./providers";
import type { BookGroup } from "@/lib/types";

export function PlaylistDeleteDialog({ group, onClose, onDeleted }: { group: BookGroup; onClose: () => void; onDeleted?: () => void }) {
  const { deletePlaylist, notify } = useReading();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);

  function close() { if (!savingRef.current) onClose(); }

  async function remove() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true); setError("");
    try {
      await deletePlaylist(group.id);
      notify("Playlist deleted. Your books are still in your library.");
      onDeleted?.();
      onClose();
    } catch { setError("Could not delete this playlist. Please try again."); }
    finally { savingRef.current = false; setSaving(false); }
  }

  return <Modal open title="Delete playlist?" onClose={close}>
    <p className="modal-description">Delete “{group.name}”? This removes the playlist and its book selections. Your books, notes and reading progress will stay in your library.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions">
      <Button type="button" variant="outline" disabled={saving} onClick={close}>Keep playlist</Button>
      <Button type="button" variant="danger" loading={saving} onClick={() => { void remove(); }}>Delete playlist</Button>
    </div>
  </Modal>;
}
