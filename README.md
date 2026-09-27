# Penny

A simple expense and income tracker for iOS, Android, and web, built with Expo / React Native. A self-hosted Node server stores accounts, transactions, recurring schedules, categories, and receipt files in SQLite.

## What works

- Add, edit, delete, search, and filter income and expenses.
- Monthly overview, calendar, category breakdown, and personal-share totals.
- Interactive monthly Sankey diagram: income categories → monthly flow → expense categories and left over. Personal shares determine band widths. Spending beyond recorded income is labeled explicitly; smaller categories are grouped without dropping their amounts. The chart scrolls horizontally on phones.
- Attach a photo from your library or an image/PDF from files (up to 10 MB).
- Split by equal shares, a personal amount, or a percentage. The original total and your share are both retained; reports count your share only.
- Weekly, monthly, and yearly income/expenses; pause, resume, or remove a schedule.
- Custom category names, colors, and icons.
- Accounts and cross-device sync. A save merges into the newest server state; revision checks reject stale overwrites. Conflicting edits to the same entry ask you to review the latest version.
- Photos render in-app; web PDFs render in the browser; native PDFs open through the system share/open sheet.
- A clearly labeled, temporary demo without an account.

## Run the complete web app

Use Node **24 or newer** and npm. No external database service is required.

```sh
npm ci
npm run build:web
npm run server
```

Open **http://localhost:3001**. Create an account, or choose the sample-data demo. The server serves both the exported web app and `/api` endpoints. No `.env` is needed for this same-origin local setup.

Data is saved to `data/penny.sqlite` by default. This directory is ignored by Git.

## Develop with live reload

```sh
cp .env.example .env
npm run server
# In a second terminal:
npm run web
```

Expo web runs on port 8081. `.env.example` points it at the API on port 3001 and allows that origin. Restart Expo after changing `EXPO_PUBLIC_API_URL`; it is embedded in the client bundle at build time.

### iOS and Android

Set `EXPO_PUBLIC_API_URL` to the server's reachable LAN URL or HTTPS hostname. `localhost` on a physical phone points at the phone, not your server. Use the same account on each device.

```sh
npm start
# Open with an Expo Go version that supports SDK 57, or a development build.
# With the respective platform development tools installed:
npm run ios
npm run android
```

Standalone mobile builds should use an HTTPS API endpoint. Development against plain HTTP depends on platform transport policies. The [Android APK workflow](docs/android-apk.md) builds signed, installable APKs through EAS and reuses the same signing key for updates. Complete its one-time Expo account and credentials setup before running it. Apple signing and app store distribution are not configured.

## Self-host with Docker Compose

The container serves the web app and API on port 3001. A named volume holds the database **including receipts**.

```sh
docker compose up -d --build
```

For LAN access, set `.env` with the actual browser origin, for example:

```dotenv
PORT=3001
CORS_ORIGINS=http://192.168.1.50:3001
COOKIE_SECURE=false
ALLOW_REGISTRATION=true
```

For HTTPS behind your existing reverse proxy:

```dotenv
PORT=3001
CORS_ORIGINS=https://penny.example.com
COOKIE_SECURE=true
ALLOW_REGISTRATION=true
```

Proxy the entire hostname to `penny:3001` (or the host's mapped port). The Docker web build uses the same origin for its API. Set the native client's `EXPO_PUBLIC_API_URL` to that HTTPS hostname when building it. Allow request bodies of at least 20 MB at the proxy for encoded receipt uploads.

After creating your account, set `ALLOW_REGISTRATION=false` and run `docker compose up -d` to disable additional signups. Accounts are separate; sharing a login across your own devices syncs that account's data.

### Automated container builds

The **Build container image** workflow (`.github/workflows/docker-image.yml`) runs on pull requests to `main`, pushes to `main`, version tags such as `v1.2.3`, and manual runs from the Actions tab. Lint, type checks, and tests must pass before it builds the image.

It builds both **linux/amd64** and **linux/arm64** from the root Dockerfile. Pull requests build without publishing. Pushes and manual runs publish to `ghcr.io/<owner>/<repository>` using the built-in `GITHUB_TOKEN`; no registry password or Docker Hub account is required. Owner/repository names are lowercased automatically.

Image tags:

- `latest` and `main` for builds on `main`.
- `v1.2.3` for a matching Git tag (version tags do not move `latest`).
- `sha-<full-commit-sha>` for identifying the source commit.
- The branch name for manual runs on other branches.

To deploy a published image, replace the `build:` block in `compose.yaml` with your image name:

```yaml
    image: ghcr.io/<owner>/<repository>:latest
```

Keep the existing environment variables, ports, and data volume, then run:

```sh
docker compose pull
docker compose up -d
```

For a private GHCR package, authenticate the homelab to GHCR with a token allowed to read that package. Repository/organization policies must permit the workflow to write packages. This workflow builds and publishes images; it does not deploy to your server.

### Backups

Back up the `penny-data` volume. Stop the container during a filesystem backup so SQLite's database and WAL files are consistent; then restart it. Restore the full volume with the service stopped. Alternatively, use SQLite's online backup API. Receipt bytes, password hashes, sessions, and ledgers are all in the database. Keep backups private.

## Sync and recurrence behavior

The app fetches on sign-in, foregrounding, and every 15 seconds while in use. Every edit first fetches the latest revision, applies only that operation, and saves conditionally; revision races retry up to four times. Same-entry and same-category edit conflicts are surfaced rather than silently overwritten. An unreachable server leaves the currently displayed data intact and reports that saving failed; there is no offline write queue.

Recurring entries are materialized when a client syncs or saves, using that device's local calendar date. Missed dates catch up once. Monthly schedules retain their original day through short months (Jan 31 → Feb 28 → Mar 31). Pausing skips paused dates on resume. Deleting an occurrence does not regenerate it. Deleting a schedule preserves history. Editing an occurrence changes only that occurrence; remove/recreate a schedule to change its amount or cadence. Attachments belong to individual occurrences and are not copied onto future entries.

## Implementation

- `src/app/`: thin Expo Router entry points for real feature screens.
- `src/shell/`: persistent responsive navigation and application composition.
- `src/features/`: feature-owned screens, forms, presentation components, selectors and behavior tests.
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

See [Frontend architecture](docs/frontend-architecture.md) for ownership rules, the pattern for adding a feature, and the testing strategy.
See [Backend architecture](docs/backend-architecture.md) for service boundaries, persistence guarantees, API regression coverage and the Hono assessment.

The initial name, Penny, is a working name. The visual direction emphasizes warm neutral colors, calm hierarchy, quick feedback, and simple entry, inspired by your preferences rather than copied product assets.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run build:web
npx expo export --platform ios --platform android --output-dir /tmp/penny-native-export
```

`npm test` runs both Node core/API tests and Jest/Expo frontend behavior tests. Use `npm run test:core`, `npm run test:ui`, or `npm run test:ui:watch` while developing.

Tests cover decimal validation, rounding, month-end and leap-year recurrence, immutable commands, stale edit/delete conflicts, category safeguards, draft conversion, monthly filtering, failed-save draft retention, session isolation, sync cleanup, API retries, route navigation and persistent drafts. Existing API integration tests cover authenticated two-session sync, stale revisions, account isolation, receipt ownership/uploads/downloads, untrusted origins, restart persistence and logout.

## Current limits

This is a working first version. It does not yet include OCR, line-item receipt splitting, bank connections, push reminders, offline editing, multiple currencies within one account, email verification, password recovery, or an account export UI. Currency is chosen before adding entries. Receipt files removed from entries are retained on the server; storage cleanup is not yet automated. Passwords are hashed with salted scrypt; sessions expire after 30 days. Deploy behind HTTPS or your private network/VPN.

Web UI and API flows have been exercised locally. iOS/Android JavaScript bundles have been compiled; physical-device testing and signing remain. Docker configuration is provided; no Docker engine was available locally to run the container.
