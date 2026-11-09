using System.Diagnostics;
using Npgsql;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Shared recurrence workers against real PostgreSQL (MAZ-59): competing runners,
// lease expiry and takeover, a connection killed or cancelled mid-occurrence, rule
// changes while a runner waits, and the hosted worker. Runners act as separate
// processes (own connection pool and clock); locks are held from separate admin
// connections. All data is synthetic.
public sealed class SharedRecurrenceConcurrencyTests(ApiFixture fixture)
    : SharedRecurrenceTestBase(fixture)
{
    [Fact]
    public async Task whenWorkersCompete_Runner_ShouldRecordEachOccurrenceExactlyOnce()
    {
        var (alex, alexId, _, _, home) = await HomeAsync();
        var ruleIds = new List<string>();
        for (var i = 0; i < 20; i++)
            ruleIds.Add(
                Id(
                    await CreateRuleAsync(
                        home,
                        alex,
                        Rule(1000 + i, alexId, "2027-01-01", "weekly")
                    )
                )
            );
        var clock = new TestClock();
        clock.Set(Utc("2027-01-29"));
        var runners = Enumerable.Range(0, 4).Select(_ => NewRunner(clock)).ToList();
        try
        {
            var recorded = await Task.WhenAll(
                runners.Select(worker => Task.Run(() => worker.Runner.RunUntilIdleAsync(Ct), Ct))
            );
            recorded.Sum().ShouldBe(100);
        }
        finally
        {
            foreach (var worker in runners)
                await worker.Source.DisposeAsync();
        }
        foreach (var ruleId in ruleIds)
        {
            (await OccurrencesAsync(ruleId)).ShouldBe([
                "2027-01-01",
                "2027-01-08",
                "2027-01-15",
                "2027-01-22",
                "2027-01-29",
            ]);
            (await EventsAsync(ruleId)).ShouldBe((5L, 5L, 5L));
            (await NextDateAsync(ruleId)).ShouldBe("2027-02-05");
        }
        (
            await CountAsync(
                "SELECT count(*) FROM penny.household_recurring WHERE lease_token IS NOT NULL OR lease_owner IS NOT NULL OR lease_expires_at IS NOT NULL"
            )
        ).ShouldBe(0);
    }

    [Fact]
    public async Task whenLeaseExpiresWhileOwnerWaits_Runner_ShouldLetOnlyTheNewOwnerRecord()
    {
        var (alex, alexId, _, _, home) = await HomeAsync();
        var ruleId = Id(await CreateRuleAsync(home, alex, Rule(9000, alexId, "2027-01-05")));
        var slowClock = new TestClock();
        slowClock.Set(Utc("2027-01-06"));
        var laterClock = new TestClock();
        laterClock.Set(Utc("2027-01-06").AddMinutes(5));
        var (slow, slowSource) = NewRunner(slowClock);
        var (later, laterSource) = NewRunner(laterClock);
        await using (slowSource)
        await using (laterSource)
        {
            await using var blocker = await Fixture.Admin.OpenConnectionAsync(Ct);
            await using var transaction = await blocker.BeginTransactionAsync(Ct);
            await ExecuteAsync(
                blocker,
                transaction,
                $"SELECT 1 FROM penny.households WHERE id = '{home}' FOR UPDATE"
            );
            // The first runner claims, then waits for the household; its lease runs out
            // (as if it had stalled or died) and a second runner takes the rule over.
            var first = Task.Run(() => slow.RunOnceAsync(Ct), Ct);
            await WaitForLockWaitAsync();
            var second = Task.Run(() => later.RunOnceAsync(Ct), Ct);
            await WaitForLockWaitAsync(2);
            await transaction.CommitAsync(Ct);
            var runs = await Task.WhenAll(first, second);
            runs.Sum(run => run.Claimed).ShouldBe(2);
            runs.Sum(run => run.Recorded).ShouldBe(1);
            runs.ShouldAllBe(run => run.Failures.Count == 0);
        }
        (await OccurrencesAsync(ruleId)).ShouldBe(["2027-01-05"]);
        (await EventsAsync(ruleId)).ShouldBe((1L, 1L, 1L));
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_recurring WHERE id = '{ruleId}' AND lease_token IS NULL AND next_date = DATE '2027-02-05'"
            )
        ).ShouldBe(1);
    }

    [Fact]
    public async Task whenConnectionDiesMidOccurrence_Runner_ShouldRollBackAndRecoverAfterLease()
    {
        var (alex, alexId, _, _, home) = await HomeAsync();
        var ruleId = Id(await CreateRuleAsync(home, alex, Rule(9000, alexId, "2027-01-05")));
        var clock = new TestClock();
        clock.Set(Utc("2027-01-06"));
        var (runner, source) = NewRunner(clock);
        await using (source)
        {
            await using var blocker = await Fixture.Admin.OpenConnectionAsync(Ct);
            await using var transaction = await blocker.BeginTransactionAsync(Ct);
            // The runner blocks on its last insert (push outbox), after the expense,
            // splits, search document, audit row and rule advance.
            await ExecuteAsync(
                blocker,
                transaction,
                "LOCK TABLE penny.push_outbox IN ACCESS EXCLUSIVE MODE"
            );
            var run = Task.Run(() => runner.RunOnceAsync(Ct), Ct);
            await WaitForLockWaitAsync();
            (
                await CountAsync(
                    "SELECT count(*) FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'penny_runtime' AND wait_event_type = 'Lock') AS killed"
                )
            ).ShouldBe(1);
            var failed = await run;
            failed.Recorded.ShouldBe(0);
            failed.Failures.ShouldHaveSingleItem();
            await transaction.RollbackAsync(Ct);
        }
        await ShouldBeUntouchedAsync(ruleId);
        // The dead runner's lease still holds the rule until it expires.
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_recurring WHERE id = '{ruleId}' AND lease_token IS NOT NULL"
            )
        ).ShouldBe(1);
        (await RunAtAsync(Utc("2027-01-06").AddMinutes(1))).ShouldBe(0);
        (await RunAtAsync(Utc("2027-01-06").AddMinutes(3))).ShouldBe(1);
        (await OccurrencesAsync(ruleId)).ShouldBe(["2027-01-05"]);
        (await EventsAsync(ruleId)).ShouldBe((1L, 1L, 1L));
    }

    [Fact]
    public async Task whenRunnerCancelledMidOccurrence_Runner_ShouldRollBackEverything()
    {
        var (alex, alexId, _, _, home) = await HomeAsync();
        var ruleId = Id(await CreateRuleAsync(home, alex, Rule(9000, alexId, "2027-01-05")));
        var clock = new TestClock();
        clock.Set(Utc("2027-01-06"));
        var (runner, source) = NewRunner(clock);
        await using (source)
        {
            await using var blocker = await Fixture.Admin.OpenConnectionAsync(Ct);
            await using var transaction = await blocker.BeginTransactionAsync(Ct);
            await ExecuteAsync(
                blocker,
                transaction,
                "LOCK TABLE penny.push_outbox IN ACCESS EXCLUSIVE MODE"
            );
            using var stopping = CancellationTokenSource.CreateLinkedTokenSource(Ct);
            var run = Task.Run(() => runner.RunOnceAsync(stopping.Token), Ct);
            await WaitForLockWaitAsync();
            await stopping.CancelAsync();
            var cancelled = false;
            try
            {
                await run;
            }
            catch (OperationCanceledException)
            {
                cancelled = true;
            }
            cancelled.ShouldBeTrue();
            await transaction.RollbackAsync(Ct);
        }
        await ShouldBeUntouchedAsync(ruleId);
    }

    [Fact]
    public async Task whenRulePausedWhileRunnerWaits_Runner_ShouldRecordNothing()
    {
        var (alex, alexId, _, _, home) = await HomeAsync();
        var ruleId = Id(await CreateRuleAsync(home, alex, Rule(9000, alexId, "2027-01-05")));
        var clock = new TestClock();
        clock.Set(Utc("2027-01-06"));
        var (runner, source) = NewRunner(clock);
        await using (source)
        {
            await using var blocker = await Fixture.Admin.OpenConnectionAsync(Ct);
            await using var transaction = await blocker.BeginTransactionAsync(Ct);
            await ExecuteAsync(
                blocker,
                transaction,
                $"SELECT 1 FROM penny.households WHERE id = '{home}' FOR UPDATE"
            );
            var run = Task.Run(() => runner.RunOnceAsync(Ct), Ct);
            await WaitForLockWaitAsync();
            // A rule writer holding the household lock pauses the claimed rule.
            await ExecuteAsync(
                blocker,
                transaction,
                $"UPDATE penny.household_recurring SET active = false, revision = revision + 1 WHERE id = '{ruleId}'"
            );
            await transaction.CommitAsync(Ct);
            var result = await run;
            result.Claimed.ShouldBe(1);
            result.Recorded.ShouldBe(0);
        }
        (await OccurrencesAsync(ruleId, includeDeleted: true)).ShouldBeEmpty();
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_recurring WHERE id = '{ruleId}' AND lease_token IS NULL AND next_date = DATE '2027-01-05'"
            )
        ).ShouldBe(1);
    }

    [Fact]
    public async Task whenWorkerEnabled_HostedWorker_ShouldRecordDueOccurrencesAndStopPromptly()
    {
        var (alex, alexId, _, _, home) = await HomeAsync();
        // The worker host uses system time.
        var start = DateOnly
            .FromDateTime(DateTime.UtcNow)
            .AddDays(-7)
            .ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        var ruleId = Id(await CreateRuleAsync(home, alex, Rule(9000, alexId, start, "weekly")));
        var factory = new TestApiFactory(
            Fixture.RuntimeConnection,
            new Dictionary<string, string>
            {
                ["Recurrence:Worker"] = "true",
                ["Recurrence:PollSeconds"] = "1",
            }
        );
        try
        {
            factory.StartServer();
            var waited = Stopwatch.StartNew();
            while ((await OccurrencesAsync(ruleId)).Count < 2)
            {
                if (waited.Elapsed > TimeSpan.FromSeconds(10))
                    throw new ShouldAssertException("The worker did not record within 10 seconds.");
                await Task.Delay(100, Ct);
            }
        }
        finally
        {
            var stopping = Stopwatch.StartNew();
            await factory.DisposeAsync();
            stopping.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(5));
        }
        (await OccurrencesAsync(ruleId)).Count.ShouldBe(2);
        (await EventsAsync(ruleId)).ShouldBe((2L, 2L, 2L));
    }

    // Nothing of the rolled-back occurrence remains and the rule did not move.
    private async Task ShouldBeUntouchedAsync(string ruleId)
    {
        (await OccurrencesAsync(ruleId, includeDeleted: true)).ShouldBeEmpty();
        (await CountAsync("SELECT count(*) FROM penny.household_splits")).ShouldBe(0);
        (
            await CountAsync(
                "SELECT count(*) FROM penny.search_documents WHERE expense_id IS NOT NULL"
            )
        ).ShouldBe(0);
        (
            await CountAsync(
                "SELECT count(*) FROM penny.household_audit WHERE action = 'expense.created'"
            )
        ).ShouldBe(0);
        (await CountAsync("SELECT count(*) FROM penny.push_outbox")).ShouldBe(0);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_recurring WHERE id = '{ruleId}' AND revision = 0 AND next_date = DATE '2027-01-05'"
            )
        ).ShouldBe(1);
    }

    private static async Task ExecuteAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string sql
    )
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync(Ct);
    }
}
