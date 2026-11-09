using System.Text.Json.Serialization;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Api.Contracts;

// Contract schema `HouseholdMember`: instants are Unix milliseconds of the member's
// latest period; `joinedOn` (local join day) and `leftAt` are omitted when absent.
public sealed record HouseholdMemberResponse(
    string UserId,
    string Email,
    long JoinedAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? JoinedOn,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? LeftAt
)
{
    public static HouseholdMemberResponse From(StoredMember member) =>
        new(
            member.UserId,
            member.Email,
            member.JoinedAt.ToUnixTimeMilliseconds(),
            member.JoinedOn is { } day ? LedgerDates.Write(day) : null,
            member.LeftAt?.ToUnixTimeMilliseconds()
        );
}
