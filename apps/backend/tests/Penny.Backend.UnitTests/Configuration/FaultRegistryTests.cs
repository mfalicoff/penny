using Penny.Backend.Api.Testing;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Configuration;

public sealed class FaultRegistryTests
{
    [Fact]
    public void whenRuleLimited_Take_ShouldFireExactlyThatManyTimes()
    {
        var faults = new FaultRegistry();
        faults.Replace([new FaultRule("http", "PUT", "/api/ledger", 503, 0, false, 2)]);
        faults.Take("http", "GET", "/api/ledger").ShouldBeNull();
        faults.Take("http", "PUT", "/api/households").ShouldBeNull();
        faults.Take("push", "PUT", "/api/ledger").ShouldBeNull();
        faults.Take("http", "put", "/api/ledger").ShouldNotBeNull();
        faults.Take("http", "PUT", "/api/ledger").ShouldNotBeNull();
        faults.Take("http", "PUT", "/api/ledger").ShouldBeNull();
        faults.Rules.Single().Times.ShouldBe(0);
    }

    [Fact]
    public async Task whenTakenConcurrently_Take_ShouldNeverExceedTheLimit()
    {
        var faults = new FaultRegistry();
        faults.Replace([new FaultRule("push", null, null, null, 0, true, 25)]);
        var taken = await Task.WhenAll(
            Enumerable.Range(0, 200).Select(_ => Task.Run(() => faults.Take("push", null, null)))
        );
        taken.Count(rule => rule is not null).ShouldBe(25);
    }

    [Fact]
    public void whenUnlimited_Take_ShouldKeepFiringUntilCleared()
    {
        var faults = new FaultRegistry();
        faults.Replace([new FaultRule("http", null, null, 500, 0, false, null)]);
        for (var index = 0; index < 5; index++)
            faults.Take("http", "GET", "/api/anything").ShouldNotBeNull();
        faults.Clear();
        faults.Take("http", "GET", "/api/anything").ShouldBeNull();
    }
}
