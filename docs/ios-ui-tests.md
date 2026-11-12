# Native UI tests (XCUITest, MAZ-81)

[Native app](../apps/ios/README.md) · [Full-stack test environment](migration/test-environment.md) · [Redesign baseline](migration/redesign.md)

Penny's XCUITest suites drive the installed Debug app on clean iPhone and iPad simulators against the real .NET API on PostgreSQL (MAZ-62's disposable environment), with the local OIDC provider for single sign-on. Nothing mocks the business API: tests arrange data through the same HTTP API the app uses, from a "second device", and use only the environment's test controls (`/api/test/*`) to create isolated accounts, pin the server clock and inject faults.

| Path | Contents |
| --- | --- |
| `apps/ios/PennyUITests/` | The UI test target (synchronized folder). `Support/` holds the harness, one folder per suite area |
| `apps/ios/PennyUITests/Support/Stack.swift` | The stack client: environment discovery, test accounts, clock, faults, OIDC provider controls, ledger reads and writes |
| `apps/ios/PennyUITests/Support/PennyUITestCase.swift` | Base class: launch options, relaunch, screenshots, accessibility tree on failure |
| `apps/ios/PennyUITests/Support/Penny.swift` | The app driver: identifiers, waits, iPhone/iPad navigation, dialogs, system alerts |
| `apps/ios/PennyUITests/Support/ContainerSeed.swift` | State an earlier install left (upgrade rehearsals) |
| `apps/ios/TestPlans/*.xctestplan` | Smoke, Full and Screenshots plans of the **PennyUITests** scheme |
| `apps/ios/Penny/TestControls.swift`, `TestStorage.swift` | The Debug-only launch controls the tests use |
| `apps/ios/Packages/PennyKit/Sources/PennyAccessibility` | The shared accessibility identifiers |
| `apps/ios/scripts/ios.sh ui-test` | Starts the stack, creates simulators, runs a plan, collects artifacts |

## Running

```sh
apps/ios/scripts/ios.sh ui-test smoke        # the PR suite (default)
apps/ios/scripts/ios.sh ui-test full         # every journey except screenshots
apps/ios/scripts/ios.sh ui-test screenshots  # appearance and accessibility captures
apps/ios/scripts/ios.sh ui-build             # compile the app and the UI tests only
```

`ui-test` needs what the full-stack environment needs (Docker or Podman, or the [native PostgreSQL mode](migration/test-environment.md#without-a-container-runtime); the .NET SDK, Node 24 and the search model; see [prerequisites](migration/test-environment.md#prerequisites)) plus Xcode 27.2. Without `PENNY_API_URL` it runs `penny-env run --oidc` around itself: the environment is created, the plan runs, server logs are collected and everything is torn down, also on failure. With an environment already up (`PENNY_API_URL`, `PENNY_TEST_TOKEN` and `PENNY_TEST_RUN` exported, for example from `npm run test-env -- env`), it uses that one.

| Variable | Effect |
| --- | --- |
| `PENNY_UI_DEVICES` | `iphone`, `ipad` or `iphone ipad` (default) |
| `PENNY_UI_ONLY` | One class or test, e.g. `PennyUITests/AuthJourneyTests/test_whenPasswordIsWrong_SignIn_ShouldShowTheErrorAndKeepTheEmail` |
| `PENNY_RUNTIME` | A simulator runtime identifier (the OS matrix) |
| `PENNY_IPHONE`, `PENNY_IPAD` | Device types, as for `ios.sh test` |
| `PENNY_STACK_BUILD=0` | Reuse the API's Release build instead of rebuilding it |
| `PENNY_UPGRADE_FROM_APP` | A previous `Penny.app`: installed and launched first, so the plan upgrades it in place |

In Xcode: start an environment with `npm run test-env -- up --oidc`, keep it running, choose the **PennyUITests** scheme, a simulator and a test plan, and test (⌘U). The runner finds the environment through `.cache/test-env/current`. Without one, every UI test is skipped (under `ios.sh` a missing stack is a failure instead). For single sign-on, trust the provider's certificate first: `xcrun simctl keychain booted add-root-cert <oidcCertificate>` from `up`'s output.

### Results

Everything lands in `test-results/ios/ui/<plan>/` (ignored by Git; CI uploads it):

| File | Contents |
| --- | --- |
| `iphone.xcresult`, `ipad.xcresult` | Result bundles: logs, failures, attachments, and what XCTest collects on a failure (UI snapshot, the app's accessibility hierarchy, the element debug descriptions; screen recordings when the runtime provides them) |
| `iphone-attachments/`, `ipad-attachments/` | The same attachments exported as files (`xcresulttool export attachments`) with a `manifest.json` |
| `server/` | `api.log`, `postgres.log` and `environment.json` of the run (no token or passwords) |

Named screenshots (`<device>-<appearance>-<step>`) are kept on success; XCTest's failure diagnostics (the "App UI hierarchy" text and the UI snapshot) only on failure.

## Plans and the OS/device matrix

| Plan | Contents | When | Retries |
| --- | --- | --- | --- |
| **Smoke** | `SmokeJourneyTests`: clean install opens sign-in; sign in → create → relaunch → read; Home → Add expense → Saved → Activity (skipped until MAZ-73) | Every PR and push to `v2` (`ios.yml`, job `ui-smoke`), required | None |
| **Full** | Everything except screenshots: smoke, lifecycle and upgrade, network failures, auth journeys, the overview journeys (`OverviewJourneyTests`, demo data, MAZ-77), notification navigation (`NotificationJourneyTests`, MAZ-79) | Nightly, on releases and on demand (`ios-ui-matrix.yml`) | One retry on failure, reported |
| **Screenshots** | `ScreenshotTests`: light and dark × default, accessibility XL text, Reduce Transparency, Reduce Motion; sign-in with keyboard and error | Nightly, on releases and on demand | None |

| | Minimum OS | Current OS |
| --- | --- | --- |
| Runtime | iOS/iPadOS 26.0 (the deployment target; `xcodebuild -downloadPlatform iOS -buildVersion 26.0`) | The newest runtime the pinned Xcode supports (27.0 with Xcode 27.2; 27.1 has no device types there) |
| iPhone | Newest iPhone *N* Pro | same |
| iPad | Newest iPad Pro 11-inch | same |
| Smoke (PR) | | ✓ |
| Full, Screenshots | ✓ | ✓ |

There is no older-OS fallback to test: iOS 26 is the floor (README, minimum OS), so the Liquid Glass control layer is real on every row.

## Test environment, isolation and determinism

- **Accounts**: every test creates its own account (`POST /api/test/users`, `<label>-<n>-<random>@penny.test`, random password). Tests never share data and can run in any order; the database itself is per run.
- **Clock**: the first stack access pins the server clock to `2026-10-15T12:00:00Z` (the seeds' clock), and the app's "today" to `2026-10-15` (`PENNY_TEST_TODAY`). Tests that move the clock (session expiry) do so explicitly; the next test pins it again.
- **Single sign-on** tests unpin the server clock first (`Stack.unpinClock()`): the API's HTTP `Date` header is real time while the attempt's `expiresAt` follows the pinned clock, so at the pinned 2026-10-15 the app sees an already-expired attempt ("Sign-in expired"). The provider's ID tokens use real time anyway.
- **Faults**: injected with `PUT /api/test/faults` (abort or status, per method and path prefix) and always cleared in `tearDown`. Faults are global to the environment, which is why plans are not parallelized.
- **App state**: every test's first launch sets `PENNY_TEST_RESET=1`, which erases the app's defaults, App Group container, Application Support, Documents, Caches and Keychain items before anything reads them: the same state as a fresh install. `relaunch()` terminates and relaunches without it, keeping the session, the offline ledger and preferences. The runner additionally creates new simulators for every run and deletes them afterwards.
- **Demo data**: screenshot tests use the temporary demo (`PENNY_TEST_DEMO=1`) at the pinned date, so captures are comparable across runs.

### Launch controls

Debug-only (`#if PENNY_TEST_CONTROLS`); `ios.sh release-check` fails if any `PENNY_TEST_*` name, `TestControls`, `TestStateReset` or `ContainerSeed` reaches the Release bundle. `TestControlsTests` covers parsing and the seed.

| Variable | Effect |
| --- | --- |
| `PENNY_TEST_SERVER_URL` | Default server (the stack) |
| `PENNY_TEST_DEMO=1` | Open the demo |
| `PENNY_TEST_RESET=1` | Erase all stored state first (a fresh install) |
| `PENNY_TEST_TODAY=yyyy-MM-dd` | Pin the app's today |
| `PENNY_TEST_CONTAINER_SEED=<path>` | Apply a seed property list after the reset |
| `PENNY_TEST_REDUCE_TRANSPARENCY=1`, `PENNY_TEST_REDUCE_MOTION=1` | Force those settings for Penny's own views (system controls follow the simulator) |
| `PENNY_TEST_NOTIFICATION=<json>`, `PENNY_TEST_NOTIFICATION_ON_RESUME=<json>` | Open a notification payload (the APNs custom keys) as if tapped, at launch or on the first return from the background, through `PushNotifications.didOpen` ([native notifications](ios-notifications.md#tests-and-verification), MAZ-79) |

Large text uses the system launch argument `-UIPreferredContentSizeCategoryName`. Appearance is set with `XCUIDevice.shared.appearance` and pinned through Penny's own setting (a `penny.appearance` seed), because the device setting alone did not restyle a freshly launched app on the iOS 27.0 simulator.

### Install, upgrade, relaunch, network and permissions

- **Clean install**: a fresh simulator per run, and `PENNY_TEST_RESET` per test.
- **Upgrade (seeded state)**: `ContainerSeed` writes standard and App Group defaults and files into the containers before launch (`LifecycleTests`). MAZ-72 plugs the legacy Expo layout in here: add a `ContainerSeed` builder with the synthetic legacy files and defaults, launch with it, and assert the migrated ledger and session.
- **Upgrade (real binary)**: `PENNY_UPGRADE_FROM_APP=<previous Penny.app>` installs and runs the previous build on each simulator first; the plan's install is then an in-place upgrade and `LifecycleTests` checks the launch without a reset. Without it that test is skipped.
- **Terminate/relaunch**: `relaunch()`.
- **Network failure**: server faults (`FaultRule.offline(prefix)` drops connections) rather than simulator network changes, so failures are exact and repeatable.
- **Permissions and pickers**: `Penny.acceptSystemAlert(_:)` answers system prompts from SpringBoard or the app; `XCUIApplication.resetAuthorizationStatus(for:)` resets a protected resource before a test. Besides Face ID, the household invite scanner asks for the camera (MAZ-75; `HouseholdJourneyTests` resets it and answers the prompt if one appears; the simulator has no camera, so the test sees the no-camera state). The receipt pickers (MAZ-78) run out of process and need no permission. `prepare_ui_device` (`ios.sh`) seeds every simulator with synthetic receipt files: the photo with `xcrun simctl addmedia`, the PDFs and refused files into Files › On My iPhone/iPad ([native receipts](ios-receipts.md#fixtures)). Missing Node or Files storage stops `ui-test`, and missing fixtures fail the receipt journeys rather than skipping them.

## Journeys

| Suite | Test | Plan |
| --- | --- | --- |
| `SmokeJourneyTests` | Clean install opens sign-in for the test server | Smoke |
| | Sign in (password) → change currency (a ledger write, confirmed on the server) → second device adds an entry through the API → terminate and relaunch (session restored, no sign-in) → read the entry in Activity and the currency in Settings | Smoke |
| | Home → Add expense → Saved → Activity: **skipped until MAZ-73** adds the entry form (steps in the test's TODO) | Smoke |
| `LifecycleTests` | Seeded earlier-install state is kept; upgrade over a previous build; relaunch keeps the session, a reset (reinstall) does not | Full |
| `NetworkFailureTests` | Offline write is saved, marked waiting, survives a relaunch and syncs when the server returns; a dropped sign-in keeps the input and succeeds on retry | Full |
| `AuthJourneyTests` | Wrong password keeps the email; account creation; SSO success and cancellation (local OIDC provider); session expiry by moving the server clock past 30 days, with the email kept; sign-out with a pending change asks and syncs first; account switching hides the previous account's entries | Full |
| `HouseholdJourneyTests` | A join link over Settings › Currency (the iPad column, the iPhone sheet) closes Settings, then opens the join sheet. Two people on the real API (MAZ-75): create, invite (code, QR, countdown), join with the code, an equal split stored as $45/$45 without the payer's account, the other member's share payment shown as Repaid, a concurrent edit refused with Review latest, the creator refused when leaving; `penny://join` links for this server, another server and a malformed one; the scanner without a camera keeping typed entry, and an expired code ([native households](ios-households.md#acceptance-scenarios)) | Full |
| `TripJourneyTests` | Two people on the real API (MAZ-76): a personal trip with an earlier expense is shared, the expense is never sent and shows under Only you, a shared expense before the other person joins keeps its participants, a later one splits between both, totals count each once, Balances; New trip, Trip expense on the trip, Delete refused while an entry is assigned and allowed once it is moved ([native trips](ios-trips.md)) | Full |
| `AddEntryOverSettingsTests` | iPad: Add entry from Settings › Currency opens over the Settings column and leaves the page in place (MAZ-78) | Full |
| `ReceiptJourneyTests` | Photo and PDF upload, preview and share with SHA-256 round trips and another account's 404; upload failure and Try again; oversized and renamed files refused; pickers cancelled at XL text; session ended during upload with the draft back; the viewer's 404, offline and Try again ([native receipts](ios-receipts.md#tests)) | Full |
| `ScreenshotTests` | Home, Activity, Settings in light/dark × default/XL text/Reduce Transparency/Reduce Motion; sign-in, keyboard and error in light/dark | Screenshots |

Online/offline keyword search fixtures (MAZ-73 search) and the per-card baseline comparison (MAZ-122) build on this harness: seed with `npm run test-env -- seed searchable-household` or `Stack` calls, and capture with `screenshot(_:)` named after the card id in `contracts/fixtures/redesign-states.json`.

## Accessibility identifiers

Tests find elements only by identifier, never by visible text (except system-provided dialog buttons and tab bar labels, which have none). The identifiers live in `PennyAccessibility.AccessibilityID` and are mirrored as string literals in the views.

- `<area>.<element>`, lowerCamelCase segments: `auth.email`, `home.settings`, `settings.syncStatus`.
- Each screen's root is `screen.<name>`: `screen.home`, `screen.activity`, `screen.currency` (one per row of MAZ-122's screen-to-test matrix).
- Rows and options end with the model's stable id or raw value: `entry.<transaction id>`, `trip.<id>`, `currency.EUR`, `appearance.dark`, `settings.<SettingsRoute>`, `tab.<AppTab>`, `sidebar.<item>`. Never an index or a title.
- iPhone and iPad keep their own areas for navigation (`tab.*` and `sidebar.*`); screens are shared.

`AccessibilityIDTests` (PennyKit, runs in `ios.sh package-test`) fails when an identifier breaks the convention, is duplicated, or is listed in `AccessibilityID` but not set by any view. A new screen adds its literal in the view and its constant in `AccessibilityID` in the same change.

## Flaky-test policy

- The Smoke plan has no retries: a smoke failure blocks the PR. If a smoke test fails without a product cause, fix it or move it out of Smoke the same day with a linked issue; never add sleeps.
- The Full plan retries a failed test once. A test that passes only on retry is flaky: open an issue with the xcresult, and fix or quarantine it (`throw XCTSkip("Flaky: MAZ-…")`) within a week.
- Wait on conditions, never on time: `Penny.wait(for:)`, `waitForSelection`, `waitForEntry` (pulls to refresh) and `Stack.waitForLedger` (polls the server).
- Failures stop the test: helpers throw `UIExpectationFailed` rather than `XCTFail`, because XCTest cannot stop async test code after a soft failure. Do not snapshot the app from `record(_:)`: it deadlocks async UI tests.

## Findings and known issues

- **Fixed**: `AdaptiveColor.color` (PennyDesign) trapped when SwiftUI resolved a color on its async render thread (main-actor closure under the module's default isolation); it crashed sign-in, account creation and offline journeys. The getter is now `nonisolated`.
- **Mitigated, not confirmed**: on iPad, going back from Settings › Currency in the detail column crashed once in SwiftUI (`NavigationColumnState.boundPathChange`, `swift_unexpectedError`) in `test_whenChangesArePending_SignOut…`; it did not reproduce in isolation. The Settings stack in the split view's detail column (`SplitShell`) was the only one without its own identity, so the column could carry another stack's state (a `[DetailRoute]` path) into its `[SettingsRoute]` path; it now has one, like the tab and Manage stacks (MAZ-141). Watch the `full` plan on iPad for a recurrence.
- **Fixed** (MAZ-78): on iPad, Add entry opened from a page pushed in Settings closed Settings (`ShellRoute.openAddEntry`), so the split view swapped its detail column from the bound Settings stack to Home in the same update as the sheet appeared, and SwiftUI crashed (`NavigationColumnState.boundPathChange`, `swift_unexpectedError`). Settings is the detail column on iPad, not a sheet, so Add entry now opens over it (`ShellRoute.settingsIsColumn`, set from the size class). `Penny.popSettingsPages()` taps the navigation bar's `BackButton` instead of its first button, which on iPad was the sidebar's Add entry; that is how `AuthJourneyTests`' sign-out journey hit the crash.
- **Fixed**: at the largest accessibility text size the demo banner on iPhone wrapped its title mid-word ("Change-s"). At accessibility sizes `StatusBanner` puts its action under the text, so the title has the full width and wraps between words (MAZ-141); check the `large-text` screenshots.

## Debugging

1. Open `test-results/ios/ui/<plan>/<device>.xcresult` in Xcode: the failing step, its UI snapshot and the "App UI hierarchy" attachment (search it for the identifier that was not found).
2. Check `server/api.log` for the requests around the failure (status codes, faults applied).
3. Re-run one test: `PENNY_UI_DEVICES=iphone PENNY_UI_ONLY=PennyUITests/<Class>/<test> apps/ios/scripts/ios.sh ui-test full`.
4. Or keep an environment up (`npm run test-env -- up --oidc`) and run the test from Xcode with breakpoints; `npm run test-env -- status` shows the clock and active faults.

## CI

`ios.yml` job `ui-smoke` (every PR touching the app, the contracts, the backend or the test environment) and `ios-ui-matrix.yml` (nightly at 07:17 UTC, on published releases, and on demand with a choice of plans) run on the `xcode-27` runner and upload `test-results/ios/ui/`. GitHub-hosted Apple Silicon macOS runners cannot run Linux containers, so both jobs install Nix, build `.#test-postgres` (PostgreSQL 18 with pgvector, locked by `flake.lock`) and run the stack with `PENNY_POSTGRES=native` ([without a container runtime](migration/test-environment.md#without-a-container-runtime)). Locally, `ios.sh ui-test` uses Docker or Podman as before, or the same native mode when those two variables are set.

## Privacy

Accounts, emails and entries are synthetic (`.test` domains, generated passwords). The control token reaches the runner only through the environment and is never attached or logged; server artifacts exclude tokens and passwords (MAZ-62). Screenshots show only the synthetic data.
