namespace Penny.Backend.Api.Testing;

// One injected failure. `Target` is `http` (applied by FaultInjectionMiddleware to
// matching requests) or `push` (reserved for the MAZ-61 delivery worker, which asks
// the registry before each provider call). A rule matches its method (any when null)
// and path prefix (any when null), waits `DelayMs`, then answers `Status` or, when
// `Abort` is set, drops the connection. `Times` limits how often it fires (null: always).
public sealed record FaultRule(
    string Target,
    string? Method,
    string? PathPrefix,
    int? Status,
    int DelayMs,
    bool Abort,
    int? Times
)
{
    public static readonly IReadOnlyList<string> Targets = ["http", "push"];
    public const int MaxDelayMs = 30_000;
}
