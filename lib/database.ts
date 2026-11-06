import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { seedDocuments } from "./seed";
import { normalizeAssetPath } from "./markdown-path";
import { defaultSettings, normalizeTranslationProvider, type BookGroup, type BookGroupItem, type DocumentAsset, type Highlight, type Note, type ReaderSettings, type ReadingDocument, type Snapshot, type VocabularyItem } from "./types";

interface FolioDB extends DBSchema {
  documents: { key: string; value: ReadingDocument };
  documentAssets: { key: [string, string]; value: DocumentAsset; indexes: { documentId: string } };
  highlights: { key: string; value: Highlight; indexes: { documentId: string } };
  notes: { key: string; value: Note; indexes: { documentId: string } };
  vocabulary: { key: string; value: VocabularyItem };
  settings: { key: string; value: ReaderSettings };
  translations: { key: string; value: { text: string; createdAt: number } };
  bookGroups: { key: string; value: BookGroup & { normalizedName: string }; indexes: { normalizedName: string } };
  bookGroupItems: { key: string; value: BookGroupItem; indexes: { groupId: string; bookId: string; groupBook: [string, string] } };
}

export function database() {
  const connection = openDB<FolioDB>("folio-reading", 3, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore("documents", { keyPath: "id" });
        const highlights = db.createObjectStore("highlights", { keyPath: "id" }); highlights.createIndex("documentId", "documentId");
        const notes = db.createObjectStore("notes", { keyPath: "id" }); notes.createIndex("documentId", "documentId");
        db.createObjectStore("vocabulary", { keyPath: "id" });
        db.createObjectStore("settings"); db.createObjectStore("translations");
      }
      if (oldVersion < 2) {
        const assets = db.createObjectStore("documentAssets", { keyPath: ["documentId", "path"] });
        assets.createIndex("documentId", "documentId");
      }
      if (oldVersion < 3) {
        const groups = db.createObjectStore("bookGroups", { keyPath: "id" });
        groups.createIndex("normalizedName", "normalizedName", { unique: true });
        const items = db.createObjectStore("bookGroupItems", { keyPath: "id" });
        items.createIndex("groupId", "groupId");
        items.createIndex("bookId", "bookId");
        items.createIndex("groupBook", ["groupId", "bookId"], { unique: true });
      }
    },
    blocking() { void connection.then((db) => db.close()); }
  });
  return connection;
}

/** Persist an entire import together; a failed asset write must not leave a partial document. */
export async function saveDocumentWithAssets(document: ReadingDocument, assets: DocumentAsset[] = []) {
  if (document.markdownPath !== undefined && normalizeAssetPath(document.markdownPath) !== document.markdownPath) throw new Error("Invalid Markdown path");
  if (assets.length && document.type !== "MD") throw new Error("Only Markdown documents can have image assets");
  const paths = new Set<string>();
  for (const asset of assets) {
    if (asset.documentId !== document.id || !asset.path || normalizeAssetPath(asset.path) !== asset.path) throw new Error("Invalid document asset path or owner");
    if (paths.has(asset.path)) throw new Error("Duplicate document asset path");
    if (!(asset.blob instanceof Blob) || asset.size !== asset.blob.size || asset.mimeType !== asset.blob.type || !asset.mimeType.startsWith("image/")) throw new Error("Invalid image asset data");
    paths.add(asset.path);
  }
  const db = await database();
  try {
    const tx = db.transaction(["documents", "documentAssets"], "readwrite");
    const completed = tx.done;
    try {
      await tx.objectStore("documents").put(document);
      const store = tx.objectStore("documentAssets");
      for (const key of await store.index("documentId").getAllKeys(document.id)) await store.delete(key);
      for (const asset of assets) await store.put(asset);
      await completed;
    } catch (error) {
      try { tx.abort(); } catch { /* A failed request may already have aborted the transaction. */ }
      await completed.catch(() => {});
      throw error;
    }
  } finally { db.close(); }
}

export async function loadDocumentAssets(documentId: string): Promise<DocumentAsset[]> {
  const db = await database();
  try { return await db.getAllFromIndex("documentAssets", "documentId", documentId); }
  finally { db.close(); }
}

export async function loadSnapshot(): Promise<Snapshot> {
  const db = await database();
  try {
    // Markdown now belongs to user uploads. Retire browser copies of the old
    // bundled samples while preserving uploaded documents, including same IDs.
    for (const document of await db.getAll("documents")) {
      if (document.type === "MD" && !document.uploaded) await removeDocumentData(db, document.id, true);
    }
    const tx = db.transaction("documents", "readwrite");
    for (const document of seedDocuments) if (!await tx.store.get(document.id)) await tx.store.put(document);
    await tx.done;
    const [documents, highlights, notes, vocabulary, settings, groups, bookGroupItems] = await Promise.all([
      db.getAll("documents"), db.getAll("highlights"), db.getAll("notes"), db.getAll("vocabulary"), db.get("settings", "preferences"), db.getAll("bookGroups"), db.getAll("bookGroupItems")
    ]);
    const bookGroups = groups.map(({ normalizedName: _normalizedName, ...group }) => group);
    return { documents, highlights, notes, vocabulary, bookGroups, bookGroupItems, settings: { ...defaultSettings, ...settings, translationProvider: normalizeTranslationProvider(settings?.translationProvider) } };
  } finally { db.close(); }
}

/** Read every persisted word, independently of UI filters or the provider snapshot. */
export async function loadVocabulary(): Promise<VocabularyItem[]> {
  const db = await database();
  try { return await db.getAll("vocabulary"); } finally { db.close(); }
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
  try { await removeDocumentData(db, id); }
  finally { db.close(); }
}

async function removeDocumentData(db: IDBPDatabase<FolioDB>, id: string, retiredOnly = false) {
  const tx = db.transaction(["documents", "documentAssets", "highlights", "notes", "settings", "bookGroupItems"], "readwrite");
  const completed = tx.done;
  try {
    if (retiredOnly) {
      const document = await tx.objectStore("documents").get(id);
      // Recheck under the write lock: another tab may have saved an upload since
      // the initial scan. Never delete that upload or its image resources.
      if (!document || document.type !== "MD" || document.uploaded) { await completed; return; }
    }
    await tx.objectStore("documents").delete(id);
    const assets = tx.objectStore("documentAssets");
    for (const key of await assets.index("documentId").getAllKeys(id)) await assets.delete(key);
    const memberships = tx.objectStore("bookGroupItems");
    for (const key of await memberships.index("bookId").getAllKeys(id)) await memberships.delete(key);
    for (const store of ["highlights", "notes"] as const) {
      const keys = await tx.objectStore(store).index("documentId").getAllKeys(id);
      for (const key of keys) await tx.objectStore(store).delete(key);
    }
    const settings = await tx.objectStore("settings").get("preferences");
    if (settings?.lastDocumentId === id) await tx.objectStore("settings").put({ ...settings, lastDocumentId: null }, "preferences");
    await completed;
  } catch (error) {
    try { tx.abort(); } catch { /* The failed request may already have aborted the transaction. */ }
    await completed.catch(() => {});
    throw error;
  }
}
export async function cachedTranslation(key: string) {
  const db = await database();
  try { return (await db.get("translations", key))?.text; } finally { db.close(); }
}
export async function cacheTranslation(key: string, text: string) {
  const db = await database();
  try { await db.put("translations", { text, createdAt: Date.now() }, key); } finally { db.close(); }
}
