namespace Penny.Backend.Api.Contracts;

public sealed record HouseholdListResponse(IReadOnlyList<HouseholdResponse> Households);
