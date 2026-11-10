# Native ledger rules (PennyDomain)

[Documentation](README.md) · [Native iOS app](../apps/ios/README.md) · [API client](ios-api-client.md) · [Ledger sync](migration/ledger.md) · [TypeScript domain rules](migration/domain-rules.md)

MAZ-70 ports the personal ledger rules of the legacy app (`src/domain/ledger.ts`, `src/domain/commands.ts`, `src/features/entries/entryDraft.ts`, the overview, transactions and trip selectors and `src/features/households/projection.ts`) to pure Swift in `apps/ios/Packages/PennyKit/Sources/PennyDomain/Ledger/`. The rules have no I/O, no UI, no clock and no randomness: callers pass today's date and generated ids. They are checked against the shared golden fixtures in `contracts/fixtures` and Swift Testing boundary tests in `Tests/PennyDomainTests`.

The reference for reports and search is the pure TypeScript module MAZ-86 extracted on v2 ([domain rules](migration/domain-rules.md)): `src/domain/summary.ts` (`monthBreakdown`, `summarizeMonth`, `isRecorded`), `search.ts` (`searchMatcher`, `byDateDescThenId`, `searchEntries`) and `selectors/` (overview, transactions, trips), tested in `tests/core/domain-rules.test.ts`. Where that module changed the old selectors, PennyDomain follows the new module.

## Ownership

| Concern | Owner | Notes |
| --- | --- | --- |
| Money parsing, personal shares, entry validation, ledger commands, personal recurrence, reports, local substring search | PennyDomain (MAZ-70) | Client-owned, as in the legacy app ([ADR 002](migration/architecture.md#adr-002-calculation-and-conflict-ownership)) |
| Wire models, decoding, HTTP | PennyData (MAZ-67) | Maps `WireLedger` ↔ `Ledger` and `WireProjectedExpense` → `SharedExpenseShare`; the mapping itself is not part of MAZ-70 |
| Durable `{base, local}` snapshots, three-way merge, sync and retries | MAZ-71 | Applies a `LedgerChange` to the latest local snapshot, then `Recurrence.materialize`, then persists before acknowledging |
| Shared splits, settlement, shared recurrence and projection | Server (MAZ-56–59); Swift settlement MAZ-75 | PennyDomain only reads the caller's projected shares; it never splits or records shared expenses |
| Search v1 folded normalization, typo and meaning tiers | Server (MAZ-121); iOS screens MAZ-73 | PennyDomain keeps the legacy local substring search |
| Screens | MAZ-73, 74, 76, 77 | They call these rules and show `LedgerRuleError.message` |

| File | Contents |
| --- | --- |
| `Models.swift` | `Ledger` (v4), `LedgerEntry`, `RecurringRule`, `LedgerCategory`, `PaymentAccount`, `Trip`, `ReceiptReference`, `Currency` and the kind/frequency/account-type enums |
| `Money.swift` | `Money.cents`, `Money.personalShare`, stored-amount bounds, half-up integer division |
| `CalendarDate.swift`, `CalendarDate+Foundation.swift`, `MonthKey.swift` | Time-zone-free dates, integer calendar arithmetic, the only `Date` → ledger-date conversion |
| `Recurrence.swift` | `next`, occurrence ids, `materialize`, month `previews` |
| `LedgerChange.swift` | Entry, schedule, trip, account, category and currency commands |
| `EntryDraft.swift` | Form validation and the entry/rule a draft produces |
| `LedgerValidation.swift` | `Ledger.violations` (the server's structural checks) and the v1–v3 upgrade |
| `Reports.swift`, `LocalSearch.swift` | Month summary (recorded and projected), Activity, trip totals, shared projection join, local search and whole-ledger `search` |
| `LedgerRuleError.swift`, `JavaScriptText.swift` | User-facing messages and the JavaScript string semantics the rules must reproduce |

## Money invariants

- Every amount is `Int64` cents. No rule uses `Double` or `Decimal`. Every row a report sums is within the stored bounds (personal rows because a ledger outside them fails `violations`; shared rows because `LedgerReport` leaves out a wire row outside them), so a sum overflows only past about 92 million rows at the maximum amount.
- `Money.cents` accepts 1–9 ASCII digits, then optionally `.` or `,` and up to two decimals, after JavaScript `trim()` (which trims U+FEFF and U+3000 but not U+0085). Signs, exponents, grouping, non-ASCII digits and a leading separator are refused. Input of any length is refused without overflow.
- A stored amount has `total` 1…99,999,999,999 and `share` 0…`total`; income and investments always have `share == total`.
- Equal and percentage shares round half up in integers: `(2n + d) / (2d)`. $10.01 split three ways is $3.34. This equals the legacy `Math.round` of a double for every valid input (the property tests check every head count 2–100 and a sweep of basis points at the boundary totals).
- Reports always sum `share`, never `total`. A trip also reports the receipt total separately.

## Date invariants

- `CalendarDate` is a wall-clock day with no time zone. Arithmetic is proleptic Gregorian integer math (civil-day algorithm), so DST, the device calendar and the time zone can never move a date. Ordering equals the `YYYY-MM-DD` text order the legacy app compared.
- Ledger dates are strict `YYYY-MM-DD` with ASCII digits, a real day, 2000-01-01…2100-12-31. 2000 is a leap year, 2100 is not; the tests walk every day of the range.
- `CalendarDate(_:in:)` converts an instant to the day in the calendar's time zone through the Gregorian calendar. Recurrence uses the device's local day, as the legacy app did.

## Recurrence rules

- Weekly adds seven days. Monthly and yearly move one or twelve months and land on `anchorDay`, or on the last day of a shorter month, and return to the anchor afterwards (Jan 31 → Feb 28 → Mar 31; Feb 29 → Feb 28 → … → Feb 29 in the next leap year).
- A new repeating entry is the first occurrence. Its rule starts at the entry's date, anchors on its day and has `nextDate` one step later, so the first date is never recorded twice. When that next date would fall after 2100-12-31, the draft is refused (`scheduleAfterLedgerRange`) instead of saving a rule the server would refuse.
- `materialize(ledger, today)` records every due occurrence of active rules through today once, with id `{ruleId}:{date}` and `recurringId`, and advances `nextDate` past today. An existing id is skipped but still advances `nextDate`, so catch-up is idempotent, also after a merge brings an occurrence from another device. Edited occurrences keep their id (the rule's date), so moving or changing one never brings the original back; deleted ones stay deleted because `nextDate` is past them.
- Pausing keeps `nextDate`. Resuming skips every date on or before today. Removing a rule keeps its history; recorded entries keep a `recurringId` that may name no rule.
- Editing a rule changes future occurrences only. Moving its next date re-anchors it on the new day; keeping the date keeps the anchor. Clearing its account removes the account.
- Previews never change the ledger. A month's previews start at each active rule's `nextDate` and exclude any occurrence already recorded.

## Commands and field deletion

`LedgerChange` is the legacy `(ledger) => ledger`: a pure function the caller applies to its latest snapshot. It throws `LedgerRuleError` and returns nothing on refusal, so a refused change never leaves a partial write. The checks and their order follow `src/domain/commands.ts` and `entryDraft.ts`: references (account, trip, category of the same kind), then the stale check against the record the form opened with, then the write. An edited entry moves to the end of the list, as before. Names of trips and accounts (and now categories) are trimmed with JavaScript whitespace rules and measured in UTF-16 code units; duplicate names compare lowercased code units.

Optional fields (`accountId`, `tripId`, `receipt`, `recurringId`, `sharedHouseholdId`) are nil when absent. Clearing one in a draft sets it to nil, and the wire layer must omit the key, never send `null` (the server refuses `null`). An income or investment entry never keeps a trip, a receipt or a split.

## Reports

`LedgerReport(ledger:shared:sharedScheduled:)` joins the personal ledger with the caller's shared shares from the server projection. It is a read model and is never saved.

- **Recorded** (`MonthSummary.recorded`): personal entries plus recorded shared shares dated in the month. **Left to spend** is `recordedRemaining = income − expense − investment` (TypeScript `recordedNet`; negative when more went out). It is not an account balance.
- **Scheduled**: previews of active personal rules and the server's shared previews in the month, oldest first.
- **Projected** (`projected`, `projectedRemaining`, TypeScript `summarizeMonth` `projected`/`projectedNet`): recorded plus every occurrence in `scheduled`: scheduled income (**Expected income**, `expectedIncome`), expenses and investment contributions, personal and shared. Once an occurrence is recorded, it replaces its preview, so nothing is counted twice: a personal preview by its occurrence id `{rule}:{date}` only (`Recurrence.previews`; an edited entry keeps `recurringId` but not its occurrence), a shared preview as below. This matches `redesign-states.json` `projected` exactly (MAZ-139).
- **Shared projection deduplication**: a shared expense repeated across period responses counts once (by household and id, compared by code units), at the position its id was first seen and with the values of its last copy, as the legacy `HouseholdProvider` `Map` with `unique.set` did (pass older responses first); the last copy's currency and amounts decide. Previews repeat the same way. A shared preview whose rule already recorded that date (a recorded row with the same household, `recurringId` and date) is dropped, even when the preview came from an older response. Recorded shared ids are random, so this relies on the `recurringId` both servers send on recorded rows since MAZ-139; a recorded row without one (an older server) is not matched. Shares in another currency than the ledger, and shared rows whose total is not 1…99,999,999,999 or whose share is not 0…total (the bounds the server stores), are left out.
- **Home** (`monthEntries`): the month's recorded and scheduled rows that match the day, kind, category and query filters. The filters never change the totals.
- **Activity** (`activity`): recorded entries only, personal and shared, never previews. The month or year totals ignore the query, kind and day filters. 50 per page, page clamped.
- **Search** (`search`, TypeScript `searchEntries`): recorded entries of the whole report, any date, filtered by query, kind and day.
- **One order**: Home, Activity, search and trip expenses all sort by date descending, then id ascending (TypeScript `byDateDescThenId`); scheduled previews in `MonthSummary.scheduled` are oldest first.
- **Investments** are contributions, reported separately from spending. **Trips** sum personal expense shares and receipt totals.
- **Not ported here**: money flow (`selectors/moneyFlow.ts`, unchanged by MAZ-86) and the calendar grid helper `calendarMonth` belong to the Home screens (MAZ-77); `CalendarDate.mondayBasedWeekday` and `MonthKey` already give their inputs.

## Local search

`LocalSearch.matches` is the offline/demo search (TypeScript `searchMatcher`): the query, trimmed with JavaScript `trim` and lowercased once, must be an exact UTF-16 substring of one search document, `"{title} {note} {category} {account}"` lowercased. Home, Activity and `search` use the same matcher, so `" coffee"` finds a row titled "Coffee" everywhere and a query of spaces matches everything. Because the fields are joined with single spaces, "beans morning" finds title "Coffee beans" with note "Morning", but "lunch  with" (two spaces) does not cross a field. "cafe" does not find "Café"; `%`, `_` and `\` are plain characters. Shared rows search their shared category and, for the payer only, their account. With pending local changes, offline, or without server search v1, the client searches its local snapshot (`LocalSearch.searchesLocally`), so an unsynced create, edit or delete is never hidden or revived by a server page; local and server rows are never mixed ([search](migration/search.md#offline-pending-edits-and-demo)).

## Fixtures

Consumed read-only through `PennyContracts` (strict models, manifest hashes): `money.json` (parse, shares, stored bounds), `recurrence.json` (next dates and 12-step sequences), `parity-cases.json` (money, shares, anchor dates), `ledger-upgrades.json` (v1–v4 upgrade, and every expected ledger passes `violations`), `full-stack-seeds.json` (alex's seeded ledger, the Maison expenses and the `streaming` shared rule, and its pending create/edit/delete local searches) and `redesign-states.json` (`alex-2026-10` recorded, scheduled and projected totals). The redesign test builds every input from the seed, including the shared preview (from the rule's `nextDate`, frequency and equal split among the members active then), and uses `redesign-states.json` only for the assertions. `search-cases.json` has no strict Swift model yet, so its legacy `ledger`, `substringCases` and `pendingCases` are read with a lenient test model.

No fixture was added or changed. Known gaps, for the fixture owners rather than invented here:

- `manifest.json` still lists only `contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift` as the Swift consumer of these files (and MAZ-73 for `search-cases.json`); the generator's consumer table (`scripts/fixtures/generate-golden.ts`) should add `apps/ios/Packages/PennyKit/Tests/PennyDomainTests` when it is next regenerated.
- There is no shared fixture for the entry draft rules, the command check order and messages, pause/resume, materialization or the projected formula with expected income; the Swift tests port the v2 TypeScript behavior (`tests/core/domain-rules.test.ts`) and the redesign totals. The message test pins every `LedgerRuleError` sentence word for word to the legacy source (`src/domain/ledger.ts`, `commands.ts`, `entryDraft.ts`), and the four new ones to the wording chosen here.
- `merge-conflicts.json` is MAZ-71's; `shared-splits.json` and `settlement.json` are MAZ-75's.

## Compatibility decisions

- **Projected counts every scheduled occurrence** (MAZ-139), as v2 `summarizeMonth` and the server's `redesign-states.json`: scheduled income, expenses and investment contributions, personal and shared. `ReportTests` and `tests/core/domain-rules.test.ts` assert the fixture's recorded and projected totals directly (`alex-2026-10`: Left to spend −175,950 cents, projected remaining −180,750, the difference being Gym and Streaming). This is a deliberate change from the legacy app, which projected scheduled income only; Left to spend and expected income are unchanged.
- **Recorded counts every entry dated in the month.** Income dated after today counting toward Projected rather than Left to spend is MAZ-136 and not implemented here.
- **Ordinal id order.** Ties sort by UTF-16 code units, not `localeCompare` (which `byDateDescThenId` uses), so order never depends on the device's ICU data. For the lowercase ASCII ids the clients generate, the two agree on letters and digits; they can differ for mixed case or punctuation (`localeCompare` puts "a" before "B" and `:` before digits).
- **Head counts are plain integers.** `" 4 "`, `"4.0"` and `"004"` are accepted like `Number()`; `"1e1"`, `"0x3"` and `"+3"` are refused (the legacy `Number()` accepted them; a native field never produces them).
- **Final sigma.** Swift's `lowercased()` maps a final "Σ" to "σ" where JavaScript gives "ς"; local substring search can differ only for that letter.
- **Value equality.** Stale checks compare values, not `JSON.stringify` text, so key order can no longer cause a false "changed on another device". Strings compare by canonical equivalence there; names and search compare code units, as before.
- **Three new command checks** that previously failed only at sync as "Invalid ledger data.": a category name must be 1–50 characters (the legacy form enforced it), at most 300 categories, and a category in use cannot change kind. Their messages follow the account and trip wording. `Ledger.violations` lets a client refuse any other unsyncable state before acknowledging a save.
- **What `Ledger.violations` checks.** The structural rules of the .NET `LedgerReader`: ids are 1–100 UTF-16 code units of the id itself (a UUID, or a UUID occurrence id `{uuid}:2026-01-01`, is valid) and unique by code units; text lengths count UTF-16 code units; and, like `LedgerText.IsStorable`, any string containing NUL is refused. The rule's other half, unpaired surrogates, cannot be represented in a Swift `String` (bridging repairs one to U+FFFD and `JSONDecoder` refuses a lone `\uD83D`), and a test pins that assumption. The server-only checks (household currency, linked accounts, receipt ownership, revision) are not repeated.
- **Schedules past 2100.** The server stores dates through 2100-12-31. The legacy form saved a new repeating entry whose next date fell later, and the sync then failed as "Invalid ledger data."; `EntryDraft.build` now refuses it with "This schedule would repeat after 2100. Choose an earlier date, or choose Does not repeat." (a new message, following the date message). Materializing and resuming have no legacy error path, so they are not refused: during 2100 a rule can still advance past the range, the same known limitation as legacy, and `Ledger.violations` names it (`dateOutOfRange`).
- **Names.** Domain types are `LedgerCategory` and `LedgerEntry` (not `Category`/`Entry`) because Foundation re-exports the Objective-C runtime's `Category`.

## Verification

Run `apps/ios/scripts/ios.sh package-test` (Mac host, seconds) and `apps/ios/scripts/ios.sh lint`; `ios.sh ci` adds the simulator and Release checks.
