# Penny documentation

[Back to the app showcase](../README.md)

## Run and operate Penny

- [Development](development.md): local web setup, Nix/direnv, live reload, connecting iOS and Android, and the source layout.
- [Self-hosting and configuration](deployment.md): Docker Compose, reverse proxies and HTTPS, container images, backups, OIDC, push notifications, and server upgrades.
- [App behavior and limits](app-guide.md): personal-share calculations, payment accounts, households, trips, reimbursements, offline sync, recurrence, and ledger upgrades.

## Build and release

- [Releases](releases.md): semantic versioning, version checks, release commands, Git tags, and native build counters.
- [Android APK builds](android-apk.md): EAS signing credentials, CI setup, installation, and compatible updates.
- [iOS IPA and TestFlight builds](ios-ipa.md): Apple credentials, widget App Groups, EAS builds, and TestFlight submission.

## Architecture and testing

- [Frontend architecture](frontend-architecture.md): routes, feature ownership, state and persistence boundaries, responsive navigation, and native glass surfaces.
- [Backend architecture](backend-architecture.md): HTTP/application/storage boundaries, validation, persistence guarantees, and framework tradeoffs.
- [Testing strategy](testing.md): test ownership, commands, coverage, browser/native setup, device isolation, and CI policy.
- [Household implementation plan](households-implementation-plan.md): original design tasks and acceptance examples. For current behavior, use the [app guide](app-guide.md#shared-households).

## Showcase screenshots

The [README](../README.md) uses real captures of the running web app with temporary demo data, refreshed on October 24, 2026. The phone-width capture shows responsive web, not a native iOS or Android build.

- `screenshots/overview.jpg`: desktop monthly overview, calendar, and category breakdown.
- `screenshots/sankey.jpg`: the overview's **Follow your money** card.
- `screenshots/add-entry.jpg`: phone-width entry form with a CAD 74.40 expense split between three people, showing a CAD 24.80 personal share.

To refresh them, follow [local web setup](development.md#run-the-complete-web-app), choose **Take a look around with sample data** on the sign-in screen, and capture the same views. Use demo data rather than a personal ledger. For the entry capture, choose **Add entry**, enter an amount and description, select **Split equally**, and set the number of people. Keep the images in `docs/screenshots/`, retain descriptive alt text in the README, and update the capture date and scenario here when they change.
