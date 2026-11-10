# Penny documentation

[Back to the app showcase](../README.md)

## Run and operate Penny

- [Development](development.md): local web setup, Nix/direnv, live reload, connecting iOS and Android, and the source layout.
- [Self-hosting and configuration](deployment.md): the .NET/PostgreSQL Compose stack, reverse proxies and HTTPS, configuration, external PostgreSQL, container images, upgrades and rollback, OIDC, push notifications, and the legacy Node deployment.
- [Cutover from Node/SQLite](cutover.md): the one-time move to .NET/PostgreSQL behind the same address: settings mapping, production-copy rehearsal, the window step by step, go/no-go and rollback, observation and compatibility windows, Node retirement, the cutover drill and release notes.
- [Operations runbook](operations.md): health and readiness, JSON logs and request ids, connections and disk, backup and restore drills, index and search maintenance, PostgreSQL roles, extensions and version policy, write reconciliation, and failure runbooks.
- [App behavior and limits](app-guide.md): personal-share calculations, payment accounts, households, trips, reimbursements, offline sync, recurrence, and ledger upgrades.

## Build and release

- [Releases](releases.md): semantic versioning, version checks, release commands, Git tags, and native build counters.
- [Android APK builds](android-apk.md): EAS signing credentials, CI setup, installation, and compatible updates.
- [iOS IPA and TestFlight builds](ios-ipa.md): Apple credentials, widget App Groups, EAS builds, and TestFlight submission.

## Architecture and testing

- [V2 migration architecture](migration/architecture.md): SwiftUI/TanStack/.NET boundaries, PostgreSQL import and recovery, versioned search, redesign traceability and compatibility gates.
- [ASP.NET Core backend foundation](../apps/backend/README.md): pinned .NET/PostgreSQL setup, explicit migrations, readiness, real database tests and backend CI.
- [Native iOS app](../apps/ios/README.md): Xcode 27.2 and iOS 26 setup, simulator build and test commands, module ownership, environments, signing, App Group and upgrade continuity, and iOS CI.
- [Native API client](ios-api-client.md): wire models, contract updates, server-scoped credentials, error and retry conventions, ledger, receipts and search.
- [Web app foundation](../apps/web/README.md): the React/Vite/TanStack browser client, pinned versions, route and data conventions, design-kit boundaries and web CI.
- [Frontend architecture](frontend-architecture.md): routes, feature ownership, state and persistence boundaries, responsive navigation, and native glass surfaces.
- [Backend architecture](backend-architecture.md): HTTP/application/storage boundaries, validation, persistence guarantees, and framework tradeoffs.
- [Backend API endpoints](api-endpoints.md): all 40 operations, authentication, request/response shapes, and compatibility notes for a Go or .NET migration.
- [Testing strategy](testing.md): test ownership, commands, coverage, browser/native setup, device isolation, and CI policy.
- [Household implementation plan](households-implementation-plan.md): original design tasks and acceptance examples. For current behavior, use the [app guide](app-guide.md#shared-households).

## Showcase screenshots

The [README](../README.md) uses real captures of the running web app with temporary demo data, refreshed on October 24, 2026. The phone-width capture shows responsive web, not a native iOS or Android build.

- `screenshots/overview.jpg`: desktop monthly overview, calendar, and category breakdown.
- `screenshots/sankey.jpg`: the overview's **Follow your money** card.
- `screenshots/add-entry.jpg`: phone-width entry form with a CAD 74.40 expense split between three people, showing a CAD 24.80 personal share.

To refresh them, follow [local web setup](development.md#run-the-complete-web-app), choose **Take a look around with sample data** on the sign-in screen, and capture the same views. Use demo data rather than a personal ledger. For the entry capture, choose **Add entry**, enter an amount and description, select **Split equally**, and set the number of people. Keep the images in `docs/screenshots/`, retain descriptive alt text in the README, and update the capture date and scenario here when they change.
