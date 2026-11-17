# Legacy compatibility (MAZ-131)

The .NET API was first written to copy the Node server exactly, so the Expo apps would keep working through the migration. The cutover (MAZ-65) is done, and the Expo web and mobile apps are retired (MAZ-97, MAZ-98). Only the native iOS app and the browser app call the API now. This page lists each piece of that compatibility, what was decided for it, and why.

## Supported clients

| Client | Status |
| --- | --- |
| Native iOS app (`apps/ios`, TestFlight) | Supported. Speaks contract 2.0.0 from the release that ships MAZ-131 |
| Browser app (`apps/web`, the `penny-web` image) | Supported. Deployed with the API |
| Expo web and mobile, Android | Removed from the repository (#64). No build is supported |

An iOS build older than contract 2.0.0 still works for everything except receipt uploads, which answer `400 Update Penny to upload receipts.` Install the current TestFlight build.

## Decisions

| Item | Decision | Reason |
| --- | --- | --- |
| Receipt uploads as JSON `{name, mime, base64}`, with Node `Buffer.from` lenient decoding | **Replaced** (contract 2.0.0) | The file is now the request body, its type is `Content-Type` and its name is an RFC 8187 `Content-Disposition`. See [receipts](receipts.md#upload-checks-in-order) and the measurements below |
| Download `Content-Disposition` as JavaScript `encodeURIComponent` | **Simplified** | `Uri.EscapeDataString` (RFC 3986 unreserved characters only). `encodeURIComponent` left `' ( ) *` literal, which RFC 8187 does not allow. The browser app ignores the header, and the iOS app's percent-decoding reads either form |
| No request timeout on receipt operations (`[DisableRequestTimeout]`) | **Kept** | A 10 MiB file on a slow mobile link still takes longer than 30 seconds. Kestrel's minimum data rates still end stalled transfers |
| Receipt downloads are `no-store` | **Kept** | Access changes when someone leaves a household, and neither client relies on HTTP caching ([receipts](receipts.md#clients)) |
| Ledger v1–v3 upgrades and pre-v3 guards | **Removed** in #64 | `PUT /api/ledger` accepts version 4 only |
| Whole-ledger sync on every save | **Kept for now** | Smaller or per-entity sync changes the offline merge model on both clients. That is a separate design, not a compatibility cleanup. Not measured here |
| Legacy English messages and check order, `{error: string}` | **Kept for now** | Both clients show these messages directly. Structured error codes need a contract change in every client. Do it as its own change |
| A non-JSON body counts as no body (`LedgerBody`, `JsonStringFields`), and `400 Invalid request` for request parse failures | **Kept** | No supported client sends a non-JSON body to these endpoints. Changing the answer to `415` would be a breaking change with no user-visible gain |
| Cookie and bearer sessions | **Kept** | The browser app uses the HttpOnly cookie and the iOS app uses the bearer token. Both are current |
| Malformed `Authorization` header falls back to the cookie | **Kept** | Neither client sends both credentials: iOS turns cookies off and the browser never sends `Authorization`. The rule costs nothing and has no effect on current clients |
| Legacy scrypt password hashes and their reset path | **Removed** before MAZ-131 | Passwords are ASP.NET Core Identity hashes. Resets use `reset-password EMAIL` ([authentication](authentication.md#password-reset-maz-123)) |
| SQLite import commands and the `sqlite_import` checkpoint table | **Removed** in #64 | `PreSquashUpgrade` drops the table when it upgrades a database from before the squash |
| `PreSquashUpgrade` (pre-squash databases in `migrate`) | **Kept** | Remove it only once every deployment has run `migrate` since the squash. The operator has to confirm that; the code cannot check it |
| Read-time redaction of audit snapshots (`AuditRedaction`) | **Kept** | Imported audit rows may still hold a payer `accountId` or receipt name. Redacting on read keeps every response the same, whatever wrote the row. A one-time data migration could replace it later |
| `legacy` markers in `contracts/openapi.json` | **None left** | |

## Receipt upload measurements

Measured on one 10 MiB PDF uploaded six times through the real API (`WebApplicationFactory` host, PostgreSQL 18, encrypted store), in process. Allocations include the test client's send.

| | Before (base64 JSON) | After (raw body) | Change |
| --- | --- | --- | --- |
| Request body | 15,073,358 bytes | 10,485,760 bytes | −30% |
| Managed allocations per upload | 146.5 MiB | 30.2 MiB | −79% |
| Time per upload (steady state) | 184–241 ms | 58–84 ms | about 3× faster |

The server now reads the body once into a buffer sized from `Content-Length`. Before, it buffered the JSON text, parsed it into a document, copied the base64 string and then decoded it. The browser app sends the `File` itself, so it no longer reads the file into a base64 data URL first. The iOS app no longer base64-encodes the file into a JSON body.
