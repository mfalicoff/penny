# Receipts (MAZ-60)

Receipt upload and download (MAZ-60) run on the encrypted file store ([receipt storage](postgresql.md#receipt-storage)). `postApiReceipts` and `getApiReceiptsId` follow `contracts/openapi.json`. Code: `ReceiptsController`, `Application/Receipts/ReceiptService` and `ReceiptFormat`, `PostgresReceiptRepository`, `Persistence/Receipts/ReceiptMaintenance`.

## Operations

| Operation | Request | Success |
| --- | --- | --- |
| `postApiReceipts` | `POST /api/receipts` with the file as the body, `Content-Type: <mime>` and `Content-Disposition: attachment; filename*=UTF-8''<name>` | `201 {id, name, mime, uri}`; `id` is 32 lowercase hex characters, `uri` is `/api/receipts/<id>` |
| `getApiReceiptsId` | `GET /api/receipts/{id}` | `200` with the original bytes |

Both require a session (cookie or bearer); `POST` also passes the origin check for non-GET requests. The `uri` is the same path a ledger entry or shared expense returns for the receipt, so existing receipt URLs keep working.

### Upload checks, in order

| Check | Failure |
| --- | --- |
| Request body at most `Backend__MaxRequestBodyBytes` (20 MB); a declared `Content-Length` is checked first, a chunked body while it is read | `413 The upload is too large.` |
| Origin, then session | `403`, `401 Please sign in to continue.` |
| A JSON body (`Content-Type: application/json`): the base64 upload of apps from before contract 2.0.0 | `400 Update Penny to upload receipts.` |
| Headers: `Content-Disposition` carries exactly one `filename*=UTF-8''…` parameter whose percent-decoded bytes are valid UTF-8 and give a storable name of 1–255 UTF-16 units; `Content-Type` is one of `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/heic`, `image/heif` (case-insensitive, parameters ignored, stored lowercase). The disposition type and a plain `filename` parameter are ignored | `400 Choose a photo or PDF smaller than 10 MB.` |
| Body size 1 byte to 10 MiB (10,485,760 bytes) and the signature of the declared type: `%PDF-`; JPEG `FF D8 FF`; PNG's 8-byte signature; `GIF87a`/`GIF89a`; WebP `RIFF`…`WEBP` in the first 12 bytes; HEIC/HEIF `ftyp` at offset 4 | `400 This file is not a supported photo or PDF, or exceeds 10 MB.` |

The body is the file itself, read once into a buffer sized from `Content-Length` (MAZ-131). A body over 10 MiB but within the request limit is read to the end and discarded before the 400, so clients that send the whole body before reading the response see the message rather than a reset. The name accepts the characters JavaScript `encodeURIComponent` leaves literal (`' ( ) * !`) as well as their RFC 8187 escapes. There is no multipart or resumable upload.

Before contract 2.0.0 the body was JSON `{name, mime, base64}` with Node-style lenient base64; [legacy compatibility](legacy-compatibility.md) records why it changed and what it measured.

### Download

- `Content-Type` is the stored MIME type; `Content-Length` is the plaintext size.
- `Content-Disposition: inline; filename*=UTF-8''<name>` where `<name>` is the RFC 8187 encoding of the uploaded name: RFC 3986 unreserved characters (`A–Z a–z 0–9 - . _ ~`) kept, every other UTF-8 byte as uppercase `%XX`.
- `Content-Security-Policy: default-src 'none'; sandbox`, plus the API-wide `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- A receipt that does not exist or that the caller may not read is `404 Receipt not found.`, with no difference between the two. A URL path containing an encoded NUL is refused by Kestrel with `400` before routing.

## Access

Every read and link is authorized in PostgreSQL in the same statement that loads the receipt row, so a membership change committed before the request is always honoured.

- **Owner:** the uploader can always read their receipt.
- **Household:** another user can read it when a live (not deleted) shared expense links it and they are a current member of that expense's household, or a former member who has a share in that expense. The rule is evaluated over membership periods. Archived households keep their readers. Deleting the last linking expense, or leaving before the expense was recorded, withdraws access. Recurring rules alone grant nothing.
- **Linking:** a personal ledger entry may reference only the user's own receipts (`400 Receipt does not belong to this account.`). A shared expense or rule may reference the actor's own receipt or one already linked by a live expense of the same household (`400 Receipt is not available to this household.`). There is no receipt list or delete endpoint.

Responses and logs never contain storage paths, file names on disk, keys or nonces.

## Receipt text (MAZ-125)

The upload also queues the receipt's text extraction (a `pending` `receipt_texts` row in the same insert). A background worker extracts it on the server only (poppler for PDF text, Tesseract for photos and scans), never delaying or failing the upload. The extracted text is stored unencrypted so search can index it, and it matches only for users who may read the receipt under the access rules above (`ReceiptAccess.Readable`, shared with downloads). When the last entry, shared expense or rule linking a receipt lets go of it, its text is deleted in the same transaction. See [operations](../self-hosting/operations.md#receipt-text-ocr) and [search](search.md#receipt-text-maz-125).

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

## Proxies and timeouts

- Allow request bodies of at least 20 MB on the reverse proxy for `/api/receipts` (nginx `client_max_body_size 20m`; Caddy and Traefik do not limit bodies by default). A proxy limit below that turns large uploads into the proxy's own 413 page instead of the JSON error.
- The receipt operations are exempt from the 30-second `Backend__RequestTimeoutSeconds` deadline, because a 10 MiB file on a slow mobile link takes longer. Kestrel's minimum request and response data rates (240 bytes/s after a 5-second grace) still end stalled transfers, and database commands keep their own timeout. Proxy read/send timeouts should be at least as generous as the slowest expected upload.

## Clients

Clients fetch `/api/receipts/<id>` with their session and display the bytes locally; they do not depend on `Content-Disposition`, CSP or HTTP caching. HEIC/HEIF previews depend on the platform: iOS renders them, most desktop browsers do not and show the download fallback. The browser app (MAZ-94) uses its session cookie: it checks the file against the rules above before uploading, sends the file as the body over `XMLHttpRequest` for upload progress, and previews photos from a blob URL and PDFs with pdf.js; see [browser receipts](../web/receipts.md). The native app (MAZ-78) applies the same checks, uploads with progress over its bearer session and previews from a protected temporary file; see [native receipts](../ios/receipts.md).

## Behavior notes

- **No ETag/304.** Responses are `no-store` and the clients never revalidate.
- **Storable names.** A filename with NUL or an unpaired UTF-16 surrogate is rejected with the schema message, like other storable-text rules ([households](households.md)).
- **No request deadline** on the two receipt operations (see above), unlike the other endpoints.

## Tests

- `ReceiptFormatTests` (unit): every signature and size boundary, the upload name header (RFC 8187 decoding, strict UTF-8, repeated or malformed parameters) and the download encoding.
- `ReceiptFileStoreTests` (unit, MAZ-94): AES-GCM round trip, fresh salts, nonces and paths per file, tampered ciphertext, a row claiming another owner or id (associated data), files swapped between rows, a different master key and an unknown `encryption_version` all fail to open.
- `ReceiptTests` (real HTTP and PostgreSQL):
  - every format round-trips with SHA-256 checksums and ciphertext at rest;
  - exact download headers;
  - `encodeURIComponent`-style names, media type case and parameters;
  - every header/signature failure with its message and nothing stored, and the outdated-app JSON body;
  - the 10 MiB file limit (declared and chunked) and the 20 MB request limit on a production-sized host;
  - unauthorized reads;
  - shared access across membership changes and expense deletion;
  - cross-account attachment;
  - failed metadata writes (file removed), failed file writes (no row), and missing/tampered files.
- `ReceiptMaintenanceTests`: PostgreSQL dump/restore with the receipt root, and `receipts-verify`/`receipts-sweep` as separate processes.
