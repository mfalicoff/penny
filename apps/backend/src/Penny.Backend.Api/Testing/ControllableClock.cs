namespace Penny.Backend.Api.Testing;

// The host clock while test controls are enabled: system time until a run pins it.
// Pinned time does not advance, so seeded scenarios and recaps are reproducible.
public sealed class ControllableClock : TimeProvider
{
    private readonly Lock gate = new();
    private DateTimeOffset? now;

    public DateTimeOffset? Pinned
    {
        get
        {
            lock (gate)
                return now;
        }
    }

    public override DateTimeOffset GetUtcNow()
    {
        lock (gate)
            return now ?? base.GetUtcNow();
    }

    public void Set(DateTimeOffset value)
    {
        lock (gate)
            now = value.ToUniversalTime();
    }

    public void Reset()
    {
        lock (gate)
            now = null;
    }
}
