# Native API client (MAZ-67)

The Swift API client lives in `apps/ios/Packages/PennyKit/Sources/PennyData/API`. It speaks the contract in `contracts/openapi.json` (1.5.0) and is independent of any view or storage. It imports only Foundation, so its tests run on the Mac host (`ios.sh package-test`).

## Layout

| File | Role |
| --- | --- |
| `WireModels.swift` | Wire types: ledger snapshot, entries, categories, accounts, trips, receipts, session, server info, projected shared expenses |
| `Search.swift` | Search v1 request, response, items and client-side limits |
| `Session.swift` | `ServerSession` (token bound to one server) and `AccountScope` (server + account partition) |
| `APIClient.swift` | Async client: info, register, login, OIDC availability/start/complete, me, logout, ledger get/put, receipt upload/download, search |
| `SearchCoordinator.swift` | Latest-query-wins paging and stale-answer protection |
| `Errors.swift` | `APIError` |
| `Transport.swift` | `HTTPTransport` and the production `URLSessionTransport` |

The OIDC routes (`oidcConfiguration`, `startOidc`, `completeOidc`) arrived with MAZ-68; sign-in, the Keychain and session handling built on this client are in [native sign-in](ios-authentication.md). Password reset (`POST /api/auth/password-reset`, whose native screen is still open), households, push registration and the shared-expense routes are not in this client yet; they follow the same conventions (MAZ-79, 75, 76).

## Models and contract updates

Wire models are written by hand and checked against the contract; they are not generated. The OpenAPI document uses `oneOf`, `if/then` and unions that generators handle poorly, and a hand-written model keeps `PennyData` free of a generator dependency. Drift is caught by tests, not by a build step:

- `WireModelTests` decodes the shared fixtures through `PennyContracts` (`search-cases.json` ledger, requests and response, and every `ledger-upgrades.json` input and expected output).
- `contracts/swift` `FixtureDecodingTests` keeps the strict round-trip check of the fixtures themselves.

When the contract changes (OpenAPI, fixtures, `docs/migration/api-reference.md` change together):

1. Update the model in `WireModels.swift` or `Search.swift` and the fixture decoding test that covers it.
2. Run `apps/ios/scripts/ios.sh package-test`. A fixture the model cannot decode, or cannot re-encode equal, fails.
3. Record the change in `docs/migration/feature-parity.md`.

Wire rules the models preserve: money is integer cents (`Int64`, never `Double`); calendar dates stay `YYYY-MM-DD` strings (never `Date`); ids are opaque strings; absent optionals stay `nil` and are omitted when encoding; the ledger `version` and snapshot `revision` are kept as sent. Unknown response members are ignored (forward compatibility); a wrong type, a missing required member or an unknown enum value is `APIError.malformedResponse`. View and domain models are built from wire models elsewhere (MAZ-70, 71, 73) and never the other way round.

## Configuration and credentials

`APIConfiguration(server:)` holds a normalized `ServerURL` (MAZ-66) plus bounded timeouts: 30 s for JSON requests and 120 s for receipt transfer by default, clamped to 1-120 s. Debug builds may default to a local server; Release has none: people choose and verify one at the server-connect screen ([native sign-in](ios-authentication.md#server-choice)).

Credentials are scoped to the server that issued them:

- `ServerSession` pairs the bearer token with its `ServerURL`; the token must be 64 lowercase hex characters and is redacted from `description`.
- `APIClient` refuses (`invalidRequest(.wrongServer)`) to be created with a session from another server, and `signedIn(as:)` checks the same.
- `URLSessionTransport` never follows redirects, so a redirect cannot carry the token to another host, and uses an ephemeral session with no cookie, credential or URL cache storage. The `Set-Cookie` the server also sends is ignored; the app authenticates with `Authorization: Bearer`.
- Unauthenticated calls (`info`, `login`, `register`, the OIDC routes) never send a token. `APIClient.anonymous(_:transport:)` makes a client that has none.
- The client does not log. `APIError` carries status and the server's message, never a request or credential.

The token is persisted per server in the Keychain by `KeychainSessionStore` ([native sign-in](ios-authentication.md#keychain-storage)).

## Errors and retries

Branch on the `APIError` case, never on message text.

| Case | Source | What to do |
| --- | --- | --- |
| `offline`, `timeout`, `unreachable` | network | Retry when connectivity returns; keep local data |
| `badRequest` | 400 | A bug or an invalid value; do not retry |
| `unauthorized` | 401 | The session ended; sign in again (`requiresSignIn`) |
| `forbidden` | 403 | Origin or permission; do not retry |
| `notFound` | 404 | Absent or private; on search it means the server lacks search v1, use local search |
| `conflict` | 409 | Stale revision: nothing changed. Refetch `ledger()`, merge and write again (`LedgerSyncEngine`, [offline sync](ios-offline-sync.md)) |
| `payloadTooLarge` | 413 | Reduce the body |
| `rateLimited`, `unavailable` | 429, 503 | Wait `retryAfter` seconds, then retry. A 503 never acknowledges a write |
| `server` | other 5xx | Retry with backoff |
| `malformedResponse` | 2xx with an invalid body | Report; do not retry blindly |
| `invalidRequest` | refused before sending | Fix the field named in the case |

Cancelling the calling task throws `CancellationError` (not an `APIError`); a response that arrives after cancellation is dropped.

The client never retries by itself. `isRetryable` tells a caller whether repeating the request can help. Reads (`ledger`, `info`, `receipt`, `search`) may be retried with backoff. A ledger write is a whole-ledger compare-and-swap on `revision`, so repeating it after an ambiguous failure (timeout, lost connection) either applies once or answers 409; the offline sync engine (MAZ-71, [offline sync](ios-offline-sync.md#sync)) owns that decision and re-merges after a 409.

## Ledger and receipts

`ledger()` returns `LedgerSnapshot(revision, ledger)`; `putLedger` sends the snapshot with the revision it was based on and returns the stored snapshot. Receipts upload as JSON `{name, mime, base64}` (1 byte to 10 MiB, mime from the contract list) and download as bytes with their mime type and filename; ids are percent-encoded into a single path segment. `uploadReceipt` takes an optional `progress` closure that receives the fraction of the request body sent, from `HTTPTransport.send(_:progress:)` (`URLSessionTransport` reports it from its task delegate; other transports report nothing). The receipt screens are in [native receipts](ios-receipts.md).

## Search

`search(_:)` is `POST /api/v1/search/transactions` ([search](migration/search.md)). The client validates the contract's limits before sending (query at most 200 UTF-16 units after trimming, real dates within 2000-2100 with `from` not after `to`, page size 1-100, cursor 1-2048 characters) and trims the query as the server does. Results are `SearchItem` values keyed by `key`, never by title. Cursors are opaque: pass `nextCursor` back unchanged with the same query, filters and sort; the server answers 400 for a cursor from another request.

`SearchCoordinator` owns one account's search: each `start` cancels the search in flight, `nextPage` continues only the latest query, and every answer is checked against its generation and `AccountScope` (server and account) before it is returned. A slow answer to an old query, or to a previous account or server, throws `CancellationError` instead of reaching the UI. `reset(client:)` on sign-out or account change drops the query, cursor and in-flight work. Pages carry their scope and request so callers can partition caches.

Search shares nothing with ledger access except the session, so an unavailable search (404, 429, 503) never blocks reading or writing the ledger. For offline or pending-edit states MAZ-73 searches one complete local result set labeled "On this device" and never mixes it into server pages.
