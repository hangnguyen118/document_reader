Book playlists are integrated into Folio's existing library, reading store, and browser database. Users can create collections, add or remove books through the action beside each card title, create a playlist with the current book already included, and manage collections under Your Space → My Playlist.

**Files created**

- `lib/playlists.ts`: validated, transactional playlist repository and ordered document retrieval.
- `components/add-to-playlist.tsx` and `components/add-to-playlist.css`: checkbox popover, immediate selection feedback, creation shortcut, storage errors, viewport positioning, and keyboard focus handling.
- `components/playlist-dialog.tsx`: shared creation and editing dialog.
- `components/playlist-delete-dialog.tsx`: confirmation, pending state, and retryable deletion errors.
- `components/book-card.tsx`: the existing library card extracted for reuse in playlists.
- `components/playlists-view.tsx` and `components/playlists.css`: overview, cover previews, management menus, detail view, and responsive layouts.
- `app/playlists/page.tsx` and `app/playlists/[id]/page.tsx`: overview and detail routes.
- `tests/unit/playlists.test.ts` and `tests/e2e/playlists.spec.ts`: data and browser coverage.
- `PLAYLIST_IMPLEMENTATION.md`: this implementation report.

**Files modified**

- `lib/types.ts`: playlist types and snapshot fields.
- `lib/database.ts`: additive migration, snapshot loading, and membership cleanup when a library document is deleted.
- `components/providers.tsx`: playlist mutations in the existing reading store; successful writes update all mounted consumers.
- `components/library-view.tsx`: shared book cards with playlist actions, preserving uploads, filters, pagination, rename, favorites, and deletion.
- `components/shell.tsx`: My Playlist navigation and active states for both new routes, preserving the relative order of existing navigation items.
- `tests/unit/database.test.ts`: expected schema version updated to 3.

**IndexedDB migration and relationships**

The existing `folio-reading` database upgrades from version 2 to version 3. The migration adds stores without replacing or clearing existing stores. Upgrades from both version 1 and version 2 are tested with saved documents, annotations, vocabulary, settings, translations, and image assets where supported.

`bookGroups` stores UUID identity, name, optional description, creation/update timestamps, and an internal normalized name. A unique `normalizedName` index prevents case-insensitive duplicate names. Names are trimmed, repeated whitespace is collapsed, and names/descriptions are limited to 100/1000 characters.

`bookGroupItems` stores UUID identity, `groupId`, `bookId`, `addedAt`, and `order`. Its unique compound `groupBook` index prevents duplicate relationships; separate `groupId` and `bookId` indexes support lookup and cleanup. `bookId` references the existing `ReadingDocument.id` for both Folio readings and uploads. Book content is never copied. New memberships append in saved order; removing and adding a book again puts it at the end.

Creating a playlist with its first book, changing membership, and deleting a playlist use atomic transactions. Failed operations roll back, and connections close even if opening a transaction fails. Missing document references are skipped when displaying books and calculating counts. Deleting a playlist or removing a membership leaves documents and their reading data intact. Deleting an original library document removes its memberships while retaining the playlists.

**UI and reading behavior**

`/playlists` shows all local collections, book counts, up to three existing book covers, an empty preview, and create/edit/delete controls. `/playlists/[id]` shows books in membership order and uses the shared card and existing `/read/[id]` reading flow. Explicitly selected Folio readings remain accessible in playlists when default books are hidden from the library. Missing playlists and empty collections have dedicated states.

Checkboxes explain that selecting adds and unchecking removes. Selections update immediately and roll back on storage failures. Ref guards prevent repeated submissions and concurrent duplicate actions. Native dialogs, native popover dismissal, keyboard management menus, focus indicators, inline errors, and the existing toast system provide interaction feedback.

**Verification**

- `npm test`: 137 unit tests passed, including 14 playlist tests. Coverage includes CRUD, normalized names, concurrent duplicate writes, database uniqueness constraints, multiple collections, ordering, missing references, atomic rollback, connection cleanup, document preservation, and migrations.
- `npm run typecheck`: passed.
- `npm run build`: passed, including both new routes and the production TypeScript check.
- Existing browser regression suites for book naming, default books, pagination, and reading: 26 passed. These exercise PDF/DOCX/TXT/Markdown uploads, favorites, search, reading progress, notes, highlights, speech, settings, and mobile navigation.
- `npx playwright test tests/e2e/playlists.spec.ts`: 8 passed. Tests cover creation/cancellation/validation, automatic first membership, multiple playlists, toggling and persistence, uploaded/Folio reading flows, editing, member removal, nonempty playlist deletion, failed writes and retry, missing references, mobile layout, viewport-safe errors, and keyboard focus after Escape and dialog closure.
- Desktop/mobile screenshots were inspected in light and dark themes. Mobile pages and popovers fit the viewport.
- `git diff --check`: passed. This repository has no configured lint command.

**Limits**

Persistence remains local to this browser and device, following the existing application model. Browser automation was run in Chromium; Firefox and Safari were not exercised. No new dependencies were added.
