namespace Penny.Backend.IntegrationTests.Infrastructure;

// System time unless a test pins it; ApiFixture.ResetAsync unpins it between tests.
public sealed class TestClock : TimeProvider
{
    private DateTimeOffset? now;

    public override DateTimeOffset GetUtcNow() => now ?? base.GetUtcNow();

    public void Set(DateTimeOffset value) => now = value;

    public void Reset() => now = null;
}
