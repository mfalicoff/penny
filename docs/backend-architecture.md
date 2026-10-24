# Backend architecture

Use this pattern for new work: **a thin HTTP route, an application service, validated input and a typed persistence boundary**.

## Ownership

| Location | Owns | Dependencies |
| --- | --- | --- |
| `server/index.ts` | Environment, listening socket, static web hosting and shutdown | App composition and Node/Express hosting |
| `server/app.ts` | Composition of one app's database, services and middleware | All backend layers |
| `server/http/` | Routes, status codes, cookies, bearer extraction, rate limits, headers and error responses | Application services |
| `server/application/` | Account/session operations, ledger saves and receipt ownership | Validation, domain rules and ports |
| `server/application/ports.ts` | Storage/security interfaces and service data types | Shared ledger types |
| `server/validation/` | Zod schemas, cross-field invariants, receipt decoding and signature/size checks | Zod and shared domain rules |
| `server/infrastructure/` | SQLite schema/repositories, transactions, scrypt and token hashing | Application ports and Node APIs |
| `src/domain/` | Shared ledger types, initial ledger and calendar/money rules | No frontend or backend runtime |

```text
HTTP request → middleware → feature route → application service → repository port
                                               ↓                       ↑
                                         input validation       SQLite implementation
```

Services receive repositories/security through factory arguments. They accept plain data and return plain results; they never receive Express requests, responses or database handles. Expected failures use `ApplicationError` reasons, which the HTTP adapter maps to status codes. Unexpected failures return a generic 500 response and are logged on the server. Express 5 forwards rejected async route handlers to that adapter.

The composition root allocates an independent database connection and auth limiter for each app instance. `createApp` retains its `{ app, db }` interface; the caller closes the connection after the listener shuts down. Failed schema initialization or composition closes the connection before rethrowing. Importing a service starts no server and opens no database.

ESLint enforces the import direction: services cannot import HTTP or concrete storage, HTTP cannot import storage, infrastructure cannot import service implementations, and validation cannot import orchestration. Backend modules may use `src/domain`; frontend runtime modules cannot import backend implementations. Receipt decoding currently uses Node's `Buffer`, so HTTP independence does not imply complete runtime portability.

## Persistence and API guarantees

- User and initial-ledger creation share a SQLite transaction. A failed ledger insert rolls back the account. Duplicate emails are handled inside that transaction as well as before password hashing, so concurrent signup attempts return one success and one conflict.
- Passwords use salted scrypt. Only SHA-256 session token hashes are stored. Session expiration is checked on every authenticated request; logout revokes just that session.
- Ledger updates compare the expected revision and increment it in the same SQL statement. Receipt ownership is checked before the update. Never split revision checking into a separate read followed by an unconditional write.
- Receipt reads and ownership checks always include the authenticated account ID. Receipt upload validation enforces allowed MIME types, file signatures and the existing 10 MB decoded limit.
- Public health/login/register routes precede the authentication middleware. Protected routes and the API 404 handler follow it. Keep this order when adding routes.
- Cookies, origin checks, CORS, the 20 MB JSON body limit, response headers, receipt URLs and JSON envelopes remain HTTP responsibilities. No API or database migration is needed for this refactor.

## Adding a capability

1. Add validation for untrusted input under `validation/`.
2. Add the operation to an application service. Add a focused port method when persistence is needed.
3. Implement that port in `infrastructure/`, preserving atomicity and account scoping.
4. Add a route under `http/` that extracts request data, calls the service and formats the response.
5. Wire the dependency in `app.ts`. Keep environment/process behavior in `index.ts`.
6. Cover externally observable behavior and failure paths in the Node tests.

## Verification

```sh
npm run lint
npm run typecheck
npm run test:core
```

`tests/core/server.test.ts` exercises real HTTP and SQLite for registration, login, two-device sync, stale revision conflicts, account/receipt isolation, uploads/downloads, invalid data, origin rejection, restart persistence and logout.

`tests/core/server-boundaries.test.ts` covers cookie authentication, bearer precedence, cookie/security headers, API 404s, malformed/oversized JSON, CORS preflight, registration policy, rate limiting and concurrent signup. It also exercises the auth service without HTTP using an injected clock for exact session expiration, and verifies database rollback when initial-ledger creation fails. HTTP tests need permission to listen on a loopback port. All databases used by these tests are temporary or in memory. See the [testing strategy](testing.md) for cross-platform ownership and execution.

## Hono assessment

Keep Express for the current Node/SQLite deployment. This refactor addresses the immediate maintenance problem: business operations and SQL were embedded in one HTTP module. A framework migration would also require replacing cookie handling, middleware, rate limiting, static-file hosting and listener integration, then rechecking the same API contract.

[Hono RPC](https://hono.dev/docs/guides/rpc) can infer client input/output types from server routes. Its [Web-standard API](https://hono.dev/docs) and [Node adapter](https://hono.dev/docs/getting-started/nodejs) make it worth reconsidering if typed client contracts or a new deployment runtime becomes a concrete goal. Migrating HTTP alone would not make this backend edge-ready: synchronous Node SQLite, local database files, cryptography and Buffer-based receipt decoding still need compatible implementations.

If a migration is chosen later, replace `http/`, app composition and hosting, and keep application services, validation rules and persistence interfaces. Run the existing API contract tests against the replacement; do not assume routing benchmarks predict end-to-end improvements for this application's database, password hashing and receipt workload.
