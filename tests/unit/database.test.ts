import "fake-indexeddb/auto";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { deleteDB } from "idb";
import { cacheTranslation, cachedTranslation, database, loadSnapshot, patchDocument, persistSettings, removeDocument, saveRecord } from "../../lib/database";
import { seedDocuments } from "../../lib/seed";

beforeEach(async () => { await deleteDB("folio-reading"); });
test("curated documents are seeded once and saved state survives reopening", async () => {
  const initial = await loadSnapshot(); assert.equal(initial.documents.length, 4);
  await patchDocument("attention", { favorite: true, currentPage: 2, lastReadAt: 100 });
  await persistSettings({ fontSize: 24, translationProvider: "local" });
  const restored = await loadSnapshot(); const document = restored.documents.find((item) => item.id === "attention")!;
  assert.equal(restored.documents.length, 4); assert.equal(document.favorite, true); assert.equal(document.currentPage, 2);
  assert.equal(restored.settings.fontSize, 24); assert.equal(restored.settings.translationProvider, "local");
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
