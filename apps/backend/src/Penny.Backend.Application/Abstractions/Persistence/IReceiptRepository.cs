namespace Penny.Backend.Application.Abstractions.Persistence;

public interface IReceiptRepository
{
    Task<StoredReceipt?> ReadAsync(
        string userId,
        string receiptId,
        CancellationToken cancellationToken
    );
}
