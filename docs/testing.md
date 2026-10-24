# Testing strategy

All executable tests live under `tests/`. Choose the lowest layer that proves the behavior; add an end-to-end journey only when an actual browser or native runtime matters. Jest's iOS/Android presets are not device tests, and a phone-sized browser is not a native app.

## Layout and ownership

| Location | Runner | Responsibility |
| --- | --- | --- |
| `tests/core/` | Node test runner | Pure rules, money/date boundaries, immutable commands, HTTP/SQLite integration and backend permissions |
| `tests/ui/` | Jest / Expo | Component interactions, providers, client data/session behavior, routing; mirrors the corresponding `src/` hierarchy |
| `tests/ui/support/` | Shared Jest support | Native mocks, setup and strict real-DOM web renderer |
| `tests/e2e/web/` | Playwright / Chromium | Exported production web app + real API; desktop and phone viewport journeys |
| `tests/e2e/native/` | Node + `agent-device` | Actual iOS Simulator / Android Emulator journeys, with shared scenarios and reusable platform lifecycle |

Do not add tests under `src/`, root `e2e/`, or generated `ios/` and `android/` directories. Keep runner configuration at the root and executable command wrappers in `scripts/`. Core/UI files use `*.test.ts(x)`; real-DOM UI cases use `*.web.test.jsx`; browser journeys use `*.spec.ts`; native entry points use `*.ios.test.mjs` / `*.android.test.mjs`.

## Commands

Use Node 24 and the committed npm lockfile (`npm ci`).

| Command | Runs |
| --- | --- |
| `npm test` | Portable default: core + all three Jest projects |
| `npm run test:core` | Node rules/API suite |
| `npm run test:ui` | iOS + Android component/data tests and web DOM tests |
| `npm run test:ui:ios` / `test:ui:android` / `test:ui:web` | One Jest platform |
| `npm run test:ui:watch` | Interactive Jest development |
| `npm run test:coverage` | Core/API + all Jest projects, with code coverage |
| `npm run test:coverage:core` / `test:coverage:ui` | Coverage for one test layer |
| `npm run test:e2e:web` | Fresh web export, isolated API/database and Playwright journeys |
| `npm run test:e2e` | Browser E2E default; does not imply native coverage |
| `npm run test:e2e:check -- ios` | Check iOS tooling, runtime and app binary without booting a device |
| `npm run test:e2e:check -- android` | Check Android tooling, AVD/image and APK without booting a device |
| `npm run test:e2e:check -- all` | Check both native platforms |
| `npm run test:e2e:ios` / `test:e2e:android` | One real native platform |
| `npm run test:e2e:native` | Both native platforms, sequentially |
| `npm run test:all` | Core + all Jest projects + browser + both native platforms |

`test:all` requires a macOS machine with both native toolchains and app binaries. An explicitly requested platform fails with setup guidance when prerequisites are missing; it is never silently skipped. Run native suites one at a time; parallel instrumentation can destabilize the Android automation bridge.

For everyday changes, run the relevant layer while iterating, then `npm run lint`, `npm run typecheck`, and `npm test`. Run browser E2E for web journeys and the affected native platform for native behavior. Before a cross-platform release, run `npm run test:all` on the prepared macOS workstation and complete the device-only checks below. Bundle exports validate resolution, not interaction.

## Code coverage

```sh
npm run test:coverage
```

Normal `npm test` remains uninstrumented for faster local feedback. Coverage runs the same core/UI suites, not a reduced test selection, and produces terminal summaries plus browsable HTML, LCOV (`lcov.info`) and machine-readable JSON (`coverage-summary.json`).

| Report | Source boundary | HTML entry point |
| --- | --- | --- |
| Core/API (`c8` / V8) | All `server/**/*.ts` and `src/domain/**/*.ts`, including files never imported by tests | `coverage/core/index.html` |
| UI (Jest / Babel) | All `src/**/*.{ts,tsx}`, including untested files; excludes declaration files | `coverage/ui/index.html` |

Tests, fixtures, dependencies and generated native projects are outside these source boundaries. Core's frontend helper/selector execution is reflected in its tests but only backend/domain code is measured in the core report; the UI report owns the complete frontend source tree.

The UI report combines the iOS, Android and web Jest projects: a covered line means at least one project executed it, not that every platform did. Core and UI reports intentionally stay separate: source ownership overlaps in `src/domain`, and V8/Babel count statements/branches differently. Do not average their percentages or claim a single cross-platform score.

To inspect one Jest platform without overwriting the combined report:

```sh
npm run test:coverage:ui -- --selectProjects ios --coverageDirectory=coverage/ui-ios
```

Replace `ios` with `android` or `web` as needed. HTML/LCOV show missed lines and branches for prioritizing meaningful tests. No arbitrary percentage threshold is enforced initially; test failures still fail the coverage command. Establish thresholds only after reviewing the baseline and deciding which behavior needs protection.

Browser and simulator/emulator E2E are not instrumented. Code coverage does not prove native layout, permissions, pickers, push delivery or physical-device behavior. Reports are ignored by Git; CI retains HTML/LCOV/JSON as the `code-coverage` artifact, excluding raw V8 temporary data.

### Measured baseline — October 24, 2026

| Layer | Statements | Branches | Functions | Lines |
| --- | --- | --- | --- | --- |
| Core/API | 86.64% | 87.75% | 91.37% | 86.64% |
| UI (iOS + Android + web combined) | 67.30% | 64.62% | 61.12% | 72.41% |

Verified `npm run test:coverage` with all 85 core and 237 UI tests passing; the documented iOS-only command also passed its 101 tests. Inspected HTML source drilldowns in Chromium, including real hit/miss annotations and the untested backend entry point at 0%. Confirmed untested widget source is present, LCOV/JSON reports are generated, and a failing child command keeps its nonzero exit status. Lint and typecheck passed. Shared CI coverage/upload contracts were checked locally; hosted Actions execution was not performed.

## Browser setup

```sh
npx playwright install chromium
npm run test:e2e:web
```

The wrapper exports current JavaScript with a fixture API URL, starts the production web app/API on `127.0.0.1:4173`, and uses a fresh temporary SQLite database. It never reuses a running development server. Coverage includes registration/login, demo navigation, expense/income/investment entries, filters, receipts, accounts/categories/trips, recurring entries, settings and persistence. OIDC provider sign-in still needs an external identity provider; controlled OIDC behavior is covered at the service/API and UI layers.

Playwright writes failure screenshots, video and traces to `test-results/web/`, and HTML to `test-results/web-report/`.

## Native workstation setup

Install the platform toolchains once; do not bake personal device IDs or absolute app paths into tests.

1. **iOS:** macOS, Xcode and an available iPhone simulator runtime. Build/install a compatible simulator app with `npx expo run:ios`, or provide a simulator `.app` via `PENNY_IOS_APP_PATH` (a device IPA is not compatible).
2. **Android:** Android SDK, emulator, `adb` and a configured AVD with its system image installed. Build a compatible debug APK with `npx expo run:android`, or provide `PENNY_ANDROID_APK`.
3. **Automation:** install `agent-device` separately and expose it on `PATH`. Tests never download or upgrade this tool automatically.
4. Run the native preflight commands above, then the relevant native suite.

[Expo's local build guide](https://docs.expo.dev/guides/local-app-development/) explains toolchain setup and when to rebuild. Rebuild after native library/config-plugin/SDK changes. JavaScript-only changes are served fresh by the harness's own Metro process. Keep generated native projects ignored; configure them through app config/plugins, not hand edits.

### Platform selection

| Setting | Purpose |
| --- | --- |
| `PENNY_IOS_APP_PATH` | Explicit simulator `.app`; otherwise discover an installed Penny binary |
| `PENNY_XCODE_DEVELOPER_DIR` | Xcode developer directory; default `/Applications/Xcode.app/Contents/Developer` |
| `PENNY_IOS_RUNTIME` / `PENNY_IOS_DEVICE_TYPE` | Explicit iOS runtime/device-type identifiers or exact names |
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | Android SDK; otherwise the usual macOS/Linux SDK location |
| `ANDROID_AVD_HOME` / `ANDROID_USER_HOME` | Source AVD configuration location |
| `PENNY_ANDROID_AVD` | Explicit source AVD profile |
| `PENNY_ANDROID_APK` | Debug APK; default `android/app/build/outputs/apk/debug/app-debug.apk` |
| `PENNY_ADB_PATH` | Explicit `adb` executable instead of `PATH` discovery |

Choose explicit profiles/binaries for repeatable release checks; automatic discovery is a convenience for local development. iOS prefers a booted matching source simulator, then stable runtime/device ordering; an explicit `.app` can use an available compatible runtime without an existing installation. Android defaults to the alphabetically first AVD. The harness deliberately ignores inherited `DEVELOPER_DIR` (Nix may point it at an SDK without simulator tools); use `PENNY_XCODE_DEVELOPER_DIR` to override full Xcode. iOS puts Xcode and Apple system tools ahead of inherited tool wrappers on `PATH`.

### Isolation and lifecycle

Both platforms use the same server-selection scenarios. Shared support owns fixture servers, Metro startup, command evidence and process teardown; platform adapters own device creation, installation, launch and disposal. New native journeys reuse that lifecycle rather than copying an entire emulator setup into a new test.

- iOS creates a temporary simulator and reuses only the source app binary, never the source simulator's data.
- Android copies only AVD configuration into a temporary directory, boots headlessly with snapshots disabled and installs the APK. It does not copy/wipe the source AVD's app data, userdata, SD card or snapshots.
- Each run starts in-memory Penny backends and a non-Penny fixture on free loopback ports. Metro uses IPv4 localhost; Android maps Metro/API ports with `adb reverse`.
- No real accounts, configured Penny backend or local `.env` API URL are used.
- Each run owns a separate `agent-device` state directory/daemon, retained with its evidence. It stops only that daemon during teardown; existing user automation sessions are untouched.
- Cleanup closes the automation session, stops services, deletes the temporary simulator/AVD and retains evidence, including on assertion failures.

Native evidence lives under `test-results/native/ios/server-connection/` and `test-results/native/android/server-connection/`: screenshots, command transcripts, backend requests, Metro output, and Android emulator output.

### Native coverage and limits

The shared journey checks five behaviors on each platform:

- First launch retains the build's URL without an identity probe.
- Invalid/non-Penny URLs cannot be saved, and identity requests contain no session credentials.
- A valid Penny version appears before saving; input changes invalidate verification.
- The selected URL/version survive app termination/relaunch and startup reaches that backend.
- Settings shows the selected server and prevents switching inside an active workspace.

This is not a full native equivalent of the browser suite. Jest covers forms, validation, retries, navigation, offline/session behavior and platform-specific date controls. Native server-selection tests do not cover OS permission prompts, real receipt pickers/PDF decoding, push delivery, widgets, physical-device layout, or upgrading an old native binary. Test these explicitly on devices when affected; migration logic also has data-layer coverage.

For a manual native smoke pass: launch a fresh development build, enter the demo, navigate, create an expense, select a date, inspect settings, background/resume and verify the saved entry/totals. Use fixture/demo data rather than personal accounts. TestFlight/signing and physical-device checks remain separate from simulator automation.

## CI policy

`.github/workflows/tests.yml` is the reusable application check used by both container and mobile release workflows. It runs lint, typecheck, core tests and all three Jest projects via `npm run test:coverage`, then browser E2E on Node 24/Linux. It uploads code coverage as `code-coverage` and browser evidence as `playwright-report`, including available reports on failure. Each core/UI test runs once, with coverage enabled.

Native device E2E is an explicit workstation/release gate, not an implied result of Linux CI or an EAS build. The repository does not provision Xcode runtimes, AVD images, `agent-device`, or native development binaries on hosted CI. Do not add a green job that skips missing devices; provision those prerequisites before moving native execution to a dedicated runner.

## Adding or changing tests

- Assert consumer-visible behavior, boundaries, transitions, permissions and failure recovery; avoid snapshots of implementation structure or tests that merely echo mocks.
- Keep pure rules/API invariants in core. Use UI tests for interactions without OS dependencies. Use browser/native E2E only for the corresponding runtime boundary.
- Mirror source ownership under `tests/ui/`; never put test code in Expo Router's route tree.
- Native UI cases run under both Expo presets. Web cases use the strict shared DOM renderer; do not silence React warnings/errors.
- Keep fixtures isolated and deterministic. New native journeys must use the common lifecycle and platform adapters, preserve fresh device data and retain failure evidence.
- Update this strategy when adding a platform, runner, command or prerequisite rather than adding another standalone setup guide.

## Consolidation verification — October 24, 2026

- `npm test`: 85 core tests and 237 UI tests across 52 Jest project suites passed.
- `npm run test:e2e:web`: fresh production export and all 17 Chromium journeys passed.
- `npm run test:e2e:check -- all`: both native platform prerequisites resolved. Explicit iOS app/runtime/device selection and invalid-platform/missing-APK failure paths were also exercised.
- `npm run test:e2e:native`: iOS then Android passed all five scenarios each (six Node results per platform including the parent), with isolated automation daemons. Used iPhone 17 / iOS 27.0 and Pixel 10 Pro / Android 17 (`android-37.1` image), existing development binaries and current JavaScript.
- Inspected both platforms' Settings screenshots. Confirmed temporary iOS simulators from both the successful run and an earlier failed run were deleted, and the temporary Android emulator was disconnected.
- `npm run lint` and `npm run typecheck` passed. Reusable workflow YAML parsed and caller/dependency contracts resolved locally; hosted GitHub Actions execution was not performed.
