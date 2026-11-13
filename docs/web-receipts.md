# Browser receipts (MAZ-94)

The v2 browser app (`apps/web`) attaches receipts to personal expenses and shared expenses, previews them and downloads them. The server side is the MAZ-60 receipt API over the encrypted file store ([receipts](reference/receipts.md), [receipt storage](reference/postgresql.md#receipt-storage)); nothing about its contract changed. Code: `apps/web/src/api/receipts.ts` (checks, upload, download), `apps/web/src/features/receipts/` (`ReceiptField`, `ReceiptPreviewDialog`, `ReceiptLink`, `pdf.ts`), styles in `apps/web/src/design/receipts.css`.

## Supported files and limits

| | |
| --- | --- |
| Types | PDF, JPEG, PNG, WebP, GIF, HEIC and HEIF. The browser's file type is used, or the extension when the browser leaves it blank (common for HEIC). |
| Size | 1 byte to 10 MiB (10,485,760 bytes), the decoded limit the server enforces. |
| Signature | The first bytes must match the type: `%PDF-`, JPEG `FF D8 FF`, the PNG signature, `GIF87a`/`GIF89a`, WebP `RIFF`…`WEBP`, HEIC/HEIF `ftyp` at offset 4. A renamed file is refused. |
| Name | Up to 255 characters; a longer name is shortened, keeping its extension. |
| One per entry | An expense (personal or shared) links at most one receipt. Income and investments have none. |

The browser checks all of these before uploading, with the same rules as `ReceiptFormat` on the server, which checks them again. Refusals say what to do next ("This file is larger than 10 MB. Choose a smaller photo or PDF.") and send nothing.

## Attaching a receipt

Add entry › More details, and the shared expense form, have a **Receipt** group (specimens `entry-extras`, `receipt-upload` and the web `add-entry` drop zone):

- **Photo** and **File or PDF** open the file picker (Photo offers images only). A file can also be dropped on the dashed area. Both buttons are labelled for screen readers ("Attach a photo", "Replace with a file or PDF") and keyboard-reachable; the hidden file inputs are not in the tab order.
- **Upload** sends the file as the API's JSON body (`{name, mime, base64}`) over `XMLHttpRequest`, because `fetch` reports no upload progress. A progress bar shows the bytes sent, with **Cancel upload**. Save waits: pressing it during an upload says so and saves nothing.
- **Failures** keep the draft and the receipt already attached. A network or server failure offers **Try again** with the same file; a refused file offers **Dismiss** only. Dismissing an error, cancelling, removing or finishing an upload returns focus to Photo, unless focus has moved elsewhere meanwhile.
- **Ended session:** a 401 during upload or preview ends the session the usual way (sign-in with "Your session ended"). An unsaved new-entry draft, with its receipt link, survives that, like offline work.
- **Offline:** the buttons are disabled and the hint says to connect; the rest of the entry still saves offline. A receipt uploaded earlier stays linked in the draft and syncs with the entry.
- **The draft:** the receipt is part of the in-memory new-entry draft (`features/entries/drafts.ts`), so Keep draft, Escape and a page change keep it; Save links it; Discard and sign-out drop the link.
- **Removing** unlinks the receipt from the entry when you save. The encrypted file stays on the server: there is no receipt delete endpoint. The same applies to a file uploaded into a draft that is then discarded.
- **Ownership:** an upload belongs to the signed-in account. A personal entry can link only its owner's receipts; a shared expense can link the actor's own upload or one already linked in that household. The server enforces both on save.

## Preview and download

Entry and shared expense details show the receipt's name as a button; the form's attachment row has **Preview**. The preview dialog (specimen `receipt`):

1. fetches `GET /api/receipts/{id}` with the session cookie (same origin, no token in the URL), then shows the bytes locally;
2. shows a **photo** with `<img>` from a `blob:` URL;
3. renders a **PDF** with [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist` 6.4.299, loaded only when a PDF is opened) onto a canvas, one page at a time, sized to the dialog and the screen's pixel ratio, with **Previous page** / **Next page** and "Page 1 of 3". Scripts, forms and links inside a PDF never run;
4. offers **Download**, which saves the original bytes under the original name.

States: a damaged PDF ("This PDF can't be shown", Download kept), a photo the browser can't decode (HEIC/HEIF outside Safari: "This browser can't display this photo format", Download kept), a receipt this account can't read ("This receipt isn't available", no bytes; the API answers 404 for both missing and forbidden receipts), offline or a server error (Try again), and an ended session (sign-in). Receipts linked by anything other than `/api/receipts/…` (a path on another device) are shown by name only.

**Cleanup:** closing the dialog aborts the request if it is still running, destroys the pdf.js document and its worker, cancels a page render in progress, and revokes the photo's `blob:` URL. Download revokes its own URL a second after the click. Leaving the form aborts an upload in flight. Focus returns to the button that opened the preview.

## Deployment: the PDF worker and security headers

- **Worker file.** pdf.js decodes in a module Web Worker. Vite emits it as `/assets/pdf.worker.min-<hash>.js`, same origin and fingerprinted, next to the other bundles. It is deliberately `.js`, not `.mjs`: module workers need a JavaScript `Content-Type`, the front end sends `X-Content-Type-Options: nosniff`, and not every server maps `.mjs`. `npm run build` runs `scripts/verify-dist.ts`, which fails if the worker is missing, is `.mjs`, or isn't referenced from the bundle. Serve `/assets/` like the other fingerprinted files (long cache, `immutable`); no extra route is needed.
- **No WebAssembly, eval or third-party fetches.** pdf.js runs with `useWasm: false` and logs errors only. Zod's eval-based fast path is off (`src/app/zodConfig.ts`, loaded before Zod; `verify-dist` checks the entry imports it first).
- **Content-Security-Policy** for the app's pages (`apps/web/scripts/security-headers.ts`):

  ```
  default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
  ```

  With [browser telemetry](observability.md#web-app-telemetry) on, `connect-src` also lists the configured collector URL, and nothing else.

  `worker-src 'self'` allows the pdf.js worker and `img-src blob:` the photo preview. `style-src 'unsafe-inline'` is there for the design kit's inline SVG icon styles. The NixOS module's nginx sends exactly this header with the SPA (`nix/module.nix`; `tests/security-headers.test.ts` keeps them identical), and `vite preview` sends it too, so the whole Playwright suite runs under it. If you serve `apps/web/dist` from your own proxy, send the same header on `/` and keep `nosniff`. The receipt downloads themselves keep the API's `Content-Security-Policy: default-src 'none'; sandbox`.
- **Body size.** Uploads are JSON with base64, about 14 MB for a 10 MiB file; proxies must accept 20 MB request bodies on `/api/receipts` ([receipts](reference/receipts.md#proxies-and-timeouts)).

## Encryption and key configuration

The API encrypts every receipt before it touches disk; the browser never sees keys or storage paths.

- **Per-file key:** `HKDF-SHA256(master key, salt = 32 random bytes per file, info = "penny/receipt/v1")` gives a 256-bit AES-GCM key. The file body and the original name are sealed with separate random 96-bit nonces and a 128-bit tag.
- **Owner binding:** the associated data is `penny/receipt/v1 ‖ part ‖ user id ‖ receipt id`, so a file or name moved to another row, another owner or another receipt id fails authentication instead of decrypting.
- **Stored per file** (PostgreSQL `receipts`): `key_salt`, `file_nonce`, `name_nonce`, `name_encrypted` and `encryption_version` (scheme 1; added by migration `AddReceiptEncryptionVersion`). Unknown versions are refused. All receipts are encrypted; there is no plaintext version to read.
- **Configuration:** `Receipts__Root` (absolute directory for the encrypted files) and `Receipts__MasterKey` (base64 of 32 random bytes, e.g. `openssl rand -base64 32`) from your secret manager. The NixOS module generates the key on first start unless `receiptKeyFile` is set ([NixOS](nixos.md)). Back up the key separately from the database and files: without it no receipt can be read. The key is never rotated, by decision ([receipt storage](reference/postgresql.md#receipt-storage)). Never commit a real key; the development `.env` and tests use generated throwaway keys.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| "This PDF can't be shown" for every PDF, with a console error about the worker | The worker file isn't served, or is served without a JavaScript type. Check `/assets/pdf.worker.min-*.js` returns 200 with `application/javascript` (or `text/javascript`); rebuild with `npm run build` so `verify-dist` checks it. |
| A console CSP violation naming `worker-src` or `blob:` | The proxy sends a stricter policy than the one above. Use `scripts/security-headers.ts`'s value. |
| "This PDF can't be shown" for one PDF | The file is damaged, truncated or password-protected. Download still returns the original bytes. |
| HEIC photo shows "can't display this photo format" | Expected outside Safari; download it, or export the photo as JPEG. |
| Upload stops with "This file is too large to upload" | A proxy limit below 20 MB answered 413. Raise `client_max_body_size` (nginx) for `/api/receipts`. |
| "This receipt isn't available" | The API answered 404: the receipt was never this account's, or a household change (leaving, the linking expense deleted) withdrew access. |
| Receipt download 500 / `receipts-verify` reports corrupt rows | The file was altered, the row's owner or id changed, or the master key differs from the one that wrote it. Restore the file and keep the original key ([backup and restore](reference/receipts.md#backup-and-restore)). |
| The buttons are disabled | The browser is offline. Connect, then attach; the entry itself can be saved first and edited later. |

## Tests

- `apps/web/tests/receipts.test.tsx` (Vitest, real app over fakes): the type, signature, size and name rules; upload body, progress, 400/401/500/offline and cancel; the draft keeping the receipt; Save held during upload; cancel on close; Try again; offline; removing; preview paging (pdf.js replaced), download and URL revocation, undecodable photo, damaged PDF, 404 and ended session; the shared expense form sending `receiptId`.
- `apps/web/tests/security-headers.test.ts` and `tests/verify-dist.test.ts`: the CSP and the worker/zod-config build checks.
- `apps/web/e2e/receipts.spec.ts` (Playwright, production build under the CSP, Chromium, Firefox and WebKit, desktop and phone): upload, save, reload, preview both pages of a real two-page PDF decoded by pdf.js, download with a SHA-256 match; a PNG decoded by the browser; unsupported, empty, mislabelled and oversized files never uploaded; failed upload and Try again; Cancel; draft kept and receipt removed; a damaged PDF; a receipt the account can't read; an ended session. Fixtures are generated byte by byte in `e2e/fixtures/receipts.ts`.
- `apps/web/e2e/receipts.real.spec.ts` (real .NET API and PostgreSQL, `npm run test:e2e:real -- receipts.real`): the same round trip with checksums through the encrypted store, and another account's 404.
- Backend: `ReceiptFileStoreTests` (round trip, tampered ciphertext, wrong owner or id, swapped files, wrong key, unknown version) and the existing real-PostgreSQL `ReceiptTests`, which also check `encryption_version`.
