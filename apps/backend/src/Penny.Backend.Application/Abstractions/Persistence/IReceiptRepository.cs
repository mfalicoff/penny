namespace Penny.Backend.Application.Abstractions.Persistence;

public interface IReceiptRepository
{
    Task<StoredReceipt?> ReadAsync(
        string userId,
        string receiptId,
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
