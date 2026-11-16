using Penny.Backend.Application.InboundMail;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.InboundMail;

// The per-process replay cache of ingress signatures (MAZ-184).
public sealed class InboundMailReplayCacheTests
{
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = DateTimeOffset.FromUnixTimeSeconds(1763300000);

        public override DateTimeOffset GetUtcNow() => Now;
    }

    [Fact]
    public void whenSignatureSeenTwice_TryRemember_ShouldRefuseTheSecond()
    {
        var cache = new InboundMailReplayCache(new Clock());
        cache.TryRemember("a").ShouldBeTrue();
        cache.TryRemember("a").ShouldBeFalse();
        cache.TryRemember("b").ShouldBeTrue();
    }

    [Fact]
    public void whenSignatureOlderThanTwoWindows_TryRemember_ShouldAcceptAgain()
    {
        var clock = new Clock();
        var cache = new InboundMailReplayCache(clock);
        cache.TryRemember("a").ShouldBeTrue();
        clock.Now += 2 * InboundMailSettings.SignatureWindow - TimeSpan.FromSeconds(1);
        cache.TryRemember("a").ShouldBeFalse();
        clock.Now += TimeSpan.FromSeconds(1);
        cache.TryRemember("a").ShouldBeTrue();
    }

    [Fact]
    public async Task whenSameSignatureRacing_TryRemember_ShouldAcceptExactlyOne()
    {
        var cache = new InboundMailReplayCache(new Clock());
        var results = await Task.WhenAll(
            Enumerable.Range(0, 64).Select(_ => Task.Run(() => cache.TryRemember("same")))
        );
        results.Count(accepted => accepted).ShouldBe(1);
    }
}
