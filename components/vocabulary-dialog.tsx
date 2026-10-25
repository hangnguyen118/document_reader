"use client";
import { useEffect, useRef, useState } from "react";
import { Languages } from "lucide-react";
import { Button, Spinner } from "@hangnguyen1902/theme";
import { useReading } from "./providers";
import { Modal } from "./modal";
import { useTranslation } from "@/hooks/use-translation";
import type { ReadingDocument, VocabularyItem } from "@/lib/types";

export function VocabularyDialog({ open, onClose, document, page = 0, initialTerm = "", initialMeaning = "", context = "", item }: { open: boolean; onClose: () => void; document?: ReadingDocument; page?: number; initialTerm?: string; initialMeaning?: string; context?: string; item?: VocabularyItem }) {
  const { settings, vocabulary, saveVocabulary, notify } = useReading();
  const [term, setTerm] = useState("");
  const [meaning, setMeaning] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [autoFill, setAutoFill] = useState(false);
  const [meaningEdited, setMeaningEdited] = useState(false);
  const formRevision = useRef(0);
  const translator = useTranslation();
  const { translate, clear } = translator;
  useEffect(() => {
    formRevision.current++;
    clear();
    if (open) {
      setTerm(item?.term ?? initialTerm.trim());
      setMeaning(item?.meaning ?? initialMeaning);
      setMeaningEdited(false);
      setAutoFill(!item && !initialMeaning.trim());
      setFormError("");
    }
    // Store updates must not reset an open form's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id, initialTerm, initialMeaning, clear]);
  useEffect(() => {
    if (!open || item?.id || !autoFill || meaningEdited || !term.trim()) return;
    const revision = formRevision.current;
    const timer = window.setTimeout(() => {
      void translate(term, settings.translationProvider).then((value) => {
        if (value && revision === formRevision.current) {
          setMeaning(value);
          setAutoFill(false);
        }
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [open, item?.id, autoFill, meaningEdited, term, settings.translationProvider, translate]);
  function close() { formRevision.current++; clear(); onClose(); }
  function translateMeaning() {
    const revision = ++formRevision.current;
    setAutoFill(false);
    translator.prepare?.(settings.translationProvider);
    void translate(term, settings.translationProvider).then((value) => {
      if (value && revision === formRevision.current) {
        setMeaning(value);
        setMeaningEdited(false);
      }
    });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (saving) return;
    if (!term.trim() || term.trim().length > 180) { setFormError("Choose a word or phrase between 1 and 180 characters."); return; }
    if (!meaning.trim()) { setFormError("Add a Vietnamese meaning to practice this word later."); return; }
    setSaving(true); setFormError("");
    const existing = item ?? vocabulary.find((word) => word.term.toLocaleLowerCase() === term.trim().toLocaleLowerCase());
    const value: VocabularyItem = {
      id: existing?.id ?? crypto.randomUUID(), term: term.trim(), meaning: meaning.trim(),
      context: existing?.context ?? context, documentId: existing?.documentId ?? document?.id ?? "",
      documentTitle: existing?.documentTitle ?? document?.title ?? "Added by you", page: existing?.page ?? page, createdAt: existing?.createdAt ?? Date.now()
    };
    try { await saveVocabulary(value); notify(existing ? "Your word has been updated." : "A new word for your collection."); close(); }
    catch { setFormError("Could not save this word. Please try again."); } finally { setSaving(false); }
  }
  return <Modal open={open} title={item ? "Edit your word" : "Keep a new word"} onClose={close}>
    <p className="modal-description">A word found in a story is a word worth remembering.</p>
    <form onSubmit={save}>
      <label className="field-label" htmlFor="vocab-term">English word or phrase</label>
      <input id="vocab-term" className="form-input word-input" maxLength={180} value={term} onChange={(event) => {
        const nextTerm = event.target.value;
        formRevision.current++;
        clear();
        setTerm(nextTerm);
        setFormError("");
        if (!item && !meaningEdited) { setMeaning(""); setAutoFill(true); }
        if (nextTerm.trim()) translator.prepare?.(settings.translationProvider);
      }} autoFocus required />
      <div className="meaning-label">
        <label className="field-label" htmlFor="vocab-meaning">Vietnamese meaning</label>
        <button className="text-link" type="button" disabled={!term.trim() || translator.loading} onClick={translateMeaning}>
          <Languages size={13} />{translator.loading ? "Translating…" : "Translate"}
        </button>
      </div>
      <textarea id="vocab-meaning" className="form-input" value={meaning} maxLength={2000} onChange={(event) => {
        const nextMeaning = event.target.value;
        formRevision.current++;
        clear();
        setMeaning(nextMeaning);
        setMeaningEdited(Boolean(nextMeaning.trim()));
        setAutoFill(!item && !nextMeaning.trim());
        setFormError("");
      }} rows={3} placeholder="A translation appears automatically. You can also enter a meaning." required />
      {translator.loading && <div className="translation-status" role="status" aria-live="polite">
        <div className="translation-loading"><Spinner size="sm" /><span>{translator.status || "Finding the right words…"}</span></div>
        {translator.progress !== null && <progress className="translation-progress" aria-label="Translation progress" max={100} value={translator.progress} />}
      </div>}
      {(translator.error || formError) && <p className="form-error" role="alert">{formError || translator.error}</p>}
      {translator.error && <button type="button" className="text-link" disabled={!term.trim()} onClick={translateMeaning}>Try translation again</button>}
      <p className="vocabulary-translation-help">Translation runs on this device. First use may download language files. Check the meaning and edit it whenever you need.</p>
      {(context || item?.context) && <blockquote className="saved-context">{item?.context ?? context}</blockquote>}
      <div className="modal-actions"><Button variant="outline" onClick={close}>Cancel</Button><Button type="submit" loading={saving}>Save word</Button></div>
    </form>
  </Modal>;
}
