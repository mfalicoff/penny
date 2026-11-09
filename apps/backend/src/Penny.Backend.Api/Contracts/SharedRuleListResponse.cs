namespace Penny.Backend.Api.Contracts;

public sealed record SharedRuleListResponse(IReadOnlyList<SharedRuleResponse> Rules);
