import { openDB, type DBSchema } from "idb";
import { seedDocuments } from "./seed";
import { defaultSettings, normalizeTranslationProvider, type Highlight, type Note, type ReaderSettings, type ReadingDocument, type Snapshot, type VocabularyItem } from "./types";

interface FolioDB extends DBSchema {
  documents: { key: string; value: ReadingDocument };
  highlights: { key: string; value: Highlight; indexes: { documentId: string } };
  notes: { key: string; value: Note; indexes: { documentId: string } };
  vocabulary: { key: string; value: VocabularyItem };
  settings: { key: string; value: ReaderSettings };
  translations: { key: string; value: { text: string; createdAt: number } };
}

export function database() {
  return openDB<FolioDB>("folio-reading", 1, {
    upgrade(db) {
      db.createObjectStore("documents", { keyPath: "id" });
      const highlights = db.createObjectStore("highlights", { keyPath: "id" }); highlights.createIndex("documentId", "documentId");
      const notes = db.createObjectStore("notes", { keyPath: "id" }); notes.createIndex("documentId", "documentId");
      db.createObjectStore("vocabulary", { keyPath: "id" });
      db.createObjectStore("settings"); db.createObjectStore("translations");
    }
  });
}

export async function loadSnapshot(): Promise<Snapshot> {
  const db = await database();
  try {
    const tx = db.transaction("documents", "readwrite");
    for (const document of seedDocuments) if (!await tx.store.get(document.id)) await tx.store.put(document);
    await tx.done;
    const [documents, highlights, notes, vocabulary, settings] = await Promise.all([
      db.getAll("documents"), db.getAll("highlights"), db.getAll("notes"), db.getAll("vocabulary"), db.get("settings", "preferences")
    ]);
    return { documents, highlights, notes, vocabulary, settings: { ...defaultSettings, ...settings, translationProvider: normalizeTranslationProvider(settings?.translationProvider) } };
  } finally { db.close(); }
}

export async function saveRecord<T extends "documents" | "highlights" | "notes" | "vocabulary">(store: T, value: FolioDB[T]["value"]) {
  const db = await database();
  try { await db.put(store, value); } finally { db.close(); }
}
export async function deleteRecord(store: "highlights" | "notes" | "vocabulary", id: string) {
  const db = await database();
  try { await db.delete(store, id); } finally { db.close(); }
}
export async function patchDocument(id: string, patch: Partial<ReadingDocument>): Promise<ReadingDocument> {
  const db = await database();
  try {
    const tx = db.transaction("documents", "readwrite");
    const document = await tx.store.get(id);
    if (!document) throw new Error("Document not found");
    const updated = { ...document, ...patch, id };
    await tx.store.put(updated); await tx.done;
    return updated;
  } finally { db.close(); }
}
export async function persistSettings(patch: Partial<ReaderSettings>): Promise<ReaderSettings> {
  const db = await database();
  try {
    const tx = db.transaction("settings", "readwrite");
    const current = await tx.store.get("preferences");
    const merged = { ...defaultSettings, ...current, ...patch };
    const updated = { ...merged, translationProvider: normalizeTranslationProvider(merged.translationProvider) };
    await tx.store.put(updated, "preferences"); await tx.done;
    return updated;
  } finally { db.close(); }
}
export async function removeDocument(id: string) {
  const db = await database();
  try {
    const tx = db.transaction(["documents", "highlights", "notes", "settings"], "readwrite");
    await tx.objectStore("documents").delete(id);
    for (const store of ["highlights", "notes"] as const) {
      const keys = await tx.objectStore(store).index("documentId").getAllKeys(id);
      for (const key of keys) await tx.objectStore(store).delete(key);
    }
    const settings = await tx.objectStore("settings").get("preferences");
    if (settings?.lastDocumentId === id) await tx.objectStore("settings").put({ ...settings, lastDocumentId: null }, "preferences");
    await tx.done;
  } finally { db.close(); }
}
export async function cachedTranslation(key: string) {
  const db = await database();
  try { return (await db.get("translations", key))?.text; } finally { db.close(); }
}
export async function cacheTranslation(key: string, text: string) {
  const db = await database();
  try { await db.put("translations", { text, createdAt: Date.now() }, key); } finally { db.close(); }
}
