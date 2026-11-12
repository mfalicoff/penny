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

The legacy Node/SQLite server (`npm run server`) serves only `/api/`. It is kept as the pre-cutover reference for the legacy test suites and as the rollback image. It saves data to `data/penny.sqlite`, which Git ignores. The Expo mobile app it once served was removed in MAZ-98.

## Native iOS and backend development

- **iOS:** the SwiftUI app has its own setup, commands and tests in the [native iOS app README](../apps/ios/README.md). Android is no longer supported; see [Android retirement](ios-ipa.md#android-retirement).
- **Backend:** the .NET API and PostgreSQL setup are in the [backend README](../apps/backend/README.md).
- **Web:** see the [web app README](../apps/web/README.md).

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

The shell uses the existing npm lockfile. Xcode/Command Line Tools and simulators
must be installed separately for local iOS builds; see the
[native iOS app README](../apps/ios/README.md#first-time-xcode-setup) for using
Xcode tools inside this shell. Existing platform settings are left unchanged. For
browser tests, install Chromium with `npx playwright install chromium` (Linux may
also need host browser dependencies).

## Run the legacy API with live reload

The web app's `npm run dev` (above) reloads on save. To run the legacy API:

```sh
cp .env.example .env
npm run server
```

## iOS builds and TestFlight

The [iOS TestFlight workflow](../.github/workflows/ios-testflight.yml) runs checks, archives and signs the native iOS app, and uploads it to TestFlight when a GitHub Release is published or on manual dispatch. Release builds attach `penny.ipa` and its SHA-256 checksum to the release's **Assets**. Complete the setup in [iOS IPA and TestFlight builds](ios-ipa.md#one-time-setup) before running it.

## Dependency updates

[`renovate.json`](../renovate.json) uses Renovate's recommended preset with a
Dependency Dashboard. All regular updates, including major versions, are grouped
into one pull request, with at most one regular Renovate PR open at a time.
It checks npm dependencies and their lockfiles, GitHub Actions, Dockerfiles, and
Docker Compose images. Security vulnerability PRs can bypass Renovate's concurrency
limit. All pull requests require manual merging.

To activate the hosted bot, merge the configuration into the default branch and
install or enable the [Renovate GitHub App](https://github.com/apps/renovate) for
this repository. No repository token or scheduled workflow is needed.
See [Renovate onboarding](https://docs.renovatebot.com/getting-started/installing-onboarding/).

The root toolchain runs TypeScript 7 and ESLint 10:

- `@typescript/native` aliases TypeScript 7 and supplies `tsc` for
  `npm run typecheck`. The `typescript` dependency aliases
  `@typescript/typescript6`, which supplies the compiler API required by
  `typescript-eslint` and other tooling. Preserve this
  [official side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0)
  until those tools support the new API.
- `eslint.config.js` uses `typescript-eslint` and keeps the domain and server
  layer boundaries.

After dependency updates, run lint, typecheck and the core tests at the root, and
each app's own checks.

Validate configuration changes from the repository root:

```sh
npx --yes --package renovate -- renovate-config-validator --strict --no-global renovate.json
```

## Implementation

- `src/domain/`: shared TypeScript ledger types, integer-cent calculations, recurrence, immutable mutation commands, entry-draft conversion and the household projection. See [Frontend architecture](frontend-architecture.md#shared-typescript-rules).
- `server/app.ts`: wires storage, services and Express middleware/routes together.
- `server/http/`: thin routes, cookies, authentication middleware and HTTP error mapping.
- `server/application/`: account, ledger and receipt operations with typed storage/security interfaces.
- `server/validation/`: input schemas, ledger invariants and receipt signature checks.
- `server/infrastructure/`: SQLite schema/repositories, atomic writes and password/token cryptography.
- `server/index.ts`: process lifecycle and environment configuration (API only since MAZ-97).
- `apps/ios/`, `apps/web/`, `apps/backend/`: the native iOS app, the browser app and the .NET API, each with its own README.

See [Backend architecture](backend-architecture.md) for service boundaries, persistence guarantees, API regression coverage and the Hono assessment.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run fixtures:check
(cd apps/web && npm ci && npm run check)
apps/ios/scripts/ios.sh ci
```

See [Testing strategy](testing.md) for the canonical test commands, coverage boundaries and CI policy.
