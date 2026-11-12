# Native app shell, settings, lock and demo (MAZ-69)

[Documentation](README.md) · [Native iOS app](../apps/ios/README.md) · [Redesign baseline](migration/redesign.md) · [Native sign-in](ios-authentication.md)

This page describes the SwiftUI shell that MAZ-69 adds to `apps/ios`: the navigation for iPhone and iPad, the shared components, the settings, the biometric app lock, the temporary demo and the loading, empty, offline and error states. It follows the iOS-native redesign in [`docs/design/penny-ios`](design/penny-ios/README.md) and [`contracts/design-baseline.json`](../contracts/design-baseline.json) (MAZ-132). The feature screens behind it (entries, households, trips, recurring, insights) belong to MAZ-73 to MAZ-77; Accounts, Categories and Recurring are described in [organize](ios-organize.md) (MAZ-74).

> MAZ-69's description predates MAZ-132. It names AMOLED and Catppuccin, DM Sans, a More tab, 52px controls and 48px targets, and Penpot specimen names. The baseline replaced those decisions: light and dark only, SF Pro and SF Symbols, Home / Activity / Shared / Trips with Settings as a sheet, and the design-kit sizes (44pt minimum target). This implementation follows the baseline. The table at the end maps the old specimen names to the cards.

## Where the code is

| Module | Files | What |
| --- | --- | --- |
| PennyDomain | `Navigation/ShellRoute.swift` | `AppTab`, `DetailRoute`, `SettingsRoute`, `SidebarItem`, `ShellRoute` (all navigation state and rules) and `DeepLinkInbox` (links waiting for sign-in and unlock) |
| PennyDomain | `Demo/DemoLedger.swift` | The made-up sample ledger, dated around today, with `demo-` ids |
| PennyData | `AppLock/` | `AppLockController`, the `DeviceAuthenticator` protocol and its LocalAuthentication implementation, and the Keychain setting store |
| PennyData | `Preferences/DevicePreferences.swift` | Appearance (system, light, dark) and the legacy theme mapping |
| PennyData | `Workspace/` | The `LedgerWorkspace` protocol and `SyncStatus`, `AccountWorkspace` (a signed-in account over the MAZ-71 offline engine), `DemoWorkspace` and `FixedWorkspace` |
| PennyDesign | `Components/` | `MoneyText`, `MoneyFormat`, `HeroAmount`, `GlassIconButton`, `GlassCapsuleButton`, `PennyButton`, `PennyMark`, `pennyCard`, `StatusBanner`, `SaveToast`, `PennyStateView`, `CategoryIcon`, `CategoryStyle`, `ControlSize` |
| PennyUI | `Shell/`, `Home/`, `Activity/`, `Together/`, `Settings/`, `Specimens.swift` | The shell (tab bar and split view), Home, Activity, Shared, Trips, Settings and its pages, the lock cover, the toast and banners, and Xcode previews named after the cards |

`RootView` owns what is per device: the appearance, the lock that covers everything and the deep-link inbox. `LaunchView` owns the app's one `OfflineLedgerStore` and `LedgerSyncModel` (MAZ-71) and keeps `.ledgerSync` attached. `AuthGate` shows the sign-in flow, the shell for a signed-in account (an `AccountWorkspace` over that model), or the demo.

## Navigation

### iPhone (and any compact width)

- The system iOS 26 `TabView`: **Home**, **Activity**, **Shared** and **Trips**, a floating Liquid Glass tab bar. There is no More tab.
- **Add entry** is the separate circular button at the trailing end of the tab bar. It is a `Tab` with the search role; selecting it opens the Add entry sheet and never becomes the selected tab. On the iOS 26 and 27 simulators it renders as a fifth item inside the glass bar ("Add entry"), not as a separate copper circle, and iOS doesn't let one tab item have its own tint. This is a recorded adaptation ([redesign](migration/redesign.md#native-implementation-notes-maz-69)).
- **Settings** opens as a sheet from the gear button in Home's toolbar. Recurring, Accounts and Categories (the old More tab) are its Manage pages.
- Each tab keeps its own navigation stack. Choosing the tab that is already shown returns it to its root.

### iPad (regular width)

- `NavigationSplitView`. The sidebar lists Home and Activity; **Together**: Shared and Trips; **Manage**: Recurring, Accounts and Categories. Its footer shows the account with its sync status and a glass Settings button. An Add entry button sits in the sidebar toolbar.
- Settings and the Manage pages open in the detail column, not as a sheet. Add entry is a sheet.
- iPad in Slide Over or a narrow Split View is compact and uses the iPhone layout. Both layouts read and write one `ShellRoute`, so resizing keeps the place.

The households and trips listed directly in the sidebar, the Insights item and the dashboard Home arrive with their features (MAZ-75–77).

### Rules (`ShellRoute`)

- A deep link shows its destination from that tab's root, so Back always leads to the tab's root. It closes Settings or Add entry if one would hide the destination. When the destination is Settings and Add entry is open, Add entry closes first and Settings opens once it has gone (`ShellModel.navigate`, as for the edit sheet): SwiftUI can't present one sheet in the update that dismisses another.
- `/entries/new` opens Add entry over whatever is shown and closes only Settings.
- Settings links (`/accounts`, `/categories`, `/recurring`) open Settings at that page; on iPad they select the Manage row.

### Deep links

Every legacy route keeps a destination (`DeepLink`, MAZ-66; [legacy deep links](migration/redesign.md#legacy-deep-links)).

| Link | Destination |
| --- | --- |
| `penny:///` | Home |
| `penny:///transactions` | Activity |
| `penny:///entries/new`, `penny://entries/new` (widget) | Add entry sheet |
| `penny:///accounts`, `/categories`, `/recurring` | Settings › that page (iPad: the Manage row) |
| `penny:///households`, `/households/{id}`, `/households/{id}/expenses/{expenseId}` | Shared tab, then the household, then the expense |
| `penny:///trips`, `/trips/{id}` | Trips tab, then the trip |
| `penny://auth/callback` | Never a destination: callbacks return through the authentication session (MAZ-68) |
| Anything else with the `penny` scheme | Home |

A link that arrives while signed out, while the session is being restored or while the app is locked waits in `DeepLinkInbox`. It opens once the shell is showing and the lock is open, never behind the lock. A newer link replaces an older one. A link belongs to the session showing when it arrived (`DeepLinkSession`, kept current by `AuthGate`): one that arrived while an account was signed in opens only in that account, and another account's shell drops it, so a link kept from before a sign-out never opens in the next account. A link that arrived while no session showed opens in the next account. The demo opens only links that arrived during the demo; an account's link waits through it.

Household and expense links open their pages (MAZ-75, [native households](ios-households.md)); `penny://join` invite links wait in `InviteHandoff` instead of the inbox, for an account on the server they name. A link to a trip that isn't on the device shows "Trip not found".

## Components and tokens

PennyDesign keeps the tokens of the baseline (`Tokens.swift`, checked by `TokenBaselineTests`) and adds components that follow `design-kit/docs`:

- **Money.** `MoneyText` and `MoneyFormat`: expenses have a typographic minus and the label color, never red; income has a plus and is green; investments are indigo and unsigned; pending is amber. Digits are tabular so amounts line up. VoiceOver hears the meaning in words ("$48.90 spent"), not a symbol.
- **Hero.** `HeroAmount`: the one large number of a screen with smaller, muted cents. It scales with Dynamic Type relative to the large title and shrinks instead of truncating.
- **Glass.** `GlassIconButton` (round toolbar controls, sheet × and ✓, the tinted primary action) and `GlassCapsuleButton` (the month picker) use `pennyGlass`, which is `.glassEffect` and an opaque surface under Reduce Transparency. Toolbars, the tab bar, search fields and sheets are system controls, so they are Liquid Glass without help. Money, lists and cards (`pennyCard`) are always solid.
- **Feedback.** `StatusBanner` (offline, error, info, demo), `SaveToast` (glass, with Undo) and `PennyStateView` (loading, empty, offline, error, unavailable).
- **Sizes.** `ControlSize`: buttons 50pt, glass buttons 44pt, the floating button 62pt, rows 60pt. Every control is at least `Metrics.minTouchTarget` (44pt) and grows with Dynamic Type through `@ScaledMetric`.
- **Icons.** SF Symbols only. `CategoryStyle` maps the legacy Ionicons names stored in categories to SF Symbols and category ids to the category palette, which never reuses a meaning color. The leaf mark is `PennyMark` (`leaf.fill` on copper).

## Supported devices and accessibility

- iPhone and iPad on iOS/iPadOS 26.0 or later (the app's minimum, MAZ-66), portrait and landscape, with the iPad in full screen, Split View and Slide Over. Every supported device has the Liquid Glass material, so there is no older-OS fallback. AMOLED doesn't exist anymore; dark is true black, and glass over it follows the system.
- **Dynamic Type.** All text uses system text styles; the hero and control sizes scale with `@ScaledMetric`. Rows wrap rather than truncate titles, and the Follow your money numbers move to a column when they don't fit.
- **VoiceOver.** Amounts read their meaning, rows read as one element, icon-only buttons have labels, selected tabs, filters and options carry the selected trait, and the save toast is announced.
- **Contrast and color.** Copper text uses `tintText`, which has enough contrast on light surfaces. Meaning is also given in text or an icon, never by color alone.
- **Reduce Transparency.** Custom glass becomes an opaque surface with a separator edge; system controls adapt by themselves. Money never sits on glass.
- **Reduce Motion.** The toast fades instead of sliding.
- **Keyboard and focus.** Settings uses system lists and pickers. When the lock covers the app, the focused field is resigned (its text stays) so typing can't reach a hidden draft. Full keyboard forms are MAZ-73.
- **Safe areas.** Content scrolls under the floating tab bar; the toast sits above it. Nothing uses fixed card geometry.

## Settings

| Setting | Where it's stored | Behavior |
| --- | --- | --- |
| Appearance: System (default), Light, Dark | `UserDefaults` (`penny.appearance`), this device only | Applied at the root with `preferredColorScheme`. A legacy `amoled` or `catppuccin` theme maps to Dark, `AppearancePreference(legacy:)`; The Expo value is imported at the first native launch ([Expo upgrade](ios-expo-migration.md)). Text size follows the device. |
| Currency: CAD, USD, EUR or GBP | The ledger (through the workspace) | The four currencies `contracts/openapi.json` allows. Locked, with the legacy message, once the ledger has entries or recurring rules, as the ledger rule does; locked while in an active household ("Currency is locked while you're in a household."), which the server enforces (`Your ledger currency must match your active households.`). The household count comes from MAZ-75; until then only the ledger rule applies on the device. A change shows the save toast; a failure shows the save error and keeps the choice to retry. |
| Face ID lock | Keychain, this device only, not synced | See [App lock](#app-lock). |
| Server | The saved server (MAZ-68) | Read-only while signed in: "Sign out to change servers." |

When this launch's import of the Expo app's data needs the person (a damaged record set aside, an unknown server, a locked device or a full disk), Settings starts with a row that says what happened and what to do (`ExpoImportNotice`, `settings.expoImport`). Settings also shows the account with its sync status and Sign out (the MAZ-68 flow, which warns about unsynced changes), or Leave demo. An account's Settings has a **Notifications** row (MAZ-79, [native notifications](ios-notifications.md#permission)). The **Lock after** delay (MAZ-133) is not in this build.

## App lock

The legacy `AppLockProvider`, ported to `AppLockController` with the same rules:

- **Fails closed.** The app is concealed from launch until the setting has been read. If the Keychain can't be read (for example before the first unlock after a restart), the lock screen says so and offers Try again; it also retries when the app becomes active. It never opens on a failed read.
- **Conceals, doesn't unmount.** The lock screen is drawn in its own window above the app's windows, so it covers open sheets and alerts too, while everything underneath stays mounted: drafts survive. It shows no amount. The app is also concealed while inactive or in the background, so the app switcher snapshot shows no money, except while Penny's own prompt is up. `RootView` applies inactive and background to the lock synchronously (`AppLockController.setActivity`) in the scene-phase change itself, so the cover is up in the same update, before the system takes the snapshot; only becoming active, which may prompt, runs in a task.
- **One prompt at a time.** Unlock is single-flight. Going to the background cancels the prompt, invalidates its answer and ends the single-flight hold at once, so a success from before backgrounding can't open a later session, and a quick return that beats the cancelled prompt's answer still asks again. Returning from the background asks again.
- **Turning it on or off** asks for biometrics first (turning on accepts biometrics only, so the person proves the sensor works for them; turning off and unlocking accept the passcode too). The new value is saved before it takes effect; if saving fails, the previous setting stays and the screen says so.
- **Recovery.** Unlocking accepts the device passcode, so a biometric lockout or a removed face or finger doesn't lock the person out. A device with no passcode can't verify anyone: the lock screen says to set a passcode in Settings, then unlock.
- **Privacy outside the app.** Widgets and notification previews aren't covered by the lock; the setting says so. MAZ-79/80 keep their contents non-sensitive; an opened notification waits for unlock like any deep link ([native notifications](ios-notifications.md#privacy-and-gates)).
- The setting is in the Keychain (`com.mfalicoff.penny.app-lock`, `AfterFirstUnlockThisDeviceOnly`, not synchronizable). The Expo app's `penny-app-lock` value is imported before the lock first reads its setting: on (or damaged) turns the native lock on, and until the Expo value can be read and saved, the lock's read fails so the app stays concealed (`ExpoImportingLockStore`, [Expo upgrade](ios-expo-migration.md)).

## Demo

**Take a look around with sample data** on the sign-in screen, or **Try with sample data** on an empty Home, opens a temporary demo:

- Its ledger (`DemoLedger`) is made up and built fresh each time. It lives only in a `DemoWorkspace` object: never written to disk, never sent to a server, never mixed with an account's data, and gone when the demo ends. Two demos never share changes.
- It shows a banner on every root screen, "Demo · Changes are temporary", with Leave. Settings shows "Demo account" and Leave demo, and has no server or sign-out.
- Changes follow the real rules (the currency lock, for example) and show the save toast with Undo.

In Debug builds, launching with `PENNY_TEST_DEMO=1` (a test control, compiled out of Release) opens the demo directly, so UI tests and screenshots reach the shell without a server.

Limitations: the demo has no households, so Shared shows its "coming" state; Add entry is not available yet (MAZ-73), so the demo can't add entries; and a demo started from an empty Home replaces the account's screens until Leave demo, which returns to them unchanged.

## States, toast and haptics

| State | Where | Behavior |
| --- | --- | --- |
| Loading | Any screen with ledger data | "Loading your entries…" |
| Empty | Home (`empty-home`), Activity, Trips, Recurring, Accounts | Says what will appear and how to start |
| Offline | Banner on Home, Activity and Trips | "Offline · N changes waiting", that changes are saved on the device, and Retry. Waiting rows say "Waiting to sync" and Projected says "as of last sync" |
| Sync error | Same banner | "Couldn't sync · N changes waiting", the workspace's message and Retry |
| Load error | Full screen | The message and Try again; for a copy on the device that can't be read, Download again ([below](#sync-status)) |
| Save error | Inside the form (`save-error`) | "Couldn't save", the reason, "Your draft is kept", Try again; an error haptic |
| Saved | Toast above the tab bar (`saved-toast`) | The change and its detail (plus "Saved on this device" when the save waits for the network), Undo, a success haptic, a VoiceOver announcement; it disappears after four seconds |
| Not available yet | Shared, household links, Add entry | Says what isn't in this build yet, instead of an empty screen that looks broken |
| Can't open your entries | A copy on the device written by a newer Penny | Says to update Penny; the copy is left untouched |

## Sync status

The shell binds only to `LedgerWorkspace` (`PennyData/Workspace/LedgerWorkspace.swift`); nothing in the shell stores or syncs anything. For a signed-in account, `AppServices.accountWorkspace` returns an `AccountWorkspace` (`PennyData/Workspace/AccountWorkspace.swift`) over MAZ-71's offline ledger and sync engine ([offline sync](ios-offline-sync.md)).

```swift
@MainActor
public protocol LedgerWorkspace: AnyObject, Observable {
    var load: LedgerLoad { get }            // .loading, .ready(Ledger), .failed(WorkspaceProblem), .unavailable(String)
    var sync: SyncStatus { get }            // .upToDate(lastSynced:), .syncing(pending:), .offline(pending:lastSynced:),
                                            // .failing(pending:problem:), .signInRequired(pending:), .localOnly
    var pendingEntryIDs: Set<String> { get } // rows that show "Waiting to sync"
    var isDemo: Bool { get }
    func commit(_ change: LedgerChange, summary: ChangeSummary) async -> Result<SavedChange, SaveFailure>
    func undo(_ change: SavedChange) async -> Result<Void, SaveFailure>
    func syncNow() async                    // Retry in the offline or error banner
    func reload() async                     // Try again after a load error, pull to refresh
}
```

- `commit` succeeds once the change is kept on the device (offline included). Reaching the server is reported through `sync`, never as a save failure. A failure means nothing was kept: `.rule(LedgerRuleError)`, `.server(WorkspaceProblem)` for changes that need the server, `.storage` or `.unavailable`.
- `undo` reverts the toast's change and fails when it can no longer be undone.
- Implementations are `@Observable` classes, so SwiftUI follows changes to `load`, `sync` and `pendingEntryIDs`.

### The signed-in account: `AccountWorkspace`

`AccountWorkspace` stores nothing. It reads the app's one `LedgerSyncModel` and translates:

- **One model per app.** `LaunchView` creates the `OfflineLedgerStore` and the `LedgerSyncModel` once, passes the store to `AuthController` (so sign-out sees the pending count) and keeps `.ledgerSync(model)` attached, which starts the model and forwards foreground and background. `AuthGate` gives the model to `AppServices.accountWorkspace` for each account shell; one `AccountWorkspace` is made per shell (the shell is rebuilt for another account).
- **Only its own account.** It shows the model's ledger and pending rows only while the model's `state.scope` is its account. Otherwise it is loading and refuses saves, so a late update for a previous account never appears.
- **The demo never touches it.** `DemoWorkspace` is not given the model, and nothing in the demo writes to the store.

| `LedgerSyncState.phase` | `sync` | `load` without a ledger yet |
| --- | --- | --- |
| `upToDate` | `.upToDate(lastSynced:)` | loading |
| `loading`, `syncing`, `pending` | `.syncing(pending:)` ("Syncing…" with nothing waiting) | loading |
| `offline`, `failed(.offline)` | `.offline(pending:lastSynced:)` | failed, offline: "Connect to the internet to download your entries." |
| `failed(issue)` | `.failing(pending:problem:)` | failed with the same problem |
| `sessionExpired` | `.signInRequired(pending:)` | failed, session expired |
| `storageUnavailable` (locked before first unlock) | `.failing`, storage | failed, storage; Try again reads it again |
| `storageUnreadable` | `.failing`, `storageUnreadable` | failed even with a ledger shown before: **Download again** runs `recoverUnreadableStorage()` (the copy is set aside, not deleted) |
| `storageNewerFormat` | `.failing`, storage | `.unavailable`: "Update Penny to open them" (even with a ledger) |

Once a ledger exists, `load` is `.ready(ledger)` in every other phase, so offline and failing states keep showing the device's copy with the banner.

| `SyncIssue` | `WorkspaceProblem.kind` |
| --- | --- |
| `offline` | `offline` |
| `serverUnreachable` | `unreachable` |
| `serverUnavailable` | `server` |
| `rejected(message)` | `server`, with the server's message |
| `conflictRetriesExhausted` | `conflict` |
| `incompatibleServerData` | `server` ("Update Penny to sync") |
| `storageWriteFailed` | `storage` |

| `LedgerSaveError` | `SaveFailure` |
| --- | --- |
| `rule(error)` | `.rule(error)` |
| `writeFailed`, `storageUnreadable` | `.storage(message)` |
| `invalid`, `notLoaded`, `unavailable` | `.unavailable(message)` |

`.server` is not produced: shared expenses and receipts are online-only and never go through the offline ledger. Every failure leaves the ledger as it was, so the form keeps the draft.

Retry in the banner and Try again on a load error both call `reload()`: download an unreadable copy again, read a locked one again, otherwise sync now. The offline banner names the device ("on this iPad" on iPad).

**Undo.** A save offers Undo whenever it changed the ledger. The engine reports the local ledger right before and after the save, read together (`SaveReceipt.before`, `after`), so their difference is the change plus the recurring entries it made due (a past-dated schedule), and nothing a sync brought in. Undo saves `LedgerChange.revert(after, to: before)` through the model, so it is on disk, pending and synced like any save. It puts back only the records the change touched, at their old place, and is refused ("This change can't be undone anymore…") when one of them changed since (on this device or synced from another), when a currency change would apply under entries, or when the result would break a ledger rule such as an entry using a removed account. Only the latest change can be undone, once.

`FixedWorkspace` puts the shell in any state for previews and tests.

## Specimens

The Xcode previews in `PennyUI/Specimens.swift` are named after the cards. MAZ-69's description uses the older Penpot names:

| MAZ-69 name | Card (`contracts/design-baseline.json`) | Preview |
| --- | --- | --- |
| foundations, components | `system-foundations` | `system-foundations` |
| navigation-rules | (navigation in the baseline) | `ShellRouteTests`; the shell previews |
| home, demo-home | `iphone-home`, `ipad-home` | `iphone-home (demo-home)` |
| more | none: More became the Settings sheet | `iphone-settings` |
| settings | `iphone-settings`, `ipad-settings` | `iphone-settings` |
| appearance | `iphone-appearance` | `iphone-appearance` |
| currency | the Currency row of `iphone-settings` | `currency` |
| app-lock-settings | `iphone-app-lock` | `iphone-app-lock` |
| lock | `iphone-lock` | `iphone-lock` |
| offline | `iphone-offline` | `iphone-offline` |
| save-error | `iphone-save-error` | `iphone-save-error` |
| saved | `iphone-saved-toast` | `iphone-saved-toast` |
| (empty Home) | `iphone-empty-home` | `iphone-empty-home` |

## Tests

Swift Testing, run by `apps/ios/scripts/ios.sh package-test` on the Mac and `ios.sh test` on clean iPhone and iPad simulators:

- `ShellRouteTests` (PennyDomain): every legacy link's destination and Back path, sheets closing for a link, per-tab stacks, reselecting a tab, the iPad sidebar mapping, the tab list against the baseline, links held until sign-in and unlock and tied to the account they arrived for, with the demo leaving account links waiting (`DeepLinkInboxTests`), the demo ledger (valid, current month, `demo-` ids) and the currencies against `contracts/openapi.json`.
- `AppLockControllerTests` (PennyData): failed and closed-Keychain reads stay concealed, launch and return prompts, cancel and failure messages, stale answers after backgrounding, a quick return before the cancelled prompt answers (prompts again, ignores the stale success), single-flight unlock, no flash during Penny's own prompt, durable on/off with failed authentication and failed saves, backgrounding while turning on, missing enrolment and passcode, a failed device check without an error never reported as success; the Keychain store with a fake Keychain; appearance persistence and the legacy theme mapping.
- `WorkspaceTests` (PennyData): demo isolation, Undo, refused changes keeping the ledger, sync status counts.
- `AccountWorkspaceTests` (PennyData): the phase, sync issue, storage and save error mapping; with the MAZ-71 fake server and a real `AuthController` and `LedgerSyncModel`: an offline save shown at once as pending, kept on disk and synced on reconnect; a refused save changing nothing; Undo saved and synced, refused after another device edited the record, and only once; session expiry asking for sign-in with the count; an unreadable copy recovered through Try again or the banner's Retry; "Saved on this device" in the toast; Undo after a save that made recurring entries due; nothing shown or saved for another account.
- `LedgerRevertTests` (PennyDomain): Undo of adds, edits, deletes and other records restores the ledger exactly (order included), keeps unrelated work synced since, and is refused for a record changed since or a currency under entries.
- `MoneyFormatTests` (PennyDesign): signs, spoken amounts, hero cents in two locales, icon and color mapping, minimum targets.
- `ShellTests` (PennyUI): the toast and haptic counters, save failures without a toast, Undo, the demo's lack of account and server, the currency lock reasons, Activity day groups, sync text, the load error action, Projected text, the scene phase covering the app synchronously when it leaves the foreground, appearance persistence, the month list.
- `AppLockSettingKeychainTests` (app-hosted): the setting in the real simulator Keychain.

Not automated yet: XCUITest journeys for every screen, Dynamic Type sizes, dark mode, keyboard dismissal and the lock over sheets (MAZ-81/82), and visual comparison with the cards (MAZ-122).
