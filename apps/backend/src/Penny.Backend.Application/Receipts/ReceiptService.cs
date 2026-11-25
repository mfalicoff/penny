using System.Security.Cryptography;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Receipts;

// Receipt upload and download (MAZ-60, raw-body uploads since MAZ-131). Messages and
// check order are part of the client contract; see docs/reference/receipts.md.
public sealed class ReceiptService(IReceiptRepository receipts, TimeProvider clock)
{
    public const string InvalidUpload = "Choose a photo or PDF smaller than 10 MB.";
    public const string UnsupportedFile =
        "This file is not a supported photo or PDF, or exceeds 10 MB.";
    public const string NotFound = "Receipt not found.";
    public const string OutdatedClient = "Update Penny to upload receipts.";

    public async Task<StoredReceiptInfo> UploadAsync(
        string userId,
        ReceiptUpload upload,
        CancellationToken cancellationToken
    )
    {
        // An app from before MAZ-131 still sends the old base64 JSON body.
        if (upload.Mime == "application/json")
            throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.ReceiptOutdatedClient,
                OutdatedClient
            );
        // Both checks keep the one legacy message; the code tells them apart.
        if (
            upload.Mime is not { } mime
            || !ReceiptFormat.Mimes.Contains(mime, StringComparer.Ordinal)
        )
            throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.ReceiptUnsupportedType,
                InvalidUpload
            );
        if (
            upload.Name is not { } name
            || name.Length is 0 or > ReceiptFormat.MaxNameLength
            || !LedgerText.IsStorable(name)
        )
            throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.ReceiptInvalidName,
                InvalidUpload
            );
        if (upload.Content is null or { Length: > ReceiptFormat.MaxBytes })
            throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.ReceiptTooLarge,
                UnsupportedFile
            );
        if (upload.Content is not { } content || !ReceiptFormat.IsAcceptable(mime, content))
            throw new BackendFailure(
                FailureKind.Invalid,
                ErrorCodes.ReceiptUnsupportedFile,
                UnsupportedFile
            );
        var id = RandomNumberGenerator.GetHexString(32, lowercase: true);
        await receipts.CreateAsync(
            userId,
            new StoredReceipt(id, name, mime, content),
            clock.GetUtcNow(),
            cancellationToken
        );
        return new(id, name, mime);
    }

    public async Task<StoredReceipt> ReadAsync(
        string userId,
        string receiptId,
        CancellationToken cancellationToken
    ) =>
        // A path id PostgreSQL cannot hold (NUL, lone surrogate) matches no receipt.
        (
            LedgerText.IsStorable(receiptId)
                ? await receipts.ReadVisibleAsync(userId, receiptId, cancellationToken)
                : null
        ) ?? throw new BackendFailure(FailureKind.NotFound, ErrorCodes.ReceiptNotFound, NotFound);
}
