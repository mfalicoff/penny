# MAZ-50 revision verification — 2026-11-07

Scope: architecture/contracts on `codex/maz-50-postgresql-contracts`, based on `master` `0e58a8b`. Remote `v2` was absent at task start; the PR base is recreated from that audited baseline. The earlier October 19 Linear verification is preserved as historical evidence, not reused to certify this revision. Recorded before the Expo app's removal (MAZ-98); `npm run test:ui` no longer exists.

| Check | Result |
| --- | --- |
| `npm run lint` | Passed, no warnings/errors |
| `npm run typecheck` | Passed |
| `node --test tests/core/*.test.ts` | 107/107 passed, including 8 architecture/contract tests |
| `npm run test:ui -- --silent` | 54 suites, 261 tests passed across legacy iOS/Android/web projects |
| Redocly CLI 2.76.0 lint | OpenAPI 3.1 valid; three style warnings for health, OIDC availability and info public GET routes without documented 4xx responses |
| Implemented route drift | All 40 current operations on 31 paths match; search v1 is separately marked planned |
| Fixture compatibility | v1–v4 normalization, cents/rounding/anchor dates, three-way merge, local substring and pending create/edit/delete cases pass existing rules |
| Real legacy HTTP/SQLite | Cookie attributes, info, ledger read/write/409, lowercase shared envelopes, recorded/scheduled projection, payer privacy, shared revisions and share payment exercised with temporary data |
| Design trace | Exactly 61 distinct penny-ios cards and 42 design-kit controls, matching the files and hashes on disk, have feature and acceptance owners; light and dark palettes; every legacy route has a destination (MAZ-132) |
| Whitespace | `git diff --check` passed |

Redocly validation is added to the reusable application CI workflow; the route/fixture tests run in its existing core/UI suites. This local run reused the checkout's existing SDK-matched node_modules through a temporary worktree symlink, with no dependency/lockfile changes. Hosted CI results are attached to the PR when available; they are separate from these local results.

New specification limits: PostgreSQL point-in-time recovery, SQL/GIN plans, FTS language behavior, concurrent workers and .NET serialization are **not implemented or executed here**. MAZ-52/59/61/62/64/65/121 require real PostgreSQL evidence. The storage fixture checks portable encodings, not an actual PostgreSQL importer. The fixture schema matcher checks the exercised subset, not every JSON Schema keyword.

The design baseline is read from `docs/design/penny-ios` and `design-kit` (MAZ-132); the visual comparison of the implementations with the cards is recorded in `contracts/visual-comparisons.json` (MAZ-122, [visual acceptance](../design/visual-acceptance.md)), and no physical-device verification is claimed. Swift/TanStack UI, iPad/accessibility/native materials, physical APNs/widgets, TestFlight and in-place pending-data migration remain their owning issues' gates. No financial app behavior, production database, deployed service or user workspace files were changed.
