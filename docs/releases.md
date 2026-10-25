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

## Automated release flow

The **Release Please** workflow (`.github/workflows/release-please.yml`) runs
on pushes to `master`. It maintains a release PR instead of publishing every
commit:

1. Merge changes to `master` using Conventional Commit messages (see below).
2. Release Please opens or updates a release PR with the next semantic version,
   matching changes to `package.json` and `package-lock.json`, an updated
   `.release-please-manifest.json`, and generated `CHANGELOG.md` entries.
3. Review the proposed version and notes, wait for the existing PR checks, then
   merge the release PR. No local version commands or manual Actions run is
   needed.
4. Release Please creates a matching `vMAJOR.MINOR.PATCH` tag and publishes a
   GitHub Release with the changelog entry as its release notes. That tag
   automatically starts the existing container and Android/iOS workflows.

The changelog groups features and fixes and links to their commits. After the
first release, each version heading links to GitHub's comparison between the
previous and current release tags: the complete commit and file delta,
including commits omitted from the summarized notes. The first automated
release starts after the current remote `master` commit, `92f6bc3e6495278a28b0df59b8a55ab0806fc7b4`;
the manifest starts empty because no version has been published yet.
That first release publishes the existing `1.0.0` version without inventing a
previous tag or a broken comparison link. Later release PRs bump from the last
published version. The bootstrap SHA is ignored after the first release and
does not need advancing.

### First-run warnings and a successful no-op

Before the first release, `Could not find releases`, `Expected 1 releases,
only found 0`, `Missing 1 paths: .`, and `No version for path .` are expected
bootstrap warnings. The `.` is the configured root package, not a missing
directory. There is no prior GitHub Release or manifest version to find;
`initial-version` selects the first proposed version rather than recording a
previous release. Keep the manifest empty and leave `bootstrap-sha` unchanged.
This follows Release Please's [manual bootstrap
flow](https://github.com/googleapis/release-please/blob/v17.3.0/docs/manifest-releaser.md#bootstrap-manually)
and [missing-release fallback](https://github.com/googleapis/release-please/blob/v17.3.0/src/manifest.ts#L597-L623).

A successful run can still produce no PR: only releasable Conventional Commits
after the bootstrap SHA drive the first release. Check the end of the log for
`No commits for path: ., skipping`. Rerunning the same history will not change
that result. Squash dependency updates with a final message such as
`fix(deps): update all dependencies`, rather than `Update all dependencies`.
The next push to `master` should then open the first **1.0.0** release PR, not
publish a release immediately. Review and merge that generated PR to publish.
Do not create a dummy tag or seed a fictitious previous version to silence the
bootstrap warnings.

### Commit messages and version selection

Use these prefixes in commits landing on `master`. With squash merges, the
final squash commit message (normally the PR title) is what matters.

| Message | Version change |
| --- | --- |
| `fix: correct expense totals` | Patch, e.g. `1.0.0` → `1.0.1` |
| `feat: add household reports` | Minor, e.g. `1.0.0` → `1.1.0` |
| `feat!: change the ledger API` | Major, e.g. `1.0.0` → `2.0.0` |

Scopes such as `fix(auth): ...` are supported. A `BREAKING CHANGE:` footer also
marks a major change. The highest applicable bump since the previous release
wins. `docs:`, `test:`, and ordinary `chore:` commits do not trigger releases
on their own; non-Conventional Commit messages do not drive version selection.
They still appear in the full comparison once a release is made. Use
`fix(deps): ...` for a dependency update that should ship as a patch.

Do not run `npm version` or create release tags for routine releases: the
release PR owns version bumps, the manifest, and the changelog. To correct the
proposed version or notes before publishing, follow
[Release Please's override instructions](https://github.com/googleapis/release-please#how-do-i-change-the-version-number).

### One-time GitHub setup

Create a dedicated fine-grained personal access token for this repository
with **Contents: read/write**, **Pull requests: read/write**, and
**Issues: read/write** permissions (Release Please manages release labels).
Store it as the repository Actions secret **`RELEASE_PLEASE_TOKEN`**.
Approve it in the organization if required, and renew it before it expires.
An equivalent GitHub App installation token can be used if your organization
already provisions one.

To store the token without putting it in shell history, run this command and
paste it at the prompt:

```sh
gh secret set RELEASE_PLEASE_TOKEN --repo mfalicoff/penny
```

Land the automation with a releasable commit such as
`feat(ci): automate releases` to open the first release PR. A `chore:`-only
setup commit waits until the next feature or fix lands.

Do not substitute `GITHUB_TOKEN`: GitHub suppresses workflows triggered by
PRs and tags created with that token, which would leave release PR checks and
release builds untriggered. The workflow fails explicitly when the dedicated
secret is missing. See the
[Release Please credential requirements](https://github.com/googleapis/release-please-action#github-credentials).

Keep the existing `EXPO_TOKEN`, EAS signing credentials, and `ASC_APP_ID` setup
from the platform guides. Protect `master` with the existing PR checks to gate
release PR merges. Prefer squash merging so each PR's release intent is
unambiguous.

### Builds, deployment, and recovery

Tag-triggered shared CI runs `npm run version:check`, rejecting invalid
versions, lockfile drift, or tags that do not exactly match `v` plus the package
version. Branch and manual builds also check consistency without requiring a
tag. The GitHub Release is published before the downstream builds finish;
a published release is not proof that its binaries or image are available.
Monitor the container and mobile runs. If a build fails, rerun that failed
workflow for the same tag instead of creating another release.

The container workflow publishes to GHCR; it does not update a running
self-hosted server. Android/iOS binaries remain Actions artifacts for 30 days,
and iOS is submitted to TestFlight, not the App Store. See the platform and
deployment guides for installation and rollout.

For an expired or missing release token, replace the secret, then rerun the
failed **Release Please** run. Merging a release PR with the generated
`autorelease: pending` label intact lets Release Please recognize it and
publish it; do not remove its release labels manually.

EAS continues to increment Android `versionCode` and iOS `buildNumber` remotely
for every build, independently of semantic versions. For local native builds,
run `npx expo prebuild` after a version bump to refresh the ignored generated
native projects; do not edit their version fields by hand.
