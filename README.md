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

Standalone mobile builds should use an HTTPS API endpoint. Development against plain HTTP depends on platform transport policies. Signing, app store distribution, and device builds require the usual Apple/Android setup and have not been configured with a personal developer account.

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

### Backups

Back up the `penny-data` volume. Stop the container during a filesystem backup so SQLite's database and WAL files are consistent; then restart it. Restore the full volume with the service stopped. Alternatively, use SQLite's online backup API. Receipt bytes, password hashes, sessions, and ledgers are all in the database. Keep backups private.

## Sync and recurrence behavior

The app fetches on sign-in, foregrounding, and every 15 seconds while in use. Every edit first fetches the latest revision, applies only that operation, and saves conditionally; revision races retry up to four times. Same-entry and same-category edit conflicts are surfaced rather than silently overwritten. An unreachable server leaves the currently displayed data intact and reports that saving failed; there is no offline write queue.

Recurring entries are materialized when a client syncs or saves, using that device's local calendar date. Missed dates catch up once. Monthly schedules retain their original day through short months (Jan 31 → Feb 28 → Mar 31). Pausing skips paused dates on resume. Deleting an occurrence does not regenerate it. Deleting a schedule preserves history. Editing an occurrence changes only that occurrence; remove/recreate a schedule to change its amount or cadence. Attachments belong to individual occurrences and are not copied onto future entries.

## Implementation

- `App.tsx`: persistent responsive shell, UI, and coordination.
- `src/app/`: Expo Router entry points for Overview, Recurring, and Categories.
- `src/EntryForm.tsx`: fast entry, receipt selection, and splits.
- `src/model.ts`: types, integer-cent calculations, recurrence.
- `src/api.ts`: authenticated requests and revision-based sync.
- `src/session.*`: HttpOnly cookies on web; SecureStore on native.
- `src/storage.*`: authenticated receipt upload/download and platform viewing.
- `server/app.ts`: Express API, validation, password hashing, account/receipt isolation.
- `server/index.ts`: SQLite lifecycle and web hosting.

The initial name, Penny, is a working name. The visual direction emphasizes warm neutral colors, calm hierarchy, quick feedback, and simple entry, inspired by your preferences rather than copied product assets.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run build:web
npx expo export --platform ios --platform android --output-dir /tmp/penny-native-export
```

Tests cover decimal validation, rounding, month-end and leap-year recurrence, catch-up idempotence, paused schedules, authenticated two-session sync, stale-revision rejection, account isolation, receipt ownership, PNG/PDF uploads and downloads, invalid uploads, invalid money, untrusted origins, restart persistence, and logout.

## Current limits

This is a working first version. It does not yet include OCR, line-item receipt splitting, bank connections, push reminders, offline editing, multiple currencies within one account, email verification, password recovery, or an account export UI. Currency is chosen before adding entries. Receipt files removed from entries are retained on the server; storage cleanup is not yet automated. Passwords are hashed with salted scrypt; sessions expire after 30 days. Deploy behind HTTPS or your private network/VPN.

Web UI and API flows have been exercised locally. iOS/Android JavaScript bundles have been compiled; physical-device testing and signing remain. Docker configuration is provided; no Docker engine was available locally to run the container.
