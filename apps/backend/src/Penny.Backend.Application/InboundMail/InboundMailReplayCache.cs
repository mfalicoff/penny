using System.Collections.Concurrent;

namespace Penny.Backend.Application.InboundMail;

// Signatures of accepted ingress requests, kept for the signature window so a captured
// request cannot be sent again (MAZ-184). Per process: several API processes each keep
// their own, and the per-user (sha256) de-duplication makes a cross-process replay of a
// message a no-op anyway.
public sealed class InboundMailReplayCache(TimeProvider clock)
{
    private const int PruneEvery = 256;
    private readonly ConcurrentDictionary<string, DateTimeOffset> seen = new(
        StringComparer.Ordinal
    );
    private int additions;

    // False when the signature was already seen and has not expired.
    public bool TryRemember(string signature)
    {
        var now = clock.GetUtcNow();
        if (Interlocked.Increment(ref additions) % PruneEvery == 0)
            foreach (var (key, expiry) in seen)
                if (expiry <= now)
                    seen.TryRemove(key, out _);
        var expires = now + 2 * InboundMailSettings.SignatureWindow;
        while (true)
        {
            if (seen.TryAdd(signature, expires))
                return true;
            if (!seen.TryGetValue(signature, out var existing))
                continue;
            if (existing > now)
                return false;
            if (seen.TryUpdate(signature, expires, existing))
                return true;
        }
    }
}
