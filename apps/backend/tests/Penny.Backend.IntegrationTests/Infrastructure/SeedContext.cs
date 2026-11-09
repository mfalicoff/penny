namespace Penny.Backend.IntegrationTests.Infrastructure;

// What a full-stack seed scenario created: aliases to sessions and ids, and the ids of
// referenced households and expenses.
public sealed class SeedContext
{
    public Dictionary<string, string> Emails { get; } = [];
    public Dictionary<string, string> Tokens { get; } = [];
    public Dictionary<string, string> UserIds { get; } = [];
    public Dictionary<string, string> Households { get; } = [];
    public Dictionary<string, string> Invites { get; } = [];
    public Dictionary<string, string> Expenses { get; } = [];
    public Dictionary<string, string> Rules { get; } = [];
}
