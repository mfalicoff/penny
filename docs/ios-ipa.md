# iOS builds, signing and TestFlight

[App showcase](../README.md) · [Documentation](README.md) · [Native iOS app](../apps/ios/README.md) · [Expo upgrade](ios-expo-migration.md)

Penny for iPhone and iPad ships as the native SwiftUI app in [`apps/ios`](../apps/ios/README.md), built with Xcode and uploaded to TestFlight (MAZ-98). It replaces the Expo app **in place**: same bundle id, Apple team, App Group, URL scheme and widget identifiers. A TestFlight or App Store update therefore installs over the Expo build and imports its data on first launch ([Expo upgrade](ios-expo-migration.md)).

The **Build the iOS app for TestFlight** workflow ([`.github/workflows/ios-testflight.yml`](../.github/workflows/ios-testflight.yml)) runs when a GitHub Release is published for a version tag such as `v1.2.3`, or by manual dispatch. It:

1. runs the application tests ([`tests.yml`](../.github/workflows/tests.yml): release version, lint, types, unit and browser tests) and the iOS gates ([`ios.yml`](../.github/workflows/ios.yml): swift-format, PennyKit and app tests on iPhone and iPad, the Release check, launch, and the XCUITest smoke plan against the full stack);
2. signs a Release archive with the App Store distribution certificate and profile (`apps/ios/scripts/ios.sh archive`);
3. exports an App Store signed IPA and checks it (`ios.sh export`): bundle id, version, build number, production environment, no default server, no test controls, the App Group, `get-task-allow` off and an App Store profile (`beta-reports-active`);
4. attaches `penny.ipa` and `penny.ipa.sha256` to the release's **Assets** and keeps the IPA and dSYMs as an Actions artifact for 30 days;
5. validates and uploads that IPA to App Store Connect (`ios.sh upload`), where it appears under TestFlight once Apple processes it.

The IPA is store signed: it installs only through TestFlight or the App Store, not from the release page. Uploading to TestFlight never publishes to the App Store. Android builds are retired ([below](#android-retirement)).

## One-time setup

Everything uses the Apple team that already owns `com.mfalicoff.penny` in App Store Connect. Never create a new App ID: a different bundle id or team is a different app, and Expo installs would not upgrade.

1. **Distribution certificate.** Reuse the Apple Distribution certificate the Expo builds use, so nothing changes for existing installs. Download it with `npx eas-cli@latest credentials --platform ios` (profile `ipa` → **Distribution Certificate** → download the `.p12` and its password), or export it from Keychain Access if you created it there. A new Apple Distribution certificate also works; revoking the old one does not affect installed apps.
2. **App Store provisioning profile.** In [Certificates, Identifiers & Profiles → Profiles](https://developer.apple.com/account/resources/profiles/list), create (or reuse) an **App Store Connect** distribution profile for `com.mfalicoff.penny` with that certificate. Its App ID must have the App Groups capability with `group.com.mfalicoff.penny` ([App Groups](#widget-app-groups-setup)); `ios.sh export` fails if the signed app lacks it. Download the `.mobileprovision`. Note its name: the workflow reads it from the file.
3. **App Store Connect API key.** In [App Store Connect → Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api), create a team key with the **App Manager** role. Download `AuthKey_<KEY ID>.p8` (Apple offers it once) and note the key ID and issuer ID. The key only uploads builds; signing uses the certificate and profile.
4. **Build number base.** App Store Connect rejects a build number that is not higher than every earlier upload of the same version, including the Expo builds. Read the last EAS build number with `npx eas-cli@latest build:version:get --platform ios` (or from TestFlight) and use a number above it as the base. Native builds are numbered `<base>.<run>.<attempt>` ([build numbers](#versions-and-build-numbers)).
5. In GitHub, under **Settings → Secrets and variables → Actions**, add:

   | Kind | Name | Value |
   | --- | --- | --- |
   | Variable | `APPLE_TEAM_ID` | The 10-character team id that owns `com.mfalicoff.penny` |
   | Variable | `IOS_BUILD_NUMBER_BASE` | The base from step 4, e.g. `24` |
   | Variable | `ASC_API_KEY_ID` | The API key id |
   | Variable | `ASC_API_ISSUER_ID` | The API issuer id |
   | Secret | `ASC_API_KEY_P8` | The full text of `AuthKey_<KEY ID>.p8` |
   | Secret | `IOS_DIST_CERT_P12` | `base64 -i distribution.p12` |
   | Secret | `IOS_DIST_CERT_PASSWORD` | The `.p12` password |
   | Secret | `IOS_APPSTORE_PROFILE` | `base64 -i Penny_App_Store.mobileprovision` |

   The workflow checks each value before it builds. It imports the certificate into a temporary keychain and deletes the keychain, profile and key afterwards. `EXPO_TOKEN` and `ASC_APP_ID` are needed only for the [legacy Expo build](#legacy-expo-build).
6. Run **Actions → Build the iOS app for TestFlight → Run workflow** on `v2` once. Ordinary pushes and pull requests never sign or upload.

When the profile or certificate expires (yearly), regenerate it and replace the secret. A profile change for a new entitlement follows the [App Groups](#widget-app-groups-setup) steps.

### Widget App Groups setup

The app and its widgets share data through the App Group `group.com.mfalicoff.penny`. The Expo app already uses it, so it is normally configured. To check or set it up in [Apple Developer → Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list):

1. Under **Identifiers → App Groups**, register `group.com.mfalicoff.penny` if it does not exist.
2. Under **Identifiers → App IDs**, open `com.mfalicoff.penny` and `com.mfalicoff.penny.ExpoWidgetsTarget`. Enable **App Groups** on each and assign `group.com.mfalicoff.penny`. Save both.
3. Regenerate the App Store provisioning profiles for both ids so their entitlements include the group, and update `IOS_APPSTORE_PROFILE`.

The widget extension keeps the id `com.mfalicoff.penny.ExpoWidgetsTarget` so widgets people already placed keep working. The native WidgetKit extension arrives with MAZ-80; when it does, it needs its own App Store profile in the workflow and in `ios.sh export`'s `provisioningProfiles`. Any new entitlement (for example `aps-environment` for push, MAZ-79) must be enabled on the App ID, and the profiles regenerated, **before** the first CI build that uses it.

## Signing

`ios.sh` signs in one of two ways:

| | Manual (CI) | Automatic (a Mac) |
| --- | --- | --- |
| When | `PENNY_PROFILE_SPECIFIER` is set to an installed App Store profile's name | otherwise |
| Archive | Apple Distribution certificate and that profile, app target only (`Configuration/Penny.xcconfig`) | Apple Development, from the Apple account under **Xcode → Settings → Accounts** (or the API key) |
| Export | re-signs with the same certificate and profile | Xcode picks or creates the distribution certificate and profile (`-allowProvisioningUpdates`) |
| Apple-side changes | none | may create profiles or a cloud-managed certificate |

To build and upload from a Mac, set `DEVELOPMENT_TEAM` in `apps/ios/Configuration/Signing.local.xcconfig` ([native app signing](../apps/ios/README.md#signing-and-entitlements)) or export `PENNY_TEAM_ID`, then:

```sh
export PENNY_BUILD_NUMBER=24.1000.1   # above every earlier upload for this version
apps/ios/scripts/ios.sh archive        # .cache/ios/Penny.xcarchive
apps/ios/scripts/ios.sh export         # .cache/ios/export/Penny.ipa and .sha256
PENNY_ASC_KEY_PATH=~/.appstoreconnect/private_keys/AuthKey_ABC123.p8 \
  PENNY_ASC_KEY_ID=ABC123 PENNY_ASC_ISSUER_ID=<issuer> \
  apps/ios/scripts/ios.sh upload       # altool --validate-app, then --upload-package --wait
```

A local upload uses a build number too; choose one that CI will not reuse (a high middle part such as `.1000.` above).

## Versions and build numbers

- **Version** (`CFBundleShortVersionString`): `MARKETING_VERSION` in `apps/ios/Configuration/Version.xcconfig`, kept equal to `package.json` by release-please and `npm run version:check`. `ios.sh archive` checks the archive carries it.
- **Build number** (`CFBundleVersion`): `PENNY_BUILD_NUMBER`, set by CI to `<IOS_BUILD_NUMBER_BASE>.<run number>.<run attempt>`. App Store Connect compares the parts in order, so every run and rerun is higher than the last, and all are higher than the Expo builds (whole numbers below the base). Xcode is told not to change it (`manageAppVersionAndBuildNumber` off).
- After any [legacy Expo build](#legacy-expo-build), EAS's counter moves past the base. Raise `IOS_BUILD_NUMBER_BASE` above the new EAS number before the next native build.

## Release runbook

1. Merge the [release PR](releases.md#automated-release-flow); it bumps `package.json` and `Version.xcconfig` and publishes the GitHub Release, which starts the workflow. Pushing a tag alone does not.
2. Wait for the workflow. If a gate fails, fix it on `v2` and rerun; nothing was uploaded. If GitHub times out after the upload started, check App Store Connect → TestFlight before rerunning (a rerun gets a new build number, so it cannot collide).
3. In App Store Connect → Penny → TestFlight, add the build to the internal group. External groups need Beta App Review.
4. Run the [device checklist](#testflight-upgrade-and-device-checklist) on at least one iPhone and one iPad that have the **Expo** TestFlight build installed with real-shaped (not personal) data, and record the results on the release.
5. Expand to more testers only after the checklist passes. App Store submission is a separate, manual step.

### TestFlight upgrade and device checklist

Run on physical devices with iOS 26 or later, upgrading from the latest Expo build without deleting it. Use a test account and fixture-like data, never personal financial data in screenshots or logs.

- [ ] **Before upgrading**, in the Expo app: sign in, pick a non-default server, set the appearance (try AMOLED or Catppuccin), turn on the app lock, place both widgets, and go offline and add two entries so they are pending.
- [ ] **Upgrade** through TestFlight. The app opens to the lock cover, in Dark if the Expo appearance was AMOLED or Catppuccin, on the same server and still signed in (or asks to sign in to the same account).
- [ ] **Pending entries**: both offline entries appear, sync when online, and show on the web app. Settings shows no import notice afterwards.
- [ ] **Biometrics**: Face ID / Touch ID unlocks; cancelling falls back to the passcode.
- [ ] **OIDC**: sign out and sign in with the provider; `penny://auth/callback` returns to the app.
- [ ] **Pickers**: attach a receipt from Photos, Files and the camera; preview and share it.
- [ ] **Push (APNs)** once MAZ-79 ships: allow notifications; another member's shared expense notifies this device.
- [ ] **Widgets** once MAZ-80 ships: the widgets placed under Expo still show and update; tapping one opens `penny://entries/new`.
- [ ] **Redesign**: Liquid Glass controls on iOS 26, light/dark with Reduce Transparency on and off, the largest Dynamic Type size, VoiceOver through Home → add entry → save, forms stay above the keyboard, inline categories, recorded vs projected money, and recovery from a stale shared payment.
- [ ] **PostgreSQL backend**: read, write and keyword search against the migrated .NET/PostgreSQL server (MAZ-65), and reconcile an offline edit.

Attach screenshots or a short recording to the release and to MAZ-98, with MAZ-82 (native simulator) and MAZ-96 (end-to-end) acceptance evidence.

### Rollback and recovery

- **A bad native build**: in TestFlight, stop testing that build (**Expire Build**) and tell testers to install the previous native build from the TestFlight app's **Previous Builds**. The native app's data stays in place.
- **Back to Expo**: testers can install the last Expo build from **Previous Builds** (TestFlight only; the App Store never downgrades). What an Expo build finds after the native app ran is described in the [Expo upgrade rollback limits](ios-expo-migration.md#rollback-limits). If no Expo build is still installable (TestFlight builds expire after 90 days), run the [legacy Expo build](#legacy-expo-build).
- **Signing broke** (expired certificate or profile, a missing entitlement): the export check names the cause. Regenerate the profile or certificate, replace the secret and rerun. Nothing reaches testers in between.

Rehearse a rollback to the previous native build and to the Expo build once on a test device before widening TestFlight.

## Legacy Expo build

The Expo app's EAS build stays available until the native in-place upgrade is proven on devices, as a rollback target only. Run **Actions → Build the iOS app for TestFlight → Run workflow** with **app: legacy-expo**. It runs the application tests, builds the `ipa` EAS profile with the existing EAS credentials (`EXPO_TOKEN` secret, `EXPO_NO_CAPABILITY_SYNC=1` because EAS's capability sync is [rejected by Apple](https://github.com/expo/eas-cli/issues/3986) for App Groups) and submits it to TestFlight (`ASC_APP_ID` variable: the app's numeric Apple ID from App Store Connect → App Information). Releases never run it.

It shares the TestFlight build train: afterwards, raise `IOS_BUILD_NUMBER_BASE` above its EAS build number.

**Retire it** (remove the job, the `ipa` EAS profile, `EXPO_TOKEN` and `ASC_APP_ID`) when all of these hold:

- the [device checklist](#testflight-upgrade-and-device-checklist) passed on an upgrade from the last Expo build, including pending entries, with no open import issue;
- at least one native release has been on TestFlight for two weeks with no rollback to Expo;
- the web app no longer uses Expo (MAZ-97), so the Expo mobile dependencies and config can go with it.

## Android retirement

Penny no longer builds or supports Android. There is no sunset period and no migration path: the APK and Play builds, their EAS profiles, the Android app config and assets, and the Android test harness are gone. People on Android can use the web app with the same account; their data is on the server. Already-installed Android builds keep working against a compatible server until it drops the legacy API (MAZ-131), but receive no fixes.

The legacy Expo sources still contain Android branches (`Platform.OS === "android"`); they are removed with the Expo app.
