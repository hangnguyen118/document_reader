"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ListPlus, Plus } from "lucide-react";
import { useReading } from "./providers";
import { PlaylistDialog } from "./playlist-dialog";
import type { ReadingDocument } from "@/lib/types";
import "./add-to-playlist.css";

export function AddToPlaylist({ document }: { document: ReadingDocument }) {
  const { bookGroups, bookGroupItems, setPlaylistMembership, notify, error: storageError } = useReading();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const mutation = useRef(false);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [optimistic, setOptimistic] = useState<{ groupId: string; included: boolean } | null>(null);

  function position() {
    const button = trigger.current; const panel = popover.current;
    if (!button || !panel) return;
    const bounds = button.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 24);
    panel.style.width = `${width}px`;
    const height = Math.min(panel.scrollHeight + 2, 380, window.innerHeight - 24);
    panel.style.left = `${Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12))}px`;
    panel.style.top = `${Math.max(12, Math.min(bounds.bottom + 8, window.innerHeight - height - 12))}px`;
  }

  useEffect(() => {
    if (!open) return;
    position();
    popover.current?.querySelector<HTMLElement>("input, button")?.focus();
    const observer = new ResizeObserver(position);
    if (popover.current) observer.observe(popover.current);
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !popover.current?.matches(":popover-open")) return;
      event.preventDefault(); popover.current.hidePopover(); trigger.current?.focus();
    }
    window.document.addEventListener("keydown", escape);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => { observer.disconnect(); window.document.removeEventListener("keydown", escape); window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [open, bookGroups.length]);

  function toggle() {
    const panel = popover.current;
    if (!panel) return;
    if (panel.matches(":popover-open")) panel.hidePopover();
    else { panel.showPopover(); position(); }
  }

  async function change(groupId: string, included: boolean) {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError(""); setOptimistic({ groupId, included });
    try {
      await setPlaylistMembership(groupId, document.id, included);
      notify(included ? "Book added to playlist." : "Book removed from playlist.");
    } catch { setError("Could not update this playlist. Please try again."); }
    finally { mutation.current = false; setBusy(false); setOptimistic(null); }
  }

  return <>
    <button ref={trigger} type="button" className="icon-button add-to-playlist" title="Add to playlist"
      aria-label={`Add ${document.title} to playlist`} aria-expanded={open} aria-controls={id} popoverTarget={id}
      onClick={(event) => { event.preventDefault(); toggle(); }}>
      <ListPlus size={17} />
    </button>
    <div ref={popover} id={id} popover="auto" className="playlist-popover" role="group" aria-label="Add to playlist" aria-busy={busy}
      onToggle={(event) => { setOpen(event.newState === "open"); if (event.newState === "open") setError(""); }}>
      <h2>Add to playlist</h2>
      <p className="playlist-popover-hint">Select to add. Uncheck to remove.</p>
      <div className="playlist-choices">
        {bookGroups.length ? bookGroups.map((group) => {
          const included = optimistic?.groupId === group.id ? optimistic.included : bookGroupItems.some((item) => item.groupId === group.id && item.bookId === document.id);
          return <label key={group.id} className="playlist-choice"><input type="checkbox" checked={included} aria-disabled={busy}
            onChange={(event) => { void change(group.id, event.target.checked); }} /><span>{group.name}</span></label>;
        }) : <p className="playlist-popover-empty">No playlists yet. Create your first collection.</p>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {storageError && !error && <p className="form-error" role="alert">{storageError}</p>}
      <button type="button" className="playlist-create-action" disabled={busy} onClick={() => { popover.current?.hidePopover(); setCreating(true); }}><Plus size={16} />Create new playlist</button>
    </div>
    {creating && <PlaylistDialog bookId={document.id} onClose={() => {
      setCreating(false);
      // Wait until the modal is removed so the book action is no longer inert.
      requestAnimationFrame(() => trigger.current?.focus());
    }} />}
  </>;
}
