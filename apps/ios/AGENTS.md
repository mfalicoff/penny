# Native iOS app

This is the SwiftUI iPhone/iPad app (MAZ-66 onward). Root Expo guidance applies to the legacy app, not Swift here; never edit the generated legacy `ios/` project. Read [README.md](README.md) for layout, commands, environments and signing.

## Rules

- Xcode is pinned in `.xcode-version` (27.2); the minimum OS is iOS 26.0, iPhone and iPad only. Don't raise or lower either without updating README.md, the xcconfigs, `PennyKit/Package.swift` and `BuiltAppTests`.
- Use `apps/ios/scripts/ios.sh` for every build, test and lint. It removes the Nix shell's SDK/compiler variables; bare `xcrun`/`xcodebuild` in the direnv shell use the wrong SDK.
- Keep build settings in `Configuration/*.xcconfig`, not in `project.pbxproj`. The project uses synchronized folders: add files under `Penny/`, `PennyTests/` or a PennyKit module, never by editing the project file.
- Put features in PennyKit modules; keep the app target thin. Dependencies point one way: PennyUI → PennyDesign, PennyUI → PennyData → PennyDomain. PennyDomain and PennyData must not import SwiftUI/UIKit/AppKit. Add a module as a new PennyKit target with its own test target; the PennyKit-Package scheme picks it up automatically.
- Never change the bundle id, App Group, URL scheme, widget extension id or widget kinds (`PennyDomain.AppIdentity`); they keep in-place upgrades from the Expo app. New entitlements need the Apple App ID and profiles updated first (`docs/ios-ipa.md`).
- Anything for tests only goes behind `#if PENNY_TEST_CONTROLS` (Debug only). `ios.sh release-check` fails if it reaches Release.
- Follow `contracts/design-baseline.json`: light and dark only, SF Pro text styles (Dynamic Type) and SF Symbols, no bundled fonts. Use `PennyColor` semantic colors; copper is the only tint and expenses use the label color, never red. Liquid Glass (`.glassEffect`, `pennyGlass`) only on the control layer, with an opaque surface under Reduce Transparency; money and lists stay solid. When a token changes, change the baseline and `Tokens.swift` together.
- Match OpenAPI and the fixtures through `PennyContracts`. Preserve durable pending base/local snapshots and in-place Expo data migration before retirement (MAZ-71/72).
- Use Swift Testing and name tests `whenCondition_Subject_ShouldOutcome`. Cover failure paths. Use fixture data, `.test` domains and loopback servers only; no personal financial data or credentials.
- No third-party Swift packages without a pinned exact version, a committed `Package.resolved` and a reason in README.md.

## Before you finish

Run `apps/ios/scripts/ios.sh format`, then `apps/ios/scripts/ios.sh ci` (lint, host package tests, clean iPhone and iPad simulator tests, Release check), plus root `npm run lint`, `npm run typecheck` and `npm run version:check` when shared files change. APNs, widgets and TestFlight upgrades also need physical-device evidence.
