namespace Penny.Backend.Application.Push;

// Counts from one delivery pass (logged without ids, tokens or payloads).
public sealed record PushRun(
    int Claimed,
    int Accepted,
    int Retried,
    int Failed,
    int InvalidTokens,
    IReadOnlyList<string> Failures
);
