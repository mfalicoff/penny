# Native ledger rules (PennyDomain)

[Documentation](README.md) · [Native iOS app](../apps/ios/README.md) · [API client](ios-api-client.md) · [Ledger sync](migration/ledger.md)

MAZ-70 ports the personal ledger rules of the legacy app (`src/domain/ledger.ts`, `src/domain/commands.ts`, `src/features/entries/entryDraft.ts`, the overview, transactions and trip selectors and `src/features/households/projection.ts`) to pure Swift in `apps/ios/Packages/PennyKit/Sources/PennyDomain/Ledger/`. The rules have no I/O, no UI, no clock and no randomness: callers pass today's date and generated ids. They are checked against the shared golden fixtures in `contracts/fixtures` and Swift Testing boundary tests in `Tests/PennyDomainTests`.

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
| `Reports.swift`, `LocalSearch.swift` | Month summary (recorded and projected), Activity, trip totals, shared projection join and local search |
| `LedgerRuleError.swift`, `JavaScriptText.swift` | User-facing messages and the JavaScript string semantics the rules must reproduce |

## Money invariants

- Every amount is `Int64` cents. No rule uses `Double` or `Decimal`. Totals of 100,000 entries at the maximum amount stay below 2^63.
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
- A new repeating entry is the first occurrence. Its rule starts at the entry's date, anchors on its day and has `nextDate` one step later, so the first date is never recorded twice.
- `materialize(ledger, today)` records every due occurrence of active rules through today once, with id `{ruleId}:{date}` and `recurringId`, and advances `nextDate` past today. An existing id is skipped but still advances `nextDate`, so catch-up is idempotent, also after a merge brings an occurrence from another device. Edited occurrences keep their id (the rule's date), so moving or changing one never brings the original back; deleted ones stay deleted because `nextDate` is past them.
- Pausing keeps `nextDate`. Resuming skips every date on or before today. Removing a rule keeps its history; recorded entries keep a `recurringId` that may name no rule.
- Editing a rule changes future occurrences only. Moving its next date re-anchors it on the new day; keeping the date keeps the anchor. Clearing its account removes the account.
- Previews never change the ledger. A month's previews start at each active rule's `nextDate` and exclude any occurrence already recorded.

## Commands and field deletion

`LedgerChange` is the legacy `(ledger) => ledger`: a pure function the caller applies to its latest snapshot. It throws `LedgerRuleError` and returns nothing on refusal, so a refused change never leaves a partial write. The checks and their order follow `src/domain/commands.ts` and `entryDraft.ts`: references (account, trip, category of the same kind), then the stale check against the record the form opened with, then the write. An edited entry moves to the end of the list, as before. Names of trips and accounts (and now categories) are trimmed with JavaScript whitespace rules and measured in UTF-16 code units; duplicate names compare lowercased code units.

Optional fields (`accountId`, `tripId`, `receipt`, `recurringId`, `sharedHouseholdId`) are nil when absent. Clearing one in a draft sets it to nil, and the wire layer must omit the key, never send `null` (the server refuses `null`). An income or investment entry never keeps a trip, a receipt or a split.

## Reports

`LedgerReport(ledger:shared:sharedScheduled:)` joins the personal ledger with the caller's shared shares from the server projection. It is a read model and is never saved.

- **Recorded** (`MonthSummary.recorded`): personal entries plus recorded shared shares dated in the month. **Left to spend** is `recordedRemaining = income − expense − investment` (negative when more went out). It is not an account balance.
- **Scheduled**: previews of active personal rules and the server's shared previews in the month, oldest first.
- **Projected** (`projected`, `projectedRemaining`): recorded plus every scheduled occurrence of every kind. **Expected income** (`expectedIncome`) is the scheduled income included in it. Once an occurrence is recorded, it replaces its preview, so income is never counted twice.
- **Shared projection deduplication**: a shared expense repeated across period responses counts once (by household and id); a shared preview whose rule already recorded that date is dropped, even when the preview came from an older response; shares in another currency than the ledger are left out.
- **Activity** (`activity`): recorded entries only, personal and shared, never previews. The month or year totals ignore the query, kind and day filters. Order is date descending, then id in ordinal order; 50 per page, page clamped.
- **Investments** are contributions, reported separately from spending. **Trips** sum personal expense shares and receipt totals.

## Local search

`LocalSearch.matches` is the legacy offline/demo search: the trimmed, lowercased query must be an exact UTF-16 substring of `"{title} {note} {category} {account}"` lowercased. "cafe" does not find "Café"; `%`, `_` and `\` are plain characters. Shared rows search their shared category and, for the payer only, their account. With pending local changes, offline, or without server search v1, the client searches its local snapshot (`LocalSearch.searchesLocally`), so an unsynced create, edit or delete is never hidden or revived by a server page; local and server rows are never mixed ([search](migration/search.md#offline-pending-edits-and-demo)).

## Fixtures

Consumed read-only through `PennyContracts` (strict models, manifest hashes): `money.json` (parse, shares, stored bounds), `recurrence.json` (next dates and 12-step sequences), `parity-cases.json` (money, shares, anchor dates), `ledger-upgrades.json` (v1–v4 upgrade, and every expected ledger passes `violations`), `full-stack-seeds.json` (alex's seeded ledger and its pending create/edit/delete local searches) and `redesign-states.json` (`alex-2026-10` recorded, scheduled and projected totals). `search-cases.json` has no strict Swift model yet, so its legacy `ledger`, `substringCases` and `pendingCases` are read with a lenient test model.

No fixture was added or changed. Known gaps, for the fixture owners rather than invented here:

- `manifest.json` still lists only `contracts/swift/Tests/PennyContractsTests/FixtureDecodingTests.swift` as the Swift consumer of these files (and MAZ-73 for `search-cases.json`); the generator's consumer table (`scripts/fixtures/generate-golden.ts`) should add `apps/ios/Packages/PennyKit/Tests/PennyDomainTests` when it is next regenerated.
- There is no shared fixture for the entry draft rules, the command check order and messages, pause/resume, materialization or the projected formula with expected income; the Swift tests port the legacy behavior and the redesign total.
- `merge-conflicts.json` is MAZ-71's; `shared-splits.json` and `settlement.json` are MAZ-75's.

## Compatibility decisions

- **Projected counts every scheduled kind.** The legacy overview added only scheduled income to its summary. The shared `redesign-states.json` total (agreed with web and C#) adds scheduled expenses too (Gym and Streaming in `alex-2026-10`); PennyDomain follows the fixture, and still reports expected income separately.
- **Recorded counts every entry dated in the month.** Income dated after today counting toward Projected rather than Left to spend is MAZ-136 and not implemented here.
- **Ordinal id order.** Ties sort by UTF-16 code units, not `localeCompare`, so order never depends on the device's ICU data. For the lowercase ASCII ids the clients generate, the two agree on letters and digits.
- **Head counts are plain integers.** `" 4 "`, `"4.0"` and `"004"` are accepted like `Number()`; `"1e1"`, `"0x3"` and `"+3"` are refused (the legacy `Number()` accepted them; a native field never produces them).
- **Final sigma.** Swift's `lowercased()` maps a final "Σ" to "σ" where JavaScript gives "ς"; local substring search can differ only for that letter.
- **Value equality.** Stale checks compare values, not `JSON.stringify` text, so key order can no longer cause a false "changed on another device". Strings compare by canonical equivalence there; names and search compare code units, as before.
- **Three new command checks** that previously failed only at sync as "Invalid ledger data.": a category name must be 1–50 characters (the legacy form enforced it), at most 300 categories, and a category in use cannot change kind. Their messages follow the account and trip wording. `Ledger.violations` lets a client refuse any other unsyncable state before acknowledging a save.
- **Names.** Domain types are `LedgerCategory` and `LedgerEntry` (not `Category`/`Entry`) because Foundation re-exports the Objective-C runtime's `Category`.

## Verification

Run `apps/ios/scripts/ios.sh package-test` (Mac host, seconds) and `apps/ios/scripts/ios.sh lint`; `ios.sh ci` adds the simulator and Release checks.
