using Penny.Backend.Application.Push;

namespace Penny.Backend.Api.Testing;

// MAZ-62 `push` faults for full-stack runs: before each provider call the delivery
// worker asks the registry for a `push` rule whose `method` names the provider
// (`apns` or `expo`; any when null). The rule waits `delayMs`, then either answers
// for the whole call (`abort`: a network failure; `status`: 410 invalid token, 429 or
// 5xx retry, other 4xx permanent) or, with neither, lets the real provider answer.
public sealed class FaultInjectingPushTransport(IPushTransport inner, FaultRegistry faults)
    : IPushTransport
{
    public string Provider => inner.Provider;

    public async Task<IReadOnlyList<PushOutcome>> SendAsync(
        IReadOnlyList<PushMessage> messages,
        CancellationToken cancellationToken
    )
    {
        if (faults.Take("push", Provider, null) is not { } rule)
            return await inner.SendAsync(messages, cancellationToken);
        if (rule.DelayMs > 0)
            await Task.Delay(rule.DelayMs, cancellationToken);
        PushOutcome? outcome = (rule.Abort, rule.Status) switch
        {
            (true, _) => PushOutcome.Retry($"{Provider}:fault-abort"),
            (_, 410) => PushOutcome.InvalidToken($"{Provider}:fault-410"),
            (_, 429 or >= 500) => PushOutcome.Retry($"{Provider}:fault-{rule.Status}"),
            (_, >= 400) => PushOutcome.Permanent($"{Provider}:fault-{rule.Status}"),
            _ => null,
        };
        return outcome is null
            ? await inner.SendAsync(messages, cancellationToken)
            : [.. messages.Select(_ => outcome)];
    }
}
