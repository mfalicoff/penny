# Penny documentation

[Back to the app showcase](../README.md)

## Run and operate Penny

- [Development](development.md): local web setup, the legacy API, Nix/direnv, dependency updates, pointers to the iOS, web and backend app setup, and the source layout.
- [Self-hosting and configuration](deployment.md): the .NET/PostgreSQL Compose stack, reverse proxies and HTTPS, configuration, external PostgreSQL, container images, upgrades and rollback, OIDC, push notifications, and the legacy Node deployment.
- [Self-hosting on NixOS](nixos.md): the flake packages and the `services.penny` / `programs.penny` NixOS module (PostgreSQL 18, migrations, the API and nginx), its options, secrets, external PostgreSQL and upgrades.
- [Cutover from Node/SQLite](cutover.md): the one-time move to .NET/PostgreSQL behind the same address: settings mapping, production-copy rehearsal, the window step by step, go/no-go and rollback, observation and compatibility windows, Node retirement, the cutover drill and release notes.
- [Operations runbook](operations.md): health and readiness, JSON logs and request ids, connections and disk, backup and restore drills, index and search maintenance, PostgreSQL roles, extensions and version policy, write reconciliation, and failure runbooks.
- [App behavior and limits](app-guide.md): personal-share calculations, payment accounts, households, trips, reimbursements, offline sync, recurrence, and ledger upgrades.

## Build and release

- [Releases](releases.md): semantic versioning, version checks, release commands, Git tags, and native build counters.
- [iOS IPA and TestFlight builds](ios-ipa.md): native Xcode archive, signing, TestFlight upload and release runbook.

## Architecture and testing

- [V2 migration architecture](migration/architecture.md): SwiftUI/TanStack/.NET boundaries, PostgreSQL import and recovery, versioned search, redesign traceability and compatibility gates.
- [ASP.NET Core backend foundation](../apps/backend/README.md): pinned .NET/PostgreSQL setup, explicit migrations, readiness, real database tests and backend CI.
- [Native iOS app](../apps/ios/README.md): Xcode 27.2 and iOS 26 setup, simulator build and test commands, module ownership, environments, signing, App Group and upgrade continuity, and iOS CI.
- [Native API client](ios-api-client.md): wire models, contract updates, server-scoped credentials, error and retry conventions, ledger, receipts and search.
- [Native sign-in and sessions](ios-authentication.md): password and single sign-on screens, the sign-in state machine, Keychain storage and accessibility, session restore, expiry and sign-out, OIDC callback setup and tests.
- [Native offline ledger and sync](ios-offline-sync.md): the per-account file format and migrations, durable saves, the three-way merge and same-field policy, sync triggers and retries, failure recovery, sign-out protection, local search reconciliation and the sync state the UI binds to.
- [Upgrading Expo iOS installs](ios-expo-migration.md): the audited Expo storage formats, the in-place importer and bridge-release decision, retry and failure handling, diagnostics, user guidance, rollback limits and the upgrade rehearsal.
- [Native ledger rules](ios-ledger-domain.md): PennyDomain ownership, integer-cent and calendar-date invariants, recurrence, ledger commands, recorded and projected reports, local search, fixtures and compatibility decisions.
- [Native UI tests](ios-ui-tests.md): XCUITest plans against the full-stack environment, simulator provisioning, the OS/device matrix, accessibility identifiers, launch controls, upgrade seeds, artifacts, the flaky-test policy and debugging.
- [Native QA matrix and release gates](ios-qa.md): journey coverage per parity area, the redesign card trace, accessibility audits, performance budgets, execution evidence, the device release checklist, triage and coverage gaps.
- [Native app shell](ios-shell.md): iPhone and iPad navigation and deep links, components and tokens, supported devices and accessibility, settings, the biometric app lock, the temporary demo, named states and the sync-status interface for offline sync.
- [Native entries, Activity and search](ios-entries.md): adding, editing and deleting entries, splits and investments, drafts and conflicts, Activity filters, server and on-device search, accessibility identifiers and simulator scenarios.
- [Native accounts, categories and recurring schedules](ios-organize.md): account and category forms with their removal guards, the category palette and legacy colors, schedule pages, editing, pause/resume and month ends, the reusable inline forms and the accessibility identifiers.
- [Native Home, money flow, Insights and calendar](ios-overview.md): report formulas, recorded versus projected, shared and private aggregation, what investments mean, the iPhone and iPad layouts, chart accessibility, tests and performance verification.
- [Native households and shared expenses](ios-households.md): create, invite (code, QR and `penny://join` links with the server rules), join and the camera scanner, members, shared expense splits and payer privacy, recording payments and monthly balances, history, repeating shared expenses, leave/remove/archive, online-only behavior, drafts and stale edits, and acceptance scenarios.
- [Native Home Screen widgets](ios-widgets.md): Monthly balance and Recent expenses in WidgetKit, the App Group entitlements and versioned snapshot schema, refresh, states, deep links, privacy and sign-out clearing, the design adaptation, supported families and verification.
- [Native personal and shared trips](ios-trips.md): personal and shared trips, the merged list, sharing a personal trip with its private earlier expenses, joining, travel dates that never filter, assignment and deletion, totals that never count twice, monthly settlement, identifiers and acceptance scenarios.
- [Web app foundation](../apps/web/README.md): the React/Vite/TanStack browser client, pinned versions, route and data conventions, design-kit boundaries and web CI.
- [Browser offline ledger and sync](web-offline-sync.md): the IndexedDB schema, durable saves, the legacy Expo web import and recovery, the shared merge and same-field policy, multi-tab coordination, sync triggers and failure states, sign-out protection, local search, the origin requirement and offline limits.
- [Browser receipts](web-receipts.md): supported files and limits, upload with progress, cancel and retry, the draft, authenticated photo and PDF preview and download, the pdf.js worker and Content-Security-Policy for deployment, receipt encryption and key configuration, and troubleshooting.
- [Native receipts](ios-receipts.md): the iPhone and iPad photo and file pickers, supported files, upload progress, cancel and retry, the draft, the authenticated photo and PDF viewer, sharing, temporary-file cleanup, permissions and privacy, and simulator and device verification.
- [Native household notifications](ios-notifications.md): APNs entitlement and Apple Developer setup, sandbox versus production, contextual permission, the registration lifecycle (refresh, denial, sign-out, account changes), payload validation and navigation, auth/app-lock and cross-account privacy, simulator injection versus physical-device verification.
- [Frontend architecture](frontend-architecture.md): the removed Expo frontend (MAZ-98), where its replacements live, and the shared TypeScript rules in `src/domain`.
- [Backend architecture](backend-architecture.md): HTTP/application/storage boundaries, validation, persistence guarantees, and framework tradeoffs.
- [Backend API endpoints](api-endpoints.md): all 40 operations, authentication, request/response shapes, and compatibility notes for a Go or .NET migration.
- [Testing strategy](testing.md): test ownership, root and per-app commands, coverage, browser and native setup pointers, and CI policy.
- [Browser and cross-client acceptance](acceptance.md): the acceptance matrix by feature, real .NET/PostgreSQL and cross-client journeys, simulator and browser runner commands, accessibility, responsive and performance results, known gaps and device-only exclusions (MAZ-96).
- [Household implementation plan](households-implementation-plan.md): original design tasks and acceptance examples. For current behavior, use the [app guide](app-guide.md#shared-households).

## Showcase screenshots

The [README](../README.md) uses real captures of the running web app with temporary demo data, refreshed on October 24, 2026. The phone-width capture shows responsive web, not a native iOS build.

- `screenshots/overview.jpg`: desktop monthly overview, calendar, and category breakdown.
- `screenshots/sankey.jpg`: the overview's **Follow your money** card.
- `screenshots/add-entry.jpg`: phone-width entry form with a CAD 74.40 expense split between three people, showing a CAD 24.80 personal share.

To refresh them, follow [local web setup](development.md#run-the-complete-web-app), choose **Take a look around with sample data** on the sign-in screen, and capture the same views. Use demo data rather than a personal ledger. For the entry capture, choose **Add entry**, enter an amount and description, select **Split equally**, and set the number of people. Keep the images in `docs/screenshots/`, retain descriptive alt text in the README, and update the capture date and scenario here when they change.
