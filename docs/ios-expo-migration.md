# Upgrading Expo iOS installs to the native app (MAZ-72)

[Documentation](README.md) · [Native iOS app](../apps/ios/README.md) · [Offline sync](ios-offline-sync.md) · [Sign-in](ios-authentication.md) · [App shell and lock](ios-shell.md) · [Architecture ADR 003](migration/architecture.md#adr-003-compatibility-and-client-migration)

The native app replaces the Expo app in place: same bundle id (`com.mfalicoff.penny`), same App Group, same app container. On its first launch it imports what the Expo app stored on the device, so nobody loses unsynced entries, their lock, their appearance, their server or (where possible) their sign-in. The importer is `ExpoMigration` in `apps/ios/Packages/PennyKit/Sources/PennyData/Migration/`.

## Decision: an in-place importer, no bridge release

There is no "bridge" Expo release that drains pending changes first. The native app reads the Expo stores in their own formats, imports them, and keeps them until the imported data has synced. Reasons:

- Every Expo store is readable from the native app: AsyncStorage is files in the same container, SecureStore items are in the same Keychain access group (same bundle id and team), and the App Group is the same.
- A bridge release only helps people who open it while online before updating; anyone who updates later, or offline, would still need an importer. A reminder to sync is not enough (ADR 003).
- Keeping the Expo data until sync means an offline first launch, a failed sync or an expired session never loses anything.

## What the Expo app stored (audit of released builds)

Released builds are 1.0.0 (2026-10-25) and later; the offline ledger (2026-10-18) and server choice (2026-10-24) were both in 1.0.0, so every released build uses the formats below. Before the offline ledger, no ledger was stored on the device.

| Store | Key | Value | Scoped by server | Imported into |
| --- | --- | --- | --- | --- |
| AsyncStorage | `penny:server-connection` | `{"url","legacyUrl","version"?}` | never | `penny.auth.server` (only if the native app has none) |
| AsyncStorage | `penny:active-account` | the signed-in email | yes | used as the session's email |
| AsyncStorage | `penny:ledger:<lowercased email>` | `{"base": ledger, "local": ledger}`, ledger v4 (v1–3 also accepted) | yes | `LedgerFileStore` file for (server, email): `base`, `local`, revision 0, never synced |
| SecureStore | `penny-session` | 64-hex session token | yes | `KeychainSessionStore` for that server, when its email is known and the native app has no session there |
| SecureStore | `penny-theme` | `light`, `dark`, `amoled`, `catppuccin` | never | `penny.appearance` via `AppearancePreference(legacy:)`: AMOLED and Catppuccin become Dark |
| SecureStore | `penny-app-lock` | `true` / `false` | never | `KeychainAppLockSettingStore` (only ever turned **on**) |
| App Group defaults | `__expo_widgets_<kind>_layout`, `__expo_widgets_<kind>_timeline` | expo-widgets snapshots (derived from the ledger) | — | nothing: derived data, removed at the first native launch; the native widgets write their own `Widgets/snapshot.json` ([widgets](ios-widgets.md#widget-data-schema)) |

Server scoping (`serverStorageKey`): keys for the build's original server (`legacyUrl`) are unscoped; keys for any other server end in `.` plus each code point of the server URL in lowercase hex joined by dots (`https://a.test` → `68.74.74.70.73.3a.2f.2f.61.2e.74.65.73.74`). Emails may contain dots, so the importer takes the leftmost suffix that decodes to an HTTP(S) URL and encodes back to exactly the same text. Every ledger under every server is imported, not only the current one.

Entry drafts, filters and OIDC transactions were memory-only in the Expo app; there is nothing to import. Receipts in ledgers reference server receipt ids, so they import as is.

### On-disk formats

- **AsyncStorage** (`@react-native-async-storage/async-storage` 2.2): `Library/Application Support/com.mfalicoff.penny/RCTAsyncLocalStorage_V1/manifest.json`, a JSON object of every key. Values up to 1024 UTF-16 units are inline; longer ones (every ledger) are `null` in the manifest and stored in a file named by the lowercase MD5 hex of the key. Pre-1.12 installs used `Documents/RCTAsyncLocalStorage_V1`, which the importer reads only when the current location has no manifest. `ExpoAsyncStorage` reads and edits this format, so a rollback build still reads it.
- **SecureStore** (`expo-secure-store` 57): generic passwords, service `app:no-auth` (`app` before SDK 50), account and generic attribute = the key's UTF-8 bytes, accessible `WhenUnlocked`. `ExpoSecureStore` never reads `app:auth` (Penny never used it, and reading it could prompt).

## How the import runs

`AppServices.live()` runs `ExpoMigration.run()` synchronously at launch, before the lock, the sign-in state and the offline store read anything. It is local only (no network). Order:

1. **Lock first.** If the Expo lock was on, or its value is damaged (the Expo app stayed locked then too), the native lock is turned on. If the Keychain cannot be read yet (device not unlocked since restart) or the native setting cannot be saved, `ExpoImportingLockStore` makes the lock's read fail, so `AppLockController` stays concealed with Try again until it can. A first native launch can therefore never show an app the Expo build kept locked.
2. **Appearance**, then the **server choice** (never replacing one the native app already has).
3. **Ledgers.** Each Expo record becomes the native file for its (server, email). If a native file already exists, the Expo pending changes (`local` vs `base`) are merged onto it with `LedgerMerge`; nothing native is overwritten. The Expo app kept no revision, so the import uses revision 0; the sync engine always reads the server before writing, so the first sync merges the pending changes onto whatever the server holds (as the Expo app did).
4. **Sessions.** For each server with a token and a known email, the session is saved natively unless that server already has one. On the first native launch the native leftover-session purge (`AuthController`) runs first, so it does not delete the imported session. `AuthController.restore` then verifies it with `/api/auth/me`: an expired token signs the person out (see reauthentication below).
5. **Retirement.** An Expo ledger record is removed only when the native ledger for it has synced after the import with nothing pending (or was removed by a sign-out the person agreed to). When every Expo ledger is gone, every session was handled and the lock was applied, the rest of Penny's Expo keys and Keychain items are removed and the import is finished. Keys other libraries wrote are never touched.

A durable journal (`Application Support/Penny/Migration/expo-import.json`: SHA-256 fingerprints and flags, no tokens or ledger contents) makes every step repeatable:

| Situation | What happens |
| --- | --- |
| Repeated launch | Records with an unchanged fingerprint are skipped; native edits since the import are never undone. |
| Crash between the ledger write and the journal write | The next launch finds the native file equal to the Expo record and only records it. |
| Ledger write fails (disk full), store unavailable (before first unlock) | Nothing is recorded; the Expo data stays; the next launch retries. Status `retryLater`. |
| Damaged Expo record or manifest, unknown ledger version, unscoped record with no saved server | Kept untouched forever; other accounts import normally; the import never finishes, so the rest of the Expo data stays too. Status `needsAttention`. |
| Offline first launch, failed sync | Imported entries are pending; the Expo records stay until a sync succeeds. |
| Expired session (reauthentication) | Sign-in is asked again. The imported ledger stays under (server, email); signing in again as the same account shows and syncs it, and only then is the Expo record removed. Signing in as someone else never shows it. |
| Token without a known email (the Expo app had forgotten the account after a 401) | Not imported (`sessionNeedsSignIn`); the entries are imported and wait for that account's sign-in. |
| Several accounts or servers | Each imports into its own scope; the current server's session becomes the native session; other servers' sessions are imported too. |
| Leftover Keychain items after the Expo app was deleted and the native app installed fresh | The lock (if on) and theme are applied; a token is never imported without the app's own AsyncStorage (that would restore a session nobody expects). The items are then removed. |
| Journal damaged | Restarted (`journalReset`); records already imported are recognised by content. |

## Diagnostics

`ExpoMigration.run()` returns an `ExpoMigrationReport` (kept in `AppServices.expoMigration`) with a status (`nothingToImport`, `waitingForSync`, `finished`, `retryLater`, `needsAttention`), one outcome per Expo ledger and notes. Its `lines` leave out emails and tokens and are logged at each launch with subsystem `com.mfalicoff.penny`, category `ExpoMigration`:

```sh
log show --last 1d --predicate 'subsystem == "com.mfalicoff.penny" AND category == "ExpoMigration"'   # sysdiagnose / Console
xcrun simctl spawn booted log show --last 1h --predicate 'subsystem == "com.mfalicoff.penny" AND category == "ExpoMigration"'
```

The journal file shows which records were imported and retired. When the import needs the person, Settings starts with a row that says what happened and what to do (`ExpoImportNotice`, accessibility id `settings.expoImport`): a locked device or an unopenable store ("Unlock this device and reopen Penny"), a native ledger that couldn't be written ("Free some space"), a record whose server is unknown ("Choose the server you used"), or a damaged or newer record (kept untouched; updating Penny may import it). Nothing shows when there was nothing to import, the import finished, or it waits for a sync.

## User guidance

- Update from the App Store or TestFlight as usual; there is nothing to do first. Opening the Expo app online once before updating makes the first native launch shorter, but is not required.
- If Penny was locked before, it is locked after the update. The appearance follows: AMOLED and Catppuccin become Dark.
- If Penny asks you to sign in again, sign in with the same account: entries you saved offline reappear and sync. Don't delete the app before they have synced: deleting removes them, as it did before.
- If entries from before the update are missing, keep the app installed and contact support with a sysdiagnose: damaged Expo data is never deleted.

## Rollback limits

- Installing an older Expo build over the native app (TestFlight only; the App Store does not downgrade) finds its own stores as they were, minus the ledger records already retired (those accounts had synced, so the Expo app downloads them again). Until the import finishes it keeps its server choice, sessions and settings. Changes made in the native app reach the Expo app only through the server.
- After the import finished, the Expo stores are gone: a rolled-back Expo app starts signed out on its build's default server with default settings, and downloads the ledgers again from the server.
- Going forward again after a rollback imports only Expo records that changed since the last import (by fingerprint), merging their pending changes onto the native ledger. The lock and sessions are re-checked; a server choice is never replaced.
- Native data never flows back into Expo formats, and the native widget snapshots (MAZ-80) do not reuse the Expo widget keys. A rolled-back Expo app finds its widget keys gone and shows its widgets empty until it writes them again.

## Tests and rehearsal

- `PennyDataTests/ExpoMigrationTests.swift` (host): the formats (scoping, MD5 overflow files, damaged manifest, deprecated location, SecureStore services), and the import with unsynced entries, repeated launch, interrupted import, damaged journal, native-ledger merge, rollback re-import, multiple accounts and servers, a token without an account, existing native choices, the first-launch purge, damaged and unknown-server ledgers, damaged manifest, failed writes, the lock (on, damaged, off, unreadable Keychain, unsavable setting) and retirement only after a real sync, including offline and reauthentication. Fixture data only.
- `PennyTests/ExpoSecureStoreKeychainTests.swift` (simulator): items written exactly as expo-secure-store writes them are read and removed through the real Keychain; the AsyncStorage location matches the app's container.
- **Upgrade rehearsal (Debug only).** Launching with `PENNY_TEST_EXPO_FIXTURE=upgrade` (`Penny/ExpoUpgradeFixture.swift`, behind `PENNY_TEST_CONTROLS`) writes an Expo install into the container in the Expo formats (lock on, AMOLED, an offline server, a signed-in account with an unsynced entry, an account on a second server without a session, a damaged ledger) and skips the import; the next launch without the variable is the upgraded first launch. With `xcrun simctl launch`, pass it as `SIMCTL_CHILD_PENNY_TEST_EXPO_FIXTURE=upgrade`; MAZ-81's UI tests can set it in `launchEnvironment`. Rehearsed on a fresh iPhone simulator (iOS 27 runtime, Xcode 27.2): the first native launch showed the lock cover in Dark, both readable ledgers imported with the pending entry, the damaged record and all Expo keys kept, the session and server imported; a repeated launch and a launch after deleting the journal left the native files byte-identical.
- Not rehearsed: an upgrade from an actual Expo binary (the fixture writes the same formats from the native app instead) and a physical-device TestFlight upgrade (MAZ-98).
