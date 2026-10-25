# Android APK builds

[App showcase](../README.md) · [Documentation](README.md)

The **Build Android APK and iOS IPA for TestFlight** GitHub Actions workflow runs manually from the Actions tab or when a version tag such as `v1.2.3` is pushed. It runs lint, type checks and tests, then starts Android and iOS EAS cloud builds. The Android job uploads `penny.apk` plus its SHA-256 checksum as a GitHub Actions artifact retained for 30 days. Download and unzip that artifact to install the APK on a phone. Builds use your Expo account's EAS build quota. See [iOS IPA builds](ios-ipa.md) for the Apple signing and TestFlight setup required by the other job.

## One-time setup

1. Confirm the Android application ID in `app.json`. This repository uses `com.mfalicoff.penny`. If you already distribute an APK, use its exact application ID and existing signing keystore before building an update. A different ID installs a separate app; a different signing key cannot update the existing installation.

2. Log in and link the app to an EAS project:

   ```sh
   npx eas-cli@latest login
   npx eas-cli@latest init
   ```

   Commit the resulting `expo.extra.eas.projectId` and any `owner` changes in `app.json`. Link the existing project if one already holds this app's credentials. Keep the committed project ID stable.

3. Optionally set the initial server default by adding `EXPO_PUBLIC_API_URL` in the Expo project's **Environment variables**, in the **production** environment with **Plain text** visibility (for example `https://penny.example.com`). Users can select their own server from the mobile sign-in screen; the choice is stored per device. For the first release upgrading existing installs to device settings, keep the same value used by the previous APK so migration preserves their current server, session, and offline entries. The value is embedded in the APK and is not a secret. The `apk` profile explicitly selects this EAS environment; setting a variable only in GitHub Actions does not configure the cloud builder. A local `.env` is ignored during upload.

4. Prepare signing credentials interactively:

   ```sh
   npx eas-cli@latest credentials --platform android
   ```

   Select the `apk` profile. For an already distributed app, upload its existing keystore, alias and passwords in the credentials manager; do not generate a replacement. For a new app, generate a keystore once and let EAS store it. Download a backup using the credentials manager and store it, its alias and both passwords securely outside Git. `credentials.json`, `*.jks` and `*.keystore` are ignored by this repository.

   If previous APKs have already been distributed, initialize EAS's Android version counter to the highest distributed `versionCode` **before** this first build:

   ```sh
   npx eas-cli@latest build:version:set --platform android --profile apk
   ```

   Then complete the first cloud build from your terminal:

   ```sh
   npx eas-cli@latest build --platform android --profile apk
   ```

5. Create an [Expo access token](https://docs.expo.dev/accounts/programmatic-access/) for an account with access to this project. In GitHub, open **Settings → Secrets and variables → Actions** and add it as a repository secret named `EXPO_TOKEN`.

6. Complete the [iOS and TestFlight setup](ios-ipa.md) as well, then push the configuration and open **Actions → Build Android APK and iOS IPA for TestFlight → Run workflow**. Future version tags also trigger both builds. Ordinary branch pushes and pull requests do not consume EAS builds.

## Keeping APK updates compatible

The `apk` profile explicitly uses `credentialsSource: "remote"`, so EAS reuses the stored signing keystore on subsequent builds. CI passes `--freeze-credentials` and `--non-interactive`: missing or unusable credentials fail the build instead of being replaced during automation. Never delete or regenerate the keystore used for distributed APKs. Rotating `EXPO_TOKEN` is safe; it authenticates CI and is not the signing key.

EAS stores the Android version counter remotely and `autoIncrement: true` raises it for each new build, including reruns. This avoids depending on GitHub run numbers or uncommitted version changes. Builds are serialized by the workflow. Install the APK with the higher version code over the existing app to preserve its installation and local data; do not uninstall first. For a new user-visible version, merge the [automated release PR](releases.md#automated-release-flow); `app.config.js` reads its version from `package.json`, and the resulting tag starts the build.

After the first release, verify an update by installing one APK, building another, and installing it over the first. The Android package and signing certificate must match, and the newer APK must have a higher version code. If you migrate from Google Play, its app signing key may differ from your upload key; the APK needs the key that signed the installed app.

If the GitHub job times out or is canceled after submitting a build, check the EAS dashboard: the cloud build may still be running. Its completed APK remains available there according to EAS retention, even if GitHub never uploaded the artifact.

References: [Expo CI setup](https://docs.expo.dev/build/building-on-ci/), [managed signing credentials](https://docs.expo.dev/app-signing/managed-credentials/), [remote version management](https://docs.expo.dev/build-reference/app-versions/), and [APK build profiles](https://docs.expo.dev/build-reference/apk/).
