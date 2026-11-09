namespace Penny.Backend.Application.Abstractions.Persistence;

// A viewer who has left the household (their latest period ended at `LeftAt`). Former
// members keep exactly their own history: expenses they have a share in, and
// household events from before they left.
public sealed record FormerMember(string UserId, DateTimeOffset LeftAt);
