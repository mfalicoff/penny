using System.Security.Cryptography;
using System.Text.Json;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Receipts;

// Receipt upload and download (MAZ-60). Messages and check order are part of the
// client contract; see docs/reference/receipts.md.
public sealed class ReceiptService(IReceiptRepository receipts, TimeProvider clock)
{
    public const string InvalidUpload = "Choose a photo or PDF smaller than 10 MB.";
    public const string UnsupportedFile =
        "This file is not a supported photo or PDF, or exceeds 10 MB.";
    public const string NotFound = "Receipt not found.";

    // `body` is null when the request had no JSON body (an invalid upload).
    public async Task<StoredReceiptInfo> UploadAsync(
        string userId,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        var (name, mime, base64) =
            Parse(body) ?? throw new BackendFailure(FailureKind.Invalid, InvalidUpload);
        var content = ReceiptFormat.Decode(base64);
        if (!ReceiptFormat.IsAcceptable(mime, content))
            throw new BackendFailure(FailureKind.Invalid, UnsupportedFile);
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
        ) ?? throw new BackendFailure(FailureKind.NotFound, NotFound);

    // The upload body: unknown keys ignored, duplicate keys resolve to the last one.
    // Names must also be storable text.
    private static (string Name, string Mime, string Base64)? Parse(JsonElement? body)
    {
        if (body is not { ValueKind: JsonValueKind.Object } root)
            return null;
        if (
            !root.TryGetProperty("name", out var nameValue)
            || nameValue.ValueKind != JsonValueKind.String
            || !root.TryGetProperty("mime", out var mimeValue)
            || mimeValue.ValueKind != JsonValueKind.String
            || !root.TryGetProperty("base64", out var base64Value)
            || base64Value.ValueKind != JsonValueKind.String
        )
            return null;
        string name,
            mime,
            base64;
        try
        {
            name = nameValue.GetString()!;
            mime = mimeValue.GetString()!;
            base64 = base64Value.GetString()!;
        }
        catch (InvalidOperationException)
        {
            // An escaped lone surrogate cannot be transcoded.
            return null;
        }
        if (
            name.Length is 0 or > ReceiptFormat.MaxNameLength
            || !LedgerText.IsStorable(name)
            || !ReceiptFormat.Mimes.Contains(mime, StringComparer.Ordinal)
            || base64.Length > ReceiptFormat.MaxBase64Length
            || !ReceiptFormat.IsBase64Text(base64)
        )
            return null;
        return (name, mime, base64);
    }
}
