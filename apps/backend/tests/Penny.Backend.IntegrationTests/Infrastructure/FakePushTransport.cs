using System.Collections.Concurrent;
using Penny.Backend.Application.Push;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// A deterministic push provider: records every message and answers with `Respond`
// (accepted with a fresh ticket by default). Never touches the network.
public sealed class FakePushTransport(string provider) : IPushTransport
{
    private int tickets;

    public string Provider => provider;
    public ConcurrentQueue<PushMessage> Sent { get; } = new();
    public Func<PushMessage, PushOutcome> Respond { get; set; } = _ => PushOutcome.Accepted(null);

    // Accepted with a unique ticket (Expo) or apns-id.
    public PushOutcome Accept() =>
        PushOutcome.Accepted($"{provider}-ticket-{Interlocked.Increment(ref tickets)}");

    public Task<IReadOnlyList<PushMessage>> SentToAsync(string token) =>
        Task.FromResult<IReadOnlyList<PushMessage>>([
            .. Sent.Where(message => message.Token == token),
        ]);

    public Task<IReadOnlyList<PushOutcome>> SendAsync(
        IReadOnlyList<PushMessage> messages,
        CancellationToken cancellationToken
    )
    {
        foreach (var message in messages)
            Sent.Enqueue(message);
        return Task.FromResult<IReadOnlyList<PushOutcome>>([
            .. messages.Select(message =>
            {
                var outcome = Respond(message);
                return outcome.Kind == PushOutcomeKind.Accepted && outcome.TicketId is null
                    ? Accept()
                    : outcome;
            }),
        ]);
    }
}
