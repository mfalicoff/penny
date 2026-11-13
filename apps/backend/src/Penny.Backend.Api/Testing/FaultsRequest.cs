namespace Penny.Backend.Api.Testing;

public sealed record FaultsRequest(IReadOnlyList<FaultRuleRequest>? Rules);
