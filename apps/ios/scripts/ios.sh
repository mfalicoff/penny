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
#   ci             lint, package-test, test and release-check
#
# Xcode is pinned by apps/ios/.xcode-version. Outputs go to .cache/ios (git-ignored).
# PENNY_IPHONE / PENNY_IPAD choose simulator device types (default: the newest iPhone
# Pro and iPad Pro 11-inch the selected Xcode offers). PENNY_RUNTIME pins a runtime identifier.
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
  /usr/bin/xcodebuild -project "$PROJECT" -scheme "$SCHEME" -derivedDataPath "$DERIVED" \
    -clonedSourcePackagesDirPath "$CACHE/SourcePackages" -skipMacroValidation "$@"
}

swift_sources() {
  find "$IOS_DIR/Penny" "$IOS_DIR/PennyTests" "$PACKAGE/Sources" "$PACKAGE/Tests" "$PACKAGE/Package.swift" \
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

  echo "==> property lists"
  /usr/bin/plutil -lint "$IOS_DIR/Configuration/Info.plist" "$IOS_DIR/Configuration/Penny.entitlements" \
    "$IOS_DIR/Penny/PrivacyInfo.xcprivacy"
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
    if /usr/bin/strings -a "$file" | grep -qE "PENNY_TEST_SERVER_URL|TestControls"; then
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
    ci) cmd_lint; cmd_package_test; cmd_test; cmd_release_check ;;
    *) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
  esac
}

main "$@"
