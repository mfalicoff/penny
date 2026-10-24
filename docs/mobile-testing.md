# Mobile test suite

The same React Native interaction tests run under the Expo SDK 57 iOS and Android Jest presets. The web project and the Node/API suite cover browser rendering and persistence separately.

```sh
npm run test:ui:ios
npm run test:ui:android
npm run test:ui -- --selectProjects web
npm test
```

| Flow | Automated checks |
| --- | --- |
| Sign-in and registration | Email normalization, password privacy, registration, errors, retry, demo entry, route/session persistence |
| Entries and transactions | Amount validation, draft retention, save retry, kind and search filters, month/year selection, pagination, entry editing |
| Accounts and categories | Creation, trimming, kind/type selection, invalid input, linked deletion safeguards, save retry |
| Trips | Personal and shared creation, invitation join, date validation, linked deletion safeguards, save retry, route navigation |
| Recurring entries | Empty state, editing, pause/resume, deletion confirmation, recorded-history preservation |
| Households | Shared expense form, splits, join/create flows, projection, balances and server permissions |
| Settings and device controls | Currency lock, sign-out failure, demo exit, native date picker selection and dismissal on each platform |
| Sync and backend | Offline ledger, revision conflicts, two-session persistence, receipt ownership, push routes and API boundaries |

These tests render native components in Jest. They do not verify device layout, keyboard behavior, system permission prompts, receipt pickers, push delivery, widgets, or native binary startup. The existing narrow-viewport Playwright tests verify mobile web layout, not an iOS or Android app.

## Live iOS simulator regression test

```sh
npm run test:simulator:ios
```

Unlike Jest's iOS preset, this launches the native Penny app in an actual iOS Simulator and drives it with the separately installed `agent-device` CLI. Requirements: macOS, Xcode with an available iPhone runtime, `agent-device` on `PATH`, and a compatible Penny development build installed in an existing simulator (`npx expo run:ios`). No automation dependency is downloaded automatically. After native dependency changes, rebuild that development binary before testing; JS changes are loaded fresh from this checkout through Metro.

The test creates a **temporary simulator**, reuses only the installed app binary, and starts its own Metro server and in-memory Penny servers on free loopback ports. It does not erase or reuse an existing simulator's app data and does not connect to your configured Penny server. It closes the automation session, shuts down and deletes the temporary simulator, and stops its services even when assertions fail.

Coverage:

- The initial mobile default is retained without a verification request.
- Invalid URLs and a non-Penny HTTP server cannot be saved; identity requests contain no session credentials.
- A valid Penny server's version appears before saving, and changing the input invalidates verification.
- The chosen URL and version survive native app termination/relaunch, and startup requests reach the selected backend.
- Settings shows the device's selected server and requires leaving the active workspace before switching.

Screenshots, the command transcript, backend request evidence and Metro logs are written under `test-results/ios-server-connection/`. This does **not** simulate installing an old app release and upgrading its native binary; session/offline-ledger migration remains covered by the data tests.

Optional environment variables: `PENNY_IOS_APP_PATH` selects a simulator `.app` instead of discovering an installed one; `PENNY_XCODE_DEVELOPER_DIR` selects Xcode (default `/Applications/Xcode.app/Contents/Developer`). If an already-running agent-device daemon inherited an invalid `DEVELOPER_DIR`, close its sessions and restart it with the correct Xcode environment before running the test.

Verified on October 24, 2026: `npm run test:simulator:ios` passed on a temporary iPhone 17 / iOS 27.0 simulator, using the installed development binary and this checkout's current JavaScript. All five regression checks passed (six Node test results including the parent). The temporary simulator was deleted and the test services were stopped. The harness passes the debug host through native launch arguments as well as agent-device's Metro hints, since simulator-wide defaults alone did not bind the sandboxed app on this runtime.

## Live Android emulator regression test

```sh
npm run test:emulator:android
```

This drives the native Android app with `agent-device`, using the same five regression scenarios as the iOS test (`tests/simulator/server-connection-scenarios.mjs`). It is separate from the Android Jest preset and mobile-web Playwright tests. Run the native suites one at a time on a development machine; concurrent simulator/emulator boot and instrumentation can destabilize the Android automation bridge.

Requirements: an installed Android SDK/emulator, at least one configured AVD with its system image available, `adb` and the separately installed `agent-device` CLI on `PATH`, and a compatible development APK. The default APK is `android/app/build/outputs/apk/debug/app-debug.apk`; build it with `npx expo run:android` after native dependency changes. The test starts its own Metro server to load current JavaScript from this checkout. Both native harnesses prefer IPv4 DNS resolution for that process, keeping Expo's `--localhost` listener reachable through the explicit `127.0.0.1` debug URLs and Android port reversals instead of binding only to `::1`.

The test copies **only the source AVD configuration** into a temporary directory, boots that new emulator headlessly with snapshots disabled, installs the APK, and starts isolated in-memory Penny backends on free ports. `adb reverse` maps the fixture and Metro ports to emulator loopback. It does not wipe or copy an existing emulator's app data, use real accounts, or connect to your configured Penny server. Cleanup closes the app session, stops the temporary emulator/Metro/backends, and removes the temporary AVD directory, including on assertion failures.

Optional settings:

- `ANDROID_HOME` / `ANDROID_SDK_ROOT`: SDK location (otherwise the usual macOS/Linux SDK path).
- `ANDROID_AVD_HOME` / `ANDROID_USER_HOME`: where to discover existing AVD configurations.
- `PENNY_ANDROID_AVD`: source AVD name; defaults to the first discovered configuration.
- `PENNY_ANDROID_APK`: development APK path.
- `PENNY_ADB_PATH`: explicit adb executable, if it is not on `PATH`.

Android uses the regular system keyboard (`--no-test-ime`), verifies that the controlled URL field retained each typed value, and dismisses the keyboard before pressing the check/save controls. A stable `testID` identifies the URL input on both platforms. Android actions use explicit destination waits rather than accessibility-idle settle loops, which can stall on React Native content.

Screenshots, the command transcript, backend requests, Metro output and emulator logs are written under `test-results/android-server-connection/`. As with the iOS test, installing an old native binary and upgrading it is not covered by this journey; detailed session/offline-ledger migration is checked separately by the data tests.

Verified on October 24, 2026: all five checks passed on a temporary Pixel 10 Pro profile running Android 17 / API 37 (the `android-37.1` image), using the existing development APK and current JavaScript. Node reported six passing results including the parent test. The emulator, temporary AVD and test services were cleaned up. The shared scenarios also passed again on the iPhone 17 / iOS 27.0 simulator. On macOS, `caffeinate -i npm run test:emulator:android` can keep an unattended test run awake; the test command itself is unchanged.

## Manual device smoke testing

For a device smoke pass, install a local development build with `npx expo run:ios` or `npx expo run:android`, then use `agent-device` to check launch, demo navigation, entry creation, date selection, settings, and returning from a backgrounded app. Local Android builds require a working JDK; Expo's SDK 57 build image uses Java 17. Local iOS builds require Xcode and CocoaPods. [Expo local build guidance](https://docs.expo.dev/build-reference/local-builds/) and [SDK 57 build image](https://docs.expo.dev/build-reference/infrastructure/) document those prerequisites.

The app uses `expo-build-properties` with `ios.enableSceneSupport` so an SDK 57 build made with Xcode 27 can launch on iOS 27. Regenerate the ignored `ios/` directory after changing this setting: `npx expo prebuild --clean --platform ios`. [Expo's scene lifecycle guide](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md) documents the SDK 57 opt in.

Device smoke verified on October 23, 2026:

| Device | Result |
| --- | --- |
| Pixel 10 Pro Android emulator | Debug build, demo launch, native date picker, expense creation, updated totals, and Transactions navigation passed. |
| iPhone 17 iOS 27 simulator | Debug build, demo launch, native date selection, expense creation, updated totals, Transactions navigation, and Settings sheet passed. |

Live sign-in was outside this pass because single sign-on configuration could not be loaded on either simulator; the app showed “Could not load single sign-on.” The automated auth UI and API tests cover sign-in behavior with controlled responses.
