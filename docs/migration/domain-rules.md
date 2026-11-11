# Reusable TypeScript domain rules (MAZ-86)

`src/domain/` is the pure, platform-neutral rules module shared by the legacy Expo app and the v2 web client (`apps/web`, MAZ-83+). It is the TypeScript counterpart of the Swift `PennyDomain` rules and the C# domain, and all three read the same `contracts/fixtures/`.

## Ownership

| File | Owns |
| --- | --- |
| `ledger.ts` | Ledger v1-v4 types and upgrade, integer-cent parsing (`cents`), personal shares (`personalShare`), date keys, anchored recurrence (`nextOccurrence`, `materialize`), `totals` |
| `commands.ts` | Immutable ledger commands (entries, trips, categories, accounts, schedules, currency) and reference clean-up on delete |
| `merge.ts` | Three-way offline merge: independent field merges, optional-field deletion, local deletes and creates |
| `households.ts` | Shared split, monthly balance and suggested-reimbursement rules (server-owned results; same code in tests) |
| `search.ts` | Local, durable offline/demo search: case-insensitive substring over title, note, category and account names, ordered by date descending then id |
| `summary.ts` | Shared month breakdown (`monthBreakdown`, `scheduledEntries`), `summarizeMonth` and signed `net`; `calendar.ts` holds month helpers. Layering: `calendar` and `summary` sit below `search` and `selectors/`, never the reverse |
| `selectors/` | Overview, Activity (`transactions`), trip and money-flow selectors. `src/features/**/selectors.ts` and `moneyFlow.ts` re-export these so existing screens are unchanged |

The wire format (HTTP envelopes in `src/data/`, `contracts/openapi.json`) is converted explicitly at the data layer; domain types are never serialized as the API contract.

## Allowed imports

Files under `src/domain/` may import only other relative files inside `src/domain/`. No React, React Native, Expo, `node:*`, `process.env`, network, storage, clock injection beyond `new Date()`/`dateKey` defaults, or server code. `tests/core/domain-rules.test.ts` fails if a package or out-of-module import appears. Callers pass `today` explicitly where determinism matters.

## Invariants

- Money is integer cents; floats are never accumulated. Rounding is half-up (`Math.round`) and a personal share never exceeds the receipt total.
- Dates are `YYYY-MM-DD` calendar strings; recurrence keeps the anchor day through short months and leap years.
- Recorded versus projected (`summarizeMonth`): recorded counts entries already in the ledger. Projected adds every occurrence scheduled in the month and not recorded yet: scheduled income, expenses and investment contributions, personal previews and shared (household) shares alike, exactly as `redesign-states.json` `projected` (`alex-2026-10`: projected remaining −180,750 cents, recorded −175,950). A recorded occurrence replaces its preview. Personal previews match by id only: a preview is skipped when its occurrence id `{rule}:{date}` is already in the ledger (an edited entry keeps `recurringId` but not its occurrence, so a rule entry moved onto a scheduled date does not hide that date). A shared preview is dropped when the ledger view has a recorded row with the same id, or with the same household, `recurringId` and date; recorded shared ids are random, so this needs the `recurringId` both servers send on recorded rows since MAZ-139. A recorded row without it (an older server) is not matched, and its stale preview counts until the next refresh drops it. `expectedIncome` is the scheduled-income part of projected; recorded totals and Left to spend (`recordedNet`) never include a preview. `net` (`recordedNet`, `projectedNet`) is income minus expenses minus investment contributions, signed; money flow's `remaining` is `max(0, net)` and its `gap` is `max(0, -net)`. Investments are not spending.
- **Deliberate change from the legacy app (MAZ-139).** The legacy app projected scheduled income only and left scheduled expenses and investments out until recorded. The deployed legacy Expo app reads `src/domain` but does not show Projected: by product decision its Overview summary cards use `recorded` totals and always read "Cash remaining", even when income was expected (the legacy app used to switch to "Projected remaining" then). Its other displays keep their legacy inputs: "Where it went" (category spending and its bar scale) uses recorded totals, the money-flow chart uses recorded entries plus expected income (`moneyFlowEntries`), and the calendar and entry list show recorded entries and previews as before (a shared preview whose occurrence is recorded is no longer listed twice).
- Activity (`selectTransactions`, `searchEntries`) is recorded-only; scheduled occurrences (including shared ones flagged `scheduled` in the merged household view) are never history.
- Search is a trimmed, case-insensitive substring over the fields joined with single spaces (the search v1 "document", so "beans morning" crosses fields), lowercased once per query, ordered date descending then id ascending in Overview, Activity, trips and search; no accent folding (search v1 on the server folds; see [search](search.md)). Pending local edits, renames and deletions are reflected because search runs on the local ledger.
- Merge: a local-edited field wins, untouched remote fields survive, a field removed locally is removed.

## Shared fixture maintenance

Consumed here: `search-cases.json` (`substringCases`, `pendingCases`), `full-stack-seeds.json` and `redesign-states.json` (totals), `parity-cases.json`, and the generated `money.json`, `recurrence.json`, `merge-conflicts.json` (`tests/core/golden-fixtures.test.ts`). Generated fixtures are never edited by hand: change the rule, run `npm run fixtures:generate`, review the diff and commit the manifest hashes; Swift, C# and TypeScript fail on an unreviewed edit. Fixtures hold synthetic data only. Add a new case to the shared file, not a TypeScript-only copy, whenever another stack must agree.

## Verification and limits

`npm run test:core`, `npm run lint`, `npm run typecheck`, `npm run fixtures:check`. Since MAZ-87 the web client imports this module through its `@domain/*` alias (`merge.ts`, `ledger.ts`, `commands.ts` and `search.ts`, for the durable offline store and local search; [browser offline sync](../web-offline-sync.md)), and `apps/web` typechecks it under its stricter flags. For `exactOptionalPropertyTypes`, `Transaction.accountId` is typed `string | undefined`, because materialized occurrences and previews copy an absent rule account as `undefined`; the JSON is unchanged. Swift ports of the new `summary.ts`/`search.ts` helpers and manifest `consumers` entries for `domain-rules.test.ts` are follow-ups.
