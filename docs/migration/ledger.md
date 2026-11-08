# Personal ledger sync (MAZ-55)

The .NET backend serves `GET /api/ledger` (`getApiLedger`) and `PUT /api/ledger` (`putApiLedger`) with the legacy wire contract: the same `{revision, ledger}` envelope, validation rules, messages, status codes and 409 semantics as `server/http/ledger.ts`, `server/application/ledger.ts` and `server/validation/ledger.ts`. Storage is the typed MAZ-52 schema, not a JSON document. Node still serves production; the shared contract keeps `x-implementation: legacy` for both operations.

Code: `Domain/Ledgers/LedgerReader` (schema, refinements, upgrade), `Application/Ledgers/LedgerService` (cross-aggregate checks and conflict), `Persistence/Repositories/PostgresLedgerRepository` (transaction), `Api/Controllers/LedgerController`. Tests: `UnitTests/Ledgers/LedgerReaderTests` (ports of the zod/upgrade fixtures, including `contracts/fixtures/ledger-upgrades.json`) and `IntegrationTests/Controllers/LedgerTests` (real HTTP and PostgreSQL, including `contracts/fixtures/http-journey.json`).

## Wire format

Both operations return `{revision, ledger}`. `PUT` takes the same envelope: the whole ledger plus the revision it was based on. Both are session-protected (cookie or bearer) and scoped to the session's user.

- **Version.** Responses are always `version: 4` with `currency`, `accounts`, `trips`, `categories`, `transactions` and `recurring`, in that key order (the legacy zod output order). Entry keys follow `id, title, kind, total, share, categoryId, accountId, tripId, date, note, receipt, recurringId`; rules follow `id, title, kind, total, share, categoryId, accountId, date, note, frequency, nextDate, anchorDay, active`.
- **Optional fields** (`accountId`, `tripId`, `receipt`, `recurringId`, `sharedHouseholdId`) are omitted when absent. They are never written as JSON `null`, and a request that sends `null` for one is invalid (zod `optional()` semantics).
- **Money** is integer cents in a JSON number: `total` 1..99,999,999,999, `share` 0..`total`. Any JSON number that is a JavaScript safe integer is accepted (`1200.0` and `1.2e3` are 1200, as with `JSON.parse`); fractions, strings and non-finite values are invalid. No floating-point arithmetic is applied.
- **Dates** are calendar dates without time zones: strict `YYYY-MM-DD` with ASCII digits, a real day, 2000-01-01 through 2100-12-31. They are stored as PostgreSQL `date` and written back unchanged.
- **Revision** is a JSON integer, 0..2^53−1 (`Number.MAX_SAFE_INTEGER`). Imported revisions keep their value; for example 9007199254740990 is read and incremented exactly.
- **Strings** keep their exact text; lengths count UTF-16 code units like JavaScript. Account and trip names are trimmed with JavaScript `trim()` whitespace rules, as the legacy schema did; other strings are not trimmed. Unknown keys are ignored and, for duplicate JSON keys, the last value wins.
- **Receipts.** An entry's `receipt` is `{id, name, mime, uri}`. Only `id` is stored on the entry. Responses (GET and PUT) serve `name` and `mime` from the uploaded receipt row (the encrypted filename is opened, never the file) and `uri` as `/api/receipts/{id}`, the value the legacy upload returned. Client-sent name/MIME/URI text is validated for length and then ignored.

## Version rules and upgrades

Writes accept versions 1–4 and are normalized to v4 before storage, exactly as the client's `upgradeLedger`:

- v3 and v4 must include `accounts`; v4 must include `trips`. v1/v2 may omit `accounts`, v1–v3 may omit `trips`; omitted lists become empty.
- v1 gains an `investments` category (`trending-up-outline`, `#678DB1`), suffixed `investments-1`, `-2`… on id collision, unless it already has an investment-kind category or already has 300 categories. v2–v4 never gain or restore categories.
- Any other version (0, 5, `"4"`) is invalid.

Reads never upgrade: imported v1–v3 documents were upgraded once by the importer, and typed storage only holds v4.

## Validation and errors

Errors use the `{error: string}` envelope. All schema/refinement failures share one message, as in the legacy service.

| Order | Condition | Status | Message |
| --- | --- | --- | --- |
| 1 | Malformed JSON, or a top-level JSON scalar | 400 | `Invalid JSON.` |
| 2 | Not `application/json`, empty body, or any schema/refinement failure below | 400 | `Invalid ledger data.` |
| 3 | Write from a pre-v3 client (version 1/2) while the stored ledger has payment accounts | 400 | `Update or reload the app before saving payment accounts.` |
| 4 | Write without `trips` while the stored ledger has trips (v2 addition) | 400 | `Update or reload the app before saving trips.` |
| 5 | Ledger currency differs from any active household (open membership, not archived) | 400 | `Your ledger currency must match your active households.` |
| 6 | A payment account is removed while a live household expense or a household rule paid by this user references it | 400 | `Remove household expense links before deleting this payment account.` |
| 7 | An entry references a receipt the user does not own (another user's or nonexistent) | 400 | `Receipt does not belong to this account.` |
| 8 | A trip's `sharedHouseholdId` names no household (v2 addition) | 400 | `Invalid ledger data.` |
| 9 | The revision is stale | 409 | `Your data changed on another device. Please refresh and try again.` |

Schema and refinements: ids 1–100 characters and unique per list; currency CAD/USD/EUR/GBP; account type bank/credit/cash/other; category name 1–50, icon ≤80, color `#RRGGBB`, kind income/expense/investment; account names 1–50 and trip names 1–80 after trimming; entry title 1–100, note ≤1000; receipt name ≤255, MIME ≤100, URI ≤500; rule frequency weekly/monthly/yearly, anchor day 1–31, `active` boolean; at most 300 accounts, trips and categories, 100,000 transactions and 1,000 rules. Each entry and rule must reference an existing account (when set) and a category of the same kind; `share` ≤ `total`, and income/investment entries cannot be split. Only expense transactions can have a trip, which must exist; rules cannot have a trip. A trip cannot end before it starts. Other status codes come from the shared boundary: 401 without a session, 403 for an untrusted origin on PUT, 413 above the body limit (20 MiB by default).

Checks 3–9 run inside the saving transaction (below), and run even when the revision is stale, so a stale write that also violates a rule reports the rule, as the single-threaded legacy service did.

## Atomicity, isolation and conflicts

`PostgresLedgerRepository.TrySaveAsync` runs one READ COMMITTED transaction:

1. Compare-and-increment: `UPDATE ledgers SET revision = revision + 1, currency = … WHERE user_id = @u AND revision = @expected` (EF `ExecuteUpdate`). A matching row is locked until commit.
2. Read the facts for checks 3–8 (stored accounts/trips, household currencies, linked accounts, owned receipt ids, existing household ids). With the row locked, these reads see every write committed before the lock.
3. Run the checks; a failure rolls back the transaction, including the revision.
4. If the revision did not match, return a conflict (409) without changing anything.
5. Apply a keyed diff to accounts, categories, trips, rules and entries (insert new ids, update changed rows, delete missing ids); EF orders statements so foreign keys hold. Commit.

Concurrent writers on the same revision serialize on the row lock: the first commits, the others re-evaluate the predicate after it commits, update nothing and receive 409. A 409, a validation failure, a cancelled request or a timeout leaves the ledger and its revision unchanged; only a committed response acknowledges a save. Writers always lock the ledger row before child rows, so ledger saves cannot deadlock with each other. Household writers that validate against a member's ledger (MAZ-56/57: currency on join, account links on expenses) must lock that `ledgers` row in the same way to keep these checks race-free.

**Retry rules.** The server never retries a save. On 409 the client re-reads (`GET`), re-applies its pending change to the fresh snapshot and retries with the new revision (the current client merges keyed changes and retries up to four times). Retrying a 4xx validation failure with the same body is pointless; a 5xx or 503 means "not saved".

## Personal versus shared sync guarantees

- **Personal ledger: client-owned, whole-document, optimistic.** The server stores exactly the validated document; it does not materialize personal recurrence, merge, or reorder by meaning. Clients materialize due occurrences themselves (entry id `{rule}:{date}`, `recurringId`) and advance `nextDate` in the same write, and they merge durable pending offline edits by id against the latest snapshot (`src/data/offlineLedger.ts`). Independent edits survive because the loser of a race re-reads and re-applies; the server guarantees only that no write is based on a stale revision.
- **Shared households** (MAZ-56–59) are server-owned per entity with their own revisions, server-side recurrence and audit. A personal save never changes shared rows; it only reads them for checks 5–8. Shared rows are never copied into the personal document.

## Storage mapping and read order

`ledgers` holds currency and revision; children are keyed `(user_id, id)` in `ledger_accounts`, `ledger_categories`, `ledger_trips`, `ledger_recurring` and `ledger_entries` (rule `date` is `start_date`). Ids are scoped per user, so two users can both have an account `visa`. Foreign keys make cross-user references impossible: entries can only name the owner's categories, accounts, trips and receipts.

The typed schema has no position column (MAZ-52 decision). Reads return accounts, trips, categories and rules ordered by id and entries by date descending, then id. PUT responses echo the request's order. Clients must not depend on list order.

## Deliberate differences from the legacy service

- Old clients that omit `trips` cannot erase stored trips (check 4); the legacy service only guarded accounts.
- A trip's `sharedHouseholdId` must name an existing household (check 8) because it is a foreign key; the legacy JSON accepted any id.
- Strings containing NUL or unpaired UTF-16 surrogates are invalid because PostgreSQL text cannot hold them.
- A write at revision 9007199254740991 is invalid: its successor is not a safe integer and exceeds the column bound. Legacy SQLite stored an unsafe successor.
- Receipt name/MIME/URI come from the receipt row instead of echoing client text; list order on read follows the rules above.
- `GET` requires the receipt store settings (`Receipts__Root`, `Receipts__MasterKey`) to open filenames, so the HTTP host now validates them at startup.

## Search seam (MAZ-121)

MAZ-55 builds no search projection or index. `TrySaveAsync` marks the seam: when MAZ-121 adds a projection of personal entries, it must update it inside this same transaction, before commit, so search never diverges from the committed revision. Indexing `ledger_entries` directly needs no write-path change.
