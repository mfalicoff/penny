Penny is a self-hosted expense tracker. The Expo/React Native app is retired (MAZ-98); each app has its own guide:

| Path | What | Guide |
| --- | --- | --- |
| `apps/ios` | Native SwiftUI app for iPhone and iPad, shipped through TestFlight | [apps/ios/AGENTS.md](apps/ios/AGENTS.md) |
| `apps/web` | TanStack web app (the `penny-web` image) | [apps/web/AGENTS.md](apps/web/AGENTS.md) |
| `apps/backend` | .NET API on PostgreSQL | [apps/backend/AGENTS.md](apps/backend/AGENTS.md) |
| `server/`, `src/domain/` | Legacy Node/SQLite API (pre-cutover reference and rollback image) and the TypeScript ledger rules it and the golden fixtures use | this file |
| `contracts/` | OpenAPI, golden fixtures and the design baseline shared by every client | [contracts/README.md](contracts/README.md) |

## Root package (legacy API and shared rules)

```bash
npm ci
npm run lint            # ESLint for server/, src/, tests/, scripts/
npm run typecheck       # tsc --noEmit
npm test                # node --test tests/core (legacy API, domain rules, contracts)
npm run fixtures:check  # golden fixtures match src/domain
npm run version:check   # package.json, package-lock.json and apps/ios Version.xcconfig agree
```

Run lint, typecheck and tests before declaring a change to the root package done.

## Rules

- There is no Android app and no Expo app. Don't add React Native, Expo or Android code or dependencies. Android is retired without a migration path (`docs/ios-ipa.md#android-retirement`).
- `src/domain` stays pure TypeScript: no Node APIs, no server imports (ESLint enforces this). It is the reference for the rules the native and web apps port; change it only with the golden fixtures (`npm run fixtures:generate`) and the matching native and web rules.
- Keep the server's layer boundaries (application, validation, http, infrastructure) as `eslint.config.js` enforces them.
- iOS builds, signing and TestFlight: `apps/ios/scripts/ios.sh` and `docs/ios-ipa.md`. Never change the bundle id, App Group, URL scheme or widget identifiers.
- Keep secrets and real personal financial data out of fixtures, logs and test artifacts.
