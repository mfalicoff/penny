# Browser offline ledger and sync (MAZ-87)

[Documentation](README.md) · [Web app](../apps/web/README.md) · [Native offline sync](ios-offline-sync.md) · [Server ledger sync](migration/ledger.md) · [Domain rules](migration/domain-rules.md)

The v2 web app (`apps/web`) keeps each signed-in account's personal ledger in the browser, saves to it while offline, and syncs it with the server's whole-ledger `GET`/`PUT /api/ledger`. It follows the native engine's rules ([native offline sync](ios-offline-sync.md)) and the shared TypeScript merge and recurrence (`src/domain/merge.ts`, `src/domain/ledger.ts`, [ADR 002](migration/architecture.md#adr-002-calculation-and-conflict-ownership)), with the native app's recurrence refinements on top (`apps/web/src/offline/merge.ts`, MAZ-90). The server never merges: it refuses a stale revision with 409.

TanStack Query is **not** the offline store. Query keeps server copies that can always be fetched again; pending work lives only in IndexedDB, so clearing or refetching Query (sign-out, expiry, `clearPrivateData`, a 401) never erases it.

| Piece | Where | Role |
| --- | --- | --- |
| `LedgerSyncEngine` | `apps/web/src/offline/engine.ts` | One account: durable saves, serialized sync with 409 retries, triggers and backoff, legacy import, recovery, sign-out hold |
| `openIndexedDb`, `MemoryLedgerDatabase` | `src/offline/database.ts` | The `penny-offline` database (atomic read-modify-write per key, `durability: "strict"`), and the in-memory stand-in used for tests and when the browser blocks storage |
| `LedgerRecord`, `parseRecord` | `src/offline/record.ts` | The stored record (format 1), account scope and keys; unreadable, misplaced and newer-format copies |
| `parseLedger`, `normalizeLedger` | `src/offline/wire.ts` | Wire ledger checks (v4; v1–v3 upgraded from an old local copy only), unknown fields kept |
| `mergeOfflineLedger` | `src/offline/merge.ts` | The shared three-way merge plus the native recurrence refinements (below), used for every sync, the merge of saves that landed during a sync, and the legacy import |
| `pendingChanges` | `src/offline/pending.ts` | "N changes waiting", the entries and schedules waiting to sync, and the entries deleted here |
| `readLegacyCopy`, `removeLegacyCopy`, `setLegacyCopyAside` | `src/offline/legacy.ts` | The Expo web app's `localStorage` copy |
| `withLock`, `openLedgerChannel` | `src/offline/coordination.ts` | Web Locks (one sync per account across tabs) and the `penny-offline-ledger` BroadcastChannel |
| `OfflineLedgerProvider`, `useLedgerSync`, `useLedgerEngine` | `src/offline/OfflineLedgerProvider.tsx` | One engine per signed-in account below `AuthGate`; Query, session and sign-out wiring |
| `SyncStatusBanner` | `src/offline/SyncStatusBanner.tsx` | The shell's sync and storage states |

## Storage schema

IndexedDB database `penny-offline`, schema version 1, one object store `ledgers` with out-of-line string keys. IndexedDB belongs to the page's origin, so each server (origin) has its own database; the record repeats the origin anyway.

| Key | Value |
| --- | --- |
| `ledger\n<origin>\n<lowercased email>` | The account's record (below) |
| `aside\n<origin>\n<lowercased email>\n<ISO time>` | An unreadable record set aside by "Set aside and download again"; removed with the account at sign-out |

```json
{
  "format": 1,
  "server": "https://penny.example.com",
  "email": "alex@example.com",
  "baseRevision": 12,
  "base": { "version": 4, "currency": "CAD", "...": "the last ledger the server acknowledged" },
  "local": { "version": 4, "currency": "CAD", "...": "base plus this browser's unsynced changes" },
  "lastSyncedAt": "2026-11-10T14:03:00.000Z",
  "savedAt": "2026-11-10T14:05:12.000Z",
  "legacy": { "fingerprint": "…", "importedAt": "…", "removedAt": "…" }
}
```

- `base` and `local` are v4 wire ledgers, normalized to plain JSON (no `undefined`). Pending work is the difference between them; there is no separate queue. `baseRevision` is `null` only for a copy imported from the legacy app, which kept no revision.
- A record whose `server` or `email` differs from its key is refused (`wrongAccount`, shown as unreadable), so a misplaced copy is never shown to the wrong person.
- **Writes** are one IndexedDB read-write transaction per step (`LedgerDatabase.update`): the change is computed from the value read in the same transaction, and IndexedDB serializes overlapping read-write transactions across every tab of the origin, so two tabs can never overwrite each other's save. Transactions use `durability: "strict"`, and a save is acknowledged only when its transaction completes. After the first save Penny asks `navigator.storage.persist()` (best effort) so the browser doesn't evict the data under storage pressure.
- **Format.** A build reads its own `format` and refuses a higher one (`storageNewerFormat`, "Reload to update") without touching the record. A future format must read every earlier one and rewrite only after a successful read; it must never drop `local`. A schema change bumps the IndexedDB version and migrates in `onupgradeneeded`; an old tab closes its connection on `versionchange` rather than block the upgrade. The old build can't reopen the upgraded database, so from then on every call fails with `StorageError("closed")` and the tab shows `storageNewerFormat` ("Penny was updated in another tab", Reload): saves are refused with the reload message and syncs stop, with no retry timer. A connection the browser closes by itself (site data cleared) is handled the same way.

## Migrating the legacy Expo web copy

The Expo web export stores AsyncStorage in `localStorage` with the key as given and no server namespace (`src/data/offlineLedger.ts`): `penny:ledger:<lowercased email>` holds `{"base": Ledger, "local": Ledger}` and `penny:active-account` the last email. Both apps are served from the same origin, so the v2 app can read the copy.

1. When an account's engine starts it reads `penny:ledger:<email>` (read-only). A copy for another email is never read.
2. A readable copy is imported in one IndexedDB transaction, with a fingerprint of the stored text:
   - no record yet: the copy becomes the record (`baseRevision: null`);
   - a record that already holds this fingerprint: nothing happens (a repeated or interrupted run, another tab, a reload);
   - a record without it (the legacy app ran again after an import, for example during a rollback): the copy's own unsynced edits are merged onto the record (`mergeLedger(copy.base, copy.local, record.local)`).
3. The first sync sends the imported edits like any others: `GET`, merge onto the server's ledger, `PUT` on the revision just read.
4. Only after a sync that leaves nothing pending, and only if the copy still has the imported fingerprint, is `penny:ledger:<email>` removed and `legacy.removedAt` recorded. If the copy changed meanwhile, it is imported again (step 2) and synced first.
5. `penny:active-account` is left alone; the cookie session says who is signed in.

Failure handling: a copy that can't be parsed is kept untouched, shown as "Changes from the previous Penny web app couldn't be read", and counts as one pending change for sign-out until **Set aside** moves it to `penny:ledger:<email>.unreadable-<time>` (which needs room for the copy; if the browser refuses, nothing changes). If IndexedDB refuses the import (quota), the copy stays in place, its edits count for sign-out, and the next start tries again. Sign-out removes the legacy copies that hold nothing unsynced (see [Several tabs](#several-tabs)). If IndexedDB is blocked entirely, the import runs in memory: the edits are still uploaded and the copy removed once the server has them. Version 1–3 ledgers in the copy are upgraded with `upgradeLedger`.

## Saving

`LedgerSyncEngine.save(change)` (a `LedgerChange` from `src/domain/commands.ts`):

1. Refused while signing out or switching accounts (`unavailable`), or when the stored copy is unreadable, from a newer version, or storage is blocked (`storage*`).
2. In one transaction: read the record (none yet: `notLoaded`), apply the change (a rule refusal, including "changed on another device", is `rule` with the command's message), `materialize` due recurring entries with the browser's local date, write. A failed write is `writeFailed` (quota has its own message). Nothing changes on any failure, so the form keeps the draft.
3. Resolve with `{ savedOffline }`, tell other tabs, and start a sync. `savedOffline` ("Saved on this device") is what is known when the save is acknowledged, without waiting for that sync: the browser reports no network, or the last attempt while online couldn't reach the server. An earlier `offline` issue doesn't count once the browser is back online. The sync's outcome then shows in the state.

Saves are allowed while a sync runs; the sync merges them.

## Sync

One sync per account at a time across tabs (Web Lock `penny-ledger-sync:<key>`; a page-local queue where the API is missing). Correctness never depends on the lock: every write is an atomic transaction and the server compares revisions. A pass:

1. Read the record from IndexedDB (another tab may have changed it), then `GET /api/ledger`.
2. If changes are pending, `mergeLedger(base, local, remote)`, then `materialize`. If the result equals the server's ledger, nothing is sent.
3. Otherwise `PUT` it on the revision just read. On 409, wait 0.2, 0.4, 0.8, 1.6 s (plus up to 50% jitter), re-read and merge again, up to five attempts; then `conflictRetriesExhausted` and backoff. Nothing is lost.
4. In one transaction, record the answer as `base` and merge saves that landed meanwhile on top (`mergeLedger(sentLocal, currentLocal, answer)`); they stay pending and another pass (at most three per sync) sends them. If saves landed during all three passes, the sync ends without an issue and schedules a retry on the backoff below, so the rest never waits for an unrelated trigger. If another tab already recorded a newer revision, the older answer is dropped. If the record was removed meanwhile (sign-out in another tab), it is not recreated.

The `PUT` is a whole-ledger compare-and-swap, so repeating it after an ambiguous failure either applies once or answers 409 and re-merges to the same result: no duplicates. If the server accepted a write but the browser couldn't record the answer (`storageWriteFailed`), the next sync finds the server already has the changes, sends nothing and records the result.

### Conflict policy

The same as the native app and the legacy app, field by field and by record id in every list: a record only the server changed takes the server's version; different fields changed on each side both survive; **the same field changed on both sides takes this browser's value**; deleted here and edited on the server is deleted; edited here and deleted on the server comes back with this browser's version; created here is appended; a currency change here wins. Occurrence ids are `{ruleId}:{date}`, so materializing after any merge adds nothing that exists.

Recurrence refinements (MAZ-90, the same four as the native `LedgerMerge`; the shared `src/domain/merge.ts` stays unchanged for the legacy app). An occurrence is "untouched" when it equals what its rule (here or in the base) generates for its date, ignoring key order:

- When both sides advanced a rule's `nextDate`, the later one wins, so a date the server already consumed is not recorded again.
- An occurrence both sides recorded keeps the server's copy when this browser's is untouched, so an edit made on the other device survives.
- An untouched occurrence only this browser recorded is dropped when the server's rule is already past its date and the server doesn't have it (recorded there, then deleted).
- **A schedule deleted on another device stays deleted** when this browser only caught it up offline (its copy differs from the base only in `nextDate`), and the untouched occurrences recorded here for it go with it. A schedule edited here in any other field (or paused, resumed) comes back with its occurrences, as in "edited here and deleted on the server"; an occurrence edited here is kept either way.

`tests/offline/merge.test.ts` checks these and that the golden `contracts/fixtures/merge-conflicts.json` cases still give the same result.

### Triggers and retries

| Trigger | Source |
| --- | --- |
| Sign-in, reload with a session, re-sign-in after expiry | The engine starts when `AuthGate` shows the account |
| Every save | `save` |
| The network returns | `window` `online` |
| The tab becomes visible | `visibilitychange`: re-reads the record, records occurrences due since the last day, syncs |
| Another tab wrote | BroadcastChannel `penny-offline-ledger`: re-reads the record (no sync) |
| A newer server ledger reached Query (Settings › Currency wrote one) | Query cache subscription |
| Retry | `syncNow()`, the banner's Retry: runs even if the browser reports no network, resets backoff, and always starts a fresh attempt |
| A failure that can pass, or saves that kept landing during all three passes | Backoff 15 s doubling to 5 min; a hidden tab waits until it is visible |

`offline` waits for the `online` event. `rejected` (400/403/413 and other 4xx) and `incompatibleServerData` (a ledger version this build can't read) don't retry by themselves. After every recorded sync the provider puts the server copy into Query's ledger entry (never an older revision than Query has) and, if the server ledger changed, invalidates the account's search results.

## Several tabs

- Saves from any tab are atomic and never lost; each tab re-reads on the channel message and shows the same pending count.
- Only one tab syncs an account at a time; the others wait for the lock and then find nothing to send.
- An answer older than what another tab recorded is ignored, so `base` never goes backwards.
- Sign-out holds saves (and parks a scheduled retry) in the tab that signs out, counts pending work from IndexedDB (including other tabs' saves), and removes the record only if it is still clean in the same transaction; a save from another tab in between keeps the record, and its work waits for the next sign-in. With the record it removes the account's `aside` records, the legacy copies set aside (`penny:ledger:<email>.unreadable-<time>`), and the legacy copy itself when the removed record had imported it or the copy has no unsynced edits of its own (an import that storage refused). As in the pending count, a legacy copy with edits the record doesn't hold, or one that can't be read, stays. `penny:active-account` is left alone. Cancelling sign-out lifts the hold, syncs if anything is pending, and otherwise restores the parked retry.
- Other tabs learn about the sign-out from their next `/me` or a 401, as before.

## Failure handling

| Failure | Behavior |
| --- | --- |
| Tab closed or crashed after a save | The save was committed before it was acknowledged; the next load shows it as pending and syncs it |
| Quota exceeded on save | `writeFailed` with "out of storage space"; nothing changes |
| Storage blocked (no IndexedDB, `SecurityError` in some private modes or site settings) | `storageUnavailable`: the engine runs in memory, downloads and shows the ledger and uploads a legacy copy's edits, but refuses saves ("This browser isn't keeping Penny's data") |
| Record unreadable or misplaced | `storageUnreadable`: saves refused, nothing sent, counts as one for sign-out. "Set aside and download again" moves it to an `aside` key and downloads again; changes only in that copy can't be recovered |
| Record from a newer build | `storageNewerFormat`: left untouched; "Reload" |
| Connection closed for another tab's schema upgrade, or by the browser | `storageNewerFormat`: saves refused with the reload message, no sync or retry until "Reload" |
| Offline, server unreachable or busy | `offline`, `serverUnreachable`, `serverUnavailable` (429/5xx); retried; pending kept |
| 401 | Nothing local changes. The provider calls `expireSession` only if the session is still this account's; sign-in shows "Your session ended… Changes waiting to sync are kept on this device". Signing in again as the same account resumes the sync |
| Account switch while a sync is in flight | The old engine is stopped; its late answers are dropped and it only ever writes its own account's key |
| Unknown ledger version from the server | `incompatibleServerData`; nothing is written over it |

## Sync status in the shell

`SyncStatusBanner` replaces the shell's offline banner (redesign specimen `offline`):

| State | Banner |
| --- | --- |
| Offline (browser) or `offline` | "Offline · N changes waiting", "saved in this browser and sync when you're back online", Retry; with nothing pending, the plain offline banner |
| `serverUnreachable`, `serverUnavailable` with pending work | "Not synced · N changes waiting" and Retry (the shell's server banner says the rest) |
| Other failures | "Couldn't sync · N changes waiting", the reason, Retry (an alert) |
| `storageUnavailable`, `storageUnreadable`, `storageNewerFormat` | The messages and actions above |
| Unreadable legacy copy | "Changes from the previous Penny web app couldn't be read" and Set aside |
| Session expired | Sign-in with the expiry notice |

`useLedgerSync()` gives screens `ledger` (server plus pending), `pending.count`, `pending.entryIds` ("Waiting to sync" rows), `pending.deletedEntryIds`, `phase`, `issue`, `lastSyncedAt` ("as of last sync"), `durable` and `changedAt`. Entry screens (MAZ-88) save with `useLedgerEngine().save(change)`, show `LedgerSaveError.message` and keep the draft on failure, and can use `savedOffline` for "Saved on this device".

## Search

Activity (`/transactions`) searches the browser's ledger instead of the server while changes are pending, while offline, when the server can't be reached, and when the server's results predate the latest change shown here (`changedAt`, until the invalidated search refetches). Local results use `searchEntries` from `src/domain/search.ts` (the trimmed, case-insensitive substring rule, newest first), filtered to the month, and say "on this device": pending creates and edits are found and marked "Waiting to sync", pending deletes are not, and server pages are never mixed in, so a deleted row can't come back and an accepted entry isn't listed twice. Shared expenses aren't kept offline, so local results are personal only.

## Online-only actions

Shared household actions, receipt uploads, settlement and server search need the network; nothing shared is queued or cached offline. Gate them on `useOnline()` and the sync phase.

## Deployment-origin continuity

IndexedDB and `localStorage` belong to one origin (scheme, host and port). Pending browser work and the legacy copy are only found when the v2 web app is served from **the same origin** the legacy Expo web app used, which the cutover keeps ([cutover](cutover.md)). Moving Penny to another address, switching between `http` and `https`, or changing the port starts with an empty store: before such a move, sync (every tab shows no "changes waiting") and then move. Clearing site data, or a browser evicting it, removes unsynced work; the server holds everything that was synced. Private windows keep data only until they close.

## Offline limitations

- The whole ledger is rewritten on every save and sync, as in the legacy and native apps.
- No background sync: changes sync while a Penny tab is open and online.
- Same-field conflicts are last-sync-wins for this browser; there is no per-field prompt. An edit of an entry another device deleted brings it back.
- Shared data and receipts aren't available offline; local search is personal entries only, with substring matching (no typo or meaning matching).
- The browser has no entry form yet (MAZ-88). Recurring schedules (MAZ-90, `/recurring`) are the first screen that saves to the store.

## Tests

| Suite | Covers |
| --- | --- |
| `tests/offline/merge.test.ts` | The golden merge cases; a schedule deleted elsewhere after an offline catch-up (and kept when edited here, or its occurrence edited here); the other device's occurrence edit kept; an occurrence recorded and deleted elsewhere dropped; the later `nextDate` kept; occurrences of a new local rule kept; untouched detection |
| `tests/offline/engine.test.ts` | A schedule deleted on another device after this browser caught it up offline doesn't come back (reproduces the MAZ-87 gap); first download; save before download; offline create/edit/delete, reload and one PUT on reconnect; rule refusals and full disk; recurrence catch-up; an iOS edit between read and write (independent fields survive), the same-field policy, five 409s then success, saves during a sync, saves during every pass (a retry is scheduled), a failed write after the server accepted; 503, 400, unknown ledger version, 401 and resume, late answers after an account switch, misplaced and newer-format copies and recovery, a connection closed by another tab's upgrade (reload, no retry), blocked storage; `savedOffline` from the current network state; two tabs (offline save seen by the other, simultaneous syncs, racing saves, recurrence across tabs and devices); sign-out counting, the save-between-count-and-removal race, a retry restored after a cancelled sign-out, and `aside` records removed |
| `tests/offline/legacy.test.ts` | Legacy import and removal after sync, interrupted and repeated runs, two tabs importing at once, a copy changed after import, an unreadable copy and Set aside (also with full storage), import refused by storage, import with IndexedDB blocked, other accounts' copies, v1–v3 copies; at sign-out, set-aside copies and clean un-imported copies removed while copies with edits or unreadable ones stay |
| `tests/offline/database.test.ts` | The IndexedDB adapter (fake-indexeddb): round trip across connections, aborted changes, no lost update across three connections, a newer schema version taking over (calls then fail as `closed`), missing and refused IndexedDB |
| `tests/offline.test.tsx` | The real app: banner from a previous visit, offline, reconnect and Retry; sign-out refused with pending work and the copy removed after it; local search with pending and deleted rows, then server results; clearing Query keeps the work; 401 keeps it; legacy import through the app; blocked storage |
| `e2e/offline.spec.ts` | Real Chromium (desktop and phone): the legacy copy imported, kept through a reload and a second tab while the server is down, the browser's offline switch, one PUT on reconnect, both tabs converged, the copy removed; sign-out refused then allowed |
| `e2e/recurring.spec.ts` | Real Chromium (desktop and phone): a schedule saved while the server is down, kept through a reload and synced with one PUT and no duplicate occurrence; a schedule deleted on another device after an offline catch-up at a later date stays deleted ([recurring](../apps/web/README.md#recurring-schedules-maz-90)) |

Run `npm test` and `npm run test:e2e` in `apps/web`. The same journeys against the real .NET/PostgreSQL stack on Chromium, Firefox and WebKit belong to MAZ-95.
