"use client";

import { ThemeProvider, type ThemeConfig } from "@hangnguyen1902/theme";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { deleteRecord, loadSnapshot, patchDocument, persistSettings, removeDocument, saveRecord } from "@/lib/database";
import { defaultSettings, type Highlight, type Note, type ReaderSettings, type ReadingDocument, type Snapshot, type VocabularyItem } from "@/lib/types";

const themeConfig: ThemeConfig = {
  colors: {
    light: { primary: "#a26946", primaryHover: "#875338", onPrimary: "#ffffff", primarySoft: "#f3e9df", background: "#faf9f6", surface: "#ffffff", surfaceRaised: "#f3f1ec", text: "#302e2a", textMuted: "#827c72", border: "#e8e4dd", focus: "#a26946" },
    dark: { primary: "#d3aa8b", primaryHover: "#e4bea0", onPrimary: "#2d241c", primarySoft: "#3a3027", background: "#1e1e1b", surface: "#262623", surfaceRaised: "#30302b", text: "#eeeae1", textMuted: "#b2ac9f", border: "#3e3d36", focus: "#d3aa8b" }
  },
  fontFamily: { sans: '"Segoe UI", Inter, system-ui, sans-serif' },
  radius: { md: "0.5rem", lg: "0.75rem" }
};
const initial: Snapshot = { documents: [], highlights: [], notes: [], vocabulary: [], settings: defaultSettings };

function useStore() {
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    loadSnapshot().then((value) => { if (active) setSnapshot(value); }).catch(() => { if (active) setError("Your browser storage is unavailable. Enable storage for this site to save your reading data."); }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);
  const notify = useCallback((message: string) => {
    setNotice(message); if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 3500);
  }, []);

  const commit = useCallback(async <T,>(operation: () => Promise<T>, apply: (value: T) => void): Promise<T> => {
    setPending((value) => value + 1);
    try { const value = await operation(); apply(value); setError(""); return value; }
    catch { setError("Your changes could not be saved on this device. Check available browser storage and try again."); throw new Error("Could not save changes"); }
    finally { setPending((value) => value - 1); }
  }, []);
  const addDocument = useCallback((document: ReadingDocument) => commit(() => saveRecord("documents", document), () => setSnapshot((state) => ({ ...state, documents: [...state.documents, document] }))), [commit]);
  const updateDocument = useCallback((id: string, patch: Partial<ReadingDocument>) => commit(() => patchDocument(id, patch), (document) => setSnapshot((state) => ({ ...state, documents: state.documents.map((item) => item.id === id ? document : item) }))), [commit]);
  const deleteDocument = useCallback((id: string) => commit(() => removeDocument(id), () => setSnapshot((state) => ({ ...state, documents: state.documents.filter((item) => item.id !== id), highlights: state.highlights.filter((item) => item.documentId !== id), notes: state.notes.filter((item) => item.documentId !== id), settings: state.settings.lastDocumentId === id ? { ...state.settings, lastDocumentId: null } : state.settings }))), [commit]);
  const updateSettings = useCallback((patch: Partial<ReaderSettings>) => commit(() => persistSettings(patch), (settings) => setSnapshot((state) => ({ ...state, settings }))), [commit]);
  const saveHighlight = useCallback((highlight: Highlight) => commit(() => saveRecord("highlights", highlight), () => setSnapshot((state) => ({ ...state, highlights: [...state.highlights.filter((item) => item.id !== highlight.id), highlight] }))), [commit]);
  const saveNote = useCallback((note: Note) => commit(() => saveRecord("notes", note), () => setSnapshot((state) => ({ ...state, notes: [...state.notes.filter((item) => item.id !== note.id), note] }))), [commit]);
  const saveVocabulary = useCallback((item: VocabularyItem) => commit(() => saveRecord("vocabulary", item), () => setSnapshot((state) => ({ ...state, vocabulary: [...state.vocabulary.filter((word) => word.id !== item.id), item] }))), [commit]);
  const removeHighlight = useCallback((id: string) => commit(() => deleteRecord("highlights", id), () => setSnapshot((state) => ({ ...state, highlights: state.highlights.filter((item) => item.id !== id) }))), [commit]);
  const removeNote = useCallback((id: string) => commit(() => deleteRecord("notes", id), () => setSnapshot((state) => ({ ...state, notes: state.notes.filter((item) => item.id !== id) }))), [commit]);
  const removeVocabulary = useCallback((id: string) => commit(() => deleteRecord("vocabulary", id), () => setSnapshot((state) => ({ ...state, vocabulary: state.vocabulary.filter((item) => item.id !== id) }))), [commit]);

  return { ...snapshot, ready, pending, error, notice, notify, addDocument, updateDocument, deleteDocument, updateSettings, saveHighlight, saveNote, saveVocabulary, removeHighlight, removeNote, removeVocabulary };
}
const ReadingContext = createContext<ReturnType<typeof useStore> | null>(null);
export function Providers({ children }: { children: ReactNode }) {
  const store = useStore();
  return <ThemeProvider config={themeConfig} defaultTheme="light" storageKey="folio-theme"><ReadingContext.Provider value={store}>{children}</ReadingContext.Provider></ThemeProvider>;
}
export function useReading() {
  const store = useContext(ReadingContext);
  if (!store) throw new Error("Reading provider is missing");
  return store;
}
