using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Api.Contracts;

// Contract schema `ReceiptInboxPage` (MAZ-184): newest first; `next` is the `before`
// value for the following page, or null. Times are Unix milliseconds.
public sealed record ReceiptInboxPageResponse(
    IReadOnlyList<ReceiptInboxItemResponse> Items,
    string? Next
);

// Contract schema `ReceiptInboxItem`. `from` and `subject` are plain text to display as
// text only. `expiresAt` is null once attached.
public sealed record ReceiptInboxItemResponse(
    string Id,
    string From,
    string Subject,
    long ReceivedAt,
    string Status,
    bool SenderVerified,
    long? ExpiresAt,
    long? AttachedAt,
    IReadOnlyList<ReceiptInboxFileResponse> Files
)
{
    public static ReceiptInboxItemResponse Of(StoredInboxItem item) =>
        new(
            item.Id,
            item.From,
            item.Subject,
            item.ReceivedAt.ToUnixTimeMilliseconds(),
            item.Status,
            item.SenderVerified,
            item.ExpiresAt?.ToUnixTimeMilliseconds(),
            item.AttachedAt?.ToUnixTimeMilliseconds(),
            [
                .. item.Files.Select(file => new ReceiptInboxFileResponse(
                    file.ReceiptId,
                    file.Kind,
                    file.Name,
                    file.Mime,
                    file.SizeBytes,
                    file.Linked,
                    ReceiptLink.UriFor(file.ReceiptId)
                )),
            ]
        );
}

// Contract schema `ReceiptInboxFile`: `kind` is email or attachment; `uri` downloads it.
public sealed record ReceiptInboxFileResponse(
    string ReceiptId,
    string Kind,
    string Name,
    string Mime,
    long SizeBytes,
    bool Linked,
    string Uri
);

// Contract schema `ReceiptInboxCleanup`: files deleted and files kept because an entry
// links them.
public sealed record ReceiptInboxCleanupResponse(int Deleted, int Kept);
