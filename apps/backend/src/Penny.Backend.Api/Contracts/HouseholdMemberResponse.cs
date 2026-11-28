using System.Text.Json.Serialization;
using Penny.Backend.Api.Profiles;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Api.Contracts;

// Contract schema `HouseholdMember`: instants are Unix milliseconds of the member's
// latest period; `joinedOn` (local join day) and `leftAt` are omitted when absent, as are
// the member's `displayName` and `avatarUrl` (MAZ-171: clients then show the email and
// initials). `deleted` (MAZ-152) is true, and otherwise omitted, when the person deleted their
// account: clients show "Former member" and no email, name or picture.
// `currency` (contract 2.5.0) is a current member's home (ledger) currency.
public sealed record HouseholdMemberResponse(
    string UserId,
    string Email,
    long JoinedAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? JoinedOn,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? LeftAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? DisplayName,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? AvatarUrl,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Deleted,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Currency
)
{
    public static HouseholdMemberResponse From(StoredMember member) =>
        new(
            member.UserId,
            member.Email,
            member.JoinedAt.ToUnixTimeMilliseconds(),
            member.JoinedOn is { } day ? LedgerDates.Write(day) : null,
            member.LeftAt?.ToUnixTimeMilliseconds(),
            member.DisplayName,
            AvatarLink.UrlFor(member.UserId, member.AvatarVersion),
            member.Deleted ? true : null,
            member.Currency
        );
}
