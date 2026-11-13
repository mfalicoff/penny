namespace Penny.Backend.Api.Testing;

// The injected failures of a test run. Rules are replaced as a whole; a matching rule
// with a remaining count is consumed atomically, so concurrent requests never exceed it.
public sealed class FaultRegistry
{
    private readonly Lock gate = new();
    private List<(FaultRule Rule, int? Remaining)> rules = [];

    public IReadOnlyList<FaultRule> Rules
    {
        get
        {
            lock (gate)
                return [.. rules.Select(item => item.Rule with { Times = item.Remaining })];
        }
    }

    public void Replace(IEnumerable<FaultRule> next)
    {
        lock (gate)
            rules = [.. next.Select(rule => (rule, rule.Times))];
    }

    public void Clear() => Replace([]);

    // The first live rule for the target, method and path, consuming one use.
    public FaultRule? Take(string target, string? method, string? path)
    {
        lock (gate)
        {
            for (var index = 0; index < rules.Count; index++)
            {
                var (rule, remaining) = rules[index];
                if (
                    !string.Equals(rule.Target, target, StringComparison.Ordinal)
                    || remaining == 0
                    || (
                        rule.Method is not null
                        && !string.Equals(rule.Method, method, StringComparison.OrdinalIgnoreCase)
                    )
                    || (
                        rule.PathPrefix is not null
                        && (
                            path is null
                            || !path.StartsWith(rule.PathPrefix, StringComparison.Ordinal)
                        )
                    )
                )
                    continue;
                rules[index] = (rule, remaining - 1);
                return rule;
            }
            return null;
        }
    }
}
