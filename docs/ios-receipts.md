# Native receipts (MAZ-78)

[Native app](../apps/ios/README.md) · [Native entries](ios-entries.md) · [Receipt API](migration/receipts.md) · [Browser receipts](web-receipts.md)

The iPhone and iPad app attaches a photo or PDF receipt to an expense, uploads it with progress, previews it and shares it. The server side is the MAZ-60 receipt API over the encrypted file store; nothing about its contract changed. The rules and messages match the browser app (MAZ-94).

## Where the code is

| Piece | File | Tests |
| --- | --- | --- |
| File rules: types, signatures, size, names, served links | `PennyData/Receipts/ReceiptRules.swift` | `ReceiptRulesTests` |
| Upload and download for the signed-in account; a 401 ends the session | `PennyData/Receipts/ReceiptTransfers.swift` (`AccountReceipts`) | `AccountReceiptsTests` |
| Upload state: progress, cancel, Try again, refusals | `PennyData/Receipts/ReceiptUploadModel.swift` | `ReceiptUploadModelTests` |
| Viewer state, temporary files and cleanup | `PennyData/Receipts/ReceiptPreviewModel.swift` (`ReceiptPreviewModel`, `ReceiptFileCache`) | `ReceiptPreviewModelTests` |
| Upload progress from the network | `PennyData/API/Transport.swift` (`send(_:progress:)`), `APIClient.uploadReceipt(…progress:)` | `ReceiptUploadProgressTests` |
| System photo picker and file picker | `PennyUI/Receipts/ReceiptPickers.swift` | `ReceiptViewTests`, `ReceiptJourneyTests` |
| Receipt group in More details, upload row | `PennyUI/Receipts/ReceiptSection.swift` | `ReceiptJourneyTests` |
| Receipt viewer (photo, PDF, Share, Remove) | `PennyUI/Receipts/ReceiptPreviewView.swift` | `ReceiptJourneyTests` |
| Xcode previews of the cards | `PennyUI/Receipts/ReceiptSpecimens.swift` | |

`ShellModel.receipts` is the account's `AccountReceipts` (set in `AuthGate`); it is nil in the demo and previews. The viewer (`ReceiptPreviewView` with `receiptViewer(_:)`) takes any `ReceiptReference`, so the shared expense screens (MAZ-75) can open it the same way.

## Supported files and limits

| | |
| --- | --- |
| Types | PDF, JPEG, PNG, WebP, GIF, HEIC and HEIF. The file picker offers only these. A file's type comes from its extension; a photo's from its first bytes, because the photo library doesn't give a reliable name. |
| Size | 1 byte to 10 MiB (10,485,760 bytes), the decoded limit the server enforces. The size is read from the file system first, so a larger file is refused without being read into memory. |
| Signature | The first bytes must match the type: `%PDF-`, JPEG `FF D8 FF`, the PNG signature, `GIF87a`/`GIF89a`, WebP `RIFF`…`WEBP`, HEIC/HEIF `ftyp` at offset 4. A renamed file is refused. |
| Name | Control characters removed, trimmed, "receipt.<ext>" when empty, and at most 255 UTF-16 units, shortened keeping its extension. |
| One per entry | An expense links at most one receipt. Income and investments have none: switching type keeps the receipt in the draft, but only an expense saves it. |

Refusals say what to do next and send nothing:

| Refusal | Message |
| --- | --- |
| Empty | This file is empty. Choose a photo or PDF. |
| Over 10 MiB | This file is larger than 10 MB. Choose a smaller photo or PDF. |
| Not a receipt type | Penny can attach photos (JPEG, PNG, WebP, GIF, HEIC) and PDFs. Choose one of those. |
| Wrong signature | This file isn't a valid photo or PDF. It may be damaged or renamed. Choose another file. |
| Can't be read | Penny couldn't read this file. Choose it again. |
| Access refused | Penny wasn't allowed to open this file. Choose it again, or save a copy to On My iPhone in Files first. |

## Permissions and privacy

- **No permission prompts.** The photo picker (`PhotosPicker`) and the file picker (`fileImporter`) run outside Penny's process and hand over only the item the person chose. Penny never reads the photo library or Files by itself, so it needs no `NSPhotoLibraryUsageDescription` or other usage string, and there is no library permission to deny. Limited photo access settings don't matter either.
- **What can still be refused** is reading the chosen item: an iCloud photo that can't download ("couldn't read"), or a file provider or security scope that refuses access ("wasn't allowed to open"). The file picker's file is read inside its security scope, which is released straight after.
- **No camera.** Taking a photo in Penny isn't offered; people take it with the Camera app and pick it. A camera capture would need `NSCameraUsageDescription` and a new App Store privacy answer.
- **Privacy manifest:** unchanged. Reading a picked file's size is not a required-reason API (only disk space and file timestamps are).
- **On the device:** a picked file is copied to Penny's temporary folder, checked, and removed again once read. The receipt's bytes stay in memory in the open entry form (so it can be previewed offline right after the upload) and are dropped when the form closes. The viewer writes the receipt to `tmp/PennyReceipts/<random>/<name>` with complete file protection (unreadable while the device is locked), and removes it when it closes. Everything left there (a crash, an account change) is removed at launch and whenever the signed-in account changes. Temporary files are never backed up.
- **On the server:** encrypted at rest; the app never sees keys or storage paths ([browser receipts](web-receipts.md#encryption-and-key-configuration)).

## Attaching a receipt

Add entry › Receipt, repeat, trip (More details) has a **Receipt** group (cards `entry-extras` and `receipt-upload`):

- **Photo** opens the system photo picker (images only, original encoding: a HEIC photo stays HEIC); **File or PDF** opens the file picker (Files, iCloud Drive and other providers). With a receipt attached they read "Replace with photo" / "Replace with a file or PDF" to VoiceOver.
- **Reading:** while a chosen item is copied and checked the row says "Reading the file…".
- **Upload:** the file is sent as the API's JSON body (`{name, mime, base64}`) over the account's `APIClient`. The row shows the name, a progress bar of the bytes sent ("Uploading… 46%", read out as a percentage) and **Cancel upload** (×). The upload belongs to the form, not to the page: going back to the form keeps it running. **Save waits:** pressing Save during an upload saves nothing and the form says "The receipt is still uploading".
- **Done:** the row shows the name, "Photo · 1.2 MB" or "PDF · 1 KB", and × to remove it. Tapping the row opens the viewer with the bytes just sent, so it works offline too.
- **Failures keep the draft** and the receipt already attached. A network or server failure (offline, timeout, 5xx, 503) offers **Try again** with the same file; a refused file (the rules above, or the server's 400/413) offers **Dismiss** only. Choosing another file replaces an upload in flight. A late answer from a cancelled or replaced upload is ignored.
- **Ended session:** a 401 ends the session the usual way (sign-in with "Your session ended"). The unsaved entry is on the draft shelf (stored per account, [native entries](ios-entries.md#failures-and-drafts)), so after signing in again Add entry says "Your unsaved entry is back" with every value as typed.
- **Offline:** the buttons are disabled and the footer says to connect (`LedgerSyncModel.canUseOnlineOnlyActions`: online, signed in, not signing out, session not expired). The rest of the entry still saves offline, and a receipt uploaded earlier stays linked in the draft and syncs with the entry.
- **The demo** has no server: the footer says receipts need an account.
- **Removing** (× or the viewer's trash) unlinks the receipt when the entry is saved. The encrypted file stays on the server: there is no receipt delete endpoint, as in the legacy app and the browser. The same applies to a file uploaded into a draft that is then discarded.
- **Closing the form** (Discard, Keep as draft, or a deep link replacing it) cancels an upload in flight; nothing is attached.
- **Ownership:** an upload belongs to the signed-in account. A personal entry can link only its owner's receipts; the server refuses anything else on save.

## The viewer

The entry detail's **Split and receipt** section shows the receipt as a row (name, Photo or PDF); tapping it opens the viewer (card `receipt`). More details opens it from the attached row.

1. The receipt is fetched with `GET /api/receipts/{id}` and the account's bearer token (no token in a URL), then written to a temporary file. A receipt the form just uploaded is shown from its bytes, without a download.
2. A **photo** fits the screen; pinch or double-tap to zoom, drag to pan when zoomed. A **PDF** is drawn by PDFKit as one scrolling column with the page count ("2 pages"); links inside it do nothing.
3. **Share** (the system share sheet) shares the temporary file, so Save to Files, AirDrop, Print and "Open in…" another app get the original bytes under the original name.
4. **Remove** (trash) is shown only from the form; the entry detail is read-only (Edit the entry to remove it).
5. Under the receipt, a card names the entry: category icon, title, total and date.

States:

| State | Shown | Next step |
| --- | --- | --- |
| Loading | "Loading the receipt…" | |
| 404 (missing, or this account may not read it; the API doesn't tell them apart) | "This receipt isn't available. It may have been removed, or you no longer have access to it." | None |
| Offline, timeout | "Penny can't reach the server, so the receipt can't be shown. Try again when you're online." | Try again |
| Server error | "Penny couldn't load this receipt. Try again." | Try again |
| 401 | "Your session ended. Sign in again to see this receipt." (the session ends) | Sign in |
| A link the server doesn't serve (attached by the legacy native app, not `/api/receipts/…`) | Shown by name only | None |
| A photo iOS can't decode | "This photo can't be shown", Share kept | Share |
| A damaged or password-protected PDF | "This PDF can't be shown", Share kept | Share |

**Cleanup:** closing the viewer cancels a download in flight and removes the temporary file. Share is only offered once the file exists.

**Private and shared access:** the server decides. The owner can always read a receipt; a household member can read one linked by a live shared expense of a household they belong to (or belonged to, with a share in that expense). Anyone else gets the same 404 as for a missing receipt ([access](migration/receipts.md#access)).

**App lock:** the lock cover is its own window above every sheet and full-screen cover, so the viewer, the pickers and the share sheet are hidden while Penny is locked, and the form underneath (with its upload) stays as it was.

## Accessibility

- Dynamic Type throughout; the upload row and buttons wrap at accessibility sizes. Buttons are at least 44 pt.
- The attached row reads as one element ("receipt.pdf, PDF · 1 KB", hint "Opens the receipt"); the progress bar reads "Uploading receipt.pdf, 46%".
- The viewer's photo is an image element ("Receipt photo"); the PDF says how many pages it has.
- Identifiers (`AccessibilityID.Receipt`): `screen.receipt`; `entryForm.details`, `entryForm.receiptUploading`; `entryExtras.{receipt,removeReceipt,receiptPhoto,receiptFile,receiptHint}`; `receiptUpload.{reading,progress,cancel,retry,dismiss,error}`; `entryDetail.receipt`; `receipt.{close,title,share,remove,loading,error,retry,image,pdf,pageCount,undecodable,entry}`.

## Tests

- `ReceiptRulesTests` (PennyData, Mac host): every type's signature, mismatches, unsupported and empty files, the 10 MiB boundary and one byte over, signature sniffing (HEIC and HEIF brands), extensions, name cleanup and UTF-16 shortening, byte formatting, served links, a sparse 10 MiB + 1 file refused before reading, a renamed file, a missing file.
- `ReceiptUploadModelTests`: progress then attach with the size; offline failure and Try again with the same file; 400, 413 and 401 without Try again; a 5xx with it; cancel dropping the late answer; a second file replacing the first; refusals; offline and demo; closing the form cancelling the upload.
- `ReceiptPreviewModelTests`: download into the cache with a SHA-256 match and a safe file name, removal on close; 404, 401, offline and 5xx; legacy links; offline without a download; local bytes; closing during the download; purge leaving other files alone.
- `AccountReceiptsTests` (real `AuthController` over a stub transport): upload mapping, a 401 ending the session, 404 for another account's receipt. `ReceiptUploadProgressTests`: body progress forwarded, empty and oversized files refused before sending.
- `ReceiptViewTests` (PennyUI): the row text, the demo without receipts, the picker's types, the preview PDF.
- `ReceiptJourneyTests` (XCUITest, Full plan, real .NET API and PostgreSQL on clean iPhone and iPad simulators):
  1. photo library → upload → preview from the form → share sheet → save; the server's bytes have the fixture's SHA-256; another account gets 404;
  2. file picker → two-page PDF → save → Activity → entry detail → authenticated download → PDFKit with "2 pages" → share; SHA-256 match;
  3. a 503 on upload → error with Try again → attached, the draft's name intact;
  4. an 11 MB file and a PNG renamed `.pdf` → refused, no Try again, nothing attached;
  5. both pickers cancelled at the largest accessibility text size → nothing changes, amount and name intact;
  6. a 401 during upload → sign-in with the email kept → "Your unsaved entry is back" with the name;
  7. the viewer with a 404 (no Try again), then offline (Try again), then online → the PDF.

### Fixtures

`apps/ios/scripts/receipt-fixtures.mjs` builds the files byte by byte (the same shapes as the browser's `e2e/fixtures/receipts.ts`): a 360×540 PNG, a two-page PDF, a damaged PDF, a PNG named `.pdf`, and a PNG padded to 10 MiB + 1. `ios.sh ui-test` writes them to `.cache/ios/receipt-fixtures/` with `manifest.json` (SHA-256 and size per file) and seeds every UI test simulator: the PNG into the photo library (`simctl addmedia`) and the rest into Files › On My iPhone/iPad (the Files app's `group.com.apple.FileProvider.LocalStorage` container). The tests read the manifest through `PENNY_RECEIPT_FIXTURES`. To run them from Xcode, seed a booted simulator the same way first. Nothing personal is in them.

### Running

```sh
PENNY_UI_ONLY=PennyUITests/ReceiptJourneyTests apps/ios/scripts/ios.sh ui-test full
```

### Physical-device checks

The simulator covers the pickers, upload, preview, sharing and every failure above. These need a device and are not automated:

- picking a photo that is only in iCloud (Optimize Storage) and one taken with the camera, including a large HEIC and a Live Photo;
- picking from iCloud Drive and a third-party file provider, and a provider that refuses access;
- the share sheet's real destinations (AirDrop, Print, Save to Files, Open in another app);
- upload progress and Cancel on a slow cellular connection;
- the app lock (Face ID) covering the viewer and pickers, and VoiceOver on the viewer.

## Not done

- No camera capture inside Penny (pick from the photo library instead).
- No document scanning (VisionKit) or OCR; receipt text search is MAZ-125.
- HEIC photos are uploaded as HEIC; browsers other than Safari show them as a download (`web-receipts.md`).
- The redesign baseline's `iphone-receipt` state (`contracts/fixtures/redesign-states.json`) still waits for a seeded receipt in `full-stack-seeds.json` (MAZ-122).
