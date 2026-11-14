# Native Home Screen widgets

[Documentation](README.md) · [Native iOS app](../apps/ios/README.md) · [Native Home and overview](ios-overview.md)

MAZ-80 builds two widgets with WidgetKit: **Monthly balance** and **Recent expenses**, small family. The app computes a small snapshot of the month, writes it to the App Group, and the widget extension only draws it. Medium and Lock Screen widgets are MAZ-135.

| Code | Contents |
| --- | --- |
| `PennyDomain/Widgets/WidgetSnapshot.swift` | The snapshot and how it is built from `LedgerReport.month` |
| `PennyData/Widgets/WidgetSnapshotStore.swift` | The App Group file: versioned envelope, owner fingerprint, read, write, clear |
| `PennyUI/Widgets/WidgetPublisher.swift` | The app side: publishes after changes, clears on sign-out and account switches |
| `PennyWidgetUI/` (PennyKit module) | The widgets, their timeline provider, states and views |
| `apps/ios/PennyWidgets/` | The extension target: the `@main` widget bundle and its privacy manifest |
| `Configuration/PennyWidgets.xcconfig`, `PennyWidgets-Info.plist`, `PennyWidgets.entitlements` | Extension identity, `NSExtension` point and App Group |

## Identity and App Group entitlements

The extension's identity is frozen for TestFlight/App Store continuity, so widgets people already placed keep working across upgrades (`PennyDomain.AppIdentity`, checked by `AppIdentityTests` and the app-hosted `BuiltAppTests`):

| | Value |
| --- | --- |
| Extension bundle id | `com.mfalicoff.penny.ExpoWidgetsTarget` (the name predates the native app; never rename it. The product is `PennyWidgets.appex`) |
| Widget kinds | `BalanceChartWidget` (Monthly balance), `RecentExpensesWidget` (Recent expenses) |
| App Group | `group.com.mfalicoff.penny`, in both `Penny.entitlements` and `PennyWidgets.entitlements` |

No new entitlement: both App IDs already have the App Group from earlier builds ([widget App Groups setup](ios-ipa.md#widget-app-groups-setup)). A device or archive build signs the extension with the same team as the app (`Signing.local.xcconfig`); automatic signing uses the existing `ExpoWidgetsTarget` App ID. If that App ID or its App Group is missing, the archive fails to sign rather than shipping widgets that can't read the snapshot. Simulator builds sign ad hoc and embed the entitlements.

Without the App Group (a misconfigured build), the app writes nothing anywhere (`WidgetPublisher.live()` is nil, never the private container), and the widgets show **Open Penny to update**.

## Widget data schema

One JSON file, `Widgets/snapshot.json` in the App Group container, written atomically by the app and read by the extension:

```json
{
  "version": 1,
  "owner": "3f9c…(32 hex)",
  "snapshot": {
    "month": "2026-11",
    "currency": "CAD",
    "generatedAt": "2026-11-12T15:04:05Z",
    "income": 320000,
    "spent": 148335,
    "invested": 60000,
    "leftToSpend": 111665,
    "projectedRemaining": 96665,
    "recentExpenses": [{ "title": "Groceries", "cents": 4890, "date": "2026-11-09", "shared": true }],
    "waitingToSync": false
  }
}
```

- Money is integer cents, the viewer's share, in the ledger's currency. The widgets format it with `MoneyFormat`; they never add or compute amounts.
- `leftToSpend`, `projectedRemaining` and the recorded `income`, `spent`, `invested` come from `LedgerReport.month(today's month, today:)`, the same call as Home ([overview formulas](ios-overview.md)): **Left to spend** is recorded only; **Projected** adds scheduled occurrences (personal and shared) and income dated after today; shared household rows count once, at the viewer's share; investments are contributions, not spending.
- `recentExpenses`: at most 3 recorded expenses dated today or earlier, newest first (then id), personal or shared (the viewer's share, `shared: true`). Scheduled previews and future-dated expenses are left out. Titles are cut to 60 characters.
- `waitingToSync`: this device has changes the server hasn't acknowledged and sync is offline, failing or needs sign-in (`SyncStatus.needsAttention` with pending changes). The widget says **As of last sync**.
- `owner`: the first 16 bytes, in hex, of SHA-256 of `widget\n<server>\n<lowercased email>`. It lets the app recognize another account's file; it reveals neither.
- Nothing else is stored: no entry ids, notes, categories, accounts, server address, email or token.

**Versioning.** `version` is the envelope's. A change that an older extension can't decode raises it; the extension reads only its own version and shows **Open Penny to update** for any other (including a damaged file or missing fields, which are never read as zeros). Adding an optional field doesn't need a new version. There is no migration step: the app rewrites the whole file on its next publish.
## Refresh

The app is the only writer. `WidgetPublishing` (on the signed-in shell) publishes whenever the snapshot it computes changes, and `WidgetPublisher` reloads every widget timeline (`WidgetCenter.reloadAllTimelines`) after each write or removal:

- a saved, synced, merged or undone change to the ledger (offline included: the local ledger is what's shown);
- household rows arriving or changing for today's month (the shell asks for today's month even when another month is on screen; the first publish waits for that answer, or its failure, so shared shares aren't briefly missing);
- a new day (the shell follows midnight and returns to the foreground), which can move income from Projected to Left to spend;
- the sync state changing to or from **As of last sync**.

Unchanged content is not rewritten, except to restamp a snapshot older than an hour when the app confirms it. The demo never publishes.

The widgets' own timeline is one entry, reloaded a minute after the next local midnight, so a month that ended is shown as past without the app running. The extension never reaches the network. WidgetKit budgets reloads: the app's reloads while it is in use are not counted, but widgets may lag a little behind changes the system defers. Changes made on another device appear once this device's app syncs them.

## States

| State | When | Monthly balance | Recent expenses |
| --- | --- | --- | --- |
| Placeholder and gallery | Loading, the widget gallery | Design sample (redacted by the system while loading) | Design sample |
| Signed out | No snapshot: signed out, session expired, never signed in, or after an account switch until the new account publishes | **Sign in to Penny** | **Sign in to Penny**, no + |
| Open Penny | Unreadable snapshot (newer version, damaged) or no App Group | **Open Penny to update** | same |
| Empty month | Nothing recorded this month | Left to spend $0.00, **Nothing recorded yet** | **No expenses yet** (when there are none at all) |
| Waiting to sync | `waitingToSync` | numbers, **As of last sync** | rows, **As of last sync** |
| Old | Built more than 12 hours ago | numbers, **Updated … ago** (live relative time) | same |
| Past month | The device's month is after the snapshot's | that month's numbers and name, **Open Penny to update** | rows, **Open Penny to update** |

Taps: Monthly balance opens Home (`penny:///`); Recent expenses opens the add entry sheet (`penny://entries/new`). A small widget has a single tap target, so the + is a picture of the widget's action. Links go through the app's deep-link inbox, so they wait for sign-in and the app lock like any other link ([native shell](ios-shell.md)).

## Privacy

Widgets show money outside the app, so:

- **Account changes clear them first.** `AuthGate` tells `WidgetPublisher` who owns the widgets on every auth change: signing out (or an expired session) deletes the file and reloads; signing in to another account deletes another account's file before anything is shown; the new shell publishes only for its own account. A late update from a shell that is going away is ignored. While the app is restoring or waiting for the Keychain, the file is left as it is.
- **Redacted when the device is locked.** Amounts, the projected line, the flow bar and expense titles are `privacySensitive`, so iOS redacts them wherever it shows widgets on a locked device (StandBy, the iPad Lock Screen) if the person hides sensitive widget data there.
- **File protection.** The file is written with `completeUntilFirstUserAuthentication`: unreadable after a restart until the first unlock, readable by the widget afterwards (WidgetKit requires this for widgets to render).
- **Independent of the app lock.** The in-app Face ID lock protects the app's UI, not widgets; turning it on doesn't change or clear them, and the Settings lock row says so ([app lock](ios-shell.md#app-lock)). To keep amounts off the Home Screen, remove the widgets.
- **Minimal data.** Only the fields above; expense titles are the only free text. The extension's privacy manifest declares App Group `UserDefaults` (reason `1C8F.1`); it collects nothing.

## Design

The 79 screen specimens include one widget card (`system-widgets`, [widgets.html](design/penny-ios/system/widgets.html)) that shows the restyled small widgets alongside the new medium and Lock Screen ones; it is not a complete widget-family design. This implementation adapts it to WidgetKit for the small family:

- **Monthly balance**: the leaf header and **LEFT TO SPEND**, the hero amount with smaller cents (the redesign's `HeroAmount`), the month, **Projected** on its own line only when it differs, then an 8 pt bar of recorded spending (label color), contributions (indigo) and what's left (green) as shares of the larger of income and outflow. It shows Left to spend, as the redesign proposes.
- **Recent expenses**: **RECENT**, up to three rows (title, `−$48.90` in the label color; a people glyph for shared rows), and the copper + in the corner.
- Solid `PennyColor.surface` background in light and dark (no glass on widgets), SF text styles with `minimumScaleFactor` for long amounts, copper as the only tint. The leaf, hero amount and + are `widgetAccentable` for tinted and clear Home Screen appearances.
- VoiceOver reads Monthly balance as one sentence ("Left to spend in November, $1,116.65. Projected, $966.65") and each expense row with its amount spoken as spent.

Supported families: `systemSmall` only. Medium, the Lock Screen accessories and their configuration are MAZ-135.

## Verification

Automated (Swift Testing):

- `PennyDomainTests/WidgetSnapshotTests`: golden recorded totals and Left to spend from `redesign-states.json` (`alex-2026-10`, shared household rows included) equal Home's; recent expenses exclude scheduled, future-dated and income rows and mark shared ones; income after today is Projected only; empty month; title limit; content equality ignores the build time.
- `PennyDataTests/WidgetSnapshotStoreTests`: round trip; the file holds only the envelope and no email or server; owner per account and case-insensitive; newer, damaged and incomplete files read as unreadable; another account's file is cleared; clearing removes the snapshot; a failed write throws and leaves nothing.
- `PennyUIModuleTests/WidgetPublisherTests`: stamped writes and reloads, no rewrite of unchanged content, restamping; sign-out clears and ignores late publishes; account switch in either order; another account's file at launch; relaunch keeps the same account's file; the shell snapshot uses today's month whatever month is on screen, follows the sync state, is nil while loading and in the demo, and waits for shared rows.
- `PennyWidgetUITests/WidgetContentTests`: every state and its month and 12-hour boundaries in a non-UTC time zone; links parse to Home and Add entry; the flow bar; the spoken label; the provider's midnight reload and missing App Group.
- `PennyWidgetUITests/WidgetRenderTests`: renders both widgets in every state, light and dark, including 99,999,999,999-cent amounts and long titles. Set `PENNY_WIDGET_RENDER_DIR` to keep the PNGs for review.
- `PennyTests/BuiltAppTests`: the built app embeds `PennyWidgets.appex` with the frozen bundle id, the WidgetKit extension point, iOS 26 and its privacy manifest.

Manual, on a simulator and then a device: sign in, add the two widgets from the gallery (check the sample), add and undo an expense and watch both update, go offline and save (**As of last sync**), tap each widget (Home, Add entry, through the lock when it's on), switch appearance (light, dark, tinted), sign out (both show **Sign in to Penny**), sign in to another account (the first account's numbers never appear). The physical-device smoke check and an upgrade over a placed widget belong to MAZ-98's TestFlight pass and are not recorded yet.

## Limitations

- Small family only (MAZ-135 adds medium and Lock Screen).
- The widgets show what this device last synced; changes from other devices appear after the app syncs.
- There is no in-app switch to hide amounts in widgets; iOS's locked-device redaction and removing the widget are the controls.
