# Penny for iPhone and iPad (SwiftUI)

[Documentation](../../docs/README.md) · [V2 architecture](../../docs/migration/architecture.md) · [Redesign baseline](../../docs/migration/redesign.md)

The native v2 app (MAZ-66 onward). It replaces the Expo app on iOS in place: it keeps the bundle id, App Group, URL scheme and widget identifiers, so the App Store/TestFlight build upgrades over the Expo build. It lives here, outside the Expo-generated `ios/` directory, which stays ignored and is never edited.

## Requirements

| | |
| --- | --- |
| Xcode | **27.2**, pinned in [`.xcode-version`](.xcode-version). `scripts/ios.sh` refuses any other version. |
| Swift | 6.4 (Xcode 27.2), Swift 6 language mode, complete concurrency checking, warnings are errors |
| Minimum OS | **iOS 26.0 / iPadOS 26.0** ([why](#minimum-os-and-liquid-glass)) |
| Devices | iPhone and iPad (`TARGETED_DEVICE_FAMILY = 1,2`). No Mac Catalyst, "Designed for iPad" on Mac, or visionOS. |
| Dependencies | None from outside the repository. PennyKit depends only on the local [`contracts/swift`](../../contracts/swift) package. |

### First-time Xcode setup

After installing or updating Xcode, accept its license and install its components once. Until then `simctl` hangs and `xcodebuild` reports "CoreSimulator is out of date":

```sh
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch
xcodebuild -downloadPlatform iOS   # if no iOS 26+ simulator runtime is installed
```

If you use the repository's Nix shell (direnv), it exports a Nix `SDKROOT`, `DEVELOPER_DIR` and compiler variables that break `xcrun`. `scripts/ios.sh` removes them for its own commands. To use Xcode tools directly in that shell, run them as `env -u SDKROOT DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun …`, or open the project from Finder or with `open apps/ios/Penny.xcodeproj`.

## Commands

Run from anywhere in the repository. Build output goes to `.cache/ios/`; test results and launch screenshots go to `test-results/ios/`. Both are ignored by Git.

```sh
apps/ios/scripts/ios.sh format         # rewrite Swift files with swift-format
apps/ios/scripts/ios.sh lint           # swift-format --strict, module boundaries, plist lint
apps/ios/scripts/ios.sh package-test   # PennyKit tests on the Mac (seconds, no simulator)
apps/ios/scripts/ios.sh build          # Debug build for the simulator
apps/ios/scripts/ios.sh test           # app + PennyKit tests on clean iPhone and iPad simulators
apps/ios/scripts/ios.sh release-check  # Release build: production settings, no test controls
apps/ios/scripts/ios.sh launch         # install, launch and screenshot on clean iPhone and iPad simulators
apps/ios/scripts/ios.sh ci             # lint, package-test, test, release-check
apps/ios/scripts/ios.sh ui-build       # build the app and the XCUITest bundle
apps/ios/scripts/ios.sh ui-test smoke  # XCUITest plan (smoke|full|screenshots) on clean iPhone and iPad
                                       # simulators against the full-stack environment (Docker/Podman)
```

`test` and `launch` create new simulators from the newest installed iOS runtime and delete them afterwards, so no state carries over between runs. They use the newest iPhone Pro and iPad Pro 11-inch device types; set `PENNY_IPHONE` or `PENNY_IPAD` to a device type name from `xcrun simctl list devicetypes` to choose others.

In Xcode, open `Penny.xcodeproj`, choose the **Penny** scheme and an iPhone or iPad simulator, and run (⌘R) or test (⌘U); its test action runs the app-hosted `PennyTests`. To run the PennyKit tests in Xcode, open `Packages/PennyKit` and test the **PennyKit-Package** scheme. `ios.sh test` runs both on each simulator; results are `test-results/ios/app-<device>.xcresult` and `pennykit-<device>.xcresult`.

CI runs the same steps on the GitHub `xcode-27` (Apple Silicon) image in [`.github/workflows/ios.yml`](../../.github/workflows/ios.yml) and uploads `test-results/ios/` as `ios-test-results`.

## Layout and ownership

| Path | Contents | Owner |
| --- | --- | --- |
| `Penny.xcodeproj` | The app and `PennyTests` targets and the shared **Penny** scheme. Folders are synchronized: add files under `Penny/` or `PennyTests/` without touching the project file. Keep build settings in `Configuration/`, not in the project. | MAZ-66 |
| `Configuration/` | xcconfig files (shared, Debug, Release, per target, version), `Info.plist` additions and entitlements | MAZ-66; signing changes need [Apple-side updates](#signing-and-entitlements) |
| `Penny/` | The app entry point, Debug-only test controls, the asset catalog (icon, accent color) and the privacy manifest. Keep it thin: features belong in PennyKit. | MAZ-66, then MAZ-69 |
| `PennyTests/` | Unit tests hosted in the built app: bundle identity, URL scheme, platforms, configuration, App Group, test controls | MAZ-66 |
| `Packages/PennyKit/Sources/PennyDomain` | Platform-neutral rules: deep links, server URLs, app identity, shell navigation (`Navigation/`) and the demo ledger (`Demo/`), and in `Ledger/` the ported money, date, recurrence, ledger command, report, overview (MAZ-77) and local search rules ([ledger rules](../../docs/ios-ledger-domain.md)), and the offline three-way merge (`LedgerMerge`, MAZ-71). | MAZ-66, 69, 70, 71, 77 |
| `Packages/PennyKit/Sources/PennyData` | Configuration, the App Group container, the API client and wire models (`API/`, [API client](../../docs/ios-api-client.md)), the sign-in state machine and Keychain session store (`Auth/`, [native sign-in](../../docs/ios-authentication.md)), the durable offline ledger, sync engine and observable sync state (`Offline/`, [offline sync](../../docs/ios-offline-sync.md)), the app lock (`AppLock/`), device preferences, and the `LedgerWorkspace` interface with `AccountWorkspace`, which connects it to the offline sync model (`Workspace/`, MAZ-69/71), and the in-place import of the Expo app's AsyncStorage and SecureStore data (`Migration/`, MAZ-72, [Expo upgrade](../../docs/ios-expo-migration.md)), and the household projection Home reads (`Shared/`, MAZ-77), and receipt rules, upload and preview (`Receipts/`, MAZ-78, [native receipts](../../docs/ios-receipts.md)) | MAZ-66, 67, 68, 69, 71, 78 |
| `Packages/PennyKit/Sources/PennyDesign` | Design tokens, colors, type, Liquid Glass helpers and the shared components (`Components/`: money, hero, glass controls, banners, toast, named states; [native shell](../../docs/ios-shell.md#components-and-tokens)) | MAZ-66, 69 |
| `Packages/PennyKit/Sources/PennyUI` | Screens and the app shell: the sign-in, create-account, server and sign-out screens (`Auth/`, MAZ-68); the iPhone tab bar and iPad split view, Home, Activity, Shared, Trips, Settings, the lock cover, the demo and the states (`Shell/`, `Home/`, `Activity/`, `Together/`, `Settings/`, MAZ-69; [native shell](../../docs/ios-shell.md)); the entry sheet, pickers, entry detail, and Activity filters and search (`Entries/`, `Activity/`, MAZ-73; [native entries](../../docs/ios-entries.md)); Accounts, Categories, Recurring, the schedule page and the reusable account, category and schedule forms (`Organize/`, MAZ-74; [organize](../../docs/ios-organize.md)); Home with Explore your month, the money flow, Insights, the calendar and the iPad dashboard (`Home/`, MAZ-77; [overview](../../docs/ios-overview.md)); the receipt pickers, upload row and viewer (`Receipts/`, MAZ-78; [native receipts](../../docs/ios-receipts.md)) | MAZ-68, 69, 73, 74, 77, 78 onward |
| `Packages/PennyKit/Tests` | One test target per module. PennyDomain, PennyData and PennyDesign tests also run on the Mac host. | each module's owner |
| `PennyUITests/`, `TestPlans/` | XCUITest target and plans against the full-stack environment ([native UI tests](../../docs/ios-ui-tests.md)) | MAZ-81 |
| `Packages/PennyKit/Sources/PennyAccessibility` | Accessibility identifiers shared by the views and the UI tests (no imports) | MAZ-81, each screen's owner |
| `scripts/ios.sh` | The commands above | MAZ-66 |

Dependencies point one way: `PennyUI → PennyDesign`, `PennyUI → PennyData → PennyDomain`. PennyDomain and PennyData never import SwiftUI, UIKit or AppKit, and PennyDesign never imports PennyData or PennyUI; `ios.sh lint` checks this, and the package manifest makes the reverse direction a compile error. PennyDesign and PennyUI default to `@MainActor` isolation; mark pure value types `nonisolated`.

UI tests (XCUITest, MAZ-81) live in `PennyUITests/` (its own target and **PennyUITests** scheme, with the Smoke, Full and Screenshots plans in `TestPlans/`); they import only `PennyAccessibility`, the PennyKit module of shared accessibility identifiers, and drive the installed app against the real API ([native UI tests](../../docs/ios-ui-tests.md)). The WidgetKit extension target belongs to MAZ-80 (new sizes: MAZ-135).

## Environments

| | Debug | Release |
| --- | --- | --- |
| `PennyEnvironment` (Info.plist) | `development` | `production` |
| Default server | `http://localhost:3001` (the legacy app's default) | none: the app opens at server connect ([native sign-in](../../docs/ios-authentication.md#server-choice)) |
| Test controls | compiled in (`PENNY_TEST_CONTROLS`) | compiled out |
| Optimization | `-Onone`, testable | `-O`, whole module |

`PennyData.AppConfiguration` reads these values at launch and fails, showing an error screen, rather than guessing when one is missing or malformed. Release must not have a default server.

Test controls (`Penny/TestControls.swift`) let tests start the app against a test server: set `PENNY_TEST_SERVER_URL` in the launch environment, for example to the [full-stack test environment](../../docs/migration/test-environment.md). `PENNY_TEST_DEMO=1` opens the temporary demo at launch ([native shell](../../docs/ios-shell.md#demo)). `PENNY_TEST_RESET`, `PENNY_TEST_TODAY`, `PENNY_TEST_CONTAINER_SEED` and the Reduce Transparency/Motion overrides serve the UI tests ([launch controls](../../docs/ios-ui-tests.md#launch-controls)). `PENNY_TEST_EXPO_FIXTURE=upgrade` stages an Expo install in the container for an in-place upgrade rehearsal and imports it at the next launch ([Expo upgrade](../../docs/ios-expo-migration.md#tests-and-rehearsal)). They exist only in Debug. `ios.sh release-check` builds Release and fails if any file in the bundle contains the test-control names, or if the Release Info.plist is not `production` without a default server.

## Minimum OS and Liquid Glass

The minimum is iOS 26.0 because the redesign requires the system Liquid Glass material on the control layer (tab bar, toolbars, month picker, search and floating buttons). With iOS 26 as the floor, every supported device has the real material, so there is no older-OS fallback to maintain. On Xcode 27 the app builds against the iOS 27 SDK and keeps the iOS 26 deployment target.

- The system tab bar, toolbars and sheets are glass automatically. Custom floating controls use `pennyGlass(in:tinted:)` from PennyDesign, which applies `.glassEffect`.
- With **Reduce Transparency** on, `pennyGlass` draws an opaque surface with a separator edge instead of glass. The system controls adapt by themselves.
- Money and lists always use solid surfaces (`PennyColor.surface`), never glass.
- **Reduce Motion**, Dynamic Type and VoiceOver are acceptance requirements for every screen (MAZ-69, 85).

## Design tokens, fonts and icons

PennyDesign mirrors the tokens in [`contracts/design-baseline.json`](../../contracts/design-baseline.json) (from `design-kit/src/styles.css`). Light and dark follow the system setting; there are no other appearances (MAZ-132). `TokenBaselineTests` fails when the Swift values and the baseline drift, so change both in one commit.

The app bundles no fonts or icon files. It uses SF Pro through the system text styles (Dynamic Type) and SF Symbols, as the baseline specifies; the design cards use Inter and Ionicons only as stand-ins. The leaf mark is the SF Symbol `leaf`. The app icon is `assets/penny-icon.png`, the same image as the Expo app.

> MAZ-66's original description mentions DM Sans, four appearances and Ionicons-derived assets. MAZ-132 replaced those decisions; this app follows the current baseline.

## Signing and entitlements

| Identifier | Value | Continuity |
| --- | --- | --- |
| Bundle id | `com.mfalicoff.penny` | Same as `app.json`; a different id would be a new app |
| App Group | `group.com.mfalicoff.penny` | Same as the Expo widgets ([App Groups setup](../../docs/ios-ipa.md#widget-app-groups-setup)); the Expo app kept only derived widget snapshots there, which MAZ-72 leaves for MAZ-80's widgets to replace ([Expo upgrade](../../docs/ios-expo-migration.md)) |
| URL scheme | `penny` | Every legacy route keeps a destination (`PennyDomain.DeepLink`), including `penny://entries/new` from the widgets and `penny://auth/callback` for OIDC |
| Widget extension | `com.mfalicoff.penny.ExpoWidgetsTarget` with kinds `BalanceChartWidget` and `RecentExpensesWidget` | Reserved for the WidgetKit extension (MAZ-80); keeping both keeps widgets people already placed |

These values live in `PennyDomain.AppIdentity`. `AppIdentityTests` compares them with `app.json` and the signing docs, and `PennyTests` checks the built bundle.

- **Simulator** builds sign ad hoc and need no Apple team. Xcode embeds the entitlements, so the App Group works in tests.
- **Device** builds and archives need the team that owns `com.mfalicoff.penny` in App Store Connect. Copy `Configuration/Signing.local.xcconfig.example` to `Configuration/Signing.local.xcconfig` (ignored by Git) and set `DEVELOPMENT_TEAM`. Automatic signing then uses the existing App ID with its App Groups capability.
- Any new entitlement must first be enabled on the matching App ID, and its provisioning profiles regenerated, as for the Expo app.

TestFlight distribution of this app (archive, upload and the upgrade from the Expo build on a physical device) is MAZ-98. The legacy EAS workflow is unchanged.

## Versions

`MARKETING_VERSION` in `Configuration/Version.xcconfig` follows `package.json`. Release-please updates it with each release, and `npm run version:check` fails when they differ. `CURRENT_PROJECT_VERSION` is `1` locally; archives for TestFlight must set it above the legacy EAS build counter (`npx eas-cli@latest build:version:get --platform ios`), because App Store Connect rejects build numbers that do not increase.

## Tests

Swift Testing, with names in the repository's `whenCondition_Subject_ShouldOutcome` form. Each module has a test target; app-level checks live in `PennyTests`.

- Tests that guard continuity read files from the checkout (`app.json`, `contracts/design-baseline.json`, `docs/ios-ipa.md`) through `#filePath`, which works on the Mac host and in the simulator.
- Contract fixtures are read through `PennyContracts` ([contracts](../../contracts/README.md)); MAZ-67 adds the API models.
- Keep personal financial data, real server addresses and credentials out of tests. Use `.test` domains, loopback addresses and fixture data.
