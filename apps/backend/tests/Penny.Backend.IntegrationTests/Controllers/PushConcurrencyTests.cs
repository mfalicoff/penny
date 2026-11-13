using Penny.Backend.Application.Push;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Repositories;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Competing workers, crashes and lease takeover on the real PostgreSQL outbox
// (MAZ-61). Independent runners use their own data sources, as separate processes
// would. Delivery is at least once: a send whose outcome was never recorded is
// repeated after the lease expires, with the same collapse id.
public sealed class PushConcurrencyTests(ApiFixture fixture) : PushTestBase(fixture)
{
    [Fact]
    public async Task whenWorkersCompete_RunUntilIdle_ShouldSendEveryDeliveryExactlyOnce()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        await RegisterApnsAsync(sam.Token, ApnsToken(1), "production");
        await RegisterApnsAsync(sam.Token, ApnsToken(2), "sandbox");
        for (var index = 0; index < 30; index++)
            await CreateExpenseAsync(householdId, alex.Token, Expense(1000 + index, alex.UserId));
        await using var first = DatabaseSettings
            .Create(Fixture.RuntimeConnection)
            .CreateDataSource();
        await using var second = DatabaseSettings
            .Create(Fixture.RuntimeConnection)
            .CreateDataSource();

        await Task.WhenAll(
            Enumerable
                .Range(0, 4)
                .Select(index =>
                    Task.Run(
                        () => Runner(source: index % 2 == 0 ? first : second).RunUntilIdleAsync(Ct),
                        Ct
                    )
                )
        );

        (await Apns.SentToAsync(ApnsToken(1))).Count.ShouldBe(30);
        (await Apns.SentToAsync(ApnsToken(2))).Count.ShouldBe(30);
        (await Apns.SentToAsync(ApnsToken(1)))
            .Select(message => message.OutboxId)
            .Distinct()
            .Count()
            .ShouldBe(30);
        (await UnsentMessagesAsync()).ShouldBe(0);
        (
            await CountAsync("SELECT count(*) FROM penny.push_outbox WHERE lease_token IS NOT NULL")
        ).ShouldBe(0);
        (
            await CountAsync("SELECT count(*) FROM penny.push_deliveries WHERE attempts <> 1")
        ).ShouldBe(0);
    }

    [Fact]
    public async Task whenWorkerCrashesAfterClaim_RunOnce_ShouldTakeOverOnlyAfterLeaseExpires()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        await RegisterApnsAsync(sam.Token, ApnsToken(1), "production");
        await CreateExpenseAsync(householdId, alex.Token, Expense(1000, alex.UserId));
        // A worker claims and prepares the message, then dies before sending.
        var crashed = new PostgresPushRepository(Source);
        var claim = (
            await crashed.ClaimAsync(
                "crashed",
                "lost",
                Noon,
                Noon + PushDeliveryRunner.Lease,
                10,
                Ct
            )
        ).Single();
        (
            await crashed.PrepareAsync(
                claim.OutboxId,
                "lost",
                Noon,
                Noon + PushDeliveryRunner.Lease,
                Noon - PushDeliveryRunner.MaxAge,
                10,
                Ct
            )
        )!
            .Single()
            .Attempts.ShouldBe(1);

        (await Runner().RunOnceAsync(Ct)).Claimed.ShouldBe(0, "the live lease keeps others out");
        At(Noon + PushDeliveryRunner.Lease);
        var run = await Runner().RunOnceAsync(Ct);

        run.Accepted.ShouldBe(1);
        (await ScalarAsync("SELECT attempts FROM penny.push_deliveries")).ShouldBe(2);
        (await UnsentMessagesAsync()).ShouldBe(0);
        // The crashed worker's late record changes nothing it no longer owns.
        await crashed.RecordAsync(
            claim.OutboxId,
            "lost",
            [
                new PushDeliveryResult(
                    ApnsToken(1),
                    PushOutcomeKind.Retry,
                    "apns:network",
                    null,
                    Noon.AddHours(1)
                ),
            ],
            Noon + PushDeliveryRunner.Lease,
            Noon,
            Ct
        );
        (await PendingAsync()).ShouldBe(0);
        (
            await CountAsync("SELECT count(*) FROM penny.push_outbox WHERE lease_token IS NOT NULL")
        ).ShouldBe(0);
    }

    [Fact]
    public async Task whenLeaseLostAfterSend_RunOnce_ShouldResendOnceWithSameCollapseIdAndSettle()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        await RegisterApnsAsync(sam.Token, ApnsToken(1), "production");
        await CreateExpenseAsync(householdId, alex.Token, Expense(1000, alex.UserId));
        var slow = new FakePushTransport(PushProviders.Apns);
        slow.Respond = _ =>
        {
            // The send outlives the lease; another worker takes over meanwhile.
            At(Noon + PushDeliveryRunner.Lease);
            Runner().RunOnceAsync(Ct).GetAwaiter().GetResult().Accepted.ShouldBe(1);
            return PushOutcome.Accepted(null);
        };

        var run = await Runner(transports: [slow]).RunOnceAsync(Ct);

        run.Accepted.ShouldBe(1);
        var sends = slow.Sent.Concat(Apns.Sent).ToList();
        sends.Count.ShouldBe(2, "at least once: both workers sent");
        sends.Select(message => message.CollapseId).Distinct().Count().ShouldBe(1);
        (await UnsentMessagesAsync()).ShouldBe(0);
        (
            await CountAsync("SELECT count(*) FROM penny.push_outbox WHERE lease_token IS NOT NULL")
        ).ShouldBe(0);
    }

    [Fact]
    public async Task whenRunCancelledDuringSend_RunOnce_ShouldKeepTheAttemptAndRetryAfterLease()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        await RegisterApnsAsync(sam.Token, ApnsToken(1), "production");
        await CreateExpenseAsync(householdId, alex.Token, Expense(1000, alex.UserId));
        using var stopping = new CancellationTokenSource();
        var stopped = new FakePushTransport(PushProviders.Apns);
        stopped.Respond = _ =>
        {
            stopping.Cancel();
            stopping.Token.ThrowIfCancellationRequested();
            return PushOutcome.Accepted(null);
        };

        await Should.ThrowAsync<OperationCanceledException>(() =>
            Runner(transports: [stopped]).RunOnceAsync(stopping.Token)
        );

        (await ScalarAsync("SELECT attempts FROM penny.push_deliveries")).ShouldBe(1);
        (await Runner().RunOnceAsync(Ct)).Claimed.ShouldBe(0);
        At(Noon + PushDeliveryRunner.Lease);
        (await Runner().RunOnceAsync(Ct)).Accepted.ShouldBe(1);
        (await UnsentMessagesAsync()).ShouldBe(0);
    }
}
