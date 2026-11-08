using Penny.Backend.Application.Households;

namespace Penny.Backend.Api.Contracts;

// Contract schema `HouseholdDetail`.
public sealed record HouseholdDetailResponse(
    HouseholdResponse Household,
    IReadOnlyList<HouseholdMemberResponse> Members
)
{
    public static HouseholdDetailResponse From(HouseholdDetail detail) =>
        new(
            HouseholdResponse.From(detail.Household),
            [.. detail.Members.Select(HouseholdMemberResponse.From)]
        );
}
