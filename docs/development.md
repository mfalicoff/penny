# Development

[App showcase](../README.md) · [Documentation](README.md)

Run all commands from the repository root. For a deployed server, use the [self-hosting guide](deployment.md).

## Run the complete web app

The browser app is `apps/web` (React, Vite, TanStack) on the .NET API. The Expo web app was retired in MAZ-97. Use Node **24 or newer**, npm, and Docker or Podman for the disposable PostgreSQL and API stack:

```sh
npm ci
npm run test-env -- up --seed searchable-household   # prints the API URL
cd apps/web
npm ci
PENNY_API_URL=http://127.0.0.1:<port> npm run dev     # http://localhost:4173
```

Open **http://localhost:4173**. Create an account, or choose the sample-data demo, which needs no API. See the [web app's developer setup](../apps/web/README.md#developer-setup) for the commands and the [test environment](migration/test-environment.md) for the stack. To run the production containers locally, follow [self-hosting](deployment.md#quick-start).

The legacy Node/SQLite server (`npm run server`) now serves only `/api/`, for the Expo mobile apps and the legacy test suites. It saves data to `data/penny.sqlite`, which Git ignores.

## Nix / direnv development shell

The pinned `flake.nix` / `flake.lock` environment provides Node 24 (including npm)
and the SQLite CLI on Apple Silicon and Intel macOS, as well as Linux.
It does not install dependencies, load `.env`, or start services automatically.

On nix-darwin, enable direnv and its flake integration in your system configuration,
then rebuild it:

```nix
programs.direnv = {
  enable = true;
  nix-direnv.enable = true;
};
```

Ensure direnv is hooked into your interactive shell. If your configuration does not
already do this, add `eval "$(direnv hook zsh)"` to `~/.zshrc` (or the equivalent
hook for your shell), then open a new terminal.

From the project directory:

```sh
direnv allow
npm ci
```

Alternatively, use `nix develop` without direnv. After cloning, the flake files are
already tracked; when adding these files to another Git checkout, stage
`flake.nix` and `flake.lock` before using `nix develop` or `direnv allow`, because
Nix ignores untracked files in Git flakes. Update the pinned toolchain deliberately
with `nix flake update` and commit the resulting lockfile.

The shell uses the existing npm lockfile; Expo and EAS CLIs remain project-local
or invoked with `npx`. Xcode/Command Line Tools and simulators must be installed
separately for local iOS builds. Watchman is optional and can be installed at the
system level for filesystem watching. Existing platform settings are left unchanged. For browser tests, install Chromium
with `npx playwright install chromium` as described below (Linux may also need
host browser dependencies).

## Develop with live reload

The web app's `npm run dev` (above) reloads on save. For the legacy Expo mobile apps, start the legacy API and Expo:

```sh
cp .env.example .env
npm run server
# In a second terminal:
npm start
```

### iOS (legacy Expo app)

This section covers the legacy Expo iOS app. The native SwiftUI app has its own setup in the [native iOS app README](../apps/ios/README.md). Android is no longer supported; see [Android retirement](ios-ipa.md#android-retirement).

On the mobile sign-in screen, choose **Change server**, enter your Penny server's base URL (without `/api`), and tap **Check server**. Penny checks the public `/api/info` endpoint, displays the server version, and enables **Use this server** only after a successful check. Use an HTTPS hostname, or a reachable LAN address for development; `localhost` on a physical phone points at the phone, not your server. Use the same account on each device.

The selection is saved only on that device, survives app restarts and sign-out, and is shown in Settings. To switch servers, sync any pending entries and sign out first. Sessions and offline ledgers are isolated by server, including accounts with the same email address. The web app (`apps/web`) has no server selector: it always uses the origin that serves it.

`EXPO_PUBLIC_API_URL` now supplies the initial mobile default, falling back to `http://localhost:3001`. On the first launch after upgrading, Penny saves that address automatically and retains existing sessions and offline entries, without requiring a network check. Keep the previous build's `EXPO_PUBLIC_API_URL` for the first migration release; older builds did not store their embedded address separately. Later builds cannot override a device's saved selection. Deploy the updated backend before asking users to select a new server: older servers without `/api/info` cannot be verified, but existing migrated connections continue working.

```sh
npm start
# Open with an Expo Go version that supports SDK 57, or a development build.
# With Xcode installed:
npm run ios
```

Standalone mobile builds should use an HTTPS API endpoint. Development against plain HTTP depends on platform transport policies. The [iOS TestFlight workflow](../.github/workflows/ios-testflight.yml) runs checks, archives and signs the native iOS app, and uploads it to TestFlight when a GitHub Release is published or on manual dispatch. Release builds attach `penny.ipa` and its SHA-256 checksum to the release's **Assets**. The legacy Expo iOS build is available only as a manual-dispatch option. Complete the setup in [iOS IPA and TestFlight builds](ios-ipa.md#one-time-setup) before running it.

## Dependency updates

[`renovate.json`](../renovate.json) uses Renovate's recommended preset with a
Dependency Dashboard. All regular updates, including major versions, are grouped
into one pull request, with at most one regular Renovate PR open at a time.
It checks npm dependencies and their lockfiles, GitHub Actions, Dockerfiles, and
Docker Compose images. Security vulnerability PRs can bypass Renovate's concurrency
limit. All pull requests require manual merging. Generated native
dependency files are not managed independently.

To activate the hosted bot, merge the configuration into the default branch and
install or enable the [Renovate GitHub App](https://github.com/apps/renovate) for
this repository. No repository token or scheduled workflow is needed.
See [Renovate onboarding](https://docs.renovatebot.com/getting-started/installing-onboarding/).

Expo, React, React Native, their native libraries, and Expo-specific tooling are
excluded from automated updates so their versions stay aligned with the Expo SDK.
Update them deliberately using Expo's SDK upgrade guidance and
`npx expo install --fix`, then commit both `package.json` and `package-lock.json`
and verify iOS. When adding an SDK-managed dependency, keep the
exclusion rule in `renovate.json` aligned with it.

The toolchain runs TypeScript 7, ESLint 10, and Jest 30 without independently
upgrading the Expo SDK:

- `@typescript/native` aliases TypeScript 7 and supplies `tsc` for
  `npm run typecheck`. The `typescript` dependency aliases
  `@typescript/typescript6`, which supplies the compiler API required by
  `typescript-eslint` and other tooling. Preserve this
  [official side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0)
  until those tools support the new API.
- `eslint.config.js` applies ESLint's
  [`fixupConfigRules`](https://github.com/eslint/rewrite/tree/main/packages/compat)
  adapter to Expo's plugins, preserving their rules on ESLint 10.
- Jest 30 runs the existing `jest-expo` iOS project.

Some upstream Expo lint/test dependencies still declare older ESLint/Jest peer
ranges, so `npm ci` emits peer warnings. The compatibility setup does not disable
rules or tests. After dependency updates, run lint, typecheck, core/UI coverage,
and browser E2E checks; install the matching Chromium build with
`npx playwright install chromium` before browser checks.

Validate configuration changes from the repository root:

```sh
npx --yes --package renovate -- renovate-config-validator --strict --no-global renovate.json
```

## Implementation

- `src/app/`: thin Expo Router entry points for real feature screens.
- `src/shell/`: persistent responsive navigation and application composition.
- `src/features/`: feature-owned screens, forms, presentation components and selectors.
- `src/providers/`: session/ledger lifecycle and workspace state that survives navigation.
- `src/domain/`: ledger types, integer-cent calculations, recurrence and immutable mutation commands.
- `src/data/`: authenticated requests, revision retries, platform sessions and receipt I/O.
- `src/shared/`: reusable UI primitives, responsive breakpoints and formatting.
- `server/app.ts`: wires storage, services and Express middleware/routes together.
- `server/http/`: thin routes, cookies, authentication middleware and HTTP error mapping.
- `server/application/`: account, ledger and receipt operations with typed storage/security interfaces.
- `server/validation/`: input schemas, ledger invariants and receipt signature checks.
- `server/infrastructure/`: SQLite schema/repositories, atomic writes and password/token cryptography.
- `server/index.ts`: process lifecycle and environment configuration (API only since MAZ-97).

See [Frontend architecture](frontend-architecture.md) for ownership rules, the pattern for adding a feature, and the testing strategy.
See [Backend architecture](backend-architecture.md) for service boundaries, persistence guarantees, API regression coverage and the Hono assessment.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npx expo export --platform ios --platform android --output-dir /tmp/penny-native-export
(cd apps/web && npm ci && npm run check)
```

See [Testing strategy](testing.md) for the canonical test commands, coverage boundaries, browser and native toolchain setup, and CI policy. Bundle exports check resolution, not device interaction.
