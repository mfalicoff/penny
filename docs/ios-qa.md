# Native QA matrix and release gates (MAZ-82)

[Documentation](README.md) · [Native UI tests](ios-ui-tests.md) · [Native app](../apps/ios/README.md) · [Redesign baseline](migration/redesign.md) · [Feature parity](migration/feature-parity.md)

This page is the native iOS release gate: which journeys are covered on the simulator and how, which redesign cards they trace to, the accessibility and performance checks with their budgets, what was actually run (execution evidence), what only a physical device can check, how to triage a failure, and the known coverage gaps. The harness itself (plans, launch controls, the stack, artifacts, flaky-test policy) is described in [native UI tests](ios-ui-tests.md); this page does not repeat it.

Everything here runs against the real .NET API on PostgreSQL from the [full-stack test environment](migration/test-environment.md), with synthetic `.test` accounts and fixed synthetic amounts. No test mocks the business API, and no fixture contains personal financial data or credentials.

## Plans

| Plan | Command | Contents | When |
| --- | --- | --- | --- |
| Smoke | `apps/ios/scripts/ios.sh ui-test smoke` | Install, sign in, write, relaunch, read; add expense | Every PR (required) |
| Full | `apps/ios/scripts/ios.sh ui-test full` | Every functional journey below | Nightly, releases, on demand |
| Screenshots | `apps/ios/scripts/ios.sh ui-test screenshots` | `ScreenshotTests` and `AccessibilityAuditTests` | Nightly, releases, on demand |
| Performance | `apps/ios/scripts/ios.sh ui-test performance` | `PerformanceTests` (budgets below) | Nightly, releases, on demand |

All four run on clean iPhone and iPad simulators (`PENNY_UI_DEVICES`), on the minimum OS (iOS 26.0) and the newest runtime in `ios-ui-matrix.yml`. `PENNY_UI_ONLY` takes several space-separated classes or tests.

## Journey matrix

Each row is a parity area from [feature parity](migration/feature-parity.md). "Server-checked" means the test reads the account's ledger back through `GET /api/ledger` after the write and compares amounts in cents, including the recorded totals per kind (`LedgerJSON.shareTotal`).

| Area | Suites | What is exercised | Durable after | Server-checked totals |
| --- | --- | --- | --- | --- |
| Install, auth and demo | `SmokeJourneyTests`, `AuthJourneyTests`, `LifecycleTests`, `OverviewJourneyTests` | Clean install, password and OIDC sign-in, account creation, wrong password, SSO cancel, session expiry by moving the server clock, sign-out with pending changes, account switching, the demo | App relaunch, reinstall | Currency |
| Transactions | `EntryJourneyTests`, `SmokeJourneyTests` | Add expense and income, kind filters that never change totals, edit amount from the detail, delete with a dialog that can be dismissed, HTTP 500 during sync | App relaunch | Yes, after each write |
| Search (PostgreSQL) | `SearchJourneyTests` | Online keyword and typo search on `POST /api/v1/search/transactions`, empty state, device search while a change is pending (and the scope line saying so), reconciliation with the server after reconnect | — | Entry present |
| Accounts and categories | `OrganizeJourneyTests` | Create an account; create, use and rename a category (one id, new name everywhere) | App relaunch | Yes |
| Recurrence | `OrganizeJourneyTests` | New monthly schedule records its first date; relaunching on a later day records the next occurrence | App relaunch at a later date | Yes (2 × amount) |
| Offline, reconnect, conflicts | `NetworkFailureTests`, `SyncConflictTests`, `EntryJourneyTests` | Dropped connections and 500s, pending banner, terminate while offline, field-by-field merge of two devices, delete-versus-edit | App relaunch while offline | Yes |
| Households and shared expenses | `HouseholdJourneyTests` | Two users on the real API: invite, join, split, payment, stale edit, links, scanner without camera | — | Split amounts |
| Trips | `TripJourneyTests` | Personal trip shared with earlier private expenses, splits, totals counted once, delete guard | — | Yes |
| Receipts | `ReceiptJourneyTests` | Photo and PDF round trips (SHA-256), failures, oversized and renamed files, session end during upload | — | Bytes |
| Reports | `OverviewJourneyTests` | Left to spend before Projected, money flow focus, calendar day selection keeps month totals, Insights drill-down, XXXL value lists | — | Demo data |
| Settings and links | `SettingsJourneyTests`, `SmokeJourneyTests`, `HouseholdJourneyTests`, `NotificationJourneyTests`, `AddEntryOverSettingsTests` | Appearance kept across relaunch, app lock refused where the device cannot authenticate, currency, `penny://join` links, notification navigation | App relaunch | Currency |
| Upgrades | `LifecycleTests` | Seeded earlier-install state; `PENNY_UPGRADE_FROM_APP` installs a previous build first | Upgrade | — |

### Redesign card trace

Every card in [design-baseline.json](../contracts/design-baseline.json) whose native acceptance is MAZ-82 has a row. `tests/core/native-qa.test.ts` fails if a card is missing here or if this page names an XCUITest suite or test that does not exist. Visual comparison against the cards is MAZ-122's; a row marked Covered means the behavior is exercised, not that the screen matches the card pixel for pixel. The eight `web-*` cards are browser references (MAZ-96); their native counterparts are named.

| Card | Native suites | Notes | Status |
| --- | --- | --- | --- |
| `system-foundations` | `AccessibilityAuditTests`, `ScreenshotTests` | Contrast audit in light/dark/XXXL and Reduce Transparency; TokenBaselineTests (PennyKit) checks tokens | Covered (automated audit + screenshots) |
| `system-widgets` | — | WidgetKit rendering, families and deep links are device checks (MAZ-80, PennyWidgetUITests in PennyKit) | Device-only (checklist) |
| `iphone-home` | `OverviewJourneyTests`, `AccessibilityAuditTests`, `ScreenshotTests` | Left to spend before Projected; audit; light/dark × default/XL/RT/RM captures | Covered |
| `iphone-home-dark` | `ScreenshotTests`, `AccessibilityAuditTests` | Dark captures and dark/dark-XXXL audits | Covered (visual comparison: MAZ-122) |
| `iphone-money-flow` | `OverviewJourneyTests`, `ScreenshotTests` | Focus/clear, value list at XXXL | Covered |
| `iphone-insights` | `OverviewJourneyTests`, `AccessibilityAuditTests` | Category drill-down; audited in every variant | Covered |
| `iphone-calendar` | `OverviewJourneyTests`, `ScreenshotTests` | Day selection keeps month totals | Covered |
| `iphone-activity` | `EntryJourneyTests`, `SearchJourneyTests`, `AccessibilityAuditTests` | Day rows, kind filters keep totals, server totals after each write | Covered |
| `iphone-search-empty` | `SearchJourneyTests` | No-match query shows the empty state | Covered |
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
| `iphone-recurring` | `OrganizeJourneyTests` | New schedule saved on the server | Covered; pause/remove swipe has no UI journey (unit-tested) |
| `iphone-schedule-detail` | `OrganizeJourneyTests` | Occurrences recorded across relaunches at a later day | Partly: anchor-31 is unit-tested only |
| `iphone-accounts` | `OrganizeJourneyTests` | — | Covered; in-use removal guard is unit-tested only |
| `iphone-account-form` | `OrganizeJourneyTests` | — | Covered |
| `iphone-categories` | `OrganizeJourneyTests` | — | Covered |
| `iphone-category-form` | `OrganizeJourneyTests` | Create and rename; entries show the new name | Covered; in-use removal guard is unit-tested only |
| `iphone-appearance` | `SettingsJourneyTests`, `LifecycleTests` | Light, Dark, System kept across relaunch | Covered |
| `iphone-app-lock` | `SettingsJourneyTests` | Unavailable biometrics explained, lock stays off | Partly: enabling, unlocking and concealing sheets are device checks |
| `iphone-sign-in` | `AuthJourneyTests`, `NetworkFailureTests`, `AccessibilityAuditTests` | Password, SSO, wrong password, dropped request, audit | Covered |
| `iphone-create-account` | `AuthJourneyTests` | — | Covered |
| `iphone-server-connect` | `SmokeJourneyTests` | Clean install shows the test server | Partly: credential-free verification of another server is unit-tested only |
| `iphone-lock` | — | — | Device-only (checklist): needs enrolled Face ID |
| `iphone-empty-home` | `SmokeJourneyTests`, `EntryJourneyTests` | Empty Home after sign-in | Covered |
| `iphone-offline` | `NetworkFailureTests`, `SyncConflictTests`, `SearchJourneyTests` | Offline banner, durable pending edits, merge on reconnect | Covered |
| `iphone-save-error` | `EntryJourneyTests` | HTTP 500 on sync keeps the entry and syncs once | Partly: the form's Couldn't save banner (local write failure) is unit-tested only |
| `iphone-saved-toast` | — | The toast is unit-tested (EntryFlowTests); it shows for 4 s during dismissal, which XCTest's idle waits outlast | Gap: not asserted in a UI journey |
| `iphone-sign-out` | `AuthJourneyTests` | Pending change asks and syncs first | Covered |
| `ipad-home` | `OverviewJourneyTests`, `ScreenshotTests` | Run with PENNY_UI_DEVICES=ipad | Covered on iPad runs |
| `ipad-activity` | `EntryJourneyTests`, `SearchJourneyTests` | List with detail beside it | Covered on iPad runs |
| `ipad-add-entry` | `AddEntryOverSettingsTests`, `EntryJourneyTests` | Text-field amount at regular width | Covered on iPad runs |
| `ipad-shared` | `HouseholdJourneyTests` | — | Covered on iPad runs |
| `ipad-trip` | `TripJourneyTests` | — | Covered on iPad runs |
| `ipad-settings` | `AddEntryOverSettingsTests`, `SettingsJourneyTests` | Settings as the detail column | Covered on iPad runs |
| `web-home` | — | Web-only reference: native behavior is traced through `iphone-home`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-activity` | — | Web-only reference: native behavior is traced through `iphone-activity`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-insights` | — | Web-only reference: native behavior is traced through `iphone-insights`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-household` | — | Web-only reference: native behavior is traced through `iphone-shared`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-trips` | — | Web-only reference: native behavior is traced through `iphone-trips`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-settings` | — | Web-only reference: native behavior is traced through `iphone-settings`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-add-entry` | — | Web-only reference: native behavior is traced through `iphone-add-expense`; the browser journeys are MAZ-96 | Not applicable to native |
| `web-sign-in` | — | Web-only reference: native behavior is traced through `iphone-sign-in`; the browser journeys are MAZ-96 | Not applicable to native |

Justified native adaptations are recorded in [redesign](migration/redesign.md#native-implementation-notes-maz-69). Android has no card (the Android app is retired, MAZ-98), and the desktop-only `web-*` cards have no native screen.

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

**Recorded debt.** The final audit run (iPhone 18 Pro, iOS 27.0, 2026-11-12) found 257 issues of five types across the 25 main-screen audits and the 4 sign-in audits; the counts below are from that run. They are real and need design or code fixes, so the test records them (`AccessibilityAuditTests.recordedDebt`) instead of failing on them; the remaining types (element descriptions, traits) found nothing and fail on any new finding. The audits also found one layout bug that is fixed here: at AX-XXXL with the keyboard up, the sign-in screen's "Take a look around with sample data" link rode above the keyboard and covered Sign in, so a tap meant for Sign in opened the demo; the link now steps aside while the keyboard is up at accessibility sizes (`SignedOutFlow`). Each type comes out of `recordedDebt` once its follow-up is fixed.

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

Also run on this branch: `apps/ios/scripts/ios.sh lint` (pass), `ios.sh package-test` (775 Swift tests in PennyKit, pass, including AccessibilityIDTests with the new identifiers), `ios.sh ui-build` (pass), `npm run test:core` (155 tests, pass, including `tests/core/native-qa.test.ts`), `npm run lint`, `npm run typecheck`, `npm run version:check` (pass). The backend is unchanged by MAZ-82; its unit tests ran with 510 of 511 passing: `OcrOptionsTests.whenValueInvalid_Read_ShouldFailWithTheSettingName(Ocr:EngineMemoryMegabytes, 128)` fails. This branch changes no backend file, so the failure is pre-existing on `origin/v2` (not investigated here). The run also needed `TESTINGPLATFORM_PIPE_DIRECTORY` set to a short path: the worktree's default `.cache/p` exceeded the 103-byte Unix socket limit.

Not run here: the existing `HouseholdJourneyTests` (except the join link), `TripJourneyTests`, `ReceiptJourneyTests`, `AuthJourneyTests`, `NotificationJourneyTests`, `OverviewJourneyTests` and `ScreenshotTests` (their harness is unchanged apart from `openSettings` retrying and faults being cleared at the start; the nightly matrix runs them), the backend integration tests, and the iOS 26.0 minimum-OS row.

Defects found and fixed by these runs:

1. **iPad crash** opening Settings › Recurring, Accounts or Categories (`NavigationColumnState.boundPathChange`).
2. **Sign-in at AX-XXXL**: the demo link covered Sign in while the keyboard was up, so the tap opened the demo.
3. **Recurrence in UI tests**: the offline store recorded due occurrences with the real date instead of the pinned `PENNY_TEST_TODAY`.
4. **Activity's search empty state** had no reachable identifier (`activity.searchEmpty`, Search all months).

## Device release checklist

Simulators cannot check these; run them on a physical iPhone and iPad with the release candidate from TestFlight before submitting, and record the device, OS and build in the release issue.

- [ ] **Upgrade from the App Store/Expo build**: install the current store build, sign in, add an entry offline, then install the candidate over it (TestFlight). The session, the pending entry and the appearance survive (MAZ-72/98).
- [ ] **Face ID lock**: turn on the lock, background and return; content and open sheets are concealed and drafts kept; cancel and passcode fallback work (MAZ-69, `iphone-lock`, `iphone-app-lock`).
- [ ] **Push notifications**: register on the production APNs environment, receive a household expense notification from a second account, tap it locked and unlocked (MAZ-79, [notifications](ios-notifications.md)).
- [ ] **Widgets**: add small widgets to the Home Screen, check light and dark, refresh after a new entry, tap through to Add entry and Home, sign out clears them (MAZ-80, `system-widgets`).
- [ ] **Camera**: scan an invite QR code from a second device (MAZ-75); simulators have no camera.
- [ ] **VoiceOver pass**: navigate Home, Activity, Add entry and Settings with VoiceOver on; every control is announced with its purpose; the amount keypad is usable.
- [ ] **Largest text and Bold Text**: Home, Add entry and a household at AX-XXXL with Bold Text.
- [ ] **Hardware keyboard on iPad**: Tab moves focus through the entry form, Return saves where expected, ⌘. or Escape closes sheets.
- [ ] **Performance**: cold launch and Activity scroll in Instruments against the device budgets above.
- [ ] **Network**: airplane mode while adding an entry, then reconnect; the entry syncs once.
- [ ] **Server restart**: restart the API (or PostgreSQL) while the app is open; pending changes sync once the server is back and totals match the server.

## Triage procedure

1. **Find the failing step.** Open `test-results/ios/ui/<plan>/<device>.xcresult` (CI artifact `ios-ui-<plan>-<os>`). Failures name the identifier that did not appear (`UIExpectationFailed`). The "App UI hierarchy" attachment shows what was on screen; search it for the identifier and for `PopoverDismissRegion`, `Sheet` or `Alert` to spot an unexpected dialog.
2. **Check the server side.** `server/api.log` has every request with status codes and applied faults; a 409 loop or a 5xx without an injected fault is a backend bug.
3. **Classify.**
   - Product bug (the app or API does the wrong thing): open a Linear issue with the xcresult, the failing step and the server log excerpt, label it with the feature's issue, and link it from the release issue. Release blockers: data loss, wrong totals, a crash, a privacy leak, a journey that cannot be completed.
   - Test bug (a changed identifier, a new system presentation such as a popover instead of an action sheet): fix the driver (`PennyUITests/Support`) in the same day.
   - Flaky (passes on the Full plan's retry): follow the [flaky-test policy](ios-ui-tests.md#flaky-test-policy): issue with the xcresult, fix or `XCTSkip("Flaky: MAZ-…")` within a week.
   - Environment (simulator runtime missing, stack did not start): re-run; if it persists, fix the runner, not the test.
4. **Reproduce one test**: `PENNY_UI_DEVICES=iphone PENNY_UI_ONLY=PennyUITests/<Class>/<test> apps/ios/scripts/ios.sh ui-test full`, or keep a stack up (`npm run test-env -- up --oidc`) and run it from Xcode.
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
- **Face ID lock success path, push, widgets, camera**: need hardware; see the device release checklist. On the simulator only the app lock's refusal path runs.
- **Hardware keyboard and focus on iPad.** Penny defines no keyboard shortcuts, and XCUITest does not model a hardware keyboard's focus ring; this is a device checklist item. The software keyboard is covered (keyboard-safe Add entry).
- **VoiceOver navigation order and rotor.** Labels are checked automatically; the order and grouping need the device VoiceOver pass.
- **Visual comparison with the redesign cards** is MAZ-122. Screenshots are captured, but not diffed against card baselines.
- **Performance on devices.** Budgets above are simulator Debug-build numbers; device numbers are a release checklist item.
- **Multiple Penny devices of one person at once** are exercised as "this app plus the API as another device", not as two simulators running the app.
