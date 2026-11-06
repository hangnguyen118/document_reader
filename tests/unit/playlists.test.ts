import "fake-indexeddb/auto";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { deleteDB, openDB } from "idb";
import { database, loadDocumentAssets, loadSnapshot, removeDocument, saveDocumentWithAssets, saveRecord } from "../../lib/database";
import { createBookGroup, deleteBookGroup, loadBookGroupDocuments, loadBookGroupItems, loadBookGroups, setBookGroupMembership, updateBookGroup } from "../../lib/playlists";
import { seedDocuments } from "../../lib/seed";
import { defaultSettings, type ReadingDocument } from "../../lib/types";

beforeEach(async () => { await deleteDB("folio-reading"); });

test("all playlist APIs close connections when transaction creation throws", async () => {
  await loadSnapshot();
  const originalTransaction = IDBDatabase.prototype.transaction;
  const originalClose = IDBDatabase.prototype.close;
  let closedConnections = 0;
  IDBDatabase.prototype.transaction = function (storeNames: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
    if (this.name === "folio-reading") throw new DOMException("Storage unavailable", "QuotaExceededError");
    return originalTransaction.call(this, storeNames, mode, options);
  };
  IDBDatabase.prototype.close = function () {
    if (this.name === "folio-reading") closedConnections++;
    return originalClose.call(this);
  };
  try {
    const operations = [
      () => createBookGroup({ name: "Unavailable" }),
      () => updateBookGroup("group", { name: "Unavailable" }),
      () => deleteBookGroup("group"),
      () => setBookGroupMembership("group", "book", true),
      () => loadBookGroups(),
      () => loadBookGroupItems(),
      () => loadBookGroupDocuments("group")
    ];
    for (const operation of operations) await assert.rejects(operation, /Storage unavailable/);
    assert.equal(closedConnections, operations.length);
  } finally {
    IDBDatabase.prototype.transaction = originalTransaction;
    IDBDatabase.prototype.close = originalClose;
  }
  assert.deepEqual(await loadBookGroups(), []);
});

test("create, retrieve, edit, and reopen empty playlists with normalized fields", async () => {
  const { group } = await createBookGroup({ name: "  English   Grammar  ", description: "  A reading collection.  " });
  assert.equal(group.name, "English Grammar");
  assert.equal(group.description, "A reading collection.");
  assert.ok(group.id);
  assert.equal(group.createdAt, group.updatedAt);
  assert.deepEqual(await loadBookGroups(), [group]);
  assert.deepEqual(await loadBookGroupItems(group.id), []);
  assert.deepEqual(await loadBookGroupDocuments(group.id), []);

  const updated = await updateBookGroup(group.id, { name: "  Vocabulary  ", description: "  " });
  assert.equal(updated.id, group.id);
  assert.equal(updated.name, "Vocabulary");
  assert.equal(updated.description, undefined);
  assert.equal(updated.createdAt, group.createdAt);
  assert.ok(updated.updatedAt >= group.updatedAt);
  assert.deepEqual((await loadSnapshot()).bookGroups, [updated]);
  assert.deepEqual((await loadSnapshot()).bookGroupItems, []);
});

test("name validation rejects whitespace, oversized fields, and case insensitive duplicates", async () => {
  await assert.rejects(createBookGroup({ name: " \t\n " }), /Enter a playlist name/);
  await assert.rejects(createBookGroup({ name: "x".repeat(101) }), /100 characters/);
  await assert.rejects(createBookGroup({ name: "Large", description: "x".repeat(1001) }), /1000 characters/);
  const { group } = await createBookGroup({ name: "English Grammar" });
  await assert.rejects(createBookGroup({ name: "  eNgLiSh  Grammar " }), /already exists/);
  const { group: other } = await createBookGroup({ name: "Another" });
  await assert.rejects(updateBookGroup(other.id, { name: "english grammar" }), /already exists/);
  await assert.rejects(updateBookGroup(group.id, { name: " " }), /Enter a playlist name/);
  assert.equal((await updateBookGroup(group.id, { name: "ENGLISH GRAMMAR" })).name, "ENGLISH GRAMMAR");
  assert.equal((await loadBookGroups()).length, 2);
  await assert.rejects(updateBookGroup("missing", { name: "Valid name" }), /no longer exists/);
});

test("concurrent creation with the same normalized name commits exactly one playlist", async () => {
  const results = await Promise.allSettled([
    createBookGroup({ name: "Favorites" }), createBookGroup({ name: " favorites " }), createBookGroup({ name: "FAVORITES" })
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await loadBookGroups()).length, 1);
});

test("creating from a book action atomically adds the existing book and supports both sources", async () => {
  await loadSnapshot();
  const upload = { ...seedDocuments[0], id: "upload-with-same-title", uploaded: true };
  await saveRecord("documents", upload);
  const { group, item } = await createBookGroup({ name: "Mixed reading" }, "attention");
  assert.equal(item?.bookId, "attention");
  assert.equal(item?.groupId, group.id);
  assert.equal(item?.order, 0);
  await setBookGroupMembership(group.id, upload.id, true);
  const books = await loadBookGroupDocuments(group.id);
  assert.deepEqual(books.map((book) => book.id), ["attention", upload.id]);
  assert.equal((await loadSnapshot()).documents.length, seedDocuments.length + 1);
  assert.deepEqual(books[1], upload);
});

test("membership is idempotent under concurrent writes and one book can belong to several groups", async () => {
  await loadSnapshot();
  const { group } = await createBookGroup({ name: "First" });
  const { group: other } = await createBookGroup({ name: "Second" });
  const results = await Promise.all(Array.from({ length: 5 }, () => setBookGroupMembership(group.id, "attention", true)));
  assert.equal(new Set(results.map((result) => result.item?.id)).size, 1);
  assert.equal((await loadBookGroupItems(group.id)).length, 1);
  await setBookGroupMembership(other.id, "attention", true);
  assert.equal((await loadBookGroupItems()).length, 2);
  await setBookGroupMembership(group.id, "attention", false);
  await setBookGroupMembership(group.id, "attention", false);
  assert.deepEqual(await loadBookGroupItems(group.id), []);
  assert.equal((await loadBookGroupItems(other.id)).length, 1);
  assert.ok((await loadSnapshot()).documents.some((document) => document.id === "attention"));
});

test("database unique indexes reject duplicate names and memberships even outside the repository", async () => {
  await loadSnapshot();
  const { group, item } = await createBookGroup({ name: "Unique" }, "attention");
  const db = await database();
  try {
    assert.equal(db.transaction("bookGroups").store.index("normalizedName").unique, true);
    assert.equal(db.transaction("bookGroupItems").store.index("groupBook").unique, true);
    await assert.rejects(db.add("bookGroups", { ...group, id: "duplicate-group", normalizedName: "unique" }), { name: "ConstraintError" });
    await assert.rejects(db.add("bookGroupItems", { ...item!, id: "duplicate-membership" }), { name: "ConstraintError" });
  } finally { db.close(); }
  assert.equal((await loadBookGroups()).length, 1);
  assert.equal((await loadBookGroupItems(group.id)).length, 1);
});

test("book ordering survives removal, append, and reopening", async () => {
  await loadSnapshot();
  const ids = seedDocuments.slice(0, 3).map((book) => book.id);
  const { group } = await createBookGroup({ name: "Ordered" }, ids[1]);
  await setBookGroupMembership(group.id, ids[0], true);
  await setBookGroupMembership(group.id, ids[2], true);
  assert.deepEqual((await loadBookGroupDocuments(group.id)).map((book) => book.id), [ids[1], ids[0], ids[2]]);
  await setBookGroupMembership(group.id, ids[0], false);
  await setBookGroupMembership(group.id, ids[0], true);
  assert.deepEqual((await loadBookGroupDocuments(group.id)).map((book) => book.id), [ids[1], ids[2], ids[0]]);
  assert.deepEqual((await loadBookGroupItems(group.id)).map((item) => item.order), [0, 2, 3]);
});

test("missing books and groups fail cleanly, and stale references are skipped", async () => {
  await loadSnapshot();
  await assert.rejects(createBookGroup({ name: "Missing book" }, "missing"), /no longer in your library/);
  assert.deepEqual(await loadBookGroups(), []);
  const { group } = await createBookGroup({ name: "Valid playlist" }, "attention");
  await assert.rejects(setBookGroupMembership(group.id, "missing", true), /no longer in your library/);
  await assert.rejects(setBookGroupMembership("missing", "attention", true), /no longer exists/);
  const db = await database();
  await db.put("bookGroupItems", { id: "stale", groupId: group.id, bookId: "missing", addedAt: 1, order: 1 });
  db.close();
  assert.deepEqual((await loadBookGroupDocuments(group.id)).map((book) => book.id), ["attention"]);
  await setBookGroupMembership(group.id, "missing", false);
  assert.equal((await loadBookGroupItems(group.id)).length, 1);
  assert.deepEqual(await loadBookGroupDocuments("missing"), []);
});

test("deleting playlists removes only their memberships and preserves books and reading data", async () => {
  await loadSnapshot();
  await saveRecord("notes", { id: "note", documentId: "attention", page: 0, quote: "Read", body: "Keep this", createdAt: 1, updatedAt: 1 });
  const { group } = await createBookGroup({ name: "Delete me" }, "attention");
  const { group: other } = await createBookGroup({ name: "Keep me" }, "attention");
  await deleteBookGroup(group.id);
  await deleteBookGroup(group.id);
  assert.deepEqual((await loadBookGroups()).map((item) => item.id), [other.id]);
  assert.deepEqual((await loadBookGroupItems()).map((item) => item.groupId), [other.id]);
  const snapshot = await loadSnapshot();
  assert.equal(snapshot.documents.length, seedDocuments.length);
  assert.equal(snapshot.notes.length, 1);
});

test("library document removal cleans memberships while keeping playlists and other books", async () => {
  const upload = { ...seedDocuments[0], id: "uploaded-book", uploaded: true };
  await saveRecord("documents", upload);
  const { group } = await createBookGroup({ name: "First" }, upload.id);
  await createBookGroup({ name: "Second" }, upload.id);
  await removeDocument(upload.id);
  assert.equal((await loadBookGroups()).length, 2);
  assert.deepEqual(await loadBookGroupItems(), []);
  assert.deepEqual(await loadBookGroupDocuments(group.id), []);
  const db = await database();
  assert.equal(await db.get("documents", upload.id), undefined);
  db.close();
});

test("failed membership writes roll back playlist creation and failed deletion preserves the group", async () => {
  await loadSnapshot();
  const originalAdd = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
    if (this.name === "bookGroupItems") throw new DOMException("Storage full", "QuotaExceededError");
    return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key);
  };
  try { await assert.rejects(createBookGroup({ name: "Must roll back" }, "attention"), /Storage full/); }
  finally { IDBObjectStore.prototype.add = originalAdd; }
  assert.deepEqual(await loadBookGroups(), []);
  assert.deepEqual(await loadBookGroupItems(), []);

  const { group } = await createBookGroup({ name: "Keep on failure" }, "attention");
  const originalDelete = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete = function (key: IDBValidKey | IDBKeyRange) {
    if (this.name === "bookGroupItems") throw new DOMException("Storage failed", "UnknownError");
    return originalDelete.call(this, key);
  };
  try { await assert.rejects(deleteBookGroup(group.id), /Storage failed/); }
  finally { IDBObjectStore.prototype.delete = originalDelete; }
  assert.deepEqual(await loadBookGroups(), [group]);
  assert.equal((await loadBookGroupItems(group.id)).length, 1);
});

for (const version of [1, 2]) {
  test(`version ${version} migrates additively preserving documents, assets, annotations, settings and cache`, async () => {
    const upload: ReadingDocument = { ...seedDocuments[0], id: "legacy-upload", uploaded: true, favorite: true, currentPage: 1, pages: ["Saved page one", "Saved page two"], type: "MD" };
    const note = { id: "legacy-note", documentId: upload.id, page: 0, quote: "Saved", body: "Keep note", createdAt: 1, updatedAt: 1 };
    const highlight = { id: "legacy-highlight", documentId: upload.id, page: 0, start: 0, end: 5, text: "Saved", color: "yellow", createdAt: 1 };
    const word = { id: "legacy-word", term: "Saved", meaning: "Kept", context: "Saved", documentId: upload.id, documentTitle: upload.title, page: 0, createdAt: 1 };
    const blob = new Blob(["image"], { type: "image/png" });
    const asset = { documentId: upload.id, path: "image.png", blob, mimeType: blob.type, size: blob.size };
    const legacy = await openDB("folio-reading", version, {
      upgrade(db) {
        db.createObjectStore("documents", { keyPath: "id" });
        for (const name of ["highlights", "notes"]) db.createObjectStore(name, { keyPath: "id" }).createIndex("documentId", "documentId");
        db.createObjectStore("vocabulary", { keyPath: "id" });
        db.createObjectStore("settings"); db.createObjectStore("translations");
        if (version === 2) db.createObjectStore("documentAssets", { keyPath: ["documentId", "path"] }).createIndex("documentId", "documentId");
      }
    });
    await legacy.put("documents", upload);
    await legacy.put("notes", note); await legacy.put("highlights", highlight); await legacy.put("vocabulary", word);
    await legacy.put("settings", { ...defaultSettings, lastDocumentId: upload.id, fontSize: 28 }, "preferences");
    await legacy.put("translations", { text: "Keep cache", createdAt: 1 }, "cached");
    if (version === 2) await legacy.put("documentAssets", asset);
    legacy.close();

    const snapshot = await loadSnapshot();
    assert.deepEqual(snapshot.documents.find((book) => book.id === upload.id), upload);
    assert.deepEqual(snapshot.notes, [note]); assert.deepEqual(snapshot.highlights, [highlight]); assert.deepEqual(snapshot.vocabulary, [word]);
    assert.equal(snapshot.settings.fontSize, 28); assert.equal(snapshot.settings.lastDocumentId, upload.id);
    assert.deepEqual(snapshot.bookGroups, []); assert.deepEqual(snapshot.bookGroupItems, []);
    const db = await database();
    assert.equal(db.version, 3); assert.equal((await db.get("translations", "cached"))?.text, "Keep cache"); db.close();
    const assets = await loadDocumentAssets(upload.id);
    assert.equal(assets.length, version === 2 ? 1 : 0);
    if (version === 2) assert.equal(await assets[0].blob.text(), "image");
    const { group } = await createBookGroup({ name: "After migration" }, upload.id);
    assert.deepEqual(await loadBookGroupDocuments(group.id), [upload]);
    const second = { ...upload, id: "new-import", title: "New import" };
    await saveDocumentWithAssets(second, [{ ...asset, documentId: second.id }]);
    assert.equal((await loadDocumentAssets(second.id)).length, 1);
  });
}
