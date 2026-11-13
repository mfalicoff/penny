# Penny for iPhone and iPad (SwiftUI)

[Documentation](../../docs/README.md) · [V2 architecture](../../docs/reference/architecture.md) · [Redesign baseline](../../docs/reference/redesign.md)

The native v2 app (MAZ-66 onward) and Penny's only iOS app. Its bundle id, App Group, URL scheme and widget identifiers are frozen for TestFlight/App Store continuity, so each build upgrades the previous one in place ([builds and TestFlight](../../docs/ios-ipa.md)).

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
apps/ios/scripts/ios.sh ui-test smoke  # XCUITest plan (smoke|full|screenshots|performance) on clean iPhone and iPad
                                       # simulators against the full-stack environment (Docker/Podman)
apps/ios/scripts/ios.sh push <file>    # send a notification payload to the booted simulator (no APNs)
apps/ios/scripts/ios.sh archive        # signed Release archive for TestFlight (PENNY_BUILD_NUMBER)
apps/ios/scripts/ios.sh export         # App Store signed, verified .cache/ios/export/Penny.ipa
apps/ios/scripts/ios.sh upload         # validate and upload that IPA to TestFlight (API key)
apps/ios/scripts/ios.sh distribution-test  # the archive/IPA checks refuse bad builds (after release-check)
```

`test` and `launch` create new simulators from the newest installed iOS runtime and delete them afterwards, so no state carries over between runs. They use the newest iPhone Pro and iPad Pro 11-inch device types; set `PENNY_IPHONE` or `PENNY_IPAD` to a device type name from `xcrun simctl list devicetypes` to choose others.

In Xcode, open `Penny.xcodeproj`, choose the **Penny** scheme and an iPhone or iPad simulator, and run (⌘R) or test (⌘U); its test action runs the app-hosted `PennyTests`. To run the PennyKit tests in Xcode, open `Packages/PennyKit` and test the **PennyKit-Package** scheme. `ios.sh test` runs both on each simulator; results are `test-results/ios/app-<device>.xcresult` and `pennykit-<device>.xcresult`.

CI runs the same steps on the GitHub `xcode-27` (Apple Silicon) image in [`.github/workflows/ios.yml`](../../.github/workflows/ios.yml) and uploads `test-results/ios/` as `ios-test-results`.

## Layout and ownership

| Path | Contents | Owner |
| --- | --- | --- |
| `Penny.xcodeproj` | The app, `PennyTests` and `PennyWidgets` (WidgetKit extension, embedded in the app) targets and the shared **Penny** scheme. Folders are synchronized: add files under `Penny/`, `PennyTests/` or `PennyWidgets/` without touching the project file. Keep build settings in `Configuration/`, not in the project. | MAZ-66 |
| `Configuration/` | xcconfig files (shared, Debug, Release, per target, version), `Info.plist` additions and entitlements | MAZ-66; signing changes need [Apple-side updates](#signing-and-entitlements) |
| `Penny/` | The app entry point, Debug-only test controls, the asset catalog (icon, accent color) and the privacy manifest. Keep it thin: features belong in PennyKit. | MAZ-66, then MAZ-69 |
| `PennyTests/` | Unit tests hosted in the built app: bundle identity, URL scheme, platforms, configuration, App Group, test controls | MAZ-66 |
| `Packages/PennyKit/Sources/PennyDomain` | Platform-neutral rules: deep links, server URLs, app identity, shell navigation (`Navigation/`) and the demo ledger (`Demo/`), and in `Ledger/` the ported money, date, recurrence, ledger command, report, overview (MAZ-77) and local search rules ([ledger rules](../../docs/ios-ledger-domain.md)), and the offline three-way merge (`LedgerMerge`, MAZ-71), and trip phases, travel dates and private expenses from before sharing (`Trips/`, MAZ-76, [trips](../../docs/ios-trips.md)), and household notification payloads and APNs tokens (`Notifications/`, MAZ-79). | MAZ-66, 69, 70, 71, 76, 77, 79 |
| `Packages/PennyKit/Sources/PennyData` | Configuration, the App Group container, the API client and wire models (`API/`, [API client](../../docs/ios-api-client.md)), the sign-in state machine and Keychain session store (`Auth/`, [native sign-in](../../docs/ios-authentication.md)), the durable offline ledger, sync engine and observable sync state (`Offline/`, [offline sync](../../docs/ios-offline-sync.md)), the app lock (`AppLock/`), device preferences, and the `LedgerWorkspace` interface with `AccountWorkspace`, which connects it to the offline sync model (`Workspace/`, MAZ-69/71), and the household projection Home reads (`Shared/`, MAZ-77), and receipt rules, upload and preview (`Receipts/`, MAZ-78, [native receipts](../../docs/ios-receipts.md)), and the trip list, shared trip totals, Share trip and the trip form (`Trips/`, MAZ-76, [trips](../../docs/ios-trips.md)), and APNs registration (`Notifications/`, `API/APIClient+Push.swift`, MAZ-79, [native notifications](../../docs/ios-notifications.md)) | MAZ-66, 67, 68, 69, 71, 76, 78, 79 |
| `Packages/PennyKit/Sources/PennyDesign` | Design tokens, colors, type, Liquid Glass helpers and the shared components (`Components/`: money, hero, glass controls, banners, toast, named states; [native shell](../../docs/ios-shell.md#components-and-tokens)) | MAZ-66, 69 |
| `Packages/PennyKit/Sources/PennyUI` | Screens and the app shell: the sign-in, create-account, server and sign-out screens (`Auth/`, MAZ-68); the iPhone tab bar and iPad split view, Home, Activity, Shared, Trips, Settings, the lock cover, the demo and the states (`Shell/`, `Home/`, `Activity/`, `Together/`, `Settings/`, MAZ-69; [native shell](../../docs/ios-shell.md)); the entry sheet, pickers, entry detail, and Activity filters and search (`Entries/`, `Activity/`, MAZ-73; [native entries](../../docs/ios-entries.md)); Accounts, Categories, Recurring, the schedule page and the reusable account, category and schedule forms (`Organize/`, MAZ-74; [organize](../../docs/ios-organize.md)); Home with Explore your month, the money flow, Insights, the calendar and the iPad dashboard (`Home/`, MAZ-77; [overview](../../docs/ios-overview.md)); the Shared tab, households, invites and the QR scanner, shared expenses, payments and history (`Households/`, MAZ-75; [households](../../docs/ios-households.md)); the receipt pickers, upload row and viewer (`Receipts/`, MAZ-78; [native receipts](../../docs/ios-receipts.md)); the Trips tab, personal and shared trip pages, the trip form and Share trip (`Trips/`, MAZ-76; [trips](../../docs/ios-trips.md)); the app delegate and notification permission, registration and opening (`Notifications/`, MAZ-79; [native notifications](../../docs/ios-notifications.md)) | MAZ-68, 69, 73, 74, 75, 76, 77, 78, 79 onward |
| `Packages/PennyKit/Tests` | One test target per module. PennyDomain, PennyData and PennyDesign tests also run on the Mac host. | each module's owner |
| `PennyUITests/`, `TestPlans/` | XCUITest target and plans against the full-stack environment ([native UI tests](../../docs/ios-ui-tests.md)) | MAZ-81 |
| `Packages/PennyKit/Sources/PennyAccessibility` | Accessibility identifiers shared by the views and the UI tests (no imports) | MAZ-81, each screen's owner |
| `scripts/ios.sh` | The commands above | MAZ-66 |

Dependencies point one way: `PennyUI → PennyDesign`, `PennyUI → PennyData → PennyDomain`. PennyDomain and PennyData never import SwiftUI, UIKit or AppKit, and PennyDesign never imports PennyData or PennyUI; `ios.sh lint` checks this, and the package manifest makes the reverse direction a compile error. PennyDesign and PennyUI default to `@MainActor` isolation; mark pure value types `nonisolated`.

UI tests (XCUITest, MAZ-81) live in `PennyUITests/` (its own target and **PennyUITests** scheme, with the Smoke, Full and Screenshots plans in `TestPlans/`); they import only `PennyAccessibility`, the PennyKit module of shared accessibility identifiers, and drive the installed app against the real API ([native UI tests](../../docs/ios-ui-tests.md)). The WidgetKit extension (`PennyWidgets/`, MAZ-80) embeds the small Monthly balance and Recent expenses widgets from PennyWidgetUI; new sizes are MAZ-135 ([widgets](../../docs/ios-widgets.md)).

## Environments

| | Debug | Release |
| --- | --- | --- |
| `PennyEnvironment` (Info.plist) | `development` | `production` |
| Default server | `http://localhost:5001` (the [backend's development stack](../backend/README.md)) | none: the app opens at server connect ([native sign-in](../../docs/ios-authentication.md#server-choice)) |
| Test controls | compiled in (`PENNY_TEST_CONTROLS`) | compiled out |
| Optimization | `-Onone`, testable | `-O`, whole module |

`PennyData.AppConfiguration` reads these values at launch and fails, showing an error screen, rather than guessing when one is missing or malformed. Release must not have a default server.

Test controls (`Penny/TestControls.swift`) let tests start the app against a test server: set `PENNY_TEST_SERVER_URL` in the launch environment, for example to the [full-stack test environment](../../docs/reference/test-environment.md). `PENNY_TEST_DEMO=1` opens the temporary demo at launch ([native shell](../../docs/ios-shell.md#demo)). `PENNY_TEST_RESET`, `PENNY_TEST_TODAY`, `PENNY_TEST_CONTAINER_SEED` and the Reduce Transparency/Motion overrides serve the UI tests ([launch controls](../../docs/ios-ui-tests.md#launch-controls)). `PENNY_TEST_NOTIFICATION` and `PENNY_TEST_NOTIFICATION_ON_RESUME` open a notification payload as if tapped ([native notifications](../../docs/ios-notifications.md#tests-and-verification)). They exist only in Debug. `ios.sh release-check` builds Release and fails if any file in the bundle contains the test-control names, or if the Release Info.plist is not `production` without a default server.

## Minimum OS and Liquid Glass

The minimum is iOS 26.0 because the redesign requires the system Liquid Glass material on the control layer (tab bar, toolbars, month picker, search and floating buttons). With iOS 26 as the floor, every supported device has the real material, so there is no older-OS fallback to maintain. On Xcode 27 the app builds against the iOS 27 SDK and keeps the iOS 26 deployment target.

- The system tab bar, toolbars and sheets are glass automatically. Custom floating controls use `pennyGlass(in:tinted:)` from PennyDesign, which applies `.glassEffect`.
- With **Reduce Transparency** on, `pennyGlass` draws an opaque surface with a separator edge instead of glass. The system controls adapt by themselves.
- Money and lists always use solid surfaces (`PennyColor.surface`), never glass.
- **Reduce Motion**, Dynamic Type and VoiceOver are acceptance requirements for every screen (MAZ-69, 85).

## Design tokens, fonts and icons

PennyDesign mirrors the tokens in [`contracts/design-baseline.json`](../../contracts/design-baseline.json) (from `design-kit/src/styles.css`). Light and dark follow the system setting; there are no other appearances (MAZ-132). `TokenBaselineTests` fails when the Swift values and the baseline drift, so change both in one commit.

The app bundles no fonts or icon files. It uses SF Pro through the system text styles (Dynamic Type) and SF Symbols, as the baseline specifies; the design cards use Inter and Ionicons only as stand-ins. The leaf mark is the SF Symbol `leaf`. The app icon is `assets/penny-icon.png`.

> MAZ-66's original description mentions DM Sans, four appearances and Ionicons-derived assets. MAZ-132 replaced those decisions; this app follows the current baseline.

## Signing and entitlements

| Identifier | Value | Continuity |
| --- | --- | --- |
| Bundle id | `com.mfalicoff.penny` | Same as every released build; a different id would be a new app |
| App Group | `group.com.mfalicoff.penny` | Shared with the widgets, which read their snapshot from it ([App Groups setup](../../docs/ios-ipa.md#widget-app-groups-setup)) |
| URL scheme | `penny` | Every route in `navigation.routes` has a destination (`PennyDomain.DeepLink`), including `penny://entries/new` from the widgets and `penny://auth/callback` for OIDC |
| Widget extension | `com.mfalicoff.penny.ExpoWidgetsTarget` with kinds `BalanceChartWidget` and `RecentExpensesWidget` | The `PennyWidgets` target (MAZ-80) keeps both (the id's name predates the native app; never rename it), so widgets people already placed keep working; it has the same App Group (`PennyWidgets.entitlements`) |

These values live in `PennyDomain.AppIdentity`. `AppIdentityTests` pins them to the released builds' values and compares them with the signing docs and the TestFlight checks in `ios.sh` and `ios-testflight.yml`, and `PennyTests` checks the built bundle.

- **Simulator** builds sign ad hoc and need no Apple team. Xcode embeds the entitlements, so the App Group works in tests.
- **Device** builds and archives need the team that owns `com.mfalicoff.penny` in App Store Connect. Copy `Configuration/Signing.local.xcconfig.example` to `Configuration/Signing.local.xcconfig` (ignored by Git) and set `DEVELOPMENT_TEAM`. Automatic signing then uses the existing App ID with its App Groups capability.
- Any new entitlement must first be enabled on the matching App ID, and its provisioning profiles regenerated (and the CI profile secrets replaced, [one-time setup](../../docs/ios-ipa.md#one-time-setup)).
- Camera access for the household invite scanner (MAZ-75) is a usage description (`INFOPLIST_KEY_NSCameraUsageDescription` in `Configuration/Penny.xcconfig`), not an entitlement: no App ID or profile change. Penny asks only when the scanner opens.
- Push notifications (MAZ-79) add the `aps-environment` entitlement (`development`; exporting for TestFlight or the App Store switches it to `production`). The App ID needs the **Push Notifications** capability and regenerated profiles before the next device build or archive ([Apple Developer setup](../../docs/ios-notifications.md#apple-developer-setup)). Penny asks for notification permission only in context, never at launch.

TestFlight distribution (MAZ-98): `ios.sh archive`, `export` and `upload`, run by [`ios-testflight.yml`](../../.github/workflows/ios-testflight.yml) when a release is published. CI signs manually with the App Store distribution certificate and one App Store profile each for the app and `PennyWidgets`; the export check also requires production `aps-environment`. On a Mac, automatic signing with your Apple account also works. Secrets, build numbers, the device checklist and rollback are in [iOS builds, signing and TestFlight](../../docs/ios-ipa.md).

## Versions

`MARKETING_VERSION` in `Configuration/Version.xcconfig` follows `package.json`. Release-please updates it with each release, and `npm run version:check` fails when they differ. `CURRENT_PROJECT_VERSION` is `1` locally. `ios.sh archive` sets it from `PENNY_BUILD_NUMBER`; CI uses `<IOS_BUILD_NUMBER_BASE>.<run>.<attempt>`, with the base above the earlier whole-number builds in TestFlight, because App Store Connect rejects build numbers that do not increase ([build numbers](../../docs/ios-ipa.md#versions-and-build-numbers)).

## Tests

Swift Testing, with names in the repository's `whenCondition_Subject_ShouldOutcome` form. Each module has a test target; app-level checks live in `PennyTests`.

- Tests that guard continuity read files from the checkout (`contracts/design-baseline.json`, `docs/ios-ipa.md`, `scripts/ios.sh`, `.github/workflows/ios-testflight.yml`) through `#filePath`, which works on the Mac host and in the simulator.
- Contract fixtures are read through `PennyContracts` ([contracts](../../contracts/README.md)); MAZ-67 adds the API models.
- Keep personal financial data, real server addresses and credentials out of tests. Use `.test` domains, loopback addresses and fixture data.
