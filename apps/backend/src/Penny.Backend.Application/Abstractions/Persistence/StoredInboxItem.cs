namespace Penny.Backend.Application.Abstractions.Persistence;

// One receipt inbox item with its text opened (MAZ-184). `ExpiresAt` is the effective
// deadline (null once attached); files are in display order, the rendered email first.
public sealed record StoredInboxItem(
    string Id,
    string From,
    string Subject,
    DateTimeOffset ReceivedAt,
    string Status,
    bool SenderVerified,
    DateTimeOffset? ExpiresAt,
    DateTimeOffset? AttachedAt,
    IReadOnlyList<StoredInboxFile> Files
);

public sealed record StoredInboxFile(
    string ReceiptId,
    string Kind,
    string Name,
    string Mime,
    long SizeBytes,
    bool Linked
);

// What a discard or Done removed: unlinked files deleted, linked files kept.
public sealed record InboxCleanup(int Deleted, int Kept);
