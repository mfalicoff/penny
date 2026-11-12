# Frontend architecture

[App showcase](../README.md) · [Documentation](README.md)

The Expo/React Native frontend was removed from the repository in MAZ-98. Android had already been retired, and the Expo web build was replaced by `apps/web` in MAZ-97. The [v2 migration architecture](migration/architecture.md) describes the clients that replaced it.

- **iOS:** the native SwiftUI app. See the [native iOS app](../apps/ios/README.md) and the `ios-*.md` guides in the [documentation index](README.md).
- **Browser:** the React/Vite/TanStack client. See the [web app foundation](../apps/web/README.md).

People who still have an Expo build installed upgrade in place. See [Upgrading Expo iOS installs](ios-expo-migration.md).

## Shared TypeScript rules

`src/domain/` remains in the root package. It holds the pure TypeScript ledger rules: types, money, recurrence, immutable commands, merge, search, recorded/projected summaries, selectors, entry-draft conversion (`entryDraft.ts`) and the household projection (`householdProjection.ts`). The legacy Node API in `server/`, the core tests and the golden fixtures use it. It must not import UI, network or platform code. See [domain rules](migration/domain-rules.md) and the [testing strategy](testing.md).
