# Releases

[App showcase](../README.md) · [Documentation](README.md)

Run release commands from the repository root. Platform-specific credentials and distribution instructions live in [Android APK builds](android-apk.md) and [iOS IPA and TestFlight builds](ios-ipa.md). Container publishing is covered in [Self-hosting](deployment.md#automated-container-builds).

## Semantic versioning and releases

Penny uses [Semantic Versioning](https://semver.org/): **MAJOR.MINOR.PATCH**.

- **Patch**: backward-compatible bug fixes.
- **Minor**: backward-compatible features.
- **Major**: breaking changes to supported behavior, API contracts, or stored-data compatibility.

`package.json` is the version source of truth, starting at the existing `1.0.0`.
`app.config.js` supplies that version to Expo for Android's `versionName` and
iOS's `CFBundleShortVersionString`; the backend's `/api/info` also reads it.
Other Expo settings remain in `app.json`. Do not add a separate version there.
Store releases use three numeric components without leading zeros; prerelease
and build suffixes are not supported by this release workflow because iOS
requires a numeric marketing version. TestFlight builds use the same release
version with distinct build numbers.

After committing your changes and passing the application checks, run **one**
of these commands from a clean working tree:

```sh
npm run release:patch  # 1.0.0 -> 1.0.1
npm run release:minor  # 1.0.0 -> 1.1.0
npm run release:major  # 1.0.0 -> 2.0.0
```

These use `npm version` to update `package.json` and `package-lock.json`, run
the version consistency check, create a version commit, and create an annotated
`vMAJOR.MINOR.PATCH` Git tag. They do not push or start a build locally.
To publish from `main`:

```sh
git push origin main --follow-tags
```

The tag triggers the existing container and mobile workflows. Their shared CI
checks run `npm run version:check`, rejecting invalid versions, lockfile drift,
or tags that do not exactly match `v` plus the package version. Branch and manual
builds also check version consistency but do not require a tag.

EAS continues to increment Android `versionCode` and iOS `buildNumber` remotely
for every build, independently of semantic versions. For local native builds,
run `npx expo prebuild` after a version bump to refresh the ignored generated
native projects; do not edit their version fields by hand.
