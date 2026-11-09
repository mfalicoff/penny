namespace Penny.Backend.Application.Push;

// Expo push receipts. Returns the receipts that exist (absent: not ready yet), or
// null when the request failed transiently. A permanent request failure maps every
// ticket to `Error`.
public interface IPushReceiptChecker
{
    Task<IReadOnlyDictionary<string, PushReceiptStatus>?> CheckAsync(
        IReadOnlyList<string> ticketIds,
        CancellationToken cancellationToken
    );
}
