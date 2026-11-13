# Testing strategy

[App showcase](../README.md) · [Documentation](README.md)

Choose the lowest layer that proves the behavior; add an end-to-end journey only when an actual browser or native runtime matters. A phone-sized browser is not a native app.

## Layout and ownership

The root package holds the shared TypeScript rules (`src/domain/`), the ledger write schema (`src/validation/`), the golden fixtures' generator and their tests. Each app owns its own tests.

| Location | Runner | Responsibility |
| --- | --- | --- |
| `tests/core/` | Node test runner | Pure rules, money/date boundaries, immutable commands, entry drafts, ledger validation, golden fixtures, OpenAPI and design-baseline contract checks, test-environment runner logic and dashboards |
| `tests/fullstack/` | Node test runner | The disposable .NET API + PostgreSQL environment: isolation, cleanup, seeds and OIDC |
| `contracts/fixtures/` + `scripts/fixtures/` | `npm run fixtures:check` | The golden fixtures and their manifest, shared with the .NET, Swift and web tests |
| `apps/ios/` | `apps/ios/scripts/ios.sh` | SwiftUI app and PennyKit tests, XCUITest journeys ([native iOS app](../apps/ios/README.md#tests), [native UI tests](ios-ui-tests.md)) |
| `apps/web/` | Vitest + Playwright | Browser app tests ([web app](../apps/web/README.md#ci)) |
| `apps/backend/` | .NET test runner | .NET API tests against a real PostgreSQL ([backend](../apps/backend/README.md#verification-and-ci)) |

Do not add tests under `src/` or root `e2e/`. Core files use `*.test.ts`; full-stack files use `*.test.mjs`. Keep executable command wrappers in `scripts/`.

The v2 browser app in `apps/web/` has colocated `src/**/*.test.ts(x)`, app-level tests in `apps/web/tests/` and a Playwright smoke in `apps/web/e2e/`. Its Vitest setup gives every test a fresh, empty IndexedDB (`fake-indexeddb`), so the durable offline store runs for real in component tests; the offline engine and multi-tab cases are in `apps/web/tests/offline/` and the real-browser journeys in `e2e/offline.spec.ts` ([browser offline sync](web-offline-sync.md#tests)). Its CI is `.github/workflows/web.yml`. Browser and cross-client acceptance evidence by feature, with runner commands and known gaps, is in [acceptance](acceptance.md) (MAZ-96). Shared-household journeys (MAZ-91) run two browser contexts against an in-memory household fake (`apps/web/tests/fakes/householdServer.ts`) in CI, and against the real .NET API and PostgreSQL with `e2e/households.real.spec.ts` under the [full-stack test environment](reference/test-environment.md) (`PENNY_REAL_STACK=1`). Recurring schedules (MAZ-90) have model tests (`tests/recurring-model.test.ts`), app tests over the durable store (`tests/recurring.test.tsx`), the browser merge cases (`tests/offline/merge.test.ts`) and a mocked Playwright journey (`e2e/recurring.spec.ts`) that pins the browser clock with `page.clock` to cover short months, leap days, catch-up and a schedule deleted on another device ([web app](../apps/web/README.md#recurring-schedules-maz-90)).

## Commands

Use Node 24 and the committed npm lockfile (`npm ci`). From the repository root:

| Command | Runs |
| --- | --- |
| `npm test` / `npm run test:core` | Shared rules and contracts suite (`tests/core`) |
| `npm run test:coverage` | The core suite with code coverage |
| `npm run test-env -- run --seed NAME -- <command>` | Disposable .NET API + PostgreSQL environment for a browser or simulator runner ([test environment](reference/test-environment.md)) |
| `npm run test:fullstack` | Environment isolation, cleanup, seeds and OIDC (needs Docker/Podman, the .NET SDK and the search model; receipt OCR is off there unless `PENNY_OCR_WORKER=true`) |
| `npm run fixtures:generate` / `fixtures:check` | Regenerate or verify the golden fixtures and their manifest |
| `npm run lint` / `npm run typecheck` | ESLint and TypeScript over `src`, `tests` and `scripts` |

For the apps:

| Command | Runs |
| --- | --- |
| `apps/ios/scripts/ios.sh ci` | Native lint, PennyKit tests, app tests on iPhone and iPad simulators and the Release check |
| `apps/ios/scripts/ios.sh ui-test smoke` | XCUITest plan (smoke, full, screenshots or performance) against the full-stack environment |
| `(cd apps/web && npm run check)` | The web app's checks; see its [CI section](../apps/web/README.md#ci) for the Playwright commands |
| `apps/backend` | See [verification and CI](../apps/backend/README.md#verification-and-ci) |

For everyday changes, run the relevant layer while iterating, then `npm run lint`, `npm run typecheck` and `npm test`. Run the web app's checks for browser behavior and `ios.sh` for native behavior. Before a release, complete the [TestFlight upgrade and device checklist](ios-ipa.md#testflight-upgrade-and-device-checklist) and the [native QA release gates](ios-qa.md).

## Code coverage

```sh
npm run test:coverage
```

Normal `npm test` remains uninstrumented for faster local feedback. Coverage runs the same core suite with `c8` (V8) and produces a terminal summary plus browsable HTML, LCOV (`lcov.info`) and machine-readable JSON (`coverage-summary.json`).

| Report | Source boundary | HTML entry point |
| --- | --- | --- |
| Core (`c8` / V8) | All `src/**/*.ts`, including files never imported by tests | `coverage/core/index.html` |

Tests, fixtures and dependencies are outside this boundary. The apps measure their own coverage.

HTML/LCOV show missed lines and branches for prioritizing meaningful tests. No percentage threshold is enforced; test failures still fail the coverage command. Reports are ignored by Git; CI retains HTML/LCOV/JSON as the `code-coverage` artifact, excluding raw V8 temporary data.

## Browser setup

Browser journeys belong to the v2 web app: from `apps/web`, run `npx playwright install chromium` once and then `npm run test:e2e` (mocked API) or `npm run test:e2e:real` (real .NET API and PostgreSQL). See [the web app's tests](../apps/web/README.md#ci). The production web image is covered by `scripts/deploy-smoke.mjs` ([container images](deployment.md#container-images-and-releases)).

## Native setup

Native tests belong to `apps/ios`. Its [README](../apps/ios/README.md) covers the pinned Xcode, first-time simulator setup and the `ios.sh` commands. [Native UI tests](ios-ui-tests.md) cover simulator provisioning, the OS/device matrix, launch controls, upgrade seeds and artifacts. Physical-device and TestFlight checks are in the [native QA matrix](ios-qa.md) and the [TestFlight checklist](ios-ipa.md#testflight-upgrade-and-device-checklist).

## CI policy

`.github/workflows/tests.yml` checks the root package on every pull request and push to `master`, and the [iOS TestFlight workflow](../.github/workflows/ios-testflight.yml) calls it before archiving. It runs the release version check, lint, typecheck, the OpenAPI lint (pinned Redocly CLI 2.76.0), `fixtures:check`, `dashboards:check` and the core tests with coverage on Node 24/Linux, and uploads code coverage as `code-coverage`. `tests/core/contracts.test.ts` checks OpenAPI consistency, the sanitized fixtures against OpenAPI and the ledger rules, local substring behavior and redesign trace completeness.

`.github/workflows/backend.yml` builds and tests the .NET API on real PostgreSQL and runs the full-stack suite and the Swift contract fixtures. `.github/workflows/backend-images.yml` builds the `penny-api` and `penny-web` images on amd64 and arm64, runs the production-container and observability smoke tests, and publishes them outside pull requests. `.github/workflows/web.yml` runs the web app's checks. Signed iOS builds and TestFlight uploads stay limited to published releases and manual runs, never pull requests.

The native SwiftUI app has its own workflow, `.github/workflows/ios.yml` (MAZ-66), on the GitHub `xcode-27` image. It runs on pull requests that touch `apps/ios/`, `contracts/`, `package.json`, `docs/ios-ipa.md`, `apps/backend/`, `scripts/test-env/` or the Nix flake, and the TestFlight workflow calls it before archiving. It runs swift-format and module-boundary lint, PennyKit tests on the macOS host, app and PennyKit tests on newly created iPhone and iPad simulators, a Release build that must exclude test controls, and a launch with screenshots on both simulators. It uploads `ios-test-results`. Run the same steps locally with `apps/ios/scripts/ios.sh ci` ([native app](../apps/ios/README.md#commands)). Sign-in and session tests are listed in [native sign-in](ios-authentication.md#tests-and-configuration); XCUITest journeys are in [native UI tests](ios-ui-tests.md).

## Adding or changing tests

- Assert consumer-visible behavior, boundaries, transitions, permissions and failure recovery; avoid snapshots of implementation structure or tests that merely echo mocks.
- Keep pure rules/API invariants in core. Put client behavior in the app that owns it.
- Keep fixtures isolated and deterministic. Regenerate golden fixtures with `npm run fixtures:generate` and commit the manifest.
- Update this strategy when adding a runner, command or prerequisite rather than adding another standalone setup guide.
