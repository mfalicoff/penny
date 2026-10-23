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

For a device smoke pass, install a local development build with `npx expo run:ios` or `npx expo run:android`, then use `agent-device` to check launch, demo navigation, entry creation, date selection, settings, and returning from a backgrounded app. Local Android builds require a working JDK; Expo's SDK 57 build image uses Java 17. Local iOS builds require Xcode and CocoaPods. [Expo local build guidance](https://docs.expo.dev/build-reference/local-builds/) and [SDK 57 build image](https://docs.expo.dev/build-reference/infrastructure/) document those prerequisites.

The app uses `expo-build-properties` with `ios.enableSceneSupport` so an SDK 57 build made with Xcode 27 can launch on iOS 27. Regenerate the ignored `ios/` directory after changing this setting: `npx expo prebuild --clean --platform ios`. [Expo's scene lifecycle guide](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md) documents the SDK 57 opt in.

Device smoke verified on October 23, 2026:

| Device | Result |
| --- | --- |
| Pixel 10 Pro Android emulator | Debug build, demo launch, native date picker, expense creation, updated totals, and Transactions navigation passed. |
| iPhone 17 iOS 27 simulator | Debug build, demo launch, native date selection, expense creation, updated totals, Transactions navigation, and Settings sheet passed. |

Live sign-in was outside this pass because single sign-on configuration could not be loaded on either simulator; the app showed “Could not load single sign-on.” The automated auth UI and API tests cover sign-in behavior with controlled responses.
