# iOS IPA and TestFlight builds

[App showcase](../README.md) · [Documentation](README.md)

The **Build Android APK and iOS IPA for TestFlight** GitHub Actions workflow runs on version tags such as `v1.2.3` and manual dispatch. After lint, type checks and tests pass, the iOS job builds a store signed IPA on EAS, uploads `penny.ipa` and its SHA-256 checksum as GitHub Actions artifacts for 30 days, then submits that exact EAS build to TestFlight. The Android APK builds in the same workflow. Builds use your Expo account's EAS build quota.

The `ipa` EAS build profile uses `"distribution": "store"`. TestFlight accepts store signed builds; this IPA cannot be installed directly from the GitHub artifact. Testers install it through Apple's TestFlight app after Apple processes the upload. Uploading to TestFlight does not publish the app to the App Store.

## One-time setup

1. Confirm the iOS bundle identifier in `app.json`. This repository uses `com.mfalicoff.penny`. It must match the app's Bundle ID in App Store Connect. If an iOS app already exists, keep its existing identifier and Apple team.

2. In the Expo project's **Environment variables** settings, set `EXPO_PUBLIC_API_URL` in the **production** environment to your server's reachable HTTPS origin. The `ipa` build profile selects this environment. This URL is embedded in the app and is not a secret; a local `.env` is ignored during EAS upload.

3. In [App Store Connect](https://appstoreconnect.apple.com/), create the Penny app record for this bundle identifier if it does not exist. Open **App Information** and copy its numeric **Apple ID**. In GitHub, set that number as the repository **variable** `ASC_APP_ID` under **Settings → Secrets and variables → Actions → Variables**. The workflow inserts it into the EAS submit profile at run time; it is not a secret.

4. Prepare store signing credentials and an App Store Connect API key under the same Apple team. From this repository, run:

   ```sh
   npx eas-cli@latest login
   npx eas-cli@latest credentials --platform ios
   ```

   Select the `ipa` build profile and let EAS create or reuse a distribution certificate and App Store provisioning profile. In the credentials menu, select **App Store Connect → Manage your API Key → Set up your project to use an API Key for EAS Submit**. The CI submission reuses that key non-interactively. If this app has a previous iOS build number, first set the remote EAS counter to that value with `npx eas-cli@latest build:version:set --platform ios --profile ipa`.

5. After completing the widget App Groups setup below, run the first iOS build interactively to finish Apple signing setup:

   ```sh
   EXPO_NO_CAPABILITY_SYNC=1 npx eas-cli@latest build --platform ios --profile ipa
   ```

   In GitHub, also set the repository **secret** `EXPO_TOKEN` to an Expo access token with access to this EAS project. It is shared with the Android job. Push the configuration, then open **Actions → Build Android APK and iOS IPA for TestFlight → Run workflow**. Ordinary branch pushes and pull requests do not start EAS builds.

### Widget App Groups setup

Penny's iOS widgets share data with the app through the App Group `group.com.mfalicoff.penny`. Before running the iOS CI job with widgets, configure it in [Apple Developer → Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list):

1. Under **Identifiers → App Groups**, register `group.com.mfalicoff.penny` if it does not already exist.
2. Under **Identifiers → App IDs**, open both `com.mfalicoff.penny` and `com.mfalicoff.penny.ExpoWidgetsTarget`. Enable **App Groups** on each ID and assign the same `group.com.mfalicoff.penny` group. Save both IDs.
3. Regenerate the App Store provisioning profiles for **both** bundle IDs so their entitlements include that App Group. For EAS-managed credentials, run `EXPO_NO_CAPABILITY_SYNC=1 npx eas-cli@latest credentials --platform ios` from this repository, select the `ipa` profile, and update each target's provisioning profile. Keep the existing distribution certificate. Then run the interactive build from step 5 to verify signing before rerunning GitHub Actions.

The iOS CI build sets `EXPO_NO_CAPABILITY_SYNC=1` because EAS's capability-sync request can be [rejected by Apple's API](https://github.com/expo/eas-cli/issues/3986). This only skips the remote capability update; it does not remove the app's or widget extension's App Group entitlements. Any future iOS entitlement changes must be applied to the matching Apple App IDs and provisioning profiles before CI builds.

CI passes `--non-interactive --freeze-credentials` to EAS Build, so missing or unusable signing credentials fail the iOS job. It checks `ASC_APP_ID` before building and submits the exact completed build ID with the stored App Store Connect API key. EAS increments the iOS build number remotely on each build, including reruns.

The user-visible version comes from `package.json` through `app.config.js`. Merge the [automated release PR](releases.md#automated-release-flow) to bump it, publish release notes, and create the matching tag that starts these builds. TestFlight reruns keep that version while EAS increments the build number.

After submission, Apple processes the build before it appears under **App Store Connect → Penny → TestFlight**. Add it to an internal testing group to invite your App Store Connect team; enable automatic distribution there if those testers should receive each new build automatically. External testers require a TestFlight group and Apple's Beta App Review. If GitHub times out after submitting, check the EAS dashboard and App Store Connect before starting another build.

References: [Expo TestFlight guide](https://docs.expo.dev/submit/testflight/), [iOS submission](https://docs.expo.dev/submit/ios/), [EAS CI setup](https://docs.expo.dev/build/building-on-ci/), [iOS capabilities](https://docs.expo.dev/build-reference/ios-capabilities/), and [remote version management](https://docs.expo.dev/build-reference/app-versions/).
