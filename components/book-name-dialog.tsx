"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@hangnguyen1902/theme";
import { Modal } from "./modal";
import { useReading } from "./providers";
import type { ReadingDocument } from "@/lib/types";

/** Mount a fresh dialog for each edit; live document updates must not reset the draft. */
export function BookNameDialog({ document, onClose }: { document: ReadingDocument; onClose: () => void }) {
  const { updateDocument, notify } = useReading();
  const [name, setName] = useState(document.title);
  const [error, setError] = useState("");
  const [invalidName, setInvalidName] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const errorId = `${fieldId}-error`;

  useEffect(() => {
    // The Modal opens its native dialog in a child effect; focus after it is visible.
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function close() { if (!savingRef.current) onClose(); }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const title = name.trim();
    if (!title || title.length > 200) {
      setInvalidName(true);
      setError(!title ? "Enter a book name." : "Keep the book name to 200 characters or fewer.");
      return;
    }
    savingRef.current = true;
    setSaving(true); setError(""); setInvalidName(false);
    try {
      await updateDocument(document.id, { title });
      notify("Book name updated.");
      onClose();
    } catch {
      setError("Could not save the book name. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return <Modal open title="Edit Book Name" onClose={close}>
    <p className="modal-description">Choose a name for this book. It will be saved on this device.</p>
    <form onSubmit={save} noValidate>
      <label className="field-label" htmlFor={fieldId}>Book name</label>
      <input ref={inputRef} id={fieldId} className="form-input" value={name} maxLength={200} required disabled={saving}
        aria-invalid={invalidName} aria-describedby={error ? errorId : undefined}
        onChange={(event) => { setName(event.target.value); setError(""); setInvalidName(false); }} />
      {error && <p id={errorId} className="form-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <Button type="button" variant="outline" disabled={saving} onClick={close}>Cancel</Button>
        <Button type="submit" loading={saving}>Save name</Button>
      </div>
    </form>
  </Modal>;
}
