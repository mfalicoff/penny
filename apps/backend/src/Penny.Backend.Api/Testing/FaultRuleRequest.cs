namespace Penny.Backend.Api.Testing;

public sealed record FaultRuleRequest(
    string? Target,
    string? Method,
    string? PathPrefix,
    int? Status,
    int? DelayMs,
    bool? Abort,
    int? Times
);
