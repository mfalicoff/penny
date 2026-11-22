# Testing strategy

[App showcase](../../README.md) · [Documentation](../README.md)

Choose the lowest layer that proves the behavior; add an end-to-end journey only when an actual browser or native runtime matters. A phone-sized browser is not a native app.

## Layout and ownership

There is no package at the repository root. The shared TypeScript rules (`apps/web/src/domain/`), the ledger write schema (`apps/web/src/validation/`), their reference tests and the golden fixtures' generator live in the web app. The repository tooling (`scripts/`: test environment, smoke tests, Grafana dashboards, version check) is its own package with its own tests. Each app owns its own tests.

| Location | Runner | Responsibility |
| --- | --- | --- |
| `apps/web/tests/domain/` | Vitest (node environment) | Pure rules, money/date boundaries, immutable commands, entry drafts, ledger validation, golden fixtures, OpenAPI and design-baseline contract checks |
| `scripts/tests/` | Node test runner | Test-environment runner logic, dashboards and the native QA matrix |
| `scripts/tests/fullstack/` | Node test runner | The disposable .NET API + PostgreSQL environment: isolation, cleanup, seeds and OIDC |
| `contracts/fixtures/` + `apps/web/scripts/fixtures/` | `npm --prefix apps/web run fixtures:check` | The golden fixtures and their manifest, shared with the .NET, Swift and web tests |
| `apps/ios/` | `apps/ios/scripts/ios.sh` | SwiftUI app and PennyKit tests, XCUITest journeys ([native iOS app](../../apps/ios/README.md#tests), [native UI tests](../ios/ui-tests.md)) |
| `apps/web/` | Vitest + Playwright | Browser app tests ([web app](../../apps/web/README.md#ci)) |
| `apps/backend/` | .NET test runner | .NET API tests against a real PostgreSQL ([backend](../../apps/backend/README.md#verification-and-ci)) |

Do not add a package, tests or `e2e/` at the repository root. Tooling tests use `*.test.ts`; full-stack files use `*.test.mjs`. Keep executable command wrappers in `scripts/`.

The v2 browser app in `apps/web/` has colocated `src/**/*.test.ts(x)`, app-level tests in `apps/web/tests/` and a Playwright smoke in `apps/web/e2e/`. Its Vitest setup gives every test a fresh, empty IndexedDB (`fake-indexeddb`), so the durable offline store runs for real in component tests; the offline engine and multi-tab cases are in `apps/web/tests/offline/` and the real-browser journeys in `e2e/offline.spec.ts` ([browser offline sync](../web/offline-sync.md#tests)). Its CI is `.github/workflows/web.yml`. Browser and cross-client acceptance evidence by feature, with runner commands and known gaps, is in [acceptance](acceptance.md) (MAZ-96). Shared-household journeys (MAZ-91) run two browser contexts against an in-memory household fake (`apps/web/tests/fakes/householdServer.ts`) in CI, and against the real .NET API and PostgreSQL with `e2e/households.real.spec.ts` under the [full-stack test environment](../reference/test-environment.md) (`PENNY_REAL_STACK=1`). Recurring schedules (MAZ-90) have model tests (`tests/recurring-model.test.ts`), app tests over the durable store (`tests/recurring.test.tsx`), the browser merge cases (`tests/offline/merge.test.ts`) and a mocked Playwright journey (`e2e/recurring.spec.ts`) that pins the browser clock with `page.clock` to cover short months, leap days, catch-up and a schedule deleted on another device ([web app](../../apps/web/README.md#recurring-schedules-maz-90)).

## Commands

Use Node 24. The tooling uses Node built-ins only at run time, so the environment, smoke and generator commands need no install. `scripts/` has its own lockfile for its lint, typecheck and tests (`npm --prefix scripts ci`). From the repository root:

| Command | Runs |
| --- | --- |
| `npm --prefix scripts test` | Tooling tests (`scripts/tests`) |
| `node scripts/test-env/penny-env.mjs run --seed NAME -- <command>` | Disposable .NET API + PostgreSQL environment for a browser or simulator runner ([test environment](../reference/test-environment.md)) |
| `npm --prefix scripts run test:fullstack` | Environment isolation, cleanup, seeds and OIDC (needs Docker/Podman, the .NET SDK and the search model; receipt OCR is off there unless `PENNY_OCR_WORKER=true`) |
| `npm --prefix apps/web run fixtures:generate` / `fixtures:check` | Regenerate or verify the golden fixtures and their manifest |
| `npm --prefix scripts run lint` / `typecheck` | ESLint and TypeScript over `scripts/` |
| `node scripts/grafana-dashboards.mjs --check` | Grafana dashboard JSON matches its generator |
| `node scripts/check-version.mjs` | The release version in `apps/ios/Configuration/Version.xcconfig` |

For the apps:

| Command | Runs |
| --- | --- |
| `apps/ios/scripts/ios.sh ci` | Native lint, PennyKit tests, app tests on iPhone and iPad simulators and the Release check |
| `apps/ios/scripts/ios.sh ui-test smoke` | XCUITest plan (smoke, full, screenshots or performance) against the full-stack environment |
| `(cd apps/web && npm run check)` | The web app's checks, including the shared rules' reference tests and `fixtures:check`; see its [CI section](../../apps/web/README.md#ci) for the Playwright commands |
| `apps/backend` | See [verification and CI](../../apps/backend/README.md#verification-and-ci) |

For everyday changes, run the relevant layer while iterating, then the checks of the app or package you changed (`apps/web` for the shared rules, `scripts/` for tooling). Run the web app's checks for browser behavior and `ios.sh` for native behavior. Before a release, complete the [TestFlight upgrade and device checklist](../ios/ipa.md#testflight-upgrade-and-device-checklist) and the [native QA release gates](../ios/qa.md).

## Code coverage

Each app measures its own coverage. The shared rules' reference tests run in the web app's Vitest suite.

## Browser setup

Browser journeys belong to the v2 web app: from `apps/web`, run `npx playwright install chromium` once and then `npm run test:e2e` (mocked API) or `npm run test:e2e:real` (real .NET API and PostgreSQL). See [the web app's tests](../../apps/web/README.md#ci). The production web image is covered by `scripts/deploy-smoke.mjs` ([container images](../self-hosting/deployment.md#container-images-and-releases)).

## Native setup

Native tests belong to `apps/ios`. Its [README](../../apps/ios/README.md) covers the pinned Xcode, first-time simulator setup and the `ios.sh` commands. [Native UI tests](../ios/ui-tests.md) cover simulator provisioning, the OS/device matrix, launch controls, upgrade seeds and artifacts. Physical-device and TestFlight checks are in the [native QA matrix](../ios/qa.md) and the [TestFlight checklist](../ios/ipa.md#testflight-upgrade-and-device-checklist).

## CI policy

`.github/workflows/tests.yml` checks the repository tooling on every pull request and push to `master`, and the [iOS TestFlight workflow](../../.github/workflows/ios-testflight.yml) calls it before archiving. In `scripts/`, on Node 24/Linux, it runs the release version check, lint, typecheck, the OpenAPI lint (pinned Redocly CLI 2.76.0), `dashboards:check` and the tooling tests. `.github/workflows/web.yml` runs `fixtures:check` and the shared rules' reference tests with the web app. `apps/web/tests/domain/contracts.test.ts` checks OpenAPI consistency, the sanitized fixtures against OpenAPI and the ledger rules, local substring behavior and redesign trace completeness.

`.github/workflows/backend.yml` builds and tests the .NET API on real PostgreSQL and runs the full-stack suite and the Swift contract fixtures. `.github/workflows/backend-images.yml` builds the `penny-api` and `penny-web` images on amd64 and arm64, runs the production-container and observability smoke tests, and publishes them outside pull requests. Backend checks and web checks also run on every push to `master`, which checks the merged result and saves the caches every pull request restores. `.github/workflows/web.yml` runs the web app's checks. Signed iOS builds and TestFlight uploads stay limited to published releases and manual runs, never pull requests.

The native SwiftUI app has its own workflow, `.github/workflows/ios.yml` (MAZ-66), on the GitHub `xcode-27` image. It runs on pull requests that touch `apps/ios/`, `contracts/`, `docs/ios/ipa.md`, `apps/backend/`, `scripts/test-env/`, the Nix flake or the iOS workflows, and the TestFlight workflow calls it before archiving with every job. macOS runners are the scarcest in CI, so a first Linux job (`scripts/ios-ci-scope.mjs`) picks the macOS jobs a pull request needs: app, contract and iOS workflow changes run all three, while backend, test environment and flake changes run only the XCUITest smoke job. Renovate's backend updates (covered by `backend.yml`'s full-stack suite) and Release Please's version bumps run none. A skipped job reports "skipped", which branch rules count as passing. On pushes to `master` it only saves the search model to `master`'s cache, which every pull request's smoke job restores. It runs swift-format and module-boundary lint, PennyKit tests on the macOS host, app and PennyKit tests on newly created iPhone and iPad simulators and, in a parallel job, a Release build that must exclude test controls, the TestFlight archive checks and a launch with screenshots on both simulators. It uploads `ios-test-results` and `ios-launch-screenshots`. Run the same steps locally with `apps/ios/scripts/ios.sh ci` ([native app](../../apps/ios/README.md#commands)). Sign-in and session tests are listed in [native sign-in](../ios/authentication.md#tests-and-configuration); XCUITest journeys are in [native UI tests](../ios/ui-tests.md).

## Adding or changing tests

- Assert consumer-visible behavior, boundaries, transitions, permissions and failure recovery; avoid snapshots of implementation structure or tests that merely echo mocks.
- Keep pure rules/API invariants with the shared rules (`apps/web/tests/domain`). Put client behavior in the app that owns it.
- Keep fixtures isolated and deterministic. Regenerate golden fixtures with `npm --prefix apps/web run fixtures:generate` and commit the manifest.
- Update this strategy when adding a runner, command or prerequisite rather than adding another standalone setup guide.
