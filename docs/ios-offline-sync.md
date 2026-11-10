# Native offline ledger and sync (MAZ-71)

[Documentation](README.md) · [Native iOS app](../apps/ios/README.md) · [Ledger rules](ios-ledger-domain.md) · [API client](ios-api-client.md) · [Sign-in](ios-authentication.md) · [Server ledger sync](migration/ledger.md)

The native app keeps each signed-in account's personal ledger on the device, saves to it while offline, and syncs it with the server's whole-ledger `GET`/`PUT /api/ledger`. The server never merges: it refuses a stale revision with 409. The client merges, as the legacy app does (`src/data/offlineLedger.ts`, `src/domain/merge.ts`, `src/providers/LedgerProvider.tsx`; [ADR 002](migration/architecture.md#adr-002-calculation-and-conflict-ownership)).

| Piece | Where | Role |
| --- | --- | --- |
| `LedgerMerge`, `PendingChanges` | `PennyDomain/Ledger/LedgerMerge.swift` | Pure three-way merge and the "what is waiting" summary |
| `Ledger(wire:)`, `WireLedger(_:)` | `PennyData/Offline/LedgerWireMapping.swift` | Wire ↔ domain ledger, with the v1–v3 upgrade |
| `LedgerFileStore`, `DurableFileSystem` | `PennyData/Offline/LedgerFileStore.swift` | One file per account, durable atomic writes |
| `LedgerSyncEngine` | `PennyData/Offline/LedgerSyncEngine.swift` | Per-account actor: save, serialized sync, retries, recovery, removal |
| `OfflineLedgerStore` | `PennyData/Offline/OfflineLedgerStore.swift` | One engine per account; the `AccountLocalData` that `AuthController` uses for sign-out |
| `LedgerSyncModel`, `LedgerSyncState` | `PennyData/Offline/LedgerSyncModel.swift` | `@Observable` state and actions for the UI; follows `AuthController` |
| `SystemNetworkMonitor`, `SystemCalendarDayMonitor`, `SyncBackoff` | `PennyData/Offline/SyncTriggers.swift` | Reconnect and day-change triggers, retry delays |
| `SearchResults` | `PennyData/Offline/SearchResults.swift` | Server search pages without repeated rows |
| `View.ledgerSync(_:)` | `PennyUI/Sync/LedgerSyncLifecycle.swift` | Puts the model in the environment, starts it, forwards scene phase |
| `AccountWorkspace` | `PennyData/Workspace/AccountWorkspace.swift` | The shell's `LedgerWorkspace` for a signed-in account, over the model ([native shell](ios-shell.md#sync-status)) |
| `LedgerChange.revert` | `PennyDomain/Ledger/LedgerRevert.swift` | The inverse change the shell's Undo saves |

## Persistence schema

Each account (`AccountScope`: server URL and lowercased email) has one JSON file in `Application Support/Penny/Ledgers/` in the app's own container, named `ledger-<first 16 bytes of SHA-256("<server>\n<email>") in hex>.json`. It is not in the App Group: widgets get their own reduced snapshots (MAZ-80).

```json
{
  "format": 1,
  "server": "https://penny.example.com",
  "email": "alex@example.com",
  "baseRevision": 12,
  "base": { "version": 4, "currency": "CAD", "...": "the last ledger the server acknowledged" },
  "local": { "version": 4, "currency": "CAD", "...": "base plus this device's unsynced changes" },
  "lastSyncedAt": "2026-11-10T14:03:00Z",
  "savedAt": "2026-11-10T14:05:12Z"
}
```

- `base` and `local` are v4 wire ledgers exactly as the API sends them (optional fields omitted, never `null`). Pending work is the difference between them; there is no separate queue that could disagree with it.
- The record repeats the server and email. A file whose record names another account is refused (`wrongAccount`), so a misplaced file is never shown to the wrong person.
- **Writes** go to a temporary file in the same directory, are flushed with `F_FULLFSYNC` (falling back to `fsync`), renamed over the old file, and the directory is flushed. A crash or power loss leaves the old file or the new one, never a mix; a stray temporary file is ignored. A save is acknowledged only after this write returns.
- **Protection.** Files are `completeUntilFirstUserAuthentication`, so a sync after a restart can run once the device has been unlocked once. The directory is excluded from backups: the server holds the backed-up copy, and restoring stale pending work onto a new device could undo newer edits.
- **Migrations.** `format` is the schema version. A build reads its own format and refuses a higher one (`newerFormat`, shown as "update the app") without touching the file. A future format change must read every earlier format and rewrite it only after a successful read; it must never drop `local`. Ledger versions inside the file follow the wire rules: v1–v3 are upgraded on read, unknown versions are refused (`LedgerMappingError`). The Expo app's AsyncStorage ledgers (`penny:ledger:<email>` under the server namespace) are imported by MAZ-72.

## Saving

`LedgerSyncModel.save(_ change: LedgerChange)` → `LedgerSyncEngine.commit`:

1. Refuse if the ledger was never downloaded (`notLoaded`), the copy is unreadable (`storageUnreadable`) or the account is signing out or switching (`unavailable`).
2. Apply the change to `local`. A rule refusal (`LedgerRuleError`, including "changed on another device" stale checks) throws `rule(_)`.
3. `Recurrence.materialize` with the device's local date.
4. Refuse a change that introduces a problem the server would reject (`Ledger.violations` not already present before the change): `invalid(_)`. A ledger that already breaks a rule, such as a rule past 2100, does not block later saves.
5. Write the file. A failed write throws `writeFailed`; the ledger on screen and on disk are unchanged, so the person keeps the draft.
6. Return a `SaveReceipt` (`savedOffline` when it is waiting for the network) and start a sync.

Saves are allowed while a sync is running; the sync merges them (below). The legacy app refused them ("Sync is finishing").

## Sync

One sync runs per account at a time; a second request joins it. A pass:

1. `GET /api/ledger`.
2. If there are pending changes, `LedgerMerge.merge(base, local, remote)`, then `Recurrence.materialize`. If the result equals the server's ledger, nothing is written.
3. Otherwise check `Ledger.violations`, then `PUT` it on the revision just read.
4. On 409, wait (`ConflictRetryPolicy.standard`: 0.2, 0.4, 0.8, 1.6 s plus up to 50% jitter), re-read and go back to 2, up to five attempts. Then the sync fails with `conflictRetriesExhausted` and retries later; nothing is lost.
5. The server's answer becomes `base`. Saves made while the sync ran are merged on top (`merge(base: the local that was sent, local: the local now, remote: the answer)`) and stay pending; another pass (at most three per sync) sends them.

A write is a whole-ledger compare-and-swap, so repeating it after an ambiguous failure (timeout after the server committed) either applies once or answers 409 and re-merges to the same result: no duplicates. If the server accepted a write but the device could not record it (`storageWriteFailed`), the next sync finds the server already has the changes, writes nothing and records the result.

### Conflict policy

Field by field, by record id, in every list (accounts, trips, categories, entries, rules):

| Situation | Result |
| --- | --- |
| A record only the server changed | The server's version |
| Different fields changed on each side | Both changes survive |
| **The same field changed on both sides** | **This device's value wins** (the device that syncs last decides), as in the legacy app |
| Deleted here, edited on the server | Deleted |
| Edited here, deleted on the server | Comes back with this device's version (legacy behavior) |
| Unchanged here, deleted on the server | Deleted |
| Created here | Appended after the server's records |
| Currency | This device's change wins, otherwise the server's |

Personal recurrence refinements (v2; not in the legacy merge), where an occurrence is "untouched" when it equals what its rule generates for its date:

- When both sides advanced a rule's `nextDate`, the later one wins, so a date already consumed is not recorded again.
- An occurrence both devices recorded keeps the server's copy when this device's is untouched, so an edit made on the other device is kept.
- An untouched occurrence this device recorded is dropped when the server's rule is already past its date and the server does not have it (recorded there and deleted).

Occurrence ids are `{ruleId}:{date}`, so materializing again after any merge adds nothing that exists. Golden cases: `contracts/fixtures/merge-conflicts.json`, plus the recurrence cases in `LedgerMergeTests`.

### Sync triggers

| Trigger | Source |
| --- | --- |
| Sign-in, launch with a saved session, re-sign-in after expiry | `LedgerSyncModel` follows `AuthController.state` |
| Every save | `save(_:)` |
| The network returns | `SystemNetworkMonitor` (`NWPathMonitor`) |
| The app becomes active | `sceneDidBecomeActive()` (also re-reads a copy that was locked and records due occurrences), wired by `View.ledgerSync(_:)` |
| The calendar day, clock or time zone changes | `SystemCalendarDayMonitor`: records due occurrences, then syncs |
| Retry | `syncNow()` ("Retry" in the offline banner): runs even if the monitor reports no network, and resets backoff |
| Failure that can pass | `SyncBackoff`: 15 s doubling to 5 min, or the server's `Retry-After` if longer |

`offline` waits for the network. `rejected` (400/403/413, or a merge the server would refuse) and `incompatibleServerData` do not retry by themselves: the next save or `syncNow()` tries again. Backgrounding cancels retry timers; there is no background sync task yet.

## Failure handling

| Failure | Behavior |
| --- | --- |
| Process killed after a save | The save was on disk before it was acknowledged; the next launch shows it as pending and syncs it |
| Disk write fails on save | `LedgerSaveError.writeFailed`; nothing changes |
| Disk write fails after the server accepted | `SyncIssue.storageWriteFailed`; retried; converges without duplicates |
| Copy cannot be read (damaged, truncated) | `storageUnreadable`: saves refused, nothing sent, counted as one pending change for sign-out. `recoverUnreadableStorage()` moves the file aside (`…unreadable-<time>.json`, removed with the account) and downloads again; changes that only existed in it cannot be recovered |
| Copy locked (before first unlock) | `storageUnavailable`; read again on foreground; never treated as damaged |
| Copy from a newer app | `storageNewerFormat`; left untouched |
| No network, server down or restarting | `offline`, `serverUnreachable`, `serverUnavailable`; retried; pending work kept |
| Repeated 409 | Up to five merged attempts per sync, then `conflictRetriesExhausted` and backoff |
| 401 | The engine changes nothing; the model calls `AuthController.sessionDidExpire(for:)` for the account the request was made for, and shows `.sessionExpired` with the pending count. Signing in again as the same account resumes the sync |
| Account switch while a sync is in flight | The model drops answers from an earlier generation; the old engine only ever writes its own account's file, and only accepts a client of its own account. A late 401 for the previous account does not end the new session |
| Sign-out while a sync is in flight | `remove()` cancels it and marks the engine removed; a late answer cannot recreate the file |

## Sign-out and cache clearing

`OfflineLedgerStore` implements `AccountLocalData`. `AuthController.signOut()` refuses with `pendingChanges(count)` while anything is pending (an unreadable copy counts as one); **Sync, then sign out** calls `syncPendingChanges`, which throws unless everything was acknowledged (a 401 is rethrown so the session ends, with nothing removed). Only **Sign out anyway** (`discardingPendingChanges: true`) removes pending work, and only after the person chose it. Removal deletes the account's files, including set-aside copies. `storedScopes()` lists accounts with data on the device, so leftovers can be offered for removal after a relaunch. There is no other cache-clearing path.

An email change on the server (`moveLocalData`) merges the old scope's pending work onto the new scope before the old file is removed.

## Online-only actions

Shared household actions and receipt uploads are not queued: they call `AuthController.client` directly and need the network. Gate them on `LedgerSyncModel.canUseOnlineOnlyActions` (online, signed in, not signing out, session not expired). An entry that references an already uploaded receipt can be saved offline like any other edit.

## Local search and server results

- `localSearch(_:kind:day:)` searches this device's `local` ledger, so pending creates and edits are found and pending deletes are not (`LedgerReport.search`, the legacy substring rule). Shared projections are not cached on the device yet, so offline results are personal entries only.
- `searchesLocally(serverHasSearch:)` is true with pending changes, offline, or against a server without search v1; the screen then shows local results ("On this device") and never mixes them with server pages ([search](migration/search.md#offline-pending-edits-and-demo)).
- Tag each server search with `searchEpoch` and pass the page to `reconcile(_:startedAt:)`: `.searchAgain` when the ledger or the account changed since the search started (a save or sync landed, so the page may show a deleted or stale row), `.useLocalResults` when changes are pending or the device is offline, otherwise `.show(page)`.
- `SearchResults` accumulates pages of one search and keeps each result key once, so a shared expense that moves between pages is not listed twice.

## Sync state for the UI

`LaunchView` creates one `OfflineLedgerStore.standard()` and one `LedgerSyncModel` for the app, passes the store to `AuthController` and applies `.ledgerSync(model)`. The MAZ-69 shell does not read the model directly: `AuthGate` hands it to `AppServices.accountWorkspace`, which wraps it in an `AccountWorkspace` for each signed-in account's shell. That adapter maps the phase to the shell's load and sync status, `SyncIssue` to the banner's problem and `LedgerSaveError` to the form's `SaveFailure`, routes Retry to `syncNow()` and the load error's action to `recoverUnreadableStorage()` (unreadable copy) or a re-read (locked copy), and implements Undo by saving `LedgerChange.revert`. The full mapping is in [native shell, Sync status](ios-shell.md#sync-status). The demo never receives the model. Other views can still read it with `@Environment(LedgerSyncModel.self)`.

| API | Use |
| --- | --- |
| `ledger: Ledger?` | The ledger to show (server + pending). Nil while signed out or before the first download |
| `state.phase` | `signedOut`, `loading`, `upToDate`, `syncing`, `pending`, `offline`, `failed(SyncIssue)`, `sessionExpired`, `storageUnavailable`, `storageUnreadable`, `storageNewerFormat` |
| `state.pending.count`, `state.pending.entryIDs`, `state.pending.deletedEntryIDs` | "Offline · 2 changes waiting", "Waiting to sync" rows |
| `state.lastSyncedAt` | "As of last sync" |
| `isOnline`, `canUseOnlineOnlyActions` | Network banner, disabling shared actions and receipt uploads |
| `save(_:) async throws(LedgerSaveError) -> SaveReceipt` | Save; on error show `LedgerSaveError.message` and keep the draft; `receipt.savedOffline` can pick "Saved on this device" (the shell's toast does not use it yet; its offline banner says the same) |
| `syncNow()` | Retry button |
| `recoverUnreadableStorage()` | Recovery action for `storageUnreadable` |
| `sceneDidBecomeActive()`, `sceneDidEnterBackground()` | Already called by `.ledgerSync(_:)` |
| `localSearch`, `searchesLocally`, `searchEpoch`, `reconcile` | Search screens (MAZ-73) |

Drafts are view state: a failed save, an expiry or a reconnect never touches them, and the model never discards one. App lock (MAZ-69) only conceals content.

## Offline limitations

- The whole ledger is rewritten on every save and sync (as the legacy app did with AsyncStorage). That is fine for typical ledgers; at the 100,000-entry limit each save writes several megabytes.
- No background sync: changes sync when the app is next active and online.
- Shared household data, settlement, receipts and server search need the network; nothing shared is cached offline yet.
- The same-field policy is last-sync-wins for this device; there is no per-field conflict prompt.
- An edit of an entry another device deleted brings it back (legacy behavior, kept deliberately).

## Tests

| Suite | Covers |
| --- | --- |
| `LedgerMergeTests` (PennyDomainTests) | `merge-conflicts.json` and the parity merge case; every stored property merges; independent and same-field edits; both devices recording, editing or deleting the same occurrence; server-skipped dates; `PendingChanges` |
| `OfflineLedgerStoreTests` (PennyDataTests) | Round trip and format 1, wrong account, interrupted write (stray temp file), disk full, backup exclusion, listing and removal; pending count, failed and expired "Sync, then sign out", email move |
| `LedgerSyncEngineTests` | Kill and relaunch with pending work, offline create/edit/delete, save before download, rule refusals, new versus existing violations, failed disk writes before and after the server accepted, corrupt and newer-format copies and recovery, locked file, independent edits through a 409, same-field policy, repeated 409s then success, joined syncs, saves during a sync, 401, 503 then timeout then restart, 400, unknown server ledger version, another account's client, removal during sync, recurrence across midnight and devices |
| `LedgerSyncModelTests` | Real `AuthController` with a fake server: first download, offline save then kill, relaunch and reconnect, session expiry and re-sign-in, sign-out refused with pending work (including an unreadable copy) and recovery, late answers after an account switch, backoff after 503, no automatic retry after 400, day change, foreground pull, search reconciliation and de-duplicated pages |
| `AccountWorkspaceTests` | The shell adapter over the same harness: phase, issue, storage and save-error mapping; an offline save shown as pending, on disk, then synced on reconnect; refused saves; Undo synced, refused after another device's edit, and only once; session expiry; unreadable-copy recovery through `reload()`; nothing shown or saved for another account |
| `LedgerRevertTests` (PennyDomainTests) | Undo restores the ledger exactly, keeps unrelated work synced since, refuses a record changed since and a currency under entries |

Run `apps/ios/scripts/ios.sh package-test`; `ios.sh ci` also runs them on clean iPhone and iPad simulators. The simulator journey against the real .NET/PostgreSQL stack (offline save, relaunch, sync and search refresh, with the full-stack test environment's fault controls) needs XCUITest and is MAZ-81's; the shell shows these states through `AccountWorkspace` ([native shell](ios-shell.md#sync-status)), and the entry screens are MAZ-73.
