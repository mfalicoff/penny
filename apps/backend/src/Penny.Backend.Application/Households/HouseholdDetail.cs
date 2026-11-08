using Penny.Backend.Application.Abstractions.Persistence;

namespace Penny.Backend.Application.Households;

public sealed record HouseholdDetail(HouseholdView Household, IReadOnlyList<StoredMember> Members);
