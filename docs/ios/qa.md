# Native QA matrix and release gates (MAZ-82)

[Documentation](../README.md) · [Native UI tests](ui-tests.md) · [Native app](../../apps/ios/README.md) · [Redesign baseline](../reference/redesign.md)

This page is the native iOS release gate: which journeys are covered on the simulator and how, which redesign cards they trace to, the accessibility and performance checks with their budgets, what was actually run (execution evidence), what only a physical device can check, how to triage a failure, and the known coverage gaps. The harness itself (plans, launch controls, the stack, artifacts, flaky-test policy) is described in [native UI tests](ui-tests.md); this page does not repeat it.

Everything here runs against the real .NET API on PostgreSQL from the [full-stack test environment](../reference/test-environment.md), with synthetic `.test` accounts and fixed synthetic amounts. No test mocks the business API, and no fixture contains personal financial data or credentials.

## Plans

| Plan | Command | Contents | When |
| --- | --- | --- | --- |
| Smoke | `apps/ios/scripts/ios.sh ui-test smoke` | Install, sign in, write, relaunch, read; add expense | Every PR (required) |
| Full | `apps/ios/scripts/ios.sh ui-test full` | Every functional journey below | Nightly, releases, on demand |
| Screenshots | `apps/ios/scripts/ios.sh ui-test screenshots` | `ScreenshotTests` and `AccessibilityAuditTests` | Nightly, releases, on demand |
| Performance | `apps/ios/scripts/ios.sh ui-test performance` | `PerformanceTests` (budgets below) | Nightly, releases, on demand |

All four run on clean iPhone and iPad simulators (`PENNY_UI_DEVICES`), on the minimum OS (iOS 26.0) and the newest runtime in `ios-ui-matrix.yml`. `PENNY_UI_ONLY` takes several space-separated classes or tests.

## Journey matrix

Each row is a feature area. "Server-checked" means the test reads the account's ledger back through `GET /api/ledger` after the write and compares amounts in cents, including the recorded totals per kind (`LedgerJSON.shareTotal`).

| Area | Suites | What is exercised | Durable after | Server-checked totals |
| --- | --- | --- | --- | --- |
| Install, auth and demo | `SmokeJourneyTests`, `AuthJourneyTests`, `LifecycleTests`, `OverviewJourneyTests` | Clean install, password and OIDC sign-in, account creation, wrong password, SSO cancel, session expiry by moving the server clock, sign-out with pending changes, account switching, the demo | App relaunch, reinstall | Currency |
| Transactions | `EntryJourneyTests`, `SmokeJourneyTests` | Add expense and income, kind filters that never change totals, edit amount from the detail, delete with a dialog that can be dismissed, HTTP 500 during sync | App relaunch | Yes, after each write |
| Search (PostgreSQL) | `SearchJourneyTests` | Online keyword and typo search on `POST /api/v1/search/transactions`, empty state, device search while a change is pending (and the scope line saying so), reconciliation with the server after reconnect | — | Entry present |
| Accounts and categories | `OrganizeJourneyTests` | Create an account; create, use and rename a category (one id, new name everywhere) | App relaunch | Yes |
| Recurrence | `OrganizeJourneyTests` | New monthly schedule records its first date; relaunching on a later day records the next occurrence | App relaunch at a later date | Yes (2 × amount) |
| Offline, reconnect, conflicts | `NetworkFailureTests`, `SyncConflictTests`, `EntryJourneyTests` | Dropped connections and 500s, pending banner, terminate while offline, field-by-field merge of two devices, delete-versus-edit | App relaunch while offline | Yes |
| Households and shared expenses | `HouseholdJourneyTests` | Two users on the real API: invite, join, split, payment, stale edit, links, scanner without camera, a shared schedule opened from Recurring | — | Split amounts |
| Trips | `TripJourneyTests` | Personal trip shared with earlier private expenses, splits, totals counted once, delete guard | — | Yes |
| Receipts | `ReceiptJourneyTests` | Photo and PDF round trips (SHA-256), failures, oversized and renamed files, session end during upload | — | Bytes |
| Reports | `OverviewJourneyTests` | Left to spend before Projected, money flow focus, the calendar sheet's day selection and Close, Insights from the flow card's pill, Show as a table, XXXL value lists | — | Demo data |
| Settings and links | `SettingsJourneyTests`, `AppLockDelayTests`, `SmokeJourneyTests`, `HouseholdJourneyTests`, `NotificationJourneyTests`, `AddEntryOverSettingsTests` | Appearance kept across relaunch, app lock refused where the device cannot authenticate, Lock after delays, currency, `penny://join` links, notification navigation | App relaunch | Currency |
| Upgrades | `LifecycleTests` | Seeded earlier-install state; `PENNY_UPGRADE_FROM_APP` installs a previous build first | Upgrade | — |

### Redesign card trace

Every card in [design-baseline.json](../../contracts/design-baseline.json) whose native acceptance is MAZ-82 has a row. `scripts/tests/native-qa.test.ts` fails if a card is missing here or if this page names an XCUITest suite or test that does not exist. Visual comparison against the cards is MAZ-122's; a row marked Covered means the behavior is exercised, not that the screen matches the card pixel for pixel. The thirty-one `web-*` cards are browser references (MAZ-96); their native counterparts are named.

| Card | Native suites | Notes | Status |
| --- | --- | --- | --- |
| `system-foundations` | `AccessibilityAuditTests`, `ScreenshotTests` | Contrast audit in light/dark/XXXL and Reduce Transparency; TokenBaselineTests (PennyKit) checks tokens | Covered (automated audit + screenshots) |
| `system-widgets` | — | WidgetKit rendering, families and deep links are device checks (MAZ-80, PennyWidgetUITests in PennyKit) | Device-only (checklist) |
| `iphone-home` | `OverviewJourneyTests`, `AccessibilityAuditTests`, `ScreenshotTests` | Left to spend before Projected; audit; light/dark × default/XL/RT/RM captures | Covered |
| `iphone-home-overspent` | `CardCaptureTests` | A negative Left to spend with "… more went out than came in" under it (MAZ-254) | Covered |
| `iphone-home-dark` | `ScreenshotTests`, `AccessibilityAuditTests` | Dark captures and dark/dark-XXXL audits | Covered (visual comparison: MAZ-122) |
| `iphone-money-flow` | `OverviewJourneyTests`, `ScreenshotTests`, `CardCaptureTests` | Focus/clear, the focus hint, Show as a table opening and closing the value list, value list at XXXL | Covered |
| `iphone-insights` | `OverviewJourneyTests`, `AccessibilityAuditTests` | Category drill-down; audited in every variant | Covered |
| `iphone-calendar` | `OverviewJourneyTests`, `ScreenshotTests` | The calendar sheet over Home: day selection, Today, Close | Covered |
| `iphone-activity` | `EntryJourneyTests`, `SearchJourneyTests`, `AccessibilityAuditTests` | Day rows, kind filters keep totals, server totals after each write | Covered |
| `iphone-search-empty` | `SearchJourneyTests`, `KeyboardLayoutTests`, `CardCaptureTests` | No-match query in the bottom search bar shows the empty state with the active filters as removable chips; with the keyboard up it stays clear of the spoken totals and server-results line | Covered |
| `iphone-add-expense` | `SmokeJourneyTests`, `EntryJourneyTests`, `AccessibilityAuditTests` | Keypad entry, server write, keyboard-safe Save at XXXL | Covered; duplicate-submit tapping is unit-tested only (EntryFlowTests) |
| `iphone-add-income` | `EntryJourneyTests` | Income via the kind segment, server share and totals | Covered |
| `iphone-entry-extras` | `ReceiptJourneyTests` | Receipt group of More details | Partly: repeat and trip rows have no UI journey here (unit-tested) |
| `iphone-split` | `HouseholdJourneyTests` | Equal split stored as $45/$45 | Partly: personal split sheet has no UI journey (unit-tested) |
| `iphone-category-picker` | — | Category chips preselect the most used category in every add-entry journey | Gap: the full picker sheet has no UI journey |
| `iphone-entry-detail` | `EntryJourneyTests`, `SyncConflictTests` | Opened from Activity, Edit and Delete from its toolbar | Covered |
| `iphone-receipt` | `ReceiptJourneyTests` | Upload, preview, share, failures | Covered (MAZ-78) |
| `iphone-delete-confirm` | `EntryJourneyTests` | Cancel keeps, Delete removes (server-checked) | Covered |
| `iphone-shared-list` | `HouseholdJourneyTests` | Two users on the real API | Covered (MAZ-75) |
| `iphone-shared` | `HouseholdJourneyTests` | — | Covered (MAZ-75) |
| `iphone-shared-balances` | `HouseholdJourneyTests` | Repaid share | Covered (MAZ-75) |
| `iphone-shared-people` | `HouseholdJourneyTests` | Invite, join, leave refused | Covered (MAZ-75) |
| `iphone-shared-expense-add` | `HouseholdJourneyTests` | — | Covered (MAZ-75) |
| `iphone-record-payment` | `HouseholdJourneyTests` | — | Covered (MAZ-75) |
| `iphone-payment-stale` | `HouseholdJourneyTests` | Concurrent edit refused with Review latest | Partly: stale monthly payment recovery is not a UI journey |
| `iphone-household-create` | `HouseholdJourneyTests` | — | Covered (MAZ-75) |
| `iphone-history` | — | — | Gap: no UI journey opens household history |
| `iphone-trips` | `TripJourneyTests` | — | Covered (MAZ-76) |
| `iphone-trip-detail` | `TripJourneyTests` | Only you, balances, totals counted once | Covered (MAZ-76) |
| `iphone-trip-form` | `TripJourneyTests` | New trip | Covered (MAZ-76) |
| `iphone-settings` | `SmokeJourneyTests`, `SettingsJourneyTests`, `AccessibilityAuditTests` | Currency persistence, audits at XXXL | Covered |
| `iphone-recurring` | `OrganizeJourneyTests`, `HouseholdJourneyTests` | New schedule saved on the server; a shared schedule opens its household with its form | Covered; pause/remove swipe has no UI journey (unit-tested) |
| `iphone-schedule-detail` | `OrganizeJourneyTests` | Occurrences recorded across relaunches at a later day | Partly: anchor-31 is unit-tested only |
| `iphone-accounts` | `OrganizeJourneyTests` | — | Covered; in-use removal guard is unit-tested only |
| `iphone-account-form` | `OrganizeJourneyTests` | — | Covered |
| `iphone-categories` | `OrganizeJourneyTests` | — | Covered |
| `iphone-category-form` | `OrganizeJourneyTests` | Create and rename; entries show the new name | Covered; in-use removal guard is unit-tested only |
| `iphone-appearance` | `SettingsJourneyTests`, `LifecycleTests` | Light, Dark, System kept across relaunch | Covered |
| `iphone-app-lock` | `SettingsJourneyTests`, `AppLockDelayTests` | Unavailable biometrics explained, lock stays off; Lock after: Immediately, After 1 minute and After 5 minutes, drafts kept, cold launch always locks (MAZ-133, with the Face ID stand-in) | Partly: real Face ID enabling, unlocking and the passcode fallback are device checks |
| `iphone-sign-in` | `AuthJourneyTests`, `NetworkFailureTests`, `AccessibilityAuditTests`, `KeyboardLayoutTests` | Password, SSO, wrong password, dropped request, audit, demo link clear of Sign in while typing | Covered |
| `iphone-create-account` | `AuthJourneyTests` | — | Covered |
| `iphone-server-connect` | `SmokeJourneyTests` | Clean install shows the test server | Partly: credential-free verification of another server is unit-tested only |
| `iphone-lock` | — | — | Device-only (checklist): needs enrolled Face ID |
| `iphone-empty-home` | `SmokeJourneyTests`, `EntryJourneyTests` | Empty Home after sign-in | Covered |
| `iphone-offline` | `NetworkFailureTests`, `SyncConflictTests`, `SearchJourneyTests` | Offline banner, durable pending edits, merge on reconnect | Covered |
| `iphone-save-error` | `EntryJourneyTests` | HTTP 500 on sync keeps the entry and syncs once | Partly: the form's Couldn't save banner (local write failure) is unit-tested only |
| `iphone-saved-toast` | — | The toast is unit-tested (EntryFlowTests); it shows for 4 s during dismissal, which XCTest's idle waits outlast | Gap: not asserted in a UI journey |
| `iphone-sign-out` | `AuthJourneyTests` | Pending change asks and syncs first | Covered |
| `iphone-sign-out-plain` | `AuthJourneyTests`, `CardCaptureTests` | Sign out with nothing waiting asks once in Penny's confirmation and signs out | Covered |
| `iphone-receipt-inbox` | — | Filter and cursor, the expiry notice and discard are unit-tested (ReceiptInboxTests in PennyKit) | Gap: no UI journey; the full-stack seed has no receipt inbox yet |
| `iphone-receipt-inbox-item` | — | Email-first order, the preselected attachment and the discard counts are unit-tested (ReceiptInboxTests) | Gap: no UI journey; the full-stack seed has no receipt inbox yet |
| `iphone-receipt-attach-file` | — | The preselected first attachment is unit-tested (ReceiptInboxTests) | Gap: no UI journey; the full-stack seed has no receipt inbox yet |
| `iphone-receipt-attach-entry` | — | Suggestions within a week (personal and shared) and search are unit-tested (ReceiptInboxTests) | Gap: no UI journey; the full-stack seed has no receipt inbox yet |
| `iphone-receipt-attach-confirm` | — | Personal and shared attach writes and the changed-expense reload are unit-tested (ReceiptInboxTests); the notes are not | Gap: no UI journey; the full-stack seed has no receipt inbox yet |
| `iphone-receipt-attached-toast` | — | No test covers the confirmation or its Undo yet | Gap: no UI journey; the full-stack seed has no receipt inbox yet |
| `iphone-receipt-email-settings` | — | Address decoding, address changes, the new-address limit and sender rules are unit-tested (ReceiptInboxTests) | Gap: no UI journey; the full-stack seed has no receipt inbox yet |
| `ipad-home` | `OverviewJourneyTests`, `ScreenshotTests` | Run with PENNY_UI_DEVICES=ipad | Covered on iPad runs |
| `ipad-activity` | `EntryJourneyTests`, `SearchJourneyTests` | List with detail beside it | Covered on iPad runs |
| `ipad-add-entry` | `AddEntryOverSettingsTests`, `EntryJourneyTests` | Text-field amount at regular width | Covered on iPad runs |
| `ipad-shared` | `HouseholdJourneyTests` | — | Covered on iPad runs |
| `ipad-trip` | `TripJourneyTests` | — | Covered on iPad runs |
| `ipad-settings` | `AddEntryOverSettingsTests`, `SettingsJourneyTests` | Settings as the detail column | Covered on iPad runs |
| `ipad-receipt-inbox` | — | Filter and cursor, the expiry notice and discard are unit-tested (ReceiptInboxTests in PennyKit) | Gap: no UI journey; the full-stack seed has no receipt inbox yet |
| `ipad-receipt-inbox-item` | — | Email-first order, the preselected attachment and the discard counts are unit-tested (ReceiptInboxTests) | Gap: no UI journey; the full-stack seed has no receipt inbox yet |
| `ipad-receipt-attach-file` | — | The preselected first attachment is unit-tested (ReceiptInboxTests) | Gap: no UI journey; the full-stack seed has no receipt inbox yet |
| `ipad-receipt-attach-entry` | — | Suggestions within a week (personal and shared) and search are unit-tested (ReceiptInboxTests) | Gap: no UI journey; the full-stack seed has no receipt inbox yet |
| `ipad-receipt-attach-confirm` | — | Personal and shared attach writes and the changed-expense reload are unit-tested (ReceiptInboxTests); the notes are not | Gap: no UI journey; the full-stack seed has no receipt inbox yet |
| `ipad-receipt-attached-toast` | — | No test covers the confirmation or its Undo yet | Gap: no UI journey; the full-stack seed has no receipt inbox yet |
| `ipad-receipt-email-settings` | — | Address decoding, address changes, the new-address limit and sender rules are unit-tested (ReceiptInboxTests) | Gap: no UI journey; the full-stack seed has no receipt inbox yet |
| `web-home` | — | Web-only reference: native behavior is traced through `iphone-home`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-activity` | — | Web-only reference: native behavior is traced through `iphone-activity`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-insights` | — | Web-only reference: native behavior is traced through `iphone-insights`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-household` | — | Web-only reference: native behavior is traced through `iphone-shared`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-trips` | — | Web-only reference: native behavior is traced through `iphone-trips`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-settings` | — | Web-only reference: native behavior is traced through `iphone-settings`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-add-entry` | — | Web-only reference: native behavior is traced through `iphone-add-expense`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-sign-in` | — | Web-only reference: native behavior is traced through `iphone-sign-in`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-receipt-inbox` | — | Web-only reference: native behavior is traced through `ipad-receipt-inbox`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-receipt-inbox-item` | — | Web-only reference: native behavior is traced through `ipad-receipt-inbox-item`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-receipt-attach-file` | — | Web-only reference: native behavior is traced through `ipad-receipt-attach-file`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-receipt-attach-entry` | — | Web-only reference: native behavior is traced through `ipad-receipt-attach-entry`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-receipt-attach-confirm` | — | Web-only reference: native behavior is traced through `ipad-receipt-attach-confirm`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-receipt-attached-toast` | — | Web-only reference: native behavior is traced through `ipad-receipt-attached-toast`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-receipt-email-settings` | — | Web-only reference: native behavior is traced through `ipad-receipt-email-settings`; the browser journeys are MAZ-96 | Not applicable to native |
| `iphone-activity-filters` | `CardCaptureTests` | Filters sheet over Activity with Expenses chosen (MAZ-255) | Partly: captured; filtering is unit-tested |
| `iphone-activity-searching` | `SearchJourneyTests`, `CardCaptureTests` | A held-back server search shows Searching your server… without local rows (MAZ-255) | Covered |
| `iphone-home-explore` | `OverviewJourneyTests`, `CardCaptureTests` | Expected income and Explore your month under Recent; the calendar row opens the calendar sheet (MAZ-254) | Covered |
| `iphone-account-picker` | `CardCaptureTests`, `EntryJourneyTests` | Account picker from a new expense (MAZ-255) | Covered |
| `iphone-household-picker` | `CardCaptureTests` | Household from More details: Personal, then the households and shared trips (MAZ-255) | Partly: moving a draft to a household is unit-tested |
| `iphone-edit-entry` | `EntryJourneyTests`, `CardCaptureTests` | Edit from the entry detail: Edit entry title, the entry-only footnote (MAZ-255) | Covered |
| `iphone-shared-expense-detail` | — | Draft card (MAZ-238), waiting for the owner's review; the Cards test plan has no state for it yet | Gap: draft card, not traced yet |
| `iphone-join-code` | — | Draft card (MAZ-238), waiting for the owner's review; the Cards test plan has no state for it yet | Gap: draft card, not traced yet |
| `iphone-invite-scanner` | — | Draft card (MAZ-238), waiting for the owner's review; the Cards test plan has no state for it yet | Gap: draft card, not traced yet |
| `iphone-invite` | — | Draft card (MAZ-238), waiting for the owner's review; the Cards test plan has no state for it yet | Gap: draft card, not traced yet |
| `iphone-notifications-prompt` | — | Draft card (MAZ-238), waiting for the owner's review; the Cards test plan has no state for it yet | Gap: draft card, not traced yet |
| `iphone-trip-personal` | — | Draft card (MAZ-238), waiting for the owner's review; the Cards test plan has no state for it yet | Gap: draft card, not traced yet |
| `iphone-trip-share` | — | Draft card (MAZ-238), waiting for the owner's review; the Cards test plan has no state for it yet | Gap: draft card, not traced yet |
| `iphone-schedule-form` | — | Draft card (MAZ-238), waiting for the owner's review; the Cards test plan has no state for it yet | Gap: draft card, not traced yet |
| `iphone-recurring-suggested` | — | Card approved by the owner (MAZ-290, 2026-11-26); the feature isn't built yet | Gap: approved card, not built yet |
| `iphone-recurring-empty` | — | Card approved by the owner (MAZ-290, 2026-11-26); the feature isn't built yet | Gap: approved card, not built yet |
| `iphone-schedule-suggested` | — | Card approved by the owner (MAZ-290, 2026-11-26); the feature isn't built yet | Gap: approved card, not built yet |
| `iphone-suggestion-dismissed-toast` | — | Card approved by the owner (MAZ-290, 2026-11-26); the feature isn't built yet | Gap: approved card, not built yet |
| `iphone-recurring-renews-soon` | — | Card approved by the owner (MAZ-290, 2026-11-26); the feature isn't built yet | Gap: approved card, not built yet |
| `iphone-schedule-reminder` | — | Card approved by the owner (MAZ-290, 2026-11-26); the feature isn't built yet | Gap: approved card, not built yet |
| `iphone-renewal-notification` | — | Card approved by the owner (MAZ-290, 2026-11-26); the feature isn't built yet | Gap: approved card, not built yet |
| `iphone-currency` | — | Draft card (MAZ-238), waiting for the owner's review; the Cards test plan has no state for it yet | Gap: draft card, not traced yet |
| `iphone-sync-failed` | `CardCaptureTests` | The amber "Couldn't sync · N changes waiting" banner with Retry while the ledger answers 503; the changes stay on the device | Partly: captured on its card; no journey test taps Retry while the server fails |
| `iphone-shared-missing` | `CardCaptureTests` | The amber "Shared expenses may be missing" banner with Retry while the household projection answers 503 | Partly: captured on its card; no journey test taps Retry |
| `iphone-demo` | — | Draft card (MAZ-238), waiting for the owner's review; the Cards test plan has no state for it yet | Gap: draft card, not traced yet |
| `ipad-home-portrait` | `OverviewJourneyTests`, `CardCaptureTests` | iPad Home in portrait: the sidebar hidden, Settings in the toolbar, Daily spending beside By category (MAZ-259) | Covered on iPad runs |
| `web-households` | — | Web-only draft reference (MAZ-238): native behavior is traced through `iphone-shared-list`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-shared-expense` | — | Web-only draft reference (MAZ-238): native behavior is traced through `iphone-shared-expense-detail`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-trip` | — | Web-only draft reference (MAZ-238): native behavior is traced through `iphone-trip-detail`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-recurring` | — | Web-only draft reference (MAZ-238): native behavior is traced through `iphone-recurring`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-accounts` | — | Web-only draft reference (MAZ-238): native behavior is traced through `iphone-accounts`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-categories` | — | Web-only draft reference (MAZ-238): native behavior is traced through `iphone-categories`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-currency` | — | Web-only draft reference (MAZ-238): native behavior is traced through `iphone-currency`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-schedule-form` | — | Web-only draft reference (MAZ-238): native behavior is traced through `iphone-schedule-form`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-recurring-suggested` | — | Web-only reference (MAZ-290): native behavior is traced through `iphone-recurring-suggested`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-recurring-empty` | — | Web-only reference (MAZ-290): native behavior is traced through `iphone-recurring-empty`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-schedule-suggested` | — | Web-only reference (MAZ-290): native behavior is traced through `iphone-schedule-suggested`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-suggestion-dismissed-toast` | — | Web-only reference (MAZ-290): native behavior is traced through `iphone-suggestion-dismissed-toast`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-recurring-renews-soon` | — | Web-only reference (MAZ-290): native behavior is traced through `iphone-recurring-renews-soon`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-edit-entry` | — | Web-only draft reference (MAZ-238): native behavior is traced through `iphone-edit-entry`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-join-code` | — | Web-only draft reference (MAZ-238): native behavior is traced through `iphone-join-code`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-activity-searching` | — | Web-only draft reference (MAZ-238): native behavior is traced through `iphone-activity-searching`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-activity-selected` | — | Web-only draft reference (MAZ-276): selecting several entries is desktop-only, so there is no native screen; the browser journeys are MAZ-96 | Not applicable to native |
| `web-activity-bulk-category` | — | Web-only draft reference (MAZ-276): selecting several entries is desktop-only, so there is no native screen; the browser journeys are MAZ-96 | Not applicable to native |
| `web-activity-bulk-account` | — | Web-only draft reference (MAZ-276): selecting several entries is desktop-only, so there is no native screen; the browser journeys are MAZ-96 | Not applicable to native |
| `web-activity-bulk-delete` | — | Web-only draft reference (MAZ-276): selecting several entries is desktop-only, so there is no native screen; the browser journeys are MAZ-96 | Not applicable to native |
| `web-activity-bulk-done` | — | Web-only draft reference (MAZ-276): selecting several entries is desktop-only, so there is no native screen; the browser journeys are MAZ-96 | Not applicable to native |
| `web-server-unreachable` | — | Web-only draft reference (MAZ-238): native behavior is traced through `iphone-offline`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-demo` | — | Web-only draft reference (MAZ-238): native behavior is traced through `iphone-demo`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-tablet` | — | Web-only draft reference (MAZ-238): native behavior is traced through `ipad-home`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-password-reset` | — | Web-only draft reference (MAZ-238): the flow has no native screen; the browser journeys are MAZ-96 | Not applicable to native |
| `web-export` | — | Web-only draft reference (MAZ-238): the flow has no native screen; the browser journeys are MAZ-96 | Not applicable to native |
| `iphone-profile` | — | Draft card (MAZ-267), waiting for the owner's review; the feature isn't built yet (MAZ-171) | Gap: draft card, not built yet |
| `iphone-profile-provider` | — | Draft card (MAZ-267), waiting for the owner's review; the feature isn't built yet (MAZ-171) | Gap: draft card, not built yet |
| `iphone-profile-photo` | — | Draft card (MAZ-267), waiting for the owner's review; the feature isn't built yet (MAZ-171) | Gap: draft card, not built yet |
| `iphone-name-prompt` | — | Draft card (MAZ-267), waiting for the owner's review; the feature isn't built yet (MAZ-171) | Gap: draft card, not built yet |
| `iphone-sign-in-providers` | — | Draft card (MAZ-267), waiting for the owner's review; the feature isn't built yet (MAZ-170) | Gap: draft card, not built yet |
| `iphone-create-account-providers` | — | Draft card (MAZ-267), waiting for the owner's review; the feature isn't built yet (MAZ-170) | Gap: draft card, not built yet |
| `iphone-verify-email` | `CardCaptureTests`, `EmailVerificationJourneyTests` | Captured with `PENNY_STACK_SMTP=1` (recorded as blocked without it): a new account signs up in the app and stops on Check your email; the journey changes the email (a wrong password first) and continues (MAZ-172) | Covered |
| `iphone-unverified` | `CardCaptureTests`, `EmailVerificationJourneyTests` | Captured with `PENNY_STACK_SMTP=1`: a new account continues from Check your email to the Shared tab's reminder; the journey then marks it verified and finds Verified in Settings › Profile (MAZ-172) | Covered |
| `iphone-forgot-password` | `CardCaptureTests` | Captured with `PENNY_STACK_SMTP=1` (the server sends email to an SMTP sink; recorded as blocked without it): Forgot password on sign-in, then Send reset link (MAZ-124) | Covered |
| `iphone-invite-email` | `CardCaptureTests` | Captured with `PENNY_STACK_SMTP=1`: an expired and a waiting invitation sent through the real API, then an address typed (MAZ-124) | Covered |
| `iphone-delete-account` | `CardCaptureTests`, `AccountDataJourneyTests` | Settings › Profile › Delete account with the seeded household under Stays for others; the journey refuses a wrong password, then deletes a fresh account and lands on sign-in with the deleted notice, and the server no longer signs it in (MAZ-152) | Covered |
| `iphone-export-all` | `CardCaptureTests`, `AccountDataJourneyTests` | Settings › Profile › Export all your data once the real API has prepared the ZIP (name · size · ready, Save or share) (MAZ-152) | Covered |
| `iphone-monitoring-prompt` | `CardCaptureTests` | Captured with `PENNY_STACK_TELEMETRY=1`: Home after a fresh sign-in on a server that offers reports asks once; PennyData's telemetry package tests cover the answer, opt-in, the demo and scrubbing (MAZ-129) | Covered |
| `iphone-privacy` | `CardCaptureTests` | Captured with `PENNY_STACK_TELEMETRY=1`: Settings › Privacy with crash reports on and performance data off, and the server's privacy policy (MAZ-129) | Covered |
| `ipad-profile` | — | Draft card (MAZ-267), waiting for the owner's review; the feature isn't built yet (MAZ-171) | Gap: draft card, not built yet |
| `ipad-recurring-suggested` | — | Card approved by the owner (MAZ-290, 2026-11-26); the feature isn't built yet | Gap: approved card, not built yet |
| `web-profile` | — | Web-only draft reference (MAZ-267): native behavior is traced through `iphone-profile`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-sign-in-providers` | — | Web-only draft reference (MAZ-267): native behavior is traced through `iphone-sign-in-providers`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-create-account` | — | Web-only draft reference (MAZ-267): native behavior is traced through `iphone-create-account-providers`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-verify-email` | — | Web-only draft reference (MAZ-267): native behavior is traced through `iphone-verify-email`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-email-verified` | — | Web-only draft reference (MAZ-267): native behavior is traced through `iphone-verify-email`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-forgot-password` | — | Web-only draft reference (MAZ-267): native behavior is traced through `iphone-forgot-password`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-forgot-password-request` | — | Web-only draft reference (MAZ-124): native behavior is traced through `iphone-forgot-password`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-password-reset-link` | — | Web-only draft reference (MAZ-124): the emailed link opens the web app on any device, so there is no native screen; the browser journeys are MAZ-96 | Not applicable to native |
| `web-invite-email` | — | Web-only draft reference (MAZ-267): native behavior is traced through `iphone-invite-email`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-delete-account` | — | Web-only draft reference (MAZ-267): native behavior is traced through `iphone-delete-account`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-export-all` | — | Web-only draft reference (MAZ-267): native behavior is traced through `iphone-export-all`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-privacy` | — | Web-only draft reference (MAZ-267): native behavior is traced through `iphone-privacy`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-monitoring-prompt` | — | Web-only draft reference (MAZ-267): native behavior is traced through `iphone-monitoring-prompt`; the browser journeys are MAZ-96 | Not applicable to native |
| `iphone-entry-currency` | — | Draft card (MAZ-270), waiting for the owner's review; the feature isn't built yet (MAZ-151) | Gap: draft card, not built yet |
| `iphone-currency-picker` | — | Draft card (MAZ-270), waiting for the owner's review; the feature isn't built yet (MAZ-151) | Gap: draft card, not built yet |
| `iphone-entry-rate-provisional` | — | Draft card (MAZ-270), waiting for the owner's review; the feature isn't built yet (MAZ-151) | Gap: draft card, not built yet |
| `iphone-entry-rate-edited` | — | Draft card (MAZ-270), waiting for the owner's review; the feature isn't built yet (MAZ-151) | Gap: draft card, not built yet |
| `iphone-entry-rate-manual` | — | Draft card (MAZ-270), waiting for the owner's review; the feature isn't built yet (MAZ-151) | Gap: draft card, not built yet |
| `iphone-home-currencies` | — | Draft card (MAZ-270), waiting for the owner's review; the feature isn't built yet (MAZ-151) | Gap: draft card, not built yet |
| `iphone-activity-currencies` | — | Draft card (MAZ-270), waiting for the owner's review; the feature isn't built yet (MAZ-151) | Gap: draft card, not built yet |
| `iphone-entry-detail-currency` | — | Draft card (MAZ-270), waiting for the owner's review; the feature isn't built yet (MAZ-151) | Gap: draft card, not built yet |
| `iphone-trip-currencies` | — | Draft card (MAZ-270), waiting for the owner's review; the feature isn't built yet (MAZ-151) | Gap: draft card, not built yet |
| `iphone-trip-balances-currency` | — | Draft card (MAZ-270), waiting for the owner's review; the feature isn't built yet (MAZ-151) | Gap: draft card, not built yet |
| `iphone-trip-form-currency` | — | Draft card (MAZ-270), waiting for the owner's review; the feature isn't built yet (MAZ-151) | Gap: draft card, not built yet |
| `iphone-currency-rates` | — | Draft card (MAZ-270), waiting for the owner's review; the feature isn't built yet (MAZ-151) | Gap: draft card, not built yet |
| `iphone-currency-rates-off` | — | Draft card (MAZ-270), waiting for the owner's review; the feature isn't built yet (MAZ-151) | Gap: draft card, not built yet |
| `ipad-add-entry-currency` | — | Draft card (MAZ-270), waiting for the owner's review; the feature isn't built yet (MAZ-151) | Gap: draft card, not built yet |
| `ipad-activity-currencies` | — | Draft card (MAZ-270), waiting for the owner's review; the feature isn't built yet (MAZ-151) | Gap: draft card, not built yet |
| `ipad-trip-currencies` | — | Draft card (MAZ-270), waiting for the owner's review; the feature isn't built yet (MAZ-151) | Gap: draft card, not built yet |
| `ipad-settings-currency` | — | Draft card (MAZ-270), waiting for the owner's review; the feature isn't built yet (MAZ-151) | Gap: draft card, not built yet |
| `web-add-entry-currency` | — | Web-only draft reference (MAZ-270): native behavior is traced through `iphone-entry-currency`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-entry-rate-provisional` | — | Web-only draft reference (MAZ-270): native behavior is traced through `iphone-entry-rate-provisional`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-entry-rate-edited` | — | Web-only draft reference (MAZ-270): native behavior is traced through `iphone-entry-rate-edited`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-entry-rate-manual` | — | Web-only draft reference (MAZ-270): native behavior is traced through `iphone-entry-rate-manual`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-activity-currencies` | — | Web-only draft reference (MAZ-270): native behavior is traced through `iphone-activity-currencies`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-trip-currencies` | — | Web-only draft reference (MAZ-270): native behavior is traced through `iphone-trip-currencies`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-trip-form-currency` | — | Web-only draft reference (MAZ-270): native behavior is traced through `iphone-trip-form-currency`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-currency-rates` | — | Web-only draft reference (MAZ-270): native behavior is traced through `iphone-currency-rates`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-currency-rates-off` | — | Web-only draft reference (MAZ-270): native behavior is traced through `iphone-currency-rates-off`; the browser journeys are MAZ-96 | Not applicable to native |

Justified native adaptations are recorded in [redesign](../reference/redesign.md#native-implementation-notes-maz-69). Android has no card (the Android app is retired, MAZ-98), and the desktop-only `web-*` cards have no native screen.

## Accessibility

| Check | How | Where |
| --- | --- | --- |
| Accessibility audit (contrast, hit regions, element descriptions, Dynamic Type, clipped text, traits) | `XCUIApplication.performAccessibilityAudit` on Home, Activity, Add entry, Settings and Insights, in light, dark, AX-XXXL, dark AX-XXXL and Reduce Motion + Reduce Transparency; sign-in with an error in light and dark AX-XXXL | `AccessibilityAuditTests`, findings attached as `<device>-audit-<screen>-<variant>.txt` |
| VoiceOver labels | Every enabled button, link, text field and switch on the main screens has a label (one accessibility snapshot per screen) | `test_whenReadByVoiceOver_InteractiveElements_ShouldAllHaveLabels` |
| VoiceOver summaries | Hero, Projected, chart nodes and calendar days read their meaning, not just numbers | `OverviewJourneyTests` |
| Dynamic Type | AX-XL captures and AX-XXXL layouts (charts give way to lists), audits at AX-XXXL | `ScreenshotTests`, `OverviewJourneyTests`, `AccessibilityAuditTests` |
| Keyboard-safe forms | At AX-XXXL with the keyboard up, the focused field stays above the keyboard and Save is hittable | `test_whenTheKeyboardIsUpAtTheLargestText_AddEntry_ShouldKeepTheFieldAndSaveReachable` |
| Dark mode, Reduce Motion, Reduce Transparency | Captures and audits under each (`PENNY_TEST_REDUCE_*` for Penny's own views) | `ScreenshotTests`, `AccessibilityAuditTests` |
| iPad | Every plan runs on iPad Pro 11-inch as well | `PENNY_UI_DEVICES=ipad` |

### Audit findings: accepted and recorded debt

`AccessibilityAuditTests.accepted` lists individual findings that are reviewed and accepted, each with its reason here. `recordedDebt` lists audit types whose findings are attached and counted but do not fail yet. Any other finding fails the test.

No individual finding is accepted yet (`accepted` is empty).

**Recorded debt.** The final audit run (iPhone 18 Pro, iOS 27.0, 2026-11-12) found 257 issues of five types across the 25 main-screen audits and the 4 sign-in audits; the counts below are from that run. They are real and need design or code fixes, so the test records them (`AccessibilityAuditTests.recordedDebt`) instead of failing on them; the remaining types (element descriptions, traits) found nothing and fail on any new finding. The audits also found one layout bug that is fixed here: at AX-XXXL with the keyboard up, the sign-in screen's "Take a look around with sample data" link rode above the keyboard and covered Sign in, so a tap meant for Sign in opened the demo; the link now steps aside whenever the keyboard is up, at every text size, since the MAZ-122 card captures showed the same overlap at the default size (`SignedOutFlow`, MAZ-179; `KeyboardLayoutTests`). Each type comes out of `recordedDebt` once its follow-up is fixed.

| Type | Findings | Typical elements | Likely fix |
| --- | --- | --- | --- |
| contrast | 107 (failed or nearly passed) | Secondary text and chips: category chip titles, "Date", "Account", "Split", "Receipt, repeat, trip", "Today", Leave demo, the Expenses/Income filter chips, "Continue with Single sign-on" | Secondary and tertiary label tokens on `PennyColor.fill`/surfaces, and chip foregrounds (MAZ-69 tokens, MAZ-122 visual baseline) |
| textClipped | 68 | Mostly at AX-XXXL: the hero's "SPENT" and amount, Activity totals, row titles and meta lines, "Invested", "None" | Let these lines wrap or move to stacked layouts at accessibility sizes |
| dynamicType | 56 | Text with a fixed or capped size: the hero amount and labels, the demo banner, Activity totals, row titles in some containers | Use text styles (or `@ScaledMetric`) instead of fixed sizes where the design allows |
| elementDetection | 3 | "Potentially inaccessible text" on Activity in light, dark and reduced, reported without an element; the likely source is the month picker's title, which the tree places off screen (x = 427 on a 402-point screen) | Check with Accessibility Inspector; hide the duplicate title from accessibility |
| hitRegion | 23 | Category chips in Add entry ("Food & drinks", "Shopping"), "See all activity", the Projected row, sign-in links ("Change", "New here? Create an account", "Take a look around") | 44 pt minimum touch targets (`Metrics.minTouchTarget`) |

The per-screen lists are the `<device>-audit-<screen>-<variant>.txt` attachments of each Screenshots run.

## Performance budgets

`PerformanceTests` (Performance plan) measures on the simulator with the Debug build (test controls are compiled out of Release, so UI tests cannot drive it). Each wall-clock number includes XCUITest's own query time, which grows with the size of the accessibility tree, so it is an upper bound on what the app spends. Two kinds of limit apply:

- **Regression budget** (asserted): about 1.5 times the first baseline, so an order-of-magnitude regression fails while runner noise does not. A run over budget fails after every number is recorded.
- **Target** (not asserted on the simulator): what the product should reach; checked on a device with Instruments before a release.

XCTest's launch metric and scroll-deceleration metric are recorded in the xcresult for trend review. On the iOS 27.0 simulator the scroll metric reports only the deceleration duration, not hitch counts, so hitches are a device check.

| Measurement | What | Baseline (iPhone 18 Pro sim, iOS 27.0) | Regression budget | Target |
| --- | --- | --- | --- | --- |
| `launch-to-home-demo` | Cold launch to the demo's Home, median of 3 | 6.1 s (6.1, 6.1 in two runs); XCTest launch metric 4.3 s to first responsive frame | 10 s | 2 s to an interactive Home on device |
| `sign-in-to-first-sync-large-ledger` | Tap Sign in → Home shows the hero for a 5,001-entry ledger (download, durable file write, report) | 6.0–7.7 s over three runs | 15 s | 5 s on device over Wi-Fi |
| `activity-open-large-ledger` | Home → Activity with its totals, 5,001 entries (1,001 in the month shown) | 16.0–25.3 s over three runs | 40 s | 1 s. **Far from target; needs profiling** (see below) |
| `search-server-large-ledger` | Type a rare word → server result row | 10.5–10.7 s | 15 s | 2 s |
| `search-device-large-ledger` | The server drops the request; the same query over 5,001 entries on the device | 5.8 s | 15 s | 1 s |
| Scroll deceleration (recorded) | Five fast swipes through Activity | 2.44 s per fling, RSD 0.3 % | Trend only | No hitch over 33 ms on device |

**Finding: Activity with a large ledger.** Opening Activity on a 5,001-entry ledger took 16–25 seconds on the simulator, while the first sync and Home took about 6. Part of that is XCUITest waiting for an idle app and querying a list of 200 rendered rows, and part is the app (Activity builds the period's report and day groups on the main actor on first appearance; `ActivityLocalCache` only helps afterwards). Typing a query also waits on the same tree. This needs an Instruments Time Profiler pass on a device before the numbers can be split; until then the regression budget only guards against it getting worse.

## Execution evidence

Recorded for MAZ-82 on 2026-11-12, on an Apple Silicon Mac with Xcode 27.2, the iOS 27.0 simulator runtime (iPhone 18 Pro, iPad Pro 11-inch (M5)), Docker PostgreSQL 18 + pgvector, and the real .NET API from this branch (`ios.sh ui-test`, which starts and tears down `penny-env run --oidc` around each run). The iOS 26.0 runtime was not installed, so the minimum-OS column is not evidenced here. The xcresult bundles and attachments are CI/local artifacts (`test-results/ios/ui/`), not committed.

| Run | Device | Selection | Result |
| --- | --- | --- | --- |
| Smoke plan | iPhone | `SmokeJourneyTests` (before the MAZ-82 changes) | 3 passed |
| Full plan | iPhone | MAZ-82 suites plus `SmokeJourneyTests`, `NetworkFailureTests`, `LifecycleTests` | 18 passed, 1 skipped (`test_whenInstalledOverAPreviousBuild_Launch_ShouldOpenWithoutErrors` needs `PENNY_UPGRADE_FROM_APP`), 0 retries |
| Full plan, after the driver changes | iPhone | `EntryJourneyTests`, `SyncConflictTests`, account journey | 5 passed |
| Screenshots plan | iPhone | `AccessibilityAuditTests` | 8 passed (29 audits attached; findings above) |
| Performance plan | iPhone | `PerformanceTests` | 2 passed; numbers in [performance budgets](#performance-budgets) |
| Full plan | iPad | MAZ-82 suites | Entries, search, sync conflicts and settings: 8 passed. Organize: 3 of 3 crashed the app (Settings › Manage page in the detail column), fixed in this branch; see the rerun below |
| Full plan, after the iPad fix | iPad | `OrganizeJourneyTests`, `AddEntryOverSettingsTests`, the join link over Settings | 5 passed (the three organize journeys, Add entry over a pushed Settings page, the join link over Settings) |

Also run on this branch: `apps/ios/scripts/ios.sh lint` (pass), `ios.sh package-test` (775 Swift tests in PennyKit, pass, including AccessibilityIDTests with the new identifiers), `ios.sh ui-build` and `ios.sh release-check` (pass; no test controls in Release), `npm run test:core` (155 tests, pass, including `scripts/tests/native-qa.test.ts`), `npm run lint`, `npm run typecheck`, `node scripts/check-version.mjs` (pass). The backend is unchanged by MAZ-82; its unit tests ran with 510 of 511 passing: `OcrOptionsTests.whenValueInvalid_Read_ShouldFailWithTheSettingName(Ocr:EngineMemoryMegabytes, 128)` fails. This branch changes no backend file, so the failure is pre-existing on `origin/v2` (not investigated here). The run also needed `TESTINGPLATFORM_PIPE_DIRECTORY` set to a short path: the worktree's default `.cache/p` exceeded the 103-byte Unix socket limit.

Not run here: the existing `HouseholdJourneyTests` (except the join link), `TripJourneyTests`, `ReceiptJourneyTests`, `AuthJourneyTests`, `NotificationJourneyTests`, `OverviewJourneyTests` and `ScreenshotTests` (their harness is unchanged apart from `openSettings` retrying and faults being cleared at the start; the nightly matrix runs them), the backend integration tests, and the iOS 26.0 minimum-OS row.

Defects found and fixed by these runs:

1. **iPad crash** opening Settings › Recurring, Accounts or Categories (`NavigationColumnState.boundPathChange`).
2. **Sign-in at AX-XXXL**: the demo link covered Sign in while the keyboard was up, so the tap opened the demo.
3. **Recurrence in UI tests**: the offline store recorded due occurrences with the real date instead of the pinned `PENNY_TEST_TODAY`.
4. **Activity's search empty state** had no reachable identifier (`activity.searchEmpty`, Search all months).

## Device release checklist

Simulators cannot check these; run them on a physical iPhone and iPad with the release candidate from TestFlight before submitting, and record the device, OS and build in the release issue.

- [ ] **Upgrade from the App Store build**: install the current store build, sign in, add an entry offline, then install the candidate over it (TestFlight). The session, the pending entry and the appearance survive (MAZ-98).
- [ ] **Face ID lock**: turn on the lock, background and return; content and open sheets are concealed and drafts kept; cancel and passcode fallback work; with Lock after set to After 1 minute, a quick return stays open and a return after a minute asks (MAZ-69, `iphone-lock`, `iphone-app-lock`).
- [ ] **Push notifications**: register on the production APNs environment, receive a household expense notification from a second account, tap it locked and unlocked (MAZ-79, [notifications](notifications.md)).
- [ ] **Widgets**: add small widgets to the Home Screen, check light and dark, refresh after a new entry, tap through to Add entry and Home, sign out clears them (MAZ-80, `system-widgets`).
- [ ] **Camera**: scan an invite QR code from a second device (MAZ-75); simulators have no camera.
- [ ] **VoiceOver pass**: navigate Home, Activity, Add entry and Settings with VoiceOver on; every control is announced with its purpose; the amount keypad is usable.
- [ ] **Largest text and Bold Text**: Home, Add entry and a household at AX-XXXL with Bold Text.
- [ ] **Hardware keyboard on iPad**: Tab moves focus through the entry form, Return saves where expected, ⌘. or Escape closes sheets.
- [ ] **Performance**: cold launch and Activity scroll in Instruments against the device budgets above.
- [ ] **Network**: airplane mode while adding an entry, then reconnect; the entry syncs once.
- [ ] **Server restart**: restart the API (or PostgreSQL) while the app is open; pending changes sync once the server is back and totals match the server.
- [ ] **Haptics and motion** (MAZ-287, [motion](../design/motion.md#haptics-ios)): on an iPhone, do every action in the haptics table and feel exactly one haptic of the right kind for each: save, a refused save, Undo, step the month, focus a money-flow band, delete after its confirmation, open and close Add entry, a category menu and Show as a table, open the filters, open an entry and a household, Retry a failed sync. A sync from another device plays none. With Reduce Motion on, nothing slides, scales, shakes or counts; fades and haptics stay.

## Triage procedure

1. **Find the failing step.** Open `test-results/ios/ui/<plan>/<device>.xcresult` (CI artifact `ios-ui-<plan>-<os>`). Failures name the identifier that did not appear (`UIExpectationFailed`). The "App UI hierarchy" attachment shows what was on screen; search it for the identifier and for `PopoverDismissRegion`, `Sheet` or `Alert` to spot an unexpected dialog.
2. **Check the server side.** `server/api.log` has every request with status codes and applied faults; a 409 loop or a 5xx without an injected fault is a backend bug.
3. **Classify.**
   - Product bug (the app or API does the wrong thing): open a Linear issue with the xcresult, the failing step and the server log excerpt, label it with the feature's issue, and link it from the release issue. Release blockers: data loss, wrong totals, a crash, a privacy leak, a journey that cannot be completed.
   - Test bug (a changed identifier, a new system presentation such as a popover instead of an action sheet): fix the driver (`PennyUITests/Support`) in the same day.
   - Flaky (passes on the Full plan's retry): follow the [flaky-test policy](ui-tests.md#flaky-test-policy): issue with the xcresult, fix or `XCTSkip("Flaky: MAZ-…")` within a week.
   - Environment (simulator runtime missing, stack did not start): re-run; if it persists, fix the runner, not the test.
4. **Reproduce one test**: `PENNY_UI_DEVICES=iphone PENNY_UI_ONLY=PennyUITests/<Class>/<test> apps/ios/scripts/ios.sh ui-test full`, or keep a stack up (`node scripts/test-env/penny-env.mjs up --oidc`) and run it from Xcode.
5. **Accessibility findings**: read the `audit-*.txt` attachment. Fix in the view (labels, `accessibilityElement`, Dynamic Type styles, contrast tokens) or, for a system control Penny does not draw, add a reviewed entry to `AccessibilityAuditTests.accepted` and to the table above.
6. **Performance budget exceeded**: re-run the Performance plan once; if it is still over, compare the `perf-*.json` attachments with the last green nightly and bisect.

## Coverage gaps

Explicit gaps, not covered by any automated native test in this repository:

- **Minimum OS run.** Only the iOS 27.0 simulator runtime was installed where MAZ-82 was developed, so the evidence below is iOS 27.0 only. `ios-ui-matrix.yml` installs and runs iOS 26.0; the first nightly after merge is the minimum-OS evidence.
- **Server restart.** The test environment has no command to restart the API or PostgreSQL under a running test, so "durable after a server restart" is not automated. Durability across app restarts is (every journey relaunches); server-side durability is covered by the backend's PostgreSQL integration tests. Device checklist item.
- **Duplicate submit, Saved toast and Undo.** Unit-tested in PennyKit (EntryFlowTests); the 4-second toast is not asserted in a UI journey because XCTest's idle waits outlast it.
- **Category rename onto an existing name (merge)** and **in-use removal guards** for accounts and categories: unit-tested only.
- **Category picker sheet, personal split sheet, entry extras (repeat, trip), household history, schedule pause/remove swipes, anchor-31 month ends, stale monthly payment recovery**: no UI journey; the rules are unit-tested in PennyKit.
- **Signed-out verification of another server** (`iphone-server-connect`): only the default test server is exercised in UI tests.
- **Face ID lock success path, push, widgets, camera**: need hardware; see the device release checklist. On the simulator the app lock's refusal path runs on the real device check, and Lock after (`AppLockDelayTests`) runs with the Debug Face ID stand-in (`PENNY_TEST_DEVICE_AUTH`).
- **Hardware keyboard and focus on iPad.** Penny defines no keyboard shortcuts, and XCUITest does not model a hardware keyboard's focus ring; this is a device checklist item. The software keyboard is covered (keyboard-safe Add entry).
- **VoiceOver navigation order and rotor.** Labels are checked automatically; the order and grouping need the device VoiceOver pass.
- **Visual comparison with the redesign cards** (MAZ-122): the Cards plan captures each card's state, and each verdict is in [visual-comparisons.json](../../contracts/visual-comparisons.json) ([visual acceptance](../design/visual-acceptance.md)). Captures are reviewed side by side with the baselines, not diffed pixel by pixel, because SF Pro and Liquid Glass differ from the cards by design.
- **Performance on devices.** Budgets above are simulator Debug-build numbers; device numbers are a release checklist item.
- **Multiple Penny devices of one person at once** are exercised as "this app plus the API as another device", not as two simulators running the app.
