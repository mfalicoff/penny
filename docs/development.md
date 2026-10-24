# Development

[App showcase](../README.md) · [Documentation](README.md)

Run all commands from the repository root. For a deployed server, use the [self-hosting guide](deployment.md).

## Run the complete web app

Use Node **24 or newer** and npm. No external database service is required.

```sh
npm ci
npm run build:web
npm run server
```

Open **http://localhost:3001**. Create an account, or choose the sample-data demo. The server serves both the exported web app and `/api` endpoints. No `.env` is needed for this same-origin local setup.

Data is saved to `data/penny.sqlite` by default. This directory is ignored by Git.

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
or invoked with `npx`. Xcode/Command Line Tools, simulators, and the Android SDK
must be installed separately for local native builds. Watchman is optional and can
be installed at the system level for filesystem watching. Existing `ANDROID_HOME` and
other platform settings are left unchanged. For browser tests, install Chromium
with `npx playwright install chromium` as described below (Linux may also need
host browser dependencies).

## Develop with live reload

```sh
cp .env.example .env
npm run server
# In a second terminal:
npm run web
```

Expo web runs on port 8081. `.env.example` points it at the API on port 3001 and allows that origin. Restart Expo after changing `EXPO_PUBLIC_API_URL`; it is embedded in the client bundle at build time.

### iOS and Android

On the mobile sign-in screen, choose **Change server**, enter your Penny server's base URL (without `/api`), and tap **Check server**. Penny checks the public `/api/info` endpoint, displays the server version, and enables **Use this server** only after a successful check. Use an HTTPS hostname, or a reachable LAN address for development; `localhost` on a physical phone points at the phone, not your server. Use the same account on each device.

The selection is saved only on that device, survives app restarts and sign-out, and is shown in Settings. To switch servers, sync any pending entries and sign out first. Sessions and offline ledgers are isolated by server, including accounts with the same email address. Web has no server selector: the deployed web app uses the backend serving it (the build-time override above remains available for web development).

`EXPO_PUBLIC_API_URL` now supplies the initial mobile default, falling back to `http://localhost:3001`. On the first launch after upgrading, Penny saves that address automatically and retains existing sessions and offline entries, without requiring a network check. Keep the previous build's `EXPO_PUBLIC_API_URL` for the first migration release; older builds did not store their embedded address separately. Later builds cannot override a device's saved selection. Deploy the updated backend before asking users to select a new server: older servers without `/api/info` cannot be verified, but existing migrated connections continue working.

```sh
npm start
# Open with an Expo Go version that supports SDK 57, or a development build.
# With the respective platform development tools installed:
npm run ios
npm run android
```

Standalone mobile builds should use an HTTPS API endpoint. Development against plain HTTP depends on platform transport policies. The [mobile build workflow](../.github/workflows/mobile-builds.yml) runs checks and builds a signed [Android APK](android-apk.md) and [iOS IPA](ios-ipa.md) through EAS on version tags or manual dispatch. It uploads the store signed IPA to TestFlight automatically. Complete the platform signing and App Store Connect setup in those guides before running it.

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
- `server/index.ts`: process lifecycle, environment configuration and web hosting.

See [Frontend architecture](frontend-architecture.md) for ownership rules, the pattern for adding a feature, and the testing strategy.
See [Backend architecture](backend-architecture.md) for service boundaries, persistence guarantees, API regression coverage and the Hono assessment.

## Verification

```sh
npm run lint

[Showing lines 1-300 of 344. Use :301 to continue]

See [Testing strategy](testing.md) for the canonical test commands, coverage boundaries, browser and native toolchain setup, and CI policy. Bundle exports check resolution, not device interaction.
