"use client";

import { useRef, useState, type FormEvent } from "react";
import { Download } from "lucide-react";
import { Button } from "@hangnguyen1902/theme";
import { Modal } from "./modal";
import { useReading } from "./providers";
import type { VocabularyExportFormat, VocabularyExportScope } from "@/lib/vocabulary-export";
import { VocabularyExportError } from "@/lib/vocabulary-export-error";

export function VocabularyExportDialog({ open, totalCount, selectedIds, onClose }: {
  open: boolean;
  totalCount: number;
  selectedIds: ReadonlySet<string>;
  onClose: () => void;
}) {
  const { notify } = useReading();
  const [format, setFormat] = useState<VocabularyExportFormat>("xlsx");
  const [scope, setScope] = useState<VocabularyExportScope>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  const noSelection = scope === "selected" && selectedIds.size === 0;
  const noWords = scope === "all" && totalCount === 0;

  function close() { if (!running.current) onClose(); }

  async function download(event: FormEvent) {
    event.preventDefault();
    if (running.current) return;
    if (noSelection || noWords) {
      setError(noSelection ? "Select at least one word before exporting selected vocabulary." : "Add a word to your collection before exporting.");
      return;
    }
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const { exportVocabularyFile, downloadVocabularyFile } = await import("@/lib/vocabulary-export");
      const result = await exportVocabularyFile(format, scope, new Set(selectedIds));
      downloadVocabularyFile(result.blob, result.fileName);
      notify(`Download started for ${result.count} ${result.count === 1 ? "word" : "words"}.`);
      onClose();
    } catch (error) {
      setError(error instanceof VocabularyExportError ? error.message : "Could not export vocabulary. Please try again.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return <Modal open={open} title="Export Vocabulary" onClose={close} className="vocabulary-export-dialog">
    <p className="modal-description">Download your vocabulary as an Excel workbook or a PDF to keep and use anywhere.</p>
    <form onSubmit={download} aria-busy={busy}>
      <fieldset className="vocabulary-export-scope" disabled={busy}>
        <legend>Vocabulary to export</legend>
        <label className={scope === "all" ? "active" : ""}>
          <input type="radio" name="vocabulary-export-scope" value="all" aria-label="Export All" checked={scope === "all"} onChange={() => { setScope("all"); setError(""); }} />
          <span><strong>Export All</strong><span>{totalCount} {totalCount === 1 ? "word" : "words"} in your collection, including words on other pages or hidden by search.</span></span>
        </label>
        <label className={scope === "selected" ? "active" : ""}>
          <input type="radio" name="vocabulary-export-scope" value="selected" aria-label="Export Selected" checked={scope === "selected"} onChange={() => { setScope("selected"); setError(""); }} aria-describedby={noSelection ? "vocabulary-export-selection-hint" : undefined} />
          <span><strong>Export Selected</strong><span>{selectedIds.size} {selectedIds.size === 1 ? "word" : "words"} selected.</span></span>
        </label>
      </fieldset>
      <label className="field-label" htmlFor="vocabulary-export-format">File format</label>
      <select className="form-input" id="vocabulary-export-format" value={format} disabled={busy} onChange={(event) => { setFormat(event.target.value as VocabularyExportFormat); setError(""); }}>
        <option value="xlsx">Excel (.xlsx)</option>
        <option value="pdf">PDF (.pdf)</option>
      </select>
      <p className="vocabulary-export-columns">Included columns: STT, Word / Phrase, Meaning.</p>
      {noSelection && <p className="vocabulary-export-hint" id="vocabulary-export-selection-hint" role="status">Select at least one word before exporting selected vocabulary.</p>}
      {noWords && <p className="vocabulary-export-hint" role="status">Add a word to your collection before exporting.</p>}
      {busy && <p className="vocabulary-export-hint" role="status">Preparing your download…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button>
        <Button type="submit" leadingIcon={<Download size={15} />} loading={busy} disabled={busy || noSelection || noWords}>Download file</Button>
      </div>
    </form>
  </Modal>;
}
