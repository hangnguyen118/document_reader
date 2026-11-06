import { database } from "./database";
import type { BookGroup, BookGroupItem, ReadingDocument } from "./types";

export interface BookGroupInput { name: string; description?: string }

/** Close the connection even when constructing a transaction fails. */
async function withDatabase<T>(operation: (db: Awaited<ReturnType<typeof database>>) => Promise<T>): Promise<T> {
  const db = await database();
  try { return await operation(db); }
  finally { db.close(); }
}

function validateInput(input: BookGroupInput) {
  const name = input.name.trim().replace(/\s+/g, " ");
  const description = input.description?.trim() || undefined;
  if (!name) throw new Error("Enter a playlist name.");
  if (name.length > 100) throw new Error("Keep the playlist name to 100 characters or fewer.");
  if (description && description.length > 1000) throw new Error("Keep the description to 1000 characters or fewer.");
  return { name, description, normalizedName: name.toLowerCase() };
}

function publicGroup({ normalizedName: _normalizedName, ...group }: BookGroup & { normalizedName: string }): BookGroup { return group; }
function ordered(items: BookGroupItem[]) {
  return items.sort((a, b) => a.order - b.order || a.addedAt - b.addedAt || a.id.localeCompare(b.id));
}
function membership(groupId: string, bookId: string, items: BookGroupItem[]): BookGroupItem {
  return { id: crypto.randomUUID(), groupId, bookId, addedAt: Date.now(), order: items.reduce((max, item) => Math.max(max, item.order), -1) + 1 };
}

/** A group and its optional first book are committed together. */
export async function createBookGroup(input: BookGroupInput, bookId?: string): Promise<{ group: BookGroup; item?: BookGroupItem }> {
  const fields = validateInput(input);
  return withDatabase(async (db) => {
    const tx = db.transaction(["bookGroups", "bookGroupItems", "documents"], "readwrite");
    // Attach a rejection handler before awaiting individual requests, including validation failures.
    const completed = tx.done; void completed.catch(() => {});
    try {
      const groups = tx.objectStore("bookGroups");
      if (await groups.index("normalizedName").get(fields.normalizedName)) throw new Error("A playlist with this name already exists.");
      if (bookId !== undefined && !await tx.objectStore("documents").get(bookId)) throw new Error("This book is no longer in your library.");
      const now = Date.now();
      const record = { id: crypto.randomUUID(), ...fields, createdAt: now, updatedAt: now };
      await groups.add(record);
      const item = bookId === undefined ? undefined : membership(record.id, bookId, []);
      if (item) await tx.objectStore("bookGroupItems").add(item);
      await completed;
      return { group: publicGroup(record), item };
    } catch (error) {
      try { tx.abort(); } catch { /* The request may have already aborted the transaction. */ }
      await completed.catch(() => {});
      throw error;
    }
  });
}

export async function updateBookGroup(id: string, input: BookGroupInput): Promise<BookGroup> {
  const fields = validateInput(input);
  return withDatabase(async (db) => {
    const tx = db.transaction("bookGroups", "readwrite");
    const completed = tx.done; void completed.catch(() => {});
    try {
      const current = await tx.store.get(id);
      if (!current) throw new Error("This playlist no longer exists.");
      const duplicate = await tx.store.index("normalizedName").get(fields.normalizedName);
      if (duplicate && duplicate.id !== id) throw new Error("A playlist with this name already exists.");
      const record = { ...current, ...fields, updatedAt: Date.now() };
      await tx.store.put(record); await completed;
      return publicGroup(record);
    } catch (error) {
      try { tx.abort(); } catch { /* The request may have already aborted the transaction. */ }
      await completed.catch(() => {});
      throw error;
    }
  });
}

/** Delete only the playlist and its memberships; documents are never changed. */
export async function deleteBookGroup(id: string): Promise<void> {
  return withDatabase(async (db) => {
    const tx = db.transaction(["bookGroups", "bookGroupItems"], "readwrite");
    const completed = tx.done; void completed.catch(() => {});
    try {
      await tx.objectStore("bookGroups").delete(id);
      const items = tx.objectStore("bookGroupItems");
      for (const key of await items.index("groupId").getAllKeys(id)) await items.delete(key);
      await completed;
    } catch (error) {
      try { tx.abort(); } catch { /* The request may have already aborted the transaction. */ }
      await completed.catch(() => {});
      throw error;
    }
  });
}

/** Idempotent membership updates serialize with document deletion and other playlist writes. */
export async function setBookGroupMembership(groupId: string, bookId: string, included: boolean): Promise<{ group: BookGroup; item?: BookGroupItem }> {
  return withDatabase(async (db) => {
    const tx = db.transaction(["bookGroups", "bookGroupItems", "documents"], "readwrite");
    const completed = tx.done; void completed.catch(() => {});
    try {
      const groups = tx.objectStore("bookGroups");
      const current = await groups.get(groupId);
      if (!current) throw new Error("This playlist no longer exists.");
      const items = tx.objectStore("bookGroupItems");
      const existing = await items.index("groupBook").get([groupId, bookId]);
      if (included && !await tx.objectStore("documents").get(bookId)) throw new Error("This book is no longer in your library.");
      if (included === Boolean(existing)) { await completed; return { group: publicGroup(current), item: existing }; }
      const item = included ? membership(groupId, bookId, await items.index("groupId").getAll(groupId)) : undefined;
      if (item) await items.add(item);
      else if (existing) await items.delete(existing.id);
      const record = { ...current, updatedAt: Date.now() };
      await groups.put(record); await completed;
      return { group: publicGroup(record), item };
    } catch (error) {
      try { tx.abort(); } catch { /* The request may have already aborted the transaction. */ }
      await completed.catch(() => {});
      throw error;
    }
  });
}

export async function loadBookGroups(): Promise<BookGroup[]> {
  const db = await database();
  try { return (await db.getAll("bookGroups")).map(publicGroup); }
  finally { db.close(); }
}

export async function loadBookGroupItems(groupId?: string): Promise<BookGroupItem[]> {
  const db = await database();
  try { return ordered(await (groupId === undefined ? db.getAll("bookGroupItems") : db.getAllFromIndex("bookGroupItems", "groupId", groupId))); }
  finally { db.close(); }
}

/** Missing references are skipped; never duplicate book content into a playlist. */
export async function loadBookGroupDocuments(groupId: string): Promise<ReadingDocument[]> {
  const db = await database();
  try {
    const tx = db.transaction(["documents", "bookGroupItems"], "readonly");
    const items = ordered(await tx.objectStore("bookGroupItems").index("groupId").getAll(groupId));
    const documents = await Promise.all(items.map((item) => tx.objectStore("documents").get(item.bookId)));
    await tx.done;
    return documents.filter((document): document is ReadingDocument => Boolean(document));
  } finally { db.close(); }
}
