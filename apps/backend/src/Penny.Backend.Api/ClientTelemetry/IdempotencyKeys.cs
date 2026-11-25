using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;

namespace Penny.Backend.Api.ClientTelemetry;

// MAZ-129: the Faro SDK sends a fresh `Idempotency-Key` with every request and retries it
// unchanged after a timeout or 5xx. A key seen from the same user in the last ten minutes
// is accepted again without forwarding, so a retry never doubles an error in Grafana.
// Keys live in memory only: a restart (or a second API instance) can let one duplicate
// through, which telemetry tolerates.
public sealed partial class IdempotencyKeys : IDisposable
{
    public const string Header = "Idempotency-Key";
    private const int Capacity = 50_000;
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

    private readonly MemoryCache seen = new(new MemoryCacheOptions { SizeLimit = Capacity });

    [GeneratedRegex("^[A-Za-z0-9_-]{8,64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Valid();

    public static bool IsValid(string key) => Valid().IsMatch(key);

    /// <summary>True the first time a user presents `key`; false for a repeat.</summary>
    public bool TryClaim(string userId, string key)
    {
        var entry = $"{userId}\n{key}";
        var claimed = false;
        seen.GetOrCreate(entry, item =>
        {
            claimed = true;
            item.Size = 1;
            item.AbsoluteExpirationRelativeToNow = Lifetime;
            return true;
        });
        return claimed;
    }

    public void Dispose() => seen.Dispose();
}
