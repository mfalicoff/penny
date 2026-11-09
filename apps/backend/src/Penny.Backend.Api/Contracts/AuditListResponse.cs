namespace Penny.Backend.Api.Contracts;

public sealed record AuditListResponse(IReadOnlyList<AuditEventResponse> Events);
