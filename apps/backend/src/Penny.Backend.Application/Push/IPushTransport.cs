namespace Penny.Backend.Application.Push;

// One push provider (APNs, or a deterministic fake in tests). `SendAsync` returns
// exactly one outcome per message, in order; it reports failures as outcomes and
// throws only for cancellation (a throw is treated as a retry for the batch).
public interface IPushTransport
{
    string Provider { get; }

    Task<IReadOnlyList<PushOutcome>> SendAsync(
        IReadOnlyList<PushMessage> messages,
        CancellationToken cancellationToken
    );
}
