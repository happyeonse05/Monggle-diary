# Standalone guest diary storage

Serve `index.html` and `diary-store.js` together. No runtime npm install,
Supabase account, artifact host or network API is needed to save a guest diary
in this browser. `npm ci --ignore-scripts`, `npm test` and `npm run check` are
development checks only; fake-indexeddb 6.2.8 is a pinned test dependency.
This static site has no bundler/build step. The check compiles inline/external
scripts and verifies the required storage asset.

Previously, without `window.storage`, records lived only in a JavaScript
object. Reloading discarded them. Guest use now stores `dy:YYYY-MM-DD`,
`dm:YYYY-MM` and `pen:prefs` in IndexedDB `monggle-guest-diary-v1`/`kv`.
Existing artifact data is not imported, renamed or deleted. The new database
contains only guest diary content/preferences. Account, session and bearer
keys are rejected. The adapter is selected only when there is no artifact
storage and no signed-in/local/cloud account. Authenticated standalone use
keeps its previous memory/cloud path and does not share this guest database.

Guest autosave snapshots the date, pages, strokes, items, memo, weather and
mood at scheduling time. Navigation cannot redirect a pending snapshot to a
different date. A serial queue retains the latest snapshot for each date;
failed jobs remain available for an explicit retry. One readwrite transaction
saves both diary and monthly marker. Success appears only on transaction
complete; an abort preserves both prior values. A failed initial read locks
writes for that store instance until reload to avoid overwriting unread data.
The UI reports pending/saving/saved/failure; the failure button retries pending
diary saves. A failed pen-preference save asks the user to select again.

Wait for **기기에 저장됨** before closing or reloading. Closing during a debounce
or active asynchronous transaction is not guaranteed to finish. Browser/site
data clearing, eviction, private mode, origin changes and device loss can
remove this storage. It is plaintext, device/origin scoped, and shared by
guest visitors in the same browser profile. It is not an encrypted backup,
cross-device sync, user authentication or a general SQL/server migration.
Do not use this guest store to protect records on a shared/public device.

Cloud sync and the artifact host retain their existing paths and limitations,
including independent multi-key writes and failure/queue behavior. Remote
auth/RLS, account-switch races, migration/export, multi-tab conflict handling,
power-loss durability and iPhone Safari need separate validation. The old
offline-account password-hash fallback was not redesigned or made persistent
by this change; it is not a secure replacement for server authentication.
No production account or data is copied or written by the tests.

## Date reads and pending edits

Each `loadDay` request has a generation and captures its storage key. Only the
latest request for the current key/scope can update the page. An older response
cannot replace a newer date or unlock its pending editor, including when the same
date is requested twice. This prevents a later edit from copying the old day's
page fields into the newly selected day's record.

While the current read is pending, the book, drawing/tools, page controls,
undo/redo and image export are inert, the memo is read-only, and the central
`saveDay` function ignores queued edit events. Date/calendar navigation remains
available; an already queued guest autosave retains its earlier frozen snapshot.
The status announces loading and the book exposes `aria-busy`. A current rejected
read (or render exception) leaves the editor locked with a reopen notice; stale
failures cannot relock a successfully loaded day. The existing guest store's own
read-error write lock still requires a full reload, even if `localGet` converts
its error to a null display value. This change does not repair damaged records.

Tests exercise the actual HTML load/save functions, including out-of-order and
same-date responses, pending writes, rejected/synchronous reads and scope changes.
Synthetic PC/mobile Chromium tests reproduce the old stale-page overwrite and
pending-input write, then check preserved IndexedDB content and save/reload.
Real Safari, production login/logout, account authorization and the old cloud
save timer are not validated or redesigned here. Import/export backup, multiple
tabs and already-running file/animation callbacks need separate work.
