using Penny.Backend.Application.Push;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// Deterministic Expo receipts: `Respond` maps the requested tickets to receipts
// (null: the request failed transiently).
public sealed class FakePushReceipts : IPushReceiptChecker
{
    public List<IReadOnlyList<string>> Requests { get; } = [];

    public Func<
        IReadOnlyList<string>,
        IReadOnlyDictionary<string, PushReceiptStatus>?
    > Respond { get; set; } = ids => ids.ToDictionary(id => id, _ => PushReceiptStatus.Ok);

    public Task<IReadOnlyDictionary<string, PushReceiptStatus>?> CheckAsync(
        IReadOnlyList<string> ticketIds,
        CancellationToken cancellationToken
    )
    {
        Requests.Add(ticketIds);
        return Task.FromResult(Respond(ticketIds));
    }
}
