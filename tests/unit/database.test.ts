import "fake-indexeddb/auto";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { deleteDB, openDB } from "idb";
import { cacheTranslation, cachedTranslation, database, loadDocumentAssets, loadSnapshot, patchDocument, persistSettings, removeDocument, saveDocumentWithAssets, saveRecord } from "../../lib/database";
import { seedDocuments } from "../../lib/seed";
import type { DocumentAsset, ReadingDocument } from "../../lib/types";

beforeEach(async () => { await deleteDB("folio-reading"); });
test("curated documents are seeded once and saved state survives reopening", async () => {
  const initial = await loadSnapshot(); assert.equal(initial.documents.length, seedDocuments.length);
  await patchDocument("attention", { favorite: true, currentPage: 2, lastReadAt: 100 });
  await persistSettings({ fontSize: 24, translationProvider: "local" });
  const restored = await loadSnapshot(); const document = restored.documents.find((item) => item.id === "attention")!;
  assert.equal(restored.documents.length, seedDocuments.length); assert.equal(document.favorite, true); assert.equal(document.currentPage, 2);
  assert.equal(restored.settings.fontSize, 24); assert.equal(restored.settings.translationProvider, "local");
});

test("an existing library receives missing default readings without replacing saved reading data", async () => {
  const missing = seedDocuments.at(-1)!;
  const legacyDocuments = seedDocuments.filter((document) => document.id !== missing.id).map((document) => document.id === "attention"
    ? { ...document, favorite: true, currentPage: 1, lastReadAt: 100, pages: ["Previously saved book contents.", "My current page."] }
    : document);
  for (const document of legacyDocuments) await saveRecord("documents", document);
  await persistSettings({ showDefaultBooks: false, lastDocumentId: "attention" });

  const upgraded = await loadSnapshot();
  assert.equal(upgraded.documents.length, seedDocuments.length);
  for (const document of legacyDocuments) {
    assert.deepEqual(upgraded.documents.find((item) => item.id === document.id), document);
  }
  assert.deepEqual(upgraded.documents.find((document) => document.id === missing.id), missing);
  assert.equal(upgraded.settings.showDefaultBooks, false);
  assert.equal(upgraded.settings.lastDocumentId, "attention");

  await patchDocument(missing.id, { favorite: true, lastReadAt: 200 });
  const reopened = await loadSnapshot();
  assert.equal(reopened.documents.filter((document) => document.id === missing.id).length, 1);
  assert.equal(reopened.documents.find((document) => document.id === missing.id)?.favorite, true);
  assert.equal(reopened.documents.find((document) => document.id === missing.id)?.lastReadAt, 200);
});

test("retiring bundled Markdown removes only its browser copy and related resources, preserving uploads and vocabulary", async () => {
  const retired = { ...markdownDocument("retired-default"), uploaded: false, title: "Local Markdown" };
  const upload = { ...markdownDocument("personal-markdown"), title: retired.title };
  await saveDocumentWithAssets(retired, [imageAsset(retired.id)]);
  await saveDocumentWithAssets(upload, [imageAsset(upload.id)]);
  for (const document of [retired, upload]) {
    await saveRecord("notes", { id: `note-${document.id}`, documentId: document.id, page: 0, quote: "Images", body: "Keep", createdAt: 1, updatedAt: 1 });
    await saveRecord("highlights", { id: `highlight-${document.id}`, documentId: document.id, page: 0, start: 0, end: 6, text: "Images", color: "yellow", createdAt: 1 });
  }
  const vocabulary = { id: "saved-word", term: "image", meaning: "picture", context: "", documentId: retired.id, documentTitle: retired.title, page: 0, createdAt: 1 };
  await saveRecord("vocabulary", vocabulary);
  await persistSettings({ lastDocumentId: retired.id, fontSize: 28, showDefaultBooks: false });

  const restored = await loadSnapshot();
  assert.equal(restored.documents.some((document) => document.id === retired.id), false);
  assert.deepEqual(restored.documents.find((document) => document.id === upload.id), upload);
  assert.equal(restored.documents.filter((document) => !document.uploaded).length, seedDocuments.length);
  assert.deepEqual(await loadDocumentAssets(retired.id), []);
  assert.equal((await loadDocumentAssets(upload.id)).length, 1);
  assert.deepEqual(restored.notes.map((note) => note.documentId), [upload.id]);
  assert.deepEqual(restored.highlights.map((highlight) => highlight.documentId), [upload.id]);
  assert.deepEqual(restored.vocabulary, [vocabulary]);
  assert.equal(restored.settings.lastDocumentId, null);
  assert.equal(restored.settings.fontSize, 28);
  assert.equal(restored.settings.showDefaultBooks, false);
  assert.deepEqual((await loadSnapshot()).documents, restored.documents);
});

test("an uploaded Markdown with a former default ID remains intact when the library opens", async () => {
  const upload = markdownDocument("retired-default");
  await saveDocumentWithAssets(upload, [imageAsset(upload.id)]);
  await persistSettings({ lastDocumentId: upload.id });
  const restored = await loadSnapshot();
  assert.deepEqual(restored.documents.find((document) => document.id === upload.id), upload);
  assert.equal((await loadDocumentAssets(upload.id)).length, 1);
  assert.equal(restored.settings.lastDocumentId, upload.id);
});
test("concurrent document and preference patches preserve unrelated values", async () => {
  await loadSnapshot();
  await Promise.all([patchDocument("attention", { favorite: true }), patchDocument("attention", { currentPage: 1 })]);
  await Promise.all([persistSettings({ fontSize: 22 }), persistSettings({ speechRate: 0.8 })]);
  const state = await loadSnapshot();
  assert.equal(state.documents.find((item) => item.id === "attention")?.favorite, true);
  assert.equal(state.documents.find((item) => item.id === "attention")?.currentPage, 1);
  assert.equal(state.settings.fontSize, 22); assert.equal(state.settings.speechRate, 0.8);
});
test("default books remain visible for new and legacy preferences", async () => {
  assert.equal((await loadSnapshot()).settings.showDefaultBooks, true);
  const db = await database();
  await db.put("settings", { fontSize: 24, translationProvider: "local" } as never, "preferences");
  db.close();
  const restored = await loadSnapshot();
  assert.equal(restored.settings.showDefaultBooks, true);
  assert.equal(restored.settings.fontSize, 24);
  assert.equal(restored.settings.translationProvider, "local");
  assert.equal((await persistSettings({ speechRate: 0.8 })).showDefaultBooks, true);
});

test("default book visibility persists across reopening and concurrent preference updates", async () => {
  await loadSnapshot();
  await Promise.all([
    persistSettings({ showDefaultBooks: false }),
    persistSettings({ fontSize: 22 }),
    persistSettings({ speechRate: 0.8 })
  ]);
  await persistSettings({ font: "sans" });
  const restored = await loadSnapshot();
  assert.equal(restored.settings.showDefaultBooks, false);
  assert.equal(restored.settings.fontSize, 22);
  assert.equal(restored.settings.speechRate, 0.8);
  assert.equal(restored.settings.font, "sans");
  await persistSettings({ showDefaultBooks: true });
  const shown = await loadSnapshot();
  assert.deepEqual(shown.settings, { ...restored.settings, showDefaultBooks: true });
});

test("hiding and showing default books preserves every document and its reading data", async () => {
  await loadSnapshot();
  await patchDocument("attention", { favorite: true, currentPage: 2, lastReadAt: 100 });
  await saveRecord("documents", { ...seedDocuments[0], id: "upload", uploaded: true, favorite: true, currentPage: 1 });
  await saveRecord("notes", { id: "default-note", documentId: "attention", page: 0, quote: "quiet", body: "Remember this", createdAt: 0, updatedAt: 0 });
  await saveRecord("highlights", { id: "default-highlight", documentId: "attention", page: 0, start: 0, end: 5, text: "quiet", color: "yellow", createdAt: 0 });
  await saveRecord("vocabulary", { id: "default-word", term: "quiet", meaning: "yên tĩnh", documentId: "attention", documentTitle: seedDocuments[0].title, page: 0, context: "", createdAt: 0 });
  await persistSettings({ lastDocumentId: "attention", fontSize: 24 });
  const original = await loadSnapshot();
  for (const showDefaultBooks of [false, true]) {
    await persistSettings({ showDefaultBooks });
    const restored = await loadSnapshot();
    assert.deepEqual(restored.settings, { ...original.settings, showDefaultBooks });
    for (const key of ["documents", "notes", "highlights", "vocabulary"] as const) {
      assert.deepEqual(restored[key], original[key], `Changing visibility must preserve ${key}`);
    }
  }
});

test("removing an upload deletes its notes/highlights and retains saved words", async () => {
  const upload = { ...seedDocuments[0], id: "upload", uploaded: true };
  await saveRecord("documents", upload);
  await saveRecord("notes", { id: "note", documentId: upload.id, page: 0, quote: "quiet", body: "Remember this", createdAt: 0, updatedAt: 0 });
  await saveRecord("highlights", { id: "highlight", documentId: upload.id, page: 0, start: 0, end: 5, text: "quiet", color: "yellow", createdAt: 0 });
  await saveRecord("vocabulary", { id: "word", term: "quiet", meaning: "yên tĩnh", documentId: upload.id, documentTitle: upload.title, page: 0, context: "", createdAt: 0 });
  await persistSettings({ lastDocumentId: upload.id }); await removeDocument(upload.id);
  const state = await loadSnapshot();
  assert.ok(!state.documents.some((item) => item.id === upload.id)); assert.equal(state.notes.length, 0); assert.equal(state.highlights.length, 0);
  assert.equal(state.vocabulary.length, 1); assert.equal(state.settings.lastDocumentId, null);
});
test("cached translations are persistent and separate between engines and model versions", async () => {
  await cacheTranslation("on-device:local:model-v1:en:vi:quiet", "yên tĩnh");
  assert.equal(await cachedTranslation("on-device:local:model-v1:en:vi:quiet"), "yên tĩnh");
  assert.equal(await cachedTranslation("on-device:local:model-v2:en:vi:quiet"), undefined);
  assert.equal(await cachedTranslation("on-device:browser:model-v1:en:vi:quiet"), undefined);
});

test("old cloud preferences migrate to automatic translation without losing reading settings", async () => {
  for (const provider of ["google", "microsoft"]) {
    const db = await database();
    await db.put("settings", { fontSize: 24, translationProvider: provider } as never, "preferences"); db.close();
    const snapshot = await loadSnapshot();
    assert.equal(snapshot.settings.translationProvider, "auto");
    assert.equal(snapshot.settings.fontSize, 24);
    assert.equal((await persistSettings({ speechRate: 0.8 })).translationProvider, "auto");
  }
});

function markdownDocument(id = "markdown-upload"): ReadingDocument {
  return { ...seedDocuments[0], id, type: "MD", uploaded: true, pages: ["# Images\n\n![Preview](../assets/preview.png)\n"], markdownPath: "docs/book.md" };
}

function imageAsset(documentId: string, path = "assets/preview.png", bytes = [137, 80, 78, 71]): DocumentAsset {
  const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
  return { documentId, path, blob, mimeType: blob.type, size: blob.size };
}

test("Markdown source and image bytes survive closing and reopening the database without entering the snapshot", async () => {
  const document = markdownDocument();
  const asset = imageAsset(document.id);
  await saveDocumentWithAssets(document, [asset]);
  const db = await database();
  assert.equal(db.version, 3);
  assert.ok(db.objectStoreNames.contains("documentAssets"));
  db.close();

  const restored = await loadSnapshot();
  assert.deepEqual(restored.documents.find((item) => item.id === document.id), document);
  assert.equal("documentAssets" in restored, false);
  assert.equal("assets" in restored.documents.find((item) => item.id === document.id)!, false);
  const [saved] = await loadDocumentAssets(document.id);
  assert.equal(saved.path, asset.path);
  assert.equal(saved.documentId, document.id);
  assert.equal(saved.mimeType, "image/png");
  assert.equal(saved.size, asset.size);
  assert.ok(saved.blob instanceof Blob);
  assert.equal(saved.blob.type, "image/png");
  assert.deepEqual(new Uint8Array(await saved.blob.arrayBuffer()), new Uint8Array(await asset.blob.arrayBuffer()));
});

test("schema v1 upgrades without replacing documents, annotations, vocabulary or settings", async () => {
  const legacy = await openDB("folio-reading", 1, {
    upgrade(db) {
      db.createObjectStore("documents", { keyPath: "id" });
      for (const name of ["highlights", "notes"]) db.createObjectStore(name, { keyPath: "id" }).createIndex("documentId", "documentId");
      db.createObjectStore("vocabulary", { keyPath: "id" });
      db.createObjectStore("settings");
      db.createObjectStore("translations");
    }
  });
  const document = { ...seedDocuments[0], id: "legacy-upload", uploaded: true, favorite: true, currentPage: 1 };
  const highlight = { id: "legacy-highlight", documentId: document.id, page: 0, start: 0, end: 5, text: "quiet", color: "yellow", createdAt: 1 };
  const note = { id: "legacy-note", documentId: document.id, page: 0, quote: "quiet", body: "Keep", createdAt: 1, updatedAt: 1 };
  const word = { id: "legacy-word", term: "quiet", meaning: "calm", context: "", documentId: document.id, documentTitle: document.title, page: 0, createdAt: 1 };
  await legacy.put("documents", document);
  await legacy.put("highlights", highlight);
  await legacy.put("notes", note);
  await legacy.put("vocabulary", word);
  await legacy.put("settings", { showDefaultBooks: false, fontSize: 27, lastDocumentId: document.id }, "preferences");
  await legacy.put("translations", { text: "saved translation", createdAt: 1 }, "old-cache");
  legacy.close();

  const snapshot = await loadSnapshot();
  assert.deepEqual(snapshot.documents.find((item) => item.id === document.id), document);
  assert.deepEqual(snapshot.highlights, [highlight]);
  assert.deepEqual(snapshot.notes, [note]);
  assert.deepEqual(snapshot.vocabulary, [word]);
  assert.equal(snapshot.settings.fontSize, 27);
  assert.equal(snapshot.settings.showDefaultBooks, false);
  assert.equal(snapshot.settings.lastDocumentId, document.id);
  assert.equal(await cachedTranslation("old-cache"), "saved translation");
  assert.deepEqual(await loadDocumentAssets(document.id), []);
  const newDocument = markdownDocument();
  await saveDocumentWithAssets(newDocument, [imageAsset(newDocument.id)]);
  assert.equal((await loadDocumentAssets(newDocument.id)).length, 1);
});

test("asset writes are atomic with the document and roll back a failed replacement", async () => {
  const document = markdownDocument();
  const original = imageAsset(document.id);
  await saveDocumentWithAssets(document, [original]);
  const nativePut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
    if (this.name === "documentAssets" && (value as DocumentAsset).path === "assets/failure.png") throw new DOMException("Storage full", "QuotaExceededError");
    return key === undefined ? nativePut.call(this, value) : nativePut.call(this, value, key);
  };
  try {
    await assert.rejects(saveDocumentWithAssets({ ...document, title: "Must not be saved" }, [imageAsset(document.id, "assets/new.png"), imageAsset(document.id, "assets/failure.png")]), /Storage full/);
    const failedNewDocument = markdownDocument("failed-new");
    await assert.rejects(saveDocumentWithAssets(failedNewDocument, [imageAsset(failedNewDocument.id, "assets/failure.png")]), /Storage full/);
  } finally { IDBObjectStore.prototype.put = nativePut; }

  const restored = await loadSnapshot();
  assert.deepEqual(restored.documents.find((item) => item.id === document.id), document);
  assert.equal(restored.documents.some((item) => item.id === "failed-new"), false);
  const remaining = await loadDocumentAssets(document.id);
  assert.deepEqual(remaining.map((asset) => asset.path), [original.path]);
  assert.deepEqual(new Uint8Array(await remaining[0].blob.arrayBuffer()), new Uint8Array(await original.blob.arrayBuffer()));
  assert.deepEqual(await loadDocumentAssets("failed-new"), []);
});

test("asset validation rejects cross-document owners, traversal, aliases and inconsistent data before writing", async () => {
  const document = markdownDocument();
  const asset = imageAsset(document.id);
  for (const invalid of [
    { ...asset, documentId: "another-document" },
    { ...asset, path: "../outside.png" },
    { ...asset, path: "assets/../preview.png" },
    { ...asset, path: "/absolute.png" },
    { ...asset, size: asset.size + 1 },
    { ...asset, mimeType: "image/jpeg" }
  ]) await assert.rejects(saveDocumentWithAssets(document, [invalid]), /Invalid/);
  await assert.rejects(saveDocumentWithAssets(document, [asset, asset]), /Duplicate/);
  assert.equal((await loadSnapshot()).documents.some((item) => item.id === document.id), false);
});

test("deleting a Markdown document removes its assets and preserves another document's same-named image", async () => {
  const first = markdownDocument("first");
  const second = markdownDocument("second");
  await saveDocumentWithAssets(first, [imageAsset(first.id)]);
  await saveDocumentWithAssets(second, [imageAsset(second.id)]);
  await removeDocument(first.id);
  assert.deepEqual(await loadDocumentAssets(first.id), []);
  assert.equal((await loadDocumentAssets(second.id)).length, 1);
  assert.ok((await loadSnapshot()).documents.some((document) => document.id === second.id));
});
