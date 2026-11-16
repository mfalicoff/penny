Penny is a self-hosted expense tracker. There is no package at the repository root: each app and the tooling has its own guide and lockfile.

| Path | What | Guide |
| --- | --- | --- |
| `apps/ios` | Native SwiftUI app for iPhone and iPad, shipped through TestFlight | [apps/ios/AGENTS.md](apps/ios/AGENTS.md) |
| `apps/web` | TanStack web app (the `penny-web` image), plus the shared TypeScript ledger rules (`src/domain`), the ledger write schema (`src/validation`), their reference tests (`tests/domain`) and the golden fixture generator (`scripts/fixtures`) | [apps/web/AGENTS.md](apps/web/AGENTS.md) |
| `apps/backend` | .NET API on PostgreSQL (the `penny-api` image) | [apps/backend/AGENTS.md](apps/backend/AGENTS.md) |
| `apps/email-worker` | Cloudflare Email Worker for emailed receipts (MAZ-184): refuses unknown recipients and forwards signed raw mail to the API | [apps/email-worker/README.md](apps/email-worker/README.md) |
| `contracts/` | OpenAPI, golden fixtures and the design baseline shared by every client | [contracts/README.md](contracts/README.md) |
| `scripts/` | Repository tooling package: full-stack test environment (`test-env`), image and observability smoke tests, Grafana dashboards, release version check, and their tests (`tests`, `tests/fullstack`) | this file |

## Tooling (`scripts/`)

The tooling uses Node built-ins only at run time, so `node scripts/...` works from the repository root without an install. Its own dev dependencies are for lint, typecheck and tests:

```bash
npm --prefix scripts ci
npm --prefix scripts run lint
npm --prefix scripts run typecheck
npm --prefix scripts test                    # node --test scripts/tests (runner logic, dashboards, native QA matrix)
npm --prefix scripts run test:fullstack      # opt-in: real .NET API + PostgreSQL environments (Docker or Podman)
node scripts/test-env/penny-env.mjs up --oidc # a disposable full-stack environment
node scripts/grafana-dashboards.mjs --check  # Grafana dashboard JSON matches its generator
node scripts/check-version.mjs               # apps/ios/Configuration/Version.xcconfig holds a valid release version
```

Run lint, typecheck and tests before declaring a change to `scripts/` done. The shared ledger rules are checked with the web app: `npm run check` in `apps/web` includes `fixtures:check` and the reference tests.

## Rules

- There is no Android app and no Expo app. Don't add React Native, Expo or Android code or dependencies. Android is retired without a migration path (`docs/ios/ipa.md#android-retirement`).
- `apps/web/src/domain` stays pure TypeScript: no Node APIs and no packages (ESLint enforces this). Together with the golden fixtures in `contracts/fixtures` it is the reference for the rules the native app, the web app and the API implement; change it only with the fixtures (`npm --prefix apps/web run fixtures:generate`) and the matching Swift, web and C# rules.
- iOS builds, signing and TestFlight: `apps/ios/scripts/ios.sh` and `docs/ios/ipa.md`. Never change the bundle id, App Group, URL scheme or widget identifiers.
- Keep secrets and real personal financial data out of fixtures, logs and test artifacts.
