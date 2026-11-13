namespace Penny.Backend.Api.Testing;

public sealed record TestStateResponse(
    string Environment,
    DateTimeOffset Now,
    bool ClockPinned,
    IReadOnlyList<FaultRule> Faults
);
