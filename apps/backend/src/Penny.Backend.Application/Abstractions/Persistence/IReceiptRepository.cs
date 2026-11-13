namespace Penny.Backend.Application.Abstractions.Persistence;

public interface IReceiptRepository
{
    // Owner-scoped read.
    Task<StoredReceipt?> ReadAsync(
        string userId,
        string receiptId,
        CancellationToken cancellationToken
    );

    // The receipt when the user owns it or may read it through a household: a live
    // expense links it and the user is a current member of that household, or a
    // former member with a share in that expense (legacy `canReadReceipt`).
    Task<StoredReceipt?> ReadVisibleAsync(
        string userId,
        string receiptId,
        CancellationToken cancellationToken
    );

    // Encrypts and writes the file, then commits its metadata row, so a row never
    // lacks its file. A rejected insert removes the file; an ambiguous failure may
    // leave an unreferenced file for `receipts-sweep`.
    Task CreateAsync(
        string userId,
        StoredReceipt receipt,
        DateTimeOffset createdAt,
        CancellationToken cancellationToken
    );

    // Name and MIME of the user's own receipts among `receiptIds`, without reading
    // the encrypted files. Ids the user does not own are absent from the result.
    Task<IReadOnlyDictionary<string, StoredReceiptInfo>> DescribeAsync(
        string userId,
        IReadOnlyCollection<string> receiptIds,
        CancellationToken cancellationToken
    );
}
