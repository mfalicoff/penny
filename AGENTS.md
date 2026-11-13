Penny is a self-hosted expense tracker. Each app has its own guide:

| Path | What | Guide |
| --- | --- | --- |
| `apps/ios` | Native SwiftUI app for iPhone and iPad, shipped through TestFlight | [apps/ios/AGENTS.md](apps/ios/AGENTS.md) |
| `apps/web` | TanStack web app (the `penny-web` image) | [apps/web/AGENTS.md](apps/web/AGENTS.md) |
| `apps/backend` | .NET API on PostgreSQL (the `penny-api` image) | [apps/backend/AGENTS.md](apps/backend/AGENTS.md) |
| `src/domain/`, `src/validation/` | The TypeScript ledger rules and ledger write schema: the reference the golden fixtures are generated from | this file |
| `contracts/` | OpenAPI, golden fixtures and the design baseline shared by every client | [contracts/README.md](contracts/README.md) |
| `scripts/`, `tests/` | Fixture generator, full-stack test environment (`scripts/test-env`), release, dashboard and deployment smoke scripts, and the core and full-stack suites | this file |

## Root package (shared rules, fixtures and tooling)

```bash
npm ci
npm run lint            # ESLint for src/, tests/, scripts/
npm run typecheck       # tsc --noEmit
npm test                # node --test tests/core (domain rules, fixtures, contracts, runner logic)
npm run fixtures:check  # golden fixtures match src/domain
npm run dashboards:check # Grafana dashboard JSON matches scripts/grafana-dashboards.mjs
npm run version:check   # package.json, package-lock.json and apps/ios Version.xcconfig agree
npm run test:fullstack  # opt-in: real .NET API + PostgreSQL environments (Docker or Podman)
```

Run lint, typecheck and tests before declaring a change to the root package done.

## Rules

- There is no Android app and no Expo app. Don't add React Native, Expo or Android code or dependencies. Android is retired without a migration path (`docs/ios-ipa.md#android-retirement`).
- `src/domain` stays pure TypeScript: no Node APIs and no packages (ESLint enforces this). Together with the golden fixtures in `contracts/fixtures` it is the reference for the rules the native app, the web app and the API implement; change it only with the fixtures (`npm run fixtures:generate`) and the matching Swift, web and C# rules.
- iOS builds, signing and TestFlight: `apps/ios/scripts/ios.sh` and `docs/ios-ipa.md`. Never change the bundle id, App Group, URL scheme or widget identifiers.
- Keep secrets and real personal financial data out of fixtures, logs and test artifacts.
