#!/usr/bin/env bash
# Build, check and test the native iOS app (apps/ios). Run from anywhere:
#
#   apps/ios/scripts/ios.sh <command>
#
#   format         rewrite Swift sources with swift-format
#   lint           swift-format --strict, module boundaries and plist checks
#   package-test   PennyKit unit tests on the macOS host (fast, no simulator)
#   build          Debug build for the iOS simulator
#   test           app and PennyKit tests on clean iPhone and iPad simulators
#   release-check  Release build; verifies production settings and no test controls
#   launch         install and launch on clean iPhone and iPad simulators, with screenshots
#   ci             lint, package-test, test, release-check and distribution-test
#   ui-build       build the app and the XCUITest bundle (no simulator, no stack)
#   ui-test [plan] XCUITest plan smoke|full|screenshots|performance against the full-stack environment
#                  on clean iPhone and iPad simulators (docs/ios-ui-tests.md)
#   push <file> [simulator]  send a notification payload (.apns) to Penny with simctl push
#                  (default: the booted simulator; no APNs, docs/ios-notifications.md)
#   archive        signed Release archive for App Store Connect (needs PENNY_BUILD_NUMBER)
#   export         re-sign the archive for App Store Connect and verify .cache/ios/export/Penny.ipa
#   upload         validate and upload that IPA to TestFlight (needs the PENNY_ASC_* key)
#   distribution-test  check the archive/IPA checks refuse bad builds (after release-check)
#
# Xcode is pinned by apps/ios/.xcode-version. Outputs go to .cache/ios (git-ignored).
# PENNY_IPHONE / PENNY_IPAD choose simulator device types (default: the newest iPhone
# Pro and iPad Pro 11-inch the selected Xcode offers). PENNY_RUNTIME pins a runtime identifier.
# ui-test: PENNY_UI_DEVICES (iphone, ipad or both), PENNY_STACK_BUILD=0 (reuse the API build),
# PENNY_UPGRADE_FROM_APP (a previous Penny.app to upgrade from).
# archive/export/upload: PENNY_TEAM_ID, PENNY_BUILD_NUMBER, PENNY_ASC_KEY_PATH, PENNY_ASC_KEY_ID,
# PENNY_ASC_ISSUER_ID (docs/ios-ipa.md).
set -euo pipefail

IOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$IOS_DIR/../.." && pwd)"
CACHE="$ROOT/.cache/ios"
DERIVED="$CACHE/DerivedData"
RESULTS="$ROOT/test-results/ios"
PROJECT="$IOS_DIR/Penny.xcodeproj"
PACKAGE="$IOS_DIR/Packages/PennyKit"
SCHEME="Penny"

# The repository's Nix shell (flake.nix, direnv) exports a Nix SDKROOT, DEVELOPER_DIR and
# compiler variables that make xcrun and xcodebuild use the wrong SDK. Drop them here.
sanitize_environment() {
  local name
  for name in SDKROOT MACOSX_DEPLOYMENT_TARGET CC CXX LD AR NM RANLIB STRIP CPP; do unset "$name"; done
  for name in $(env | sed -n "s/^\(NIX_[A-Za-z0-9_]*\)=.*/\1/p"); do unset "$name"; done
  export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
}

select_xcode() {
  local wanted candidate version
  wanted="$(tr -d '[:space:]' < "$IOS_DIR/.xcode-version")"
  for candidate in "${PENNY_XCODE:-}" "/Applications/Xcode_${wanted}.app" "/Applications/Xcode-${wanted}.app" \
    "/Applications/Xcode.app"; do
    [[ -n "$candidate" && -d "$candidate/Contents/Developer" ]] || continue
    version="$(DEVELOPER_DIR="$candidate/Contents/Developer" /usr/bin/xcodebuild -version 2>/dev/null | head -1 || true)"
    if [[ "$version" == "Xcode $wanted" ]]; then
      export DEVELOPER_DIR="$candidate/Contents/Developer"
      return
    fi
  done
  echo "error: Xcode $wanted (apps/ios/.xcode-version) is not installed. Install it, or set PENNY_XCODE to its .app." >&2
  exit 1
}

xcb() {
  # Package tests and the app share one DerivedData so the simulator build is reused.
  /usr/bin/xcodebuild -project "$PROJECT" -scheme "${XCB_SCHEME:-$SCHEME}" -derivedDataPath "$DERIVED" \
    -clonedSourcePackagesDirPath "$CACHE/SourcePackages" -skipMacroValidation "$@"
}

swift_sources() {
  find "$IOS_DIR/Penny" "$IOS_DIR/PennyTests" "$IOS_DIR/PennyUITests" "$IOS_DIR/PennyWidgets" "$PACKAGE/Sources" "$PACKAGE/Tests" "$PACKAGE/Package.swift" \
    -name '*.swift' -type f
}

cmd_format() {
  swift_sources | xargs xcrun swift-format format --in-place --configuration "$IOS_DIR/.swift-format"
}

cmd_lint() {
  echo "==> swift-format lint"
  swift_sources | xargs xcrun swift-format lint --strict --configuration "$IOS_DIR/.swift-format"

  echo "==> module boundaries"
  # Domain and data stay platform-neutral: no UI frameworks, so they test on any host.
  if grep -rnE '^\s*(public |internal |@testable )?import (SwiftUI|UIKit|AppKit|PennyDesign|PennyUI)\b' \
    "$PACKAGE/Sources/PennyDomain" "$PACKAGE/Sources/PennyData"; then
    echo "error: PennyDomain and PennyData must not import UI frameworks or UI modules." >&2
    exit 1
  fi
  if grep -rnE '^\s*(public )?import (PennyData|PennyUI)\b' "$PACKAGE/Sources/PennyDesign"; then
    echo "error: PennyDesign must not depend on data or feature modules." >&2
    exit 1
  fi
  # The widget extension links PennyWidgetUI only; the app's screens stay out of it (MAZ-80).
  if grep -rnE '^\s*(public |internal |@testable )?import PennyUI\b' "$PACKAGE/Sources/PennyWidgetUI" \
    "$IOS_DIR/PennyWidgets"; then
    echo "error: the widgets must not depend on the app's screens (PennyUI)." >&2
    exit 1
  fi
  # Identifiers only: the UI test runner links it, so it stays free of app code.
  if grep -rnE '^\s*(public |internal |@testable )?import ' "$PACKAGE/Sources/PennyAccessibility"; then
    echo "error: PennyAccessibility must not import anything." >&2
    exit 1
  fi
  # UI tests drive the installed app through identifiers; they never import its modules.
  if grep -rnE '^\s*(public |internal |@testable )?import (Penny|PennyDomain|PennyData|PennyDesign|PennyUI)\b' \
    "$IOS_DIR/PennyUITests"; then
    echo "error: PennyUITests may import PennyAccessibility only, not app modules." >&2
    exit 1
  fi

  echo "==> property lists and test plans"
  /usr/bin/plutil -lint "$IOS_DIR/Configuration/Info.plist" "$IOS_DIR/Configuration/Penny.entitlements" \
    "$IOS_DIR/Penny/PrivacyInfo.xcprivacy" "$IOS_DIR/Configuration/PennyWidgets-Info.plist" \
    "$IOS_DIR/Configuration/PennyWidgets.entitlements" "$IOS_DIR/PennyWidgets/PrivacyInfo.xcprivacy"
  # Test plans are JSON: converting them parses them strictly.
  local plan
  for plan in "$IOS_DIR"/TestPlans/*.xctestplan; do
    /usr/bin/plutil -convert binary1 -o /dev/null "$plan" && echo "$plan: OK"
  done
}

cmd_package_test() {
  xcrun swift test --package-path "$PACKAGE" --scratch-path "$CACHE/spm"
}

cmd_build() {
  xcb -configuration Debug -destination 'generic/platform=iOS Simulator' build
}

# Installed iOS runtime identifiers, newest first (or PENNY_RUNTIME alone).
runtimes() {
  if [[ -n "${PENNY_RUNTIME:-}" ]]; then echo "$PENNY_RUNTIME"; return; fi
  xcrun simctl list runtimes available | grep -E '^iOS ' | sort -V -r \
    | sed -E 's/.* - (com\.apple\.CoreSimulator\.SimRuntime\.[^ ]+).*/\1/'
}

device_type() {
  # $1: override, $2: pattern for `simctl list devicetypes` names. Prints the newest
  # matching type's identifier (simctl's own order is not by age, so sort by version).
  if [[ -n "$1" ]]; then echo "$1"; return; fi
  xcrun simctl list devicetypes | grep -E "$2" | sort -V | tail -1 \
    | sed -E 's/.*\((com\.apple\.CoreSimulator\.SimDeviceType\.[^)]+)\)$/\1/'
}

CREATED_DEVICES=()
cleanup_devices() {
  local id
  [[ ${#CREATED_DEVICES[@]} -gt 0 ]] || return 0
  for id in "${CREATED_DEVICES[@]}"; do
    xcrun simctl shutdown "$id" >/dev/null 2>&1 || true
    xcrun simctl delete "$id" >/dev/null 2>&1 || true
  done
}

# Creates a fresh simulator (no state from earlier runs) on the newest runtime that supports
# the device type, and sets CREATED_ID. An installed runtime can support no device types
# with this Xcode (iOS 27.1 under Xcode 27.2 does), so older runtimes are tried in turn.
clean_device() {
  local type="$1" runtime
  CREATED_ID=""
  [[ -n "$type" ]] || { echo "error: no matching simulator device type." >&2; exit 1; }
  for runtime in $(runtimes); do
    if CREATED_ID="$(xcrun simctl create "penny-ci ${type##*.}" "$type" "$runtime" 2>/dev/null)" \
      && [[ "$CREATED_ID" =~ ^[0-9A-F-]{36}$ ]]; then
      CREATED_DEVICES+=("$CREATED_ID")
      echo "Simulator ${type##*.} on ${runtime##*.}: $CREATED_ID"
      return
    fi
  done
  echo "error: no installed iOS runtime supports $type. Install one with: xcodebuild -downloadPlatform iOS" >&2
  exit 1
}

devices() {
  local iphone_type ipad_type
  iphone_type="$(device_type "${PENNY_IPHONE:-}" '^iPhone [0-9]+ Pro \(com')"
  ipad_type="$(device_type "${PENNY_IPAD:-}" '^iPad Pro 11-inch \(M[0-9]+\) \(com')"
  trap cleanup_devices EXIT
  clean_device "$iphone_type"; IPHONE_ID="$CREATED_ID"
  clean_device "$ipad_type"; IPAD_ID="$CREATED_ID"
}

# PennyKit's generated scheme runs every package test target. Package test targets listed
# in the app's scheme are not built by xcodebuild, so they run here instead.
xcb_package() {
  (cd "$PACKAGE" && /usr/bin/xcodebuild -scheme PennyKit-Package -derivedDataPath "$CACHE/PackageDerivedData" \
    -clonedSourcePackagesDirPath "$CACHE/SourcePackages" -skipMacroValidation "$@")
}

cmd_test() {
  devices
  mkdir -p "$RESULTS"
  rm -rf "$RESULTS"/*.xcresult
  local id name
  xcb -configuration Debug -destination "id=$IPHONE_ID" build-for-testing
  xcb_package -configuration Debug -destination "id=$IPHONE_ID" build-for-testing
  for name in iphone ipad; do
    if [[ $name == iphone ]]; then id="$IPHONE_ID"; else id="$IPAD_ID"; fi
    xcb -configuration Debug -destination "id=$id" test-without-building -resultBundlePath "$RESULTS/app-$name.xcresult"
    xcb_package -configuration Debug -destination "id=$id" test-without-building \
      -resultBundlePath "$RESULTS/pennykit-$name.xcresult"
  done
}

# Test controls must be compiled out: neither the type nor its launch variable may remain
# anywhere in the bundle (Debug builds keep code in Penny.debug.dylib, not the executable).
assert_no_test_controls() {
  local file found=0
  while IFS= read -r -d "" file; do
    if /usr/bin/strings -a "$file" | grep -qE "PENNY_TEST_[A-Z_]+|TestControls|TestStateReset|ContainerSeed|ExpoUpgradeFixture"; then
      echo "error: $file contains test controls." >&2
      found=1
    fi
  done < <(find "$1" -type f -print0)
  [[ $found -eq 0 ]] || exit 1
}

cmd_release_check() {
  xcb -configuration Release -destination 'generic/platform=iOS Simulator' build
  local app="$DERIVED/Build/Products/Release-iphonesimulator/Penny.app" plist
  plist="$app/Info.plist"
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :PennyEnvironment' "$plist")" == "production" ]] \
    || { echo "error: Release PennyEnvironment is not production." >&2; exit 1; }
  [[ -z "$(/usr/libexec/PlistBuddy -c 'Print :PennyDefaultServerURL' "$plist")" ]] \
    || { echo "error: Release has a default server URL." >&2; exit 1; }
  assert_no_test_controls "$app"
  echo "Release configuration: production, no default server, no test controls."
}

# --- TestFlight distribution (MAZ-98, docs/ios-ipa.md) -----------------------------------

ARCHIVE="$CACHE/Penny.xcarchive"
EXPORT_DIR="$CACHE/export"
BUNDLE_ID="com.mfalicoff.penny"
APP_GROUP="group.com.mfalicoff.penny"
# The WidgetKit extension (MAZ-80) keeps the Expo extension's id so placed widgets survive.
WIDGETS_ID="com.mfalicoff.penny.ExpoWidgetsTarget"
WIDGETS_APPEX="PlugIns/PennyWidgets.appex"

plist_value() { /usr/libexec/PlistBuddy -c "Print :$1" "$2" 2>/dev/null || true; }

# Two signing modes (docs/ios-ipa.md#signing):
# - manual (CI): PENNY_PROFILE_SPECIFIER and PENNY_WIDGETS_PROFILE_SPECIFIER name installed App
#   Store provisioning profiles for the app and the widget extension, and their "Apple
#   Distribution" certificate is in a keychain. Archive and export both use them, so Xcode never
#   creates certificates or profiles.
# - automatic (local): Xcode signs with the Apple account under Settings › Accounts, or with the
#   App Store Connect API key below, and may create or update profiles.
signing_flags() {
  SIGN_FLAGS=()
  if [[ -n "${PENNY_PROFILE_SPECIFIER:-}" || -n "${PENNY_WIDGETS_PROFILE_SPECIFIER:-}" ]]; then
    [[ -n "${PENNY_PROFILE_SPECIFIER:-}" && -n "${PENNY_WIDGETS_PROFILE_SPECIFIER:-}" ]] \
      || { echo "error: manual signing needs both PENNY_PROFILE_SPECIFIER and PENNY_WIDGETS_PROFILE_SPECIFIER." >&2; exit 1; }
    # Read by Configuration/Penny.xcconfig and PennyWidgets.xcconfig (those targets only).
    SIGN_FLAGS=(PENNY_CODE_SIGN_STYLE=Manual "PENNY_CODE_SIGN_IDENTITY=Apple Distribution"
      "PENNY_PROFILE_SPECIFIER=$PENNY_PROFILE_SPECIFIER"
      "PENNY_WIDGETS_PROFILE_SPECIFIER=$PENNY_WIDGETS_PROFILE_SPECIFIER")
    ASC_FLAGS=()
  else
    asc_auth_flags
  fi
}

# The App Store Connect API key signs in to Apple for automatic signing and uploads.
# PENNY_ASC_KEY_PATH must name the key file AuthKey_<PENNY_ASC_KEY_ID>.p8 (altool finds it by
# that name). Without a key, Xcode uses the Apple account signed in under Settings › Accounts.
asc_auth_flags() {
  ASC_FLAGS=(-allowProvisioningUpdates)
  [[ -n "${PENNY_ASC_KEY_PATH:-}" ]] || return 0
  require_asc_key
  ASC_FLAGS+=(-authenticationKeyPath "$PENNY_ASC_KEY_PATH" -authenticationKeyID "$PENNY_ASC_KEY_ID"
    -authenticationKeyIssuerID "$PENNY_ASC_ISSUER_ID")
}

require_asc_key() {
  [[ -n "${PENNY_ASC_KEY_PATH:-}" && -n "${PENNY_ASC_KEY_ID:-}" && -n "${PENNY_ASC_ISSUER_ID:-}" ]] \
    || { echo "error: set PENNY_ASC_KEY_PATH, PENNY_ASC_KEY_ID and PENNY_ASC_ISSUER_ID." >&2; exit 1; }
  [[ -f "$PENNY_ASC_KEY_PATH" && "$(basename "$PENNY_ASC_KEY_PATH")" == "AuthKey_${PENNY_ASC_KEY_ID}.p8" ]] \
    || { echo "error: PENNY_ASC_KEY_PATH must be an existing file named AuthKey_${PENNY_ASC_KEY_ID}.p8." >&2; exit 1; }
}

# The team comes from PENNY_TEAM_ID or Configuration/Signing.local.xcconfig.
team_id() {
  local team="${PENNY_TEAM_ID:-}"
  if [[ -z "$team" && -f "$IOS_DIR/Configuration/Signing.local.xcconfig" ]]; then
    team="$(sed -n 's/^[[:space:]]*DEVELOPMENT_TEAM[[:space:]]*=[[:space:]]*\([A-Z0-9]*\).*/\1/p' \
      "$IOS_DIR/Configuration/Signing.local.xcconfig" | tail -1)"
  fi
  [[ "$team" =~ ^[A-Z0-9]{10}$ ]] \
    || { echo "error: set PENNY_TEAM_ID (or DEVELOPMENT_TEAM in Configuration/Signing.local.xcconfig) to the team that owns $BUNDLE_ID." >&2; exit 1; }
  echo "$team"
}

package_version() { sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1; }

# App Store Connect compares CFBundleVersion component by component and rejects any build
# number that is not higher than every earlier upload for this version, including the legacy
# EAS builds. One to three dot-separated integers, no leading zeros.
require_build_number() {
  [[ "${PENNY_BUILD_NUMBER:-}" =~ ^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)){0,2}$ ]] \
    || { echo "error: set PENNY_BUILD_NUMBER to 1-3 dot-separated integers above the last TestFlight build (README.md#versions)." >&2; exit 1; }
}

# Checks shared by the archive and the exported IPA: identity, version, environment, no test
# controls. $1 is a Penny.app directory.
verify_app() {
  local app="$1" plist="$1/Info.plist" version
  version="$(package_version)"
  [[ "$(plist_value CFBundleIdentifier "$plist")" == "$BUNDLE_ID" ]] \
    || { echo "error: $app is not $BUNDLE_ID." >&2; exit 1; }
  [[ "$(plist_value CFBundleShortVersionString "$plist")" == "$version" ]] \
    || { echo "error: $app version is not package.json's $version." >&2; exit 1; }
  [[ "$(plist_value CFBundleVersion "$plist")" == "$PENNY_BUILD_NUMBER" ]] \
    || { echo "error: $app build number is not $PENNY_BUILD_NUMBER." >&2; exit 1; }
  [[ "$(plist_value PennyEnvironment "$plist")" == "production" ]] \
    || { echo "error: $app PennyEnvironment is not production." >&2; exit 1; }
  [[ -z "$(plist_value PennyDefaultServerURL "$plist")" ]] \
    || { echo "error: $app has a default server URL." >&2; exit 1; }
  [[ "$(plist_value PennyAppGroup "$plist")" == "$APP_GROUP" ]] \
    || { echo "error: $app does not use $APP_GROUP." >&2; exit 1; }
  # App Store Connect rejects an extension whose version or build differs from the app's.
  local widgets="$app/$WIDGETS_APPEX"
  [[ -d "$widgets" ]] || { echo "error: $app does not embed $WIDGETS_APPEX." >&2; exit 1; }
  [[ "$(plist_value CFBundleIdentifier "$widgets/Info.plist")" == "$WIDGETS_ID" ]] \
    || { echo "error: $widgets is not $WIDGETS_ID." >&2; exit 1; }
  [[ "$(plist_value CFBundleShortVersionString "$widgets/Info.plist")" == "$version" \
    && "$(plist_value CFBundleVersion "$widgets/Info.plist")" == "$PENNY_BUILD_NUMBER" ]] \
    || { echo "error: $widgets version or build number differs from the app's." >&2; exit 1; }
  assert_no_test_controls "$app"
}

# Distribution entitlements on the re-signed app and its widget extension. $1 is a Penny.app
# directory, $2 the team.
verify_distribution_signature() {
  local app="$1" team="$2"
  /usr/bin/codesign --verify --deep --strict "$app"
  verify_bundle_signature "$app" "$BUNDLE_ID" "$team"
  # APNs (MAZ-79): an App Store profile turns the development entitlement into production.
  [[ "$(plist_value aps-environment "$CACHE/distribution-entitlements.plist")" == "production" ]] \
    || { echo "error: $app is not signed for production APNs; enable Push Notifications on the App ID and regenerate its profile (docs/ios-notifications.md)." >&2; exit 1; }
  verify_bundle_signature "$app/$WIDGETS_APPEX" "$WIDGETS_ID" "$team"
}

# $1 a signed bundle, $2 its bundle id, $3 the team. Leaves its entitlements in
# $CACHE/distribution-entitlements.plist.
verify_bundle_signature() {
  local app="$1" id="$2" team="$3" entitlements
  entitlements="$CACHE/distribution-entitlements.plist"
  rm -f "$entitlements"
  /usr/bin/codesign -d --entitlements "$entitlements" --xml "$app" 2>/dev/null
  [[ "$(plist_value application-identifier "$entitlements")" == "$team.$id" ]] \
    || { echo "error: $app is not signed for $team.$id." >&2; exit 1; }
  [[ "$(plist_value get-task-allow "$entitlements")" == "false" ]] \
    || { echo "error: $app is development-signed (get-task-allow is not false)." >&2; exit 1; }
  [[ "$(plist_value beta-reports-active "$entitlements")" == "true" ]] \
    || { echo "error: $app is not signed with an App Store profile (no beta-reports-active)." >&2; exit 1; }
  [[ "$(plist_value com.apple.security.application-groups:0 "$entitlements")" == "$APP_GROUP" ]] \
    || { echo "error: $app lacks the $APP_GROUP entitlement; update the App ID and profiles (docs/ios-ipa.md)." >&2; exit 1; }
}

cmd_archive() {
  require_build_number
  local team
  team="$(team_id)"
  signing_flags
  rm -rf "$ARCHIVE"
  # Bash 3.2 (macOS) treats an empty array as unset under set -u, hence the ${a[@]+...} form.
  xcb -configuration Release -destination 'generic/platform=iOS' ${ASC_FLAGS[@]+"${ASC_FLAGS[@]}"} \
    -archivePath "$ARCHIVE" archive \
    DEVELOPMENT_TEAM="$team" CURRENT_PROJECT_VERSION="$PENNY_BUILD_NUMBER" ${SIGN_FLAGS[@]+"${SIGN_FLAGS[@]}"}
  verify_app "$ARCHIVE/Products/Applications/Penny.app"
  echo "Archive: $ARCHIVE ($(package_version) build $PENNY_BUILD_NUMBER, team $team)"
}

# Re-signs the archive for App Store Connect and writes Penny.ipa with its checksum.
cmd_export() {
  require_build_number
  [[ -d "$ARCHIVE" ]] || { echo "error: no archive at $ARCHIVE; run ios.sh archive first." >&2; exit 1; }
  local team options unpacked
  team="$(team_id)"
  signing_flags
  options="$CACHE/ExportOptions.plist"
  rm -f "$options"
  /usr/libexec/PlistBuddy -c "Add :method string app-store-connect" -c "Add :destination string export" \
    -c "Add :teamID string $team" \
    -c "Add :uploadSymbols bool true" -c "Add :manageAppVersionAndBuildNumber bool false" \
    -c "Add :testFlightInternalTestingOnly bool false" "$options" >/dev/null
  if [[ -n "${PENNY_PROFILE_SPECIFIER:-}" ]]; then
    /usr/libexec/PlistBuddy -c "Add :signingStyle string manual" -c "Add :signingCertificate string Apple Distribution" \
      -c "Add :provisioningProfiles dict" -c "Add :provisioningProfiles:$BUNDLE_ID string $PENNY_PROFILE_SPECIFIER" \
      -c "Add :provisioningProfiles:$WIDGETS_ID string $PENNY_WIDGETS_PROFILE_SPECIFIER" \
      "$options" >/dev/null
  else
    /usr/libexec/PlistBuddy -c "Add :signingStyle string automatic" "$options" >/dev/null
  fi
  rm -rf "$EXPORT_DIR"
  /usr/bin/xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$EXPORT_DIR" \
    -exportOptionsPlist "$options" ${ASC_FLAGS[@]+"${ASC_FLAGS[@]}"}
  [[ -f "$EXPORT_DIR/Penny.ipa" ]] || { echo "error: export did not write Penny.ipa." >&2; exit 1; }

  unpacked="$CACHE/ipa"
  rm -rf "$unpacked"
  /usr/bin/ditto -x -k "$EXPORT_DIR/Penny.ipa" "$unpacked"
  verify_app "$unpacked/Payload/Penny.app"
  verify_distribution_signature "$unpacked/Payload/Penny.app" "$team"
  (cd "$EXPORT_DIR" && /usr/bin/shasum -a 256 Penny.ipa > Penny.ipa.sha256)
  echo "IPA: $EXPORT_DIR/Penny.ipa (App Store signed, $(package_version) build $PENNY_BUILD_NUMBER)"
}

# Exercises the distribution checks without signing: the Release simulator app from
# release-check must pass verify_app, and copies with a wrong identity, version, build number,
# environment, server or test controls, and bad inputs, must each be refused. Each case runs in
# a subshell because the checks exit on failure.
cmd_distribution_test() {
  local app="$DERIVED/Build/Products/Release-iphonesimulator/Penny.app" work failures=0 build
  [[ -d "$app" ]] || { echo "error: run ios.sh release-check first." >&2; exit 1; }
  build="$(plist_value CFBundleVersion "$app/Info.plist")"
  work="$CACHE/distribution-test"
  rm -rf "$work" && mkdir -p "$work"

  expect() { # expect pass|fail <description> <command...>
    local want="$1" what="$2" got
    shift 2
    if ("$@") >"$work/out.log" 2>&1; then got=pass; else got=fail; fi
    if [[ "$got" == "$want" ]]; then
      echo "ok: $what ($want)"
    else
      echo "FAILED: $what: expected $want, got $got" >&2
      sed 's/^/    /' "$work/out.log" >&2
      failures=$((failures + 1))
    fi
  }
  tampered() { # tampered <name> <PlistBuddy command> -> prints the copy's path
    rm -rf "$work/$1.app" && cp -R "$app" "$work/$1.app"
    /usr/libexec/PlistBuddy -c "$2" "$work/$1.app/Info.plist"
    echo "$work/$1.app"
  }
  with_build() { PENNY_BUILD_NUMBER="$1"; shift; "$@"; }
  with_team() { PENNY_TEAM_ID="$1"; shift; "$@"; }

  expect pass "Release app passes the archive checks" with_build "$build" verify_app "$app"
  expect fail "another bundle id is refused" with_build "$build" verify_app \
    "$(tampered bundle 'Set :CFBundleIdentifier com.example.other')"
  expect fail "a version other than package.json's is refused" with_build "$build" verify_app \
    "$(tampered version 'Set :CFBundleShortVersionString 0.0.1')"
  expect fail "a different build number is refused" with_build "$build.1" verify_app "$app"
  expect fail "a development environment is refused" with_build "$build" verify_app \
    "$(tampered environment 'Set :PennyEnvironment development')"
  expect fail "a default server is refused" with_build "$build" verify_app \
    "$(tampered server 'Set :PennyDefaultServerURL http://127.0.0.1:3001')"
  expect fail "another App Group is refused" with_build "$build" verify_app \
    "$(tampered group 'Set :PennyAppGroup group.com.example.other')"
  rm -rf "$work/nowidgets.app" && cp -R "$app" "$work/nowidgets.app" && rm -rf "$work/nowidgets.app/$WIDGETS_APPEX"
  expect fail "an app without the widget extension is refused" with_build "$build" verify_app "$work/nowidgets.app"
  rm -rf "$work/widgetbuild.app" && cp -R "$app" "$work/widgetbuild.app"
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $build.9" "$work/widgetbuild.app/$WIDGETS_APPEX/Info.plist"
  expect fail "a widget build number other than the app's is refused" with_build "$build" verify_app "$work/widgetbuild.app"
  rm -rf "$work/widgetid.app" && cp -R "$app" "$work/widgetid.app"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.mfalicoff.penny.Widgets" "$work/widgetid.app/$WIDGETS_APPEX/Info.plist"
  expect fail "another widget extension id is refused" with_build "$build" verify_app "$work/widgetid.app"
  with_profiles() { PENNY_PROFILE_SPECIFIER="$1" PENNY_WIDGETS_PROFILE_SPECIFIER="$2"; signing_flags; }
  expect pass "manual signing with both profiles is accepted" with_profiles "Penny App Store" "Penny Widgets App Store"
  expect fail "manual signing with only the app profile is refused" with_profiles "Penny App Store" ""
  expect fail "manual signing with only the widget profile is refused" with_profiles "" "Penny Widgets App Store"
  rm -rf "$work/controls.app" && cp -R "$app" "$work/controls.app"
  echo "PENNY_TEST_CONTROLS" > "$work/controls.app/leftover.txt"
  expect fail "test controls in the bundle are refused" with_build "$build" verify_app "$work/controls.app"

  local number
  for number in 1 24.3.1 100.0 0; do
    expect pass "build number $number is accepted" with_build "$number" require_build_number
  done
  for number in "" 01 1.02 1.2.3.4 1a v1 1. -1; do
    expect fail "build number '$number' is refused" with_build "$number" require_build_number
  done
  expect pass "a 10-character team id is accepted" with_team ABCDE12345 team_id
  expect fail "a malformed team id is refused" with_team abc team_id
  touch "$work/AuthKey_WRONG.p8"
  touch "$work/AuthKey_RIGHT.p8"
  with_key() { PENNY_ASC_KEY_PATH="$1" PENNY_ASC_KEY_ID=RIGHT PENNY_ASC_ISSUER_ID=issuer; shift; "$@"; }
  expect pass "an API key file named for its id is accepted" with_key "$work/AuthKey_RIGHT.p8" require_asc_key
  expect fail "an API key file not named for its id is refused" with_key "$work/AuthKey_WRONG.p8" require_asc_key
  expect fail "a missing API key file is refused" with_key "$work/missing/AuthKey_RIGHT.p8" require_asc_key

  [[ $failures -eq 0 ]] || { echo "error: $failures distribution check(s) misbehaved." >&2; exit 1; }
  echo "Distribution checks: all cases behaved as expected."
}

# Validates and uploads the exported IPA to App Store Connect, where it appears in TestFlight
# once Apple processes it. Uploading never publishes to the App Store.
cmd_upload() {
  require_asc_key
  [[ -f "$EXPORT_DIR/Penny.ipa" ]] || { echo "error: no IPA at $EXPORT_DIR; run ios.sh export first." >&2; exit 1; }
  local auth=(--api-key "$PENNY_ASC_KEY_ID" --api-issuer "$PENNY_ASC_ISSUER_ID")
  export API_PRIVATE_KEYS_DIR
  API_PRIVATE_KEYS_DIR="$(dirname "$PENNY_ASC_KEY_PATH")"
  xcrun altool --validate-app "$EXPORT_DIR/Penny.ipa" "${auth[@]}"
  xcrun altool --upload-package "$EXPORT_DIR/Penny.ipa" "${auth[@]}" --wait
}

launch_on() {
  local id="$1" name="$2" app="$DERIVED/Build/Products/Debug-iphonesimulator/Penny.app"
  xcrun simctl bootstatus "$id" -b >/dev/null
  xcrun simctl install "$id" "$app"
  local pid
  pid="$(xcrun simctl launch "$id" com.mfalicoff.penny | sed -E 's/.*: ([0-9]+)$/\1/')"
  sleep 3
  xcrun simctl io "$id" screenshot "$RESULTS/launch-$name.png" >/dev/null
  # Simulator apps are host processes: still alive after launch means no crash on start.
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null \
    || { echo "error: Penny is not running on $name." >&2; exit 1; }
  # The penny:// scheme is registered to this app: iOS shows its "Open in Penny?" prompt,
  # captured in the deeplink screenshot. Routing itself is covered by DeepLinkTests.
  xcrun simctl openurl "$id" 'penny://entries/new'
  sleep 2
  xcrun simctl io "$id" screenshot "$RESULTS/launch-$name-deeplink.png" >/dev/null
  echo "Launched on $name; screenshot $RESULTS/launch-$name.png"
}

cmd_launch() {
  devices
  mkdir -p "$RESULTS"
  xcb -configuration Debug -destination "id=$IPHONE_ID" build
  launch_on "$IPHONE_ID" iphone
  launch_on "$IPAD_ID" ipad
}

# --- XCUITest (MAZ-81, docs/ios-ui-tests.md) ---------------------------------------------

# Without a running stack (PENNY_API_URL unset), starts the full-stack environment (.NET API,
# PostgreSQL, local OIDC provider) around this same command, then copies its logs next to the
# results. penny-env always tears the environment down, even when tests fail.
cmd_ui_test() {
  local plan="${1:-smoke}"
  case "$plan" in
    smoke | full | screenshots | performance) ;;
    *) echo "error: ui-test plan must be smoke, full, screenshots or performance." >&2; exit 2 ;;
  esac
  if [[ -n "${PENNY_API_URL:-}" && -n "${PENNY_TEST_TOKEN:-}" ]]; then
    ui_test_run "$plan"
    return
  fi
  command -v node >/dev/null || { echo "error: ui-test needs Node to start the test stack." >&2; exit 1; }
  local run_id status=0 out="$RESULTS/ui/$plan"
  run_id="r$(/usr/bin/od -An -N5 -tx1 /dev/urandom | tr -d ' \n')"
  local args=(run --run-id "$run_id" --oidc)
  [[ "${PENNY_STACK_BUILD:-1}" == 0 ]] && args+=(--no-build)
  node "$ROOT/scripts/test-env/penny-env.mjs" "${args[@]}" -- "$IOS_DIR/scripts/ios.sh" ui-test "$plan" || status=$?
  if [[ -d "$ROOT/test-results/fullstack/$run_id" ]]; then
    mkdir -p "$out"
    rm -rf "$out/server"
    cp -R "$ROOT/test-results/fullstack/$run_id" "$out/server"
    echo "Server logs: $out/server"
  fi
  return "$status"
}

# Device names to run on: PENNY_UI_DEVICES ("iphone ipad" by default; either alone is fine).
ui_devices() { echo "${PENNY_UI_DEVICES:-iphone ipad}"; }

# Prepares a fresh simulator for UI tests: boots it and trusts the local OIDC provider's
# throwaway certificate (single sign-on journeys). It also seeds the synthetic receipt files
# (seed_receipt_fixtures). Nothing is granted: tests set up permissions themselves.
prepare_ui_device() {
  local id="$1"
  xcrun simctl bootstatus "$id" -b >/dev/null
  seed_receipt_fixtures "$id"
  if [[ -n "${PENNY_OIDC_CERTIFICATE:-}" && -f "$PENNY_OIDC_CERTIFICATE" ]]; then
    xcrun simctl keychain "$id" add-root-cert "$PENNY_OIDC_CERTIFICATE"
  fi
  # Upgrade rehearsal: install and run the previous build first, so the plan's install of this
  # build is an in-place upgrade over real stored state (UpgradeTests).
  if [[ -n "${PENNY_UPGRADE_FROM_APP:-}" ]]; then
    xcrun simctl install "$id" "$PENNY_UPGRADE_FROM_APP"
    xcrun simctl launch "$id" com.mfalicoff.penny >/dev/null
    sleep 5
    xcrun simctl terminate "$id" com.mfalicoff.penny >/dev/null 2>&1 || true
  fi
}

# Receipt journeys (MAZ-78, docs/ios-receipts.md): synthetic files from receipt-fixtures.mjs. The
# photo goes into the photo library for the system photo picker; the PDFs and the refused files
# into Files › On My iPhone/iPad (the Files app's local storage), where the document picker finds
# them. The UI tests read manifest.json from RECEIPT_FIXTURES for the checksums.
RECEIPT_FIXTURES="$CACHE/receipt-fixtures"
seed_receipt_fixtures() {
  local id="$1" storage name
  # ui-test requires the receipt journeys' fixtures, as it requires the stack: missing Node or
  # Files storage stops the run instead of letting those journeys fail one by one.
  command -v node >/dev/null || { echo "error: Node is required to seed the receipt fixtures." >&2; exit 1; }
  node "$IOS_DIR/scripts/receipt-fixtures.mjs" "$RECEIPT_FIXTURES" >/dev/null
  xcrun simctl addmedia "$id" "$RECEIPT_FIXTURES/penny-receipt-photo.png"
  storage="$(xcrun simctl get_app_container "$id" com.apple.DocumentsApp groups 2>/dev/null \
    | sed -n 's/^group\.com\.apple\.FileProvider\.LocalStorage[[:space:]]*//p')"
  if [[ -z "$storage" ]]; then
    echo "error: no Files local storage on $id; the receipt file picker journeys can't run." >&2
    exit 1
  fi
  mkdir -p "$storage/File Provider Storage"
  for name in penny-receipt.pdf penny-damaged.pdf penny-renamed.pdf penny-oversized.png; do
    cp "$RECEIPT_FIXTURES/$name" "$storage/File Provider Storage/$name"
  done
}

ui_test_run() {
  local plan="$1" out="$RESULTS/ui/$1" failed=0 name id testplan only=()
  testplan="$(tr '[:lower:]' '[:upper:]' <<< "${plan:0:1}")${plan:1}"
  # PENNY_UI_ONLY: tests or classes, space-separated, e.g. PennyUITests/AuthJourneyTests (debugging).
  local selected
  for selected in ${PENNY_UI_ONLY:-}; do only+=("-only-testing:$selected"); done
  devices
  rm -rf "$out"/*.xcresult "$out"/*-attachments
  mkdir -p "$out"
  XCB_SCHEME=PennyUITests xcb -configuration Debug -destination "id=$IPHONE_ID" build-for-testing
  for name in $(ui_devices); do
    if [[ $name == iphone ]]; then id="$IPHONE_ID"; else id="$IPAD_ID"; fi
    prepare_ui_device "$id"
    echo "==> UI tests ($testplan) on $name"
    # xcodebuild hands TEST_RUNNER_* variables to the test runner without the prefix.
    if ! TEST_RUNNER_PENNY_API_URL="$PENNY_API_URL" TEST_RUNNER_PENNY_TEST_TOKEN="$PENNY_TEST_TOKEN" \
      TEST_RUNNER_PENNY_TEST_RUN="${PENNY_TEST_RUN:-local}" TEST_RUNNER_PENNY_OIDC_ISSUER="${PENNY_OIDC_ISSUER:-}" \
      TEST_RUNNER_PENNY_UITEST_REQUIRE_STACK=1 TEST_RUNNER_PENNY_UITEST_UPGRADE="${PENNY_UPGRADE_FROM_APP:+1}" \
      TEST_RUNNER_PENNY_RECEIPT_FIXTURES="$RECEIPT_FIXTURES" \
      XCB_SCHEME=PennyUITests xcb -configuration Debug -destination "id=$id" -testPlan "$testplan" \
      ${only[@]+"${only[@]}"} test-without-building -resultBundlePath "$out/$name.xcresult"; then
      failed=1
    fi
    # Screenshots, failure recordings and the accessibility trees, browsable without Xcode.
    xcrun xcresulttool export attachments --path "$out/$name.xcresult" --output-path "$out/$name-attachments" \
      >/dev/null 2>&1 || mkdir -p "$out/$name-attachments"
    # One simulator at a time: an idle booted iPhone starves the iPad run on small CI runners
    # (XCTest's accessibility queries then time out). The device itself is deleted at exit.
    xcrun simctl shutdown "$id" >/dev/null 2>&1 || true
  done
  echo "UI test results: $out"
  return "$failed"
}

# A notification payload through simctl (MAZ-79): exercises presentation and the tap on a
# simulator, never APNs transport (docs/ios-notifications.md#tests-and-verification).
cmd_push() {
  local file="$1" device="$2"
  [[ -f "$file" ]] || { echo "usage: ios.sh push <payload.apns> [simulator id]" >&2; exit 2; }
  xcrun simctl push "$device" com.mfalicoff.penny "$file"
}

main() {
  sanitize_environment
  select_xcode
  mkdir -p "$CACHE"
  case "${1:-}" in
    format) cmd_format ;;
    lint) cmd_lint ;;
    package-test) cmd_package_test ;;
    build) cmd_build ;;
    test) cmd_test ;;
    release-check) cmd_release_check ;;
    launch) cmd_launch ;;
    ui-test) cmd_ui_test "${2:-smoke}" ;;
    ui-build) XCB_SCHEME=PennyUITests xcb -configuration Debug -destination 'generic/platform=iOS Simulator' build-for-testing ;;
    archive) cmd_archive ;;
    export) cmd_export ;;
    upload) cmd_upload ;;
    distribution-test) cmd_distribution_test ;;
    ci) cmd_lint; cmd_package_test; cmd_test; cmd_release_check; cmd_distribution_test ;;
    push) cmd_push "${2:-}" "${3:-booted}" ;;
    *) sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
  esac
}

main "$@"
