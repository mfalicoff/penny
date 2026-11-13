# Browser and cross-client acceptance (MAZ-96)

[Documentation](README.md) · [Web app](../apps/web/README.md#browser-tests) · [Full-stack test environment](migration/test-environment.md) · [Native UI tests](ios-ui-tests.md) · [Redesign baseline](migration/redesign.md)

This is the release acceptance evidence for the v2 browser app and for the browser and the native app working against one .NET API and PostgreSQL database. It lists every journey by feature, how to run it, what the last recorded run found, and what is still not proven. Native-only acceptance (XCUITest on simulators, VoiceOver, Liquid Glass, devices) is MAZ-82's; comparing implementations with the design cards is MAZ-122's.

Every journey uses synthetic data: `.test` accounts with random passwords, made-up titles and amounts, generated receipt files. No secret, token or real financial data is written to fixtures, logs or artifacts.

## Runner commands

All browser commands run from `apps/web` against the production build (`npm ci && npm run build` first).

| What | Command | Needs |
| --- | --- | --- |
| Mocked browser suite (smoke, journeys, accessibility, performance) | `npm run test:e2e -- --trace off` | Playwright Chromium (`npx playwright install chromium`) |
| Same on Firefox and WebKit | `PENNY_E2E_BROWSERS=firefox,webkit npm run test:e2e -- --trace off` | `npx playwright install firefox webkit` |
| Real .NET/PostgreSQL journeys, disposable environment | `npm run test:e2e:real -- --trace off` | Docker or Podman (`PENNY_CONTAINER_CLI=podman`), the .NET SDK, the search model and restored packages ([prerequisites](migration/test-environment.md#prerequisites)) |
| One real journey, one project | `npm run test:e2e:real -- search.real --project=chromium-phone --trace off` | as above |
| Visual baselines (compare) | `PENNY_VISUAL=1 npx playwright test visual --project=chromium-desktop` | Chromium; baselines are per platform |
| Visual baselines (record after an intended change) | `PENNY_VISUAL=1 npx playwright test visual --project=chromium-desktop --update-snapshots` | Review every changed PNG before committing |
| Accessibility triage report | `PENNY_A11Y_REPORT=$PWD/a11y.jsonl npx playwright test a11y` | Appends every axe violation as JSON lines |
| Backend search and seed tests (repository root) | `bash apps/backend/dotnet.sh test --solution Penny.Backend.slnx --configuration Release --filter-class "*Search*" --filter-class "*FullStackSeed*"` | A container runtime (`DOCKER_HOST` for Podman), `tesseract` for the receipt-text cases; on macOS set `TESTINGPLATFORM_PIPE_DIRECTORY` to a short path when the checkout path is long |

### Simulator and browser against one API

The browser runner and the XCUITest runner both use an environment that is already up when `PENNY_API_URL`, `PENNY_TEST_TOKEN` and `PENNY_TEST_RUN` are exported, so both clients can work on one API and database:

```sh
# Repository root, terminal 1: one environment, kept up while this command runs.
npm run test-env -- up --oidc

# Terminal 2, repository root.
eval "$(npm run --silent test-env -- env)"

# Native half (needs Xcode 27.2; see docs/ios-ui-tests.md).
apps/ios/scripts/ios.sh ui-test full

# Browser half, against the same API and database. Set PENNY_E2E_PORT=8081 (another allowed origin)
# when 4173 is busy; single sign-on specs need 4173.
cd apps/web && PENNY_E2E_REUSE_STACK=1 npm run test:e2e:real -- --trace off

npm run test-env -- down
```

What this gives: both suites run against one server, database, clock and fault registry. Run the halves one after the other, not at once: both move the server clock and inject faults, which are global to the environment. The browser specs were run against a kept-up environment here (Playwright with the exported variables); the native half was not, because Xcode is not installed on the machine this suite was written on. It also does not yet make one journey hand off between a simulator and a browser (an entry created offline in the simulator, then read in the browser): that needs a scenario hand-off between XCUITest and Playwright, listed under [known gaps](#known-gaps). The browser specs in `cross-client.real.spec.ts` cover the same convergence with a second client that speaks the native app's protocol ([below](#cross-client-convergence)).

## Acceptance matrix

`mocked` specs run with `/api` mocked per test (CI: Chromium desktop and phone; Firefox and WebKit smoke jobs). `real` specs run against the [full-stack test environment](migration/test-environment.md) (CI: Chromium, Firefox and WebKit, one environment each). Spec files are in `apps/web/e2e/`.

| Feature | Browser, mocked | Browser, real .NET/PostgreSQL | Cross-client | Native (MAZ-82) |
| --- | --- | --- | --- | --- |
| Password sign-in, registration, sign-out | `auth.spec.ts` | `auth.real.spec.ts` | | `AuthJourneyTests` |
| Single sign-on (OIDC), forged callback | `auth.spec.ts` | `auth.real.spec.ts` (local provider) | | `AuthJourneyTests` |
| Session expiry with a waiting change | `auth.spec.ts` | `recovery.real.spec.ts` (server clock + 31 days) | | `AuthJourneyTests` |
| Temporary demo, isolation | `shell.spec.ts`, `home.spec.ts` | n/a (no server) | | `ScreenshotTests` (demo) |
| Currency, accounts, categories | `organize.spec.ts` | `financial.real.spec.ts` | | `ios-organize.md` |
| Income, expense, investment entries | `transactions.spec.ts` | `financial.real.spec.ts`, `cross-client.real.spec.ts` | `cross-client.real.spec.ts` | `ios-entries.md` |
| Recurring schedules | `recurring.spec.ts` | `financial.real.spec.ts` (schedule stored, projected on Home) | | `ios-organize.md` |
| Home recorded vs projected | `home.spec.ts` | `financial.real.spec.ts` | `cross-client.real.spec.ts` (totals) | `OverviewJourneyTests` |
| Activity search: substring, accents, CJK, renames, privacy | `transactions.spec.ts` (stand-in) | `search.real.spec.ts` (every `searchable-household` expectation) | | MAZ-73 |
| Search paging and filters | | `search.real.spec.ts` | | |
| Pending offline create/edit/delete, reconnect, no duplicates | `offline.spec.ts`, `transactions.spec.ts` | `search.real.spec.ts` | `cross-client.real.spec.ts` | `NetworkFailureTests` |
| Independent and same-field races | `transactions.spec.ts` | | `cross-client.real.spec.ts` | `LedgerSyncEngineTests` (unit) |
| Deletion under an open edit | | | `cross-client.real.spec.ts` | |
| Receipts upload, preview, download, privacy | `receipts.spec.ts` | `receipts.real.spec.ts` | | `ReceiptJourneyTests` |
| Failed receipt upload and retry | `receipts.spec.ts` | `recovery.real.spec.ts` | | `ReceiptJourneyTests` |
| Two-person households: invite, splits, privacy, stale payment, settlement, archive | `households.spec.ts` | `households.real.spec.ts` | | `HouseholdJourneyTests` |
| Membership revocation (former member keeps history) | `households.spec.ts` | `search.real.spec.ts` (cam) | | |
| Trips: personal, shared, join after expense, repayment | `trips.spec.ts` | `trips.real.spec.ts` | | `TripJourneyTests` |
| Server 503 and dropped connections | `transactions.spec.ts` | `recovery.real.spec.ts` (fault controls) | | `NetworkFailureTests` |
| Unreachable server through a reload | `smoke.spec.ts` | `recovery.real.spec.ts` | | `NetworkFailureTests` |
| Database outage and recovery | | `recovery.real.spec.ts` (PostgreSQL container paused) | | |
| Legacy browser cache upgrade | `offline.spec.ts` | `recovery.real.spec.ts` (onto a server copy that moved on) | | `LifecycleTests`, `ios-expo-migration.md` |
| Settings: appearance, pinned theme | `shell.spec.ts` | `financial.real.spec.ts` | | `ScreenshotTests` |
| Accessibility scans | `a11y.spec.ts` | | | MAZ-82 |
| Keyboard use and focus | `shell.spec.ts`, `transactions.spec.ts`, `organize.spec.ts`, `a11y.spec.ts` | | | MAZ-82 |
| Responsive 320px to desktop, zoom, doubled text | `shell.spec.ts`, `visual.spec.ts` | | | `ScreenshotTests` |
| Light, dark, forced colors, reduced motion | `shell.spec.ts`, `a11y.spec.ts`, `visual.spec.ts` | | | `ScreenshotTests` |
| Large-ledger performance | `performance.spec.ts` | `search.real.spec.ts` (latency) | | `ios-overview.md` |

### Web redesign cards

The redesign's web cards (`contracts/design-baseline.json`, `acceptance.web: "MAZ-96"`) and the journeys that hold their scenario. The visual comparison against each card is MAZ-122's.

| Card | Scenario | Journeys |
| --- | --- | --- |
| `web-home` | recorded versus projected totals, accessible charts, adaptive layout | `home.spec.ts`, `financial.real.spec.ts`, `a11y.spec.ts`, `visual.spec.ts`, `performance.spec.ts` |
| `web-activity` | day grouping, filters, server search with pending local scope | `transactions.spec.ts`, `search.real.spec.ts`, `cross-client.real.spec.ts` |
| `web-insights` | totals, accessible charts, adaptive layout | `home.spec.ts`, `a11y.spec.ts` (known chart label gaps) |
| `web-household` | two-user shared expense, balances, payment recording, privacy, stale revisions | `households.spec.ts`, `households.real.spec.ts` |
| `web-trips` | personal and shared trips, Only you entries, membership and balances | `trips.spec.ts`, `trips.real.spec.ts`, `visual.spec.ts` |
| `web-settings` | persistence, larger text, keyboard | `shell.spec.ts`, `financial.real.spec.ts`, `visual.spec.ts` |
| `web-add-entry` | retained draft, keyboard-safe save, validation, duplicate submit | `transactions.spec.ts`, `a11y.spec.ts` |
| `web-sign-in` | password and OIDC sign-in, registration, sign-out with pending changes | `auth.spec.ts`, `auth.real.spec.ts`, `offline.spec.ts`, `visual.spec.ts` |

## Cross-client convergence

`cross-client.real.spec.ts` runs the browser next to a second client that speaks the native app's ledger protocol ([native offline sync](ios-offline-sync.md)): bearer `GET /api/ledger`, a whole-ledger `PUT` with the revision it read, 409 on a stale revision, then the shared three-way merge `src/domain/merge.ts` (which the Swift `LedgerMerge` is held to through `contracts/fixtures/merge-conflicts.json`) and up to five retries. Server, database and protocol are real; only the client is not the Swift app.

1. The protocol client records two expenses offline while the browser adds one online; on reconnect the server refuses the stale write once (409), the client merges and writes, and the server holds all three exactly once.
2. The browser lists the other client's entries; Activity's October total equals the sum the server stores.
3. The browser edits an entry the other client created; the other client reads the new amount.
4. Independent race: the browser edits one entry while the other client changes another; both changes survive.
5. Same-field race: both change one amount; the browser learns of the other write, shows "This entry changed on another device" with their value and keeps its own draft; Keep my changes saves it.
6. Deletion under an open edit: the other client deletes an entry the browser is editing; the browser shows it was deleted and writes nothing back.

## Accessibility

**Automated (`a11y.spec.ts`).** axe-core 4.14 with the WCAG 2.0, 2.1 and 2.2 A/AA rules scans sign-in, Home, Activity, Insights, Trips, Recurring, Accounts, Categories and Settings in light and dark, the Add entry dialog, and Home and Activity under forced colors with reduced motion, on desktop and phone layouts. The scans found the violations below. They are recorded in `apps/web/e2e/a11y-known.json` with their reasons; a violation that is not listed fails the suite, and a listed one that disappears fails it too, so the list can only shrink.

| Rule (WCAG) | Where | Finding |
| --- | --- | --- |
| `color-contrast` (1.4.3) | Every page, both themes | White on the accent button: 3.68:1 light, 2.76:1 dark (sign-in, Add entry, primary actions). Income green 3.69–4.17:1, pending amber 3.16–3.64:1, keyboard-shortcut chips 4.41:1, quiet links 4.43:1, banner text 4.13:1. Needs a design-kit token change, not a hand edit of `tokens.css` |
| `label-content-name-mismatch` (2.5.3) | Home and Insights money-flow nodes and chart segments; Categories rows | The accessible name doesn't contain the visible text (for example `Edit Groceries` on a row showing usage text), so speech-input users must say a name they can't see |
| `scrollable-region-focusable` (2.1.1) | Insights category table, phone | The horizontally scrolling table can't take keyboard focus |

**Keyboard (automated).** Skip link and main focus, every route by keyboard, shortcuts with focus restoration (`shell.spec.ts`); keyboard-only Add entry with the category radio group and ⌘↵ (`transactions.spec.ts`); keyboard CRUD for accounts and categories (`organize.spec.ts`); Escape returns focus to the Add entry opener (`a11y.spec.ts`); the Sankey and stacked flow by keyboard (`home.spec.ts`).

**Manual assistive technology (not yet run).** These need a person and are release gates, not automated evidence: VoiceOver on macOS Safari and iOS Safari, NVDA with Firefox on Windows, browser zoom to 400%, Windows High Contrast. For each of sign-in, Home, Activity with search, Add entry, a household expense and payment, and Settings: every control is announced with name, role and state; the order follows the layout; live status messages (sync, search counts, toasts) are announced once; dialogs trap and return focus. Record the date, browser, AT version and findings here when done.

## Responsive layouts and visual regression

`shell.spec.ts` loads every page at 320, 390, 768, 1024, 1100 and 1440px, at 200% zoom and with doubled root text, and fails on any horizontal scrolling. `visual.spec.ts` captures sign-in, Home, Activity, Trips and Settings at 320, 768 and 1440px in light and dark (30 baselines), each with the same overflow check. The baselines are rendered on macOS (`*-chromium-desktop-darwin.png`) and compared only with `PENNY_VISUAL=1`, because text rasterization differs between operating systems; Linux CI does not compare them yet.

Observed while recording: at 320px, Activity's Search button and the totals card reach the right edge of the window without the side gutter the other pages keep (there is no horizontal scrolling). Left for design review with MAZ-122.

## Performance budgets

`performance.spec.ts` (Chromium, mocked API so the browser is measured) loads a synthetic 20,000-entry ledger across 24 months. `search.real.spec.ts` measures every search request it makes against .NET and PostgreSQL.

| Measure | Budget | Desktop | Phone |
| --- | --- | --- | --- |
| First Home with the whole ledger (download, IndexedDB, report) | 2,500 ms | 340 ms | 343 ms |
| Home month change | 750 ms | 73 ms | 70 ms |
| Activity month with totals | 2,000 ms | 575 ms | 455 ms |
| Offline search over the whole local copy | 1,000 ms | 198 ms | 51 ms |
| Longest main-thread task | 500 ms | 149 ms | 147 ms |
| Server search over HTTP, p95 / max (small seed, 33 requests) | 300 ms / 1,000 ms | 55–68 ms / 135–159 ms (Firefox, WebKit) | 46 ms / 67 ms (WebKit) |
| Browser search: navigate, query, render | 3,000 ms per query | under budget | under budget |

The server-side budgets at 100,000 entries per viewer are measured by MAZ-121 ([search](migration/search.md)); this suite checks that the end-to-end path through the browser stays inside them on a small seed.

## Results

Recorded on 2026-11-12 on an Apple Silicon Mac (macOS, rootless Podman 6.1 machine with 4 CPUs and 6 GB, .NET SDK 10.0.403, Node 24.21, Playwright 1.64.1 with Chromium 1248, Firefox and WebKit 27.2), branch `mfalicoff2001/maz-96-complete-browser-and-ios-to-web-end-to` from `v2` at `d8ff47b`. Each real-stack run created and tore down its own environment (`npm run test:e2e:real`).

| Suite | Projects | Result |
| --- | --- | --- |
| Real stack, all `*.real.spec.ts` (20 journeys) | chromium-desktop, chromium-phone | 40 passed (before the session-expiry spec change below, which was then repeated on the phone projects) |
| Real stack, all `*.real.spec.ts` | firefox-desktop, webkit-desktop, webkit-phone | 56 passed, 1 failed, 3 not run: session expiry on webkit-phone (spec race, fixed below; the serial file skipped the rest). After the fix, `recovery.real` ×3 on chromium-phone and webkit-phone: 36 passed |
| Mocked suite, all `*.spec.ts` | chromium-desktop, chromium-phone | 118 passed, 24 skipped (real-stack and visual specs skip here) |
| Mocked suite | firefox-desktop, webkit-desktop, webkit-phone | `a11y.spec.ts` 20 passed on all five projects; Firefox: every other spec passed. WebKit on macOS: 9 failures in specs this branch does not change (`receipts.spec.ts` PDF and photo preview, `recurring.spec.ts`, `smoke.spec.ts` keyboard route walk, `households.spec.ts` phone toast), reproducible with `--workers=2`; CI runs WebKit on Linux, so they are not attributed to this change and were not investigated further |
| Visual baselines (`PENNY_VISUAL=1`) | chromium-desktop | 6 tests (30 captures) passed |
| Web unit and component tests (`npm test`) | Vitest | 39 files, 482 tests passed |
| Web lint, typecheck, build | | `npm run lint`, `npm run typecheck`, `npm run build` (with `dist/` verification) pass |
| Backend search, seed and test-control tests (`--filter-class "*Search*" --filter-class "*FullStackSeed*" --filter-class "*TestControls*"`, Release) | xUnit, PostgreSQL through Testcontainers on Podman | 53 passed, 2 skipped (explicit benchmarks), 5 failed: every `ReceiptTextSearchTests` case, because `tesseract` (receipt OCR) is not installed on this machine |

Flakiness seen while writing the suite (the first full Chromium run shared the machine with a second Playwright run) and how it was resolved:

- The money journey read the server before the schedule had synced, and clicked a currency before the page settled (chromium-desktop and chromium-phone once each). Fixed in the spec: it waits for both.
- Session expiry on phone layouts (chromium-phone once, webkit-phone once) timed out on Add entry. The page snapshot shows the app had already, correctly, returned to sign-in with the expiry notice: a background refetch reached the server after the clock moved and got the 401 before the test's write. Fixed in the spec: the change is made to wait first (the write is faulted), then the clock moves, so either request may notice the expiry. Product behavior was right in both runs.
- The legacy upgrade journey on chromium-desktop once got a 401 for the protocol client's own session while polling. Not explained and not reproduced since; it ran after the session-expiry journey, which moves the server clock. Repeat it before marking the real-stack job required.

Search latency over HTTP in `search.real.spec.ts` (small seed, every request the spec makes): p95 55.0 ms and max 134.5 ms on firefox-desktop, p95 67.9 ms and max 158.7 ms on webkit-desktop, p95 46.1 ms and max 67.2 ms on webkit-phone (the Chromium runs asserted the same budgets; their numbers were not exported).

## Known gaps

- **Simulator to browser hand-off.** No journey yet creates data in the iOS Simulator and reads it in the browser (or back). The runners share an environment (above), and `cross-client.real.spec.ts` proves convergence with a protocol client, but the Swift app's own sync is only exercised by its XCUITest and unit suites. Closing it needs an XCUITest that publishes what it created (for example through `Stack` writing a file the browser spec reads) and a wrapper that runs the two in order. Xcode was not available where this suite was written.
- **API server restart.** The test environment cannot restart the .NET process in place, so a server restart is approximated by dropped connections (faults) and a paused database. A real restart with in-flight writes is not covered.
- **Search index rebuild.** `search-rebuild` and `search-verify` against migrated SQLite data are covered by backend tests and the cutover drill ([cutover](cutover.md)), not by a browser journey after a rebuild.
- **Migrated SQLite server data.** Browser journeys run on data created through the API, not on a database imported from the legacy SQLite file (`npm run test-env -- cutover` covers the import itself).
- **Upgrade from a real previous build.** The legacy cache journey seeds the Expo web app's `localStorage` format; no test installs a previous production bundle and upgrades it with a service worker or cache in place.
- **Accessibility.** The violations listed above are open. Manual screen-reader, zoom and high-contrast checks have not been run.
- **Visual comparison.** Baselines are web-only regressions on macOS; card-by-card comparison with the design and Linux baselines are MAZ-122.
- **Session expiry prefill.** After a session expires the browser asks for the email again; the iOS app keeps it. Product decision pending.
- **Shared money semantics from both clients.** Per-share and monthly payments, stale-payment recovery and settlement run in the browser (`households.real.spec.ts`) and natively (`HouseholdJourneyTests`) separately, not interleaved between a simulator and a browser.
- **App lock.** Biometric app lock is native only; the browser has none.
- **WebKit on macOS.** Nine existing mocked journeys fail on Playwright's WebKit on macOS (above) and pass on Chromium and Firefox; CI's WebKit runs on Linux. Not investigated here.
- **CI cost.** The new real-stack specs run in the existing `web.yml` real-stack job on all three engines; the session-expiry and paused-database journeys add about 20 s each per project. The paused-database journey needs the container CLI on the runner (it skips with `PENNY_POSTGRES=native`).

### Device-only exclusions

Not provable in a browser or a simulator, and owned by MAZ-82 and the release checklist: Liquid Glass rendering and Reduce Transparency on device, Face ID and the app lock, the camera invite scanner, APNs delivery, WidgetKit on a Home Screen, Dynamic Type at device scale with VoiceOver, and the TestFlight upgrade from the Expo build (MAZ-98).
