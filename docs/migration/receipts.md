# Receipts (MAZ-60)

MAZ-60 ports receipt upload and download (`server/http/receipts.ts`, `server/application/receipts.ts`, `server/validation/receipts.ts`) to .NET on top of the encrypted file store from MAZ-52 ([receipt storage](postgresql.md#receipt-storage)). The contract operations `postApiReceipts` and `getApiReceiptsId` keep their operation IDs and stay `legacy` in the shared contract while Node serves production. Code: `ReceiptsController`, `Application/Receipts/ReceiptService` and `ReceiptFormat`, `PostgresReceiptRepository`, `Persistence/Receipts/ReceiptMaintenance`.

## Operations

| Operation | Request | Success |
| --- | --- | --- |
| `postApiReceipts` | `POST /api/receipts` with JSON `{name, mime, base64}` | `201 {id, name, mime, uri}`; `id` is 32 lowercase hex characters, `uri` is `/api/receipts/<id>` |
| `getApiReceiptsId` | `GET /api/receipts/{id}` | `200` with the original bytes |

Both require a session (cookie or bearer); `POST` also passes the origin check for non-GET requests. The `uri` is the same path a ledger entry or shared expense returns for the receipt, so existing and imported receipt URLs keep working.

### Upload checks, in order

| Check | Failure |
| --- | --- |
| Request body at most `Backend__MaxRequestBodyBytes` (20 MB, the legacy `express.json` limit); a declared `Content-Length` is checked first, a chunked body while it is read | `413 The upload is too large.` |
| Origin, then session | `403`, `401 Please sign in to continue.` |
| JSON syntax; a top-level scalar is malformed too | `400 Invalid JSON.` |
| Schema (zod `receiptUploadSchema`): a JSON object whose `name` is a string of 1–255 UTF-16 units, `mime` is one of `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/heic`, `image/heif` (exact, case-sensitive), and `base64` is at most 14,680,064 characters of `[A-Za-z0-9+/]` followed by at most two `=`. Unknown keys are ignored and the last duplicate key wins. A non-JSON content type or an empty body fails here | `400 Choose a photo or PDF smaller than 10 MB.` |
| Decoded size 1 byte to 10 MiB (10,485,760 bytes) and the signature of the declared type: `%PDF-`; JPEG `FF D8 FF`; PNG's 8-byte signature; `GIF87a`/`GIF89a`; WebP `RIFF`…`WEBP` in the first 12 bytes; HEIC/HEIF `ftyp` at offset 4 | `400 This file is not a supported photo or PDF, or exceeds 10 MB.` |

Base64 decoding follows Node's `Buffer.from(text, "base64")` for text that passes the pattern: padding is optional, a final lone character is ignored and unused low bits are dropped, so every upload the legacy server accepted decodes to the same bytes. The pattern rejects whitespace, line breaks and the URL-safe alphabet, as before.

A base64 string of 14 MiB characters decodes to about 10.5 MB, so the 10 MiB decoded check is the effective limit; the JSON envelope keeps the request under 20 MB. Clients send the whole file in one JSON request: there is no multipart or resumable upload.

### Download

- `Content-Type` is the stored MIME type; `Content-Length` is the plaintext size.
- `Content-Disposition: inline; filename*=UTF-8''<name>` where `<name>` is JavaScript `encodeURIComponent` of the uploaded name (unreserved `A–Z a–z 0–9 - _ . ! ~ * ' ( )` kept, every other UTF-8 byte as uppercase `%XX`), byte-for-byte the legacy header.
- `Content-Security-Policy: default-src 'none'; sandbox`, plus the API-wide `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- A receipt that does not exist or that the caller may not read is `404 Receipt not found.`, with no difference between the two. A URL path containing an encoded NUL is refused by Kestrel with `400` before routing.

## Access

Every read and link is authorized in PostgreSQL in the same statement that loads the receipt row, so a membership change committed before the request is always honoured.

- **Owner:** the uploader can always read their receipt.
- **Household:** another user can read it when a live (not deleted) shared expense links it and they are a current member of that expense's household, or a former member who has a share in that expense. This is the legacy `canReadReceipt` rule over membership periods. Archived households keep their readers. Deleting the last linking expense, or leaving before the expense was recorded, withdraws access. Recurring rules alone grant nothing.
- **Linking:** a personal ledger entry may reference only the user's own receipts (`400 Receipt does not belong to this account.`). A shared expense or rule may reference the actor's own receipt or one already linked by a live expense of the same household (`400 Receipt is not available to this household.`). There is no receipt list or delete endpoint.

Responses and logs never contain storage paths, file names on disk, keys or nonces.

## Receipt text (MAZ-125)

The upload also queues the receipt's text extraction (a `pending` `receipt_texts` row in the same insert). A background worker extracts it on the server only (poppler for PDF text, Tesseract for photos and scans), never delaying or failing the upload. The extracted text is stored unencrypted so search can index it, and it matches only for users who may read the receipt under the access rules above (`ReceiptAccess.Readable`, shared with downloads). When the last entry, shared expense or rule linking a receipt lets go of it, its text is deleted in the same transaction. See [operations](../operations.md#receipt-text-ocr) and [search](search.md#receipt-text-maz-125).

## Storage, failures and recovery

Bytes and the original filename are sealed with AES-256-GCM under a per-file HKDF key ([receipt storage](postgresql.md#receipt-storage)). An upload writes in this order:

1. Encrypt, write a temporary file (mode 0600), fsync, rename without overwriting to `xx/<32 hex>`.
2. Insert the `receipts` row.

So a row never exists without its file. If PostgreSQL rejects the insert, the file is deleted and the request fails with `500`. If the outcome is ambiguous (connection lost during commit), the file is kept and `receipts-sweep` removes it later if no row references it. A file-write failure (full disk, unwritable root) fails with `500` and writes no row. A missing or tampered file makes the download `500 The server could not complete this request.` with no partial body; the log records only the exception type and trace ID.

### Commands

Both use the runtime connection (`ConnectionStrings__Postgres`) and `Receipts__Root`/`Receipts__MasterKey`, never start HTTP and print a JSON report of counts only on stdout.

```sh
bash apps/backend/dotnet.sh run --project src/Penny.Backend.Api -- receipts-verify
bash apps/backend/dotnet.sh run --project src/Penny.Backend.Api -- receipts-sweep --dry-run
bash apps/backend/dotnet.sh run --project src/Penny.Backend.Api -- receipts-sweep
```

- `receipts-verify` decrypts every receipt's file and name and checks the stored size. It reports `{Receipts, Verified, Missing, Corrupt, Unreferenced, Bytes}` and exits 0 when no file is missing or corrupt, 2 otherwise. Unreferenced files are reported but are not an error.
- `receipts-sweep [--dry-run]` deletes files in the store layout that no row references (including leftover `*.tmp-*` writes) once they are more than an hour old. Younger files may belong to an upload that has not committed yet. Files outside the layout are never touched. It reports `{Examined, Removed, DryRun}`.

### Backup and restore

Receipt metadata lives in PostgreSQL and the bytes on the filesystem, so a backup needs both, plus the master key kept separately in the secret manager.

1. Dump the database first, then copy `Receipts__Root`. Files are written before their rows and never modified or deleted by the API, so every row in the dump has its file in the later copy. The copy may hold extra files from uploads after the dump.
2. To restore, restore the database and the receipt root together with the service stopped, keeping the same master key, then run `receipts-verify` (expect exit 0). Run `receipts-sweep` afterwards to drop files for receipts the restored database no longer knows about.
3. Do not run `receipts-sweep` against a root while a different, newer database is restoring: it would delete files that database still references.

`import-sqlite --verify` already compares every imported receipt's id, owner, decrypted name, MIME, size and SHA-256 with the SQLite source. `ImportedReceiptTests` additionally downloads the imported receipt over HTTP at its legacy `/api/receipts/receipt` URL with imported sessions (owner and a former member sharing the linked expense) and checks the bytes.

## Proxies and timeouts

- Allow request bodies of at least 20 MB on the reverse proxy for `/api/receipts` (nginx `client_max_body_size 20m`; Caddy and Traefik do not limit bodies by default). A proxy limit below that turns large uploads into the proxy's own 413 page instead of the JSON error.
- The receipt operations are exempt from the 30-second `Backend__RequestTimeoutSeconds` deadline, because a 20 MB body on a slow mobile link takes longer. Kestrel's minimum request and response data rates (240 bytes/s after a 5-second grace) still end stalled transfers, and database commands keep their own timeout. Proxy read/send timeouts should be at least as generous as the slowest expected upload.

## Clients

The Expo clients upload with `saveReceipt` (`src/data/receipts*.ts`): native reads the picked file as base64, web uses `FileReader` data URLs. To preview, they fetch `/api/receipts/<id>` with their session and display the bytes locally: a cache file on native (image view or the platform PDF viewer) and a blob URL on web (`<img>` or pdf.js). They do not depend on `Content-Disposition`, CSP or HTTP caching. HEIC/HEIF previews depend on the platform: iOS renders them, most desktop browsers do not and show the download fallback. The v2 browser app (MAZ-94) does the same with its session cookie: it checks the file against the rules above before uploading, sends the JSON body over `XMLHttpRequest` for upload progress, and previews photos from a blob URL and PDFs with pdf.js; see [browser receipts](../web-receipts.md). Native receipt UI is MAZ-78.

## Deliberate differences from Node

- **No ETag/304.** Express added a weak `ETag` and answered `If-None-Match` with 304. Responses are `no-store` and the clients never revalidate, so .NET sends neither.
- **Storable names.** A filename with NUL or an unpaired UTF-16 surrogate is rejected with the schema message, like other storable-text rules ([households](households.md)). Node stored either; with a lone surrogate, `encodeURIComponent` then threw and the download failed with 500. The SQLite import already refuses both.
- **No request deadline** on the two receipt operations (see above); Node had none either, unlike the other .NET endpoints.
- **Bytes at rest** are encrypted files rather than SQLite BLOBs; ids, URLs, names, MIME types and plaintext bytes are unchanged.

## Tests

- `ReceiptFormatTests` (unit): the base64 pattern, Node-compatible decoding, every signature and size boundary, and `encodeURIComponent` parity.
- `ReceiptFileStoreTests` (unit, MAZ-94): AES-GCM round trip, fresh salts, nonces and paths per file, tampered ciphertext, a row claiming another owner or id (associated data), files swapped between rows, a different master key and an unknown `encryption_version` all fail to open.
- `ReceiptTests` (real HTTP and PostgreSQL):
  - every format round-trips with SHA-256 checksums and ciphertext at rest;
  - exact download headers;
  - unpadded and dangling base64;
  - every schema/signature failure with legacy messages and nothing stored;
  - the 10 MiB decoded, 14 MiB text and 20 MB request limits on a production-sized host;
  - unauthorized reads;
  - shared access across membership changes and expense deletion;
  - cross-account attachment;
  - failed metadata writes (file removed), failed file writes (no row), and missing/tampered files.
- `ReceiptMaintenanceTests`: PostgreSQL dump/restore with the receipt root, and `receipts-verify`/`receipts-sweep` as separate processes.
- `ImportedReceiptTests`: SQLite import, then HTTP download.
