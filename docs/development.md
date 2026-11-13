# Development

[App showcase](../README.md) · [Documentation](README.md)

Run all commands from the repository root. For a deployed server, use the [self-hosting guide](deployment.md).

## Run the complete web app

The browser app is `apps/web` (React, Vite, TanStack) on the .NET API. Use Node **24 or newer**, npm, and Docker or Podman for the disposable PostgreSQL and API stack:

```sh
npm ci
npm run test-env -- up --seed searchable-household   # prints the API URL
cd apps/web
npm ci
PENNY_API_URL=http://127.0.0.1:<port> npm run dev     # http://localhost:4173
```

Open **http://localhost:4173**. Create an account, or choose the sample-data demo, which needs no API. See the [web app's developer setup](../apps/web/README.md#developer-setup) for the commands and the [test environment](reference/test-environment.md) for the stack. To run the production containers locally, follow [self-hosting](deployment.md#quick-start).

## Native iOS and backend development

- **iOS:** the SwiftUI app has its own setup, commands and tests in the [native iOS app README](../apps/ios/README.md). Android is no longer supported; see [Android retirement](ios-ipa.md#android-retirement).
- **Backend:** the .NET API and PostgreSQL setup are in the [backend README](../apps/backend/README.md).
- **Web:** see the [web app README](../apps/web/README.md).

## Nix / direnv development shell

The pinned `flake.nix` / `flake.lock` environment provides Node 24 (including npm)
and the receipt OCR tools (Tesseract, poppler, libvips) on Apple Silicon and Intel macOS,
as well as Linux.
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
- `eslint.config.js` uses `typescript-eslint` and keeps `src/domain` free of
  packages and Node APIs.

After dependency updates, run lint, typecheck and the core tests at the root, and
each app's own checks.

Validate configuration changes from the repository root:

```sh
npx --yes --package renovate -- renovate-config-validator --strict --no-global renovate.json
```

## Source layout

- `apps/ios/`, `apps/web/`, `apps/backend/`: the native iOS app, the browser app and the .NET API, each with its own README.
- `src/domain/`: the pure TypeScript ledger rules (types, integer-cent calculations, recurrence, immutable commands, merge, search, summaries, entry-draft conversion and the household projection), the reference the native and web apps port. See [domain rules](reference/domain-rules.md).
- `src/validation/ledger.ts`: the ledger write schema the golden fixtures and core tests check ledgers against.
- `contracts/`: OpenAPI, the golden fixtures and the design baseline shared by every client.
- `scripts/`: the fixture generator, the full-stack test environment, deployment and observability smoke tests, and the version check.
- `deploy/`, `nix/`: the Compose stack and the NixOS module.

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
