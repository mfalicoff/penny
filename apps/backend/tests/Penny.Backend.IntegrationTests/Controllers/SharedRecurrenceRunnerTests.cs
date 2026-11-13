using System.Net;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// What the shared recurrence runner records (MAZ-59), with the injectable clock and
// real PostgreSQL: anchor days through short months and leap years, the UTC day
// boundary, catch-up after missed runs, membership on each occurrence date, consumed
// dates, and exactly one stored occurrence with its audit, outbox and search rows.
// All data is synthetic.
public sealed class SharedRecurrenceRunnerTests(ApiFixture fixture)
    : SharedRecurrenceTestBase(fixture)
{
    [Fact]
    public async Task whenRuleAnchoredOnMonthEnd_Runner_ShouldRecordShortMonthsAndLeapDays()
    {
        var (alex, alexId, _, _, home) = await HomeAsync();
        var monthly = Id(await CreateRuleAsync(home, alex, Rule(9000, alexId, "2028-01-31")));
        var yearly = Id(
            await CreateRuleAsync(home, alex, Rule(9000, alexId, "2028-02-29", "yearly"))
        );
        (await RunAtAsync(Utc("2028-05-31"))).ShouldBe(6);
        (await OccurrencesAsync(monthly)).ShouldBe([
            "2028-01-31",
            "2028-02-29",
            "2028-03-31",
            "2028-04-30",
            "2028-05-31",
        ]);
        (await NextDateAsync(monthly)).ShouldBe("2028-06-30");
        (await RunAtAsync(Utc("2032-03-01"))).ShouldBe(4 + 45);
        (await OccurrencesAsync(yearly)).ShouldBe([
            "2028-02-29",
            "2029-02-28",
            "2030-02-28",
            "2031-02-28",
            "2032-02-29",
        ]);
        (await NextDateAsync(yearly)).ShouldBe("2033-02-28");
        (await ListRulesAsync(home, alex))
            .Select(rule => rule.GetProperty("anchorDay").GetInt32())
            .ShouldBe([31, 29], ignoreOrder: true);
    }

    [Fact]
    public async Task whenClockCrossesUtcMidnight_Runner_ShouldRecordOnTheUtcDay()
    {
        var (alex, alexId, _, _, home) = await HomeAsync();
        var ruleId = Id(await CreateRuleAsync(home, alex, Rule(9000, alexId, "2027-01-10")));
        (await RunAtAsync(Utc("2027-01-09", 23, 59, 59))).ShouldBe(0);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_recurring WHERE id = '{ruleId}' AND lease_token IS NOT NULL"
            )
        ).ShouldBe(0);
        (await RunAtAsync(Utc("2027-01-10", 0))).ShouldBe(1);
        (await OccurrencesAsync(ruleId)).ShouldBe(["2027-01-10"]);
    }

    [Fact]
    public async Task whenRunsWereMissed_Runner_ShouldCatchUpEveryDateExactlyOnce()
    {
        var (alex, alexId, bea, _, home) = await HomeAsync();
        var ruleId = Id(
            await CreateRuleAsync(home, alex, Rule(9000, alexId, "2027-01-01", "weekly"))
        );
        (await RunAtAsync(Utc("2027-02-01"))).ShouldBe(5);
        (await OccurrencesAsync(ruleId)).ShouldBe([
            "2027-01-01",
            "2027-01-08",
            "2027-01-15",
            "2027-01-22",
            "2027-01-29",
        ]);
        // Running again, or from a freshly started runner (a restart), records nothing.
        (await RunAtAsync(Utc("2027-02-01"))).ShouldBe(0);
        var clock = new TestClock();
        clock.Set(Utc("2027-02-01", 18));
        var (restarted, source) = NewRunner(clock);
        await using (source)
            (await restarted.RunUntilIdleAsync(Ct)).ShouldBe(0);
        // One audit event and search document per occurrence; one outbox row per other
        // current member (the payer is the actor).
        (await EventsAsync(ruleId)).ShouldBe((5L, 5L, 5L));
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.push_outbox o JOIN penny.household_expenses e ON e.id = o.entity_id WHERE e.recurring_id = '{ruleId}' AND o.event_type = 'expense.created' AND o.user_id = (SELECT id FROM penny.users WHERE email = 'bea@example.test')"
            )
        ).ShouldBe(5);
        var occurrence = (await ListExpensesAsync(home, bea, "?month=2027-01")).First();
        occurrence.GetProperty("recurringId").GetString().ShouldBe(ruleId);
        occurrence.GetProperty("createdBy").GetString().ShouldBe(alexId);
        occurrence.GetProperty("revision").GetInt64().ShouldBe(0);
        Amounts(occurrence).ShouldBe([4500L, 4500L]);
    }

    [Fact]
    public async Task whenMembersChange_Runner_ShouldSplitEachDateAmongItsMembers()
    {
        var (alex, alexId, bea, beaId, home) = await HomeAsync();
        var ruleId = Id(
            await CreateRuleAsync(
                home,
                alex,
                Rule(9000, alexId, "2027-01-05", extra: Exact((alexId, 6000), (beaId, 3000)))
            )
        );
        var (cam, camId) = await AccountAsync("cam@example.test");
        await ExtendSessionsAsync();
        At(Utc("2027-02-10"));
        await AdmitAsync(home, alex, cam);
        (await RunAtAsync(Utc("2027-03-06"))).ShouldBe(3);
        var expenses = (await ListExpensesAsync(home, bea))
            .OrderBy(expense => expense.GetProperty("date").GetString(), StringComparer.Ordinal)
            .ToList();
        expenses
            .Select(expense => expense.GetProperty("date").GetString())
            .ShouldBe(["2027-01-05", "2027-02-05", "2027-03-05"]);
        // Before Cam's join day the stored exact split applies (the same members are
        // active); from then on the occurrence is split equally among all three.
        foreach (var expense in expenses.Take(2))
        {
            expense.GetProperty("splitMode").GetString().ShouldBe("exact");
            Shares(expense)
                .ShouldBe(
                    new Dictionary<string, long> { [alexId] = 6000, [beaId] = 3000 },
                    ignoreOrder: true
                );
        }
        expenses[2].GetProperty("splitMode").GetString().ShouldBe("equal");
        Shares(expenses[2])
            .ShouldBe(
                new Dictionary<string, long>
                {
                    [alexId] = 3000,
                    [beaId] = 3000,
                    [camId] = 3000,
                },
                ignoreOrder: true
            );
        (await OccurrencesAsync(ruleId)).Count.ShouldBe(3);
        // Nobody joining owes anything for earlier occurrences.
        (await ProjectionAsync(cam, "?month=2027-02"))
            .GetProperty("transactions")
            .GetArrayLength()
            .ShouldBe(0);
    }

    [Fact]
    public async Task whenPayerLeft_Runner_ShouldSkipDatesWithoutThePayerAndKeepAdvancing()
    {
        var (alex, alexId, bea, beaId, home) = await HomeAsync();
        // Bea pays her whole share, so her balances stay settled and she may leave.
        var ruleId = Id(
            await CreateRuleAsync(
                home,
                bea,
                Rule(5000, beaId, "2027-01-05", extra: Exact((alexId, 0), (beaId, 5000)))
            )
        );
        (await RunAtAsync(Utc("2027-01-06"))).ShouldBe(1);
        At(Utc("2027-01-20"));
        using (var left = await SendAsync(HttpMethod.Post, $"/api/households/{home}/leave", bea))
            left.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await RunAtAsync(Utc("2027-03-06"))).ShouldBe(0);
        (await OccurrencesAsync(ruleId)).ShouldBe(["2027-01-05"]);
        (await NextDateAsync(ruleId)).ShouldBe("2027-04-05");
        (await ListRulesAsync(home, alex)).ShouldHaveSingleItem();
    }

    [Fact]
    public async Task whenOccurrenceDeleted_Runner_ShouldNeverRecordThatDateAgain()
    {
        var (alex, alexId, bea, _, home) = await HomeAsync();
        var body = Rule(9000, alexId, "2027-01-05");
        var ruleId = Id(await CreateRuleAsync(home, alex, body));
        (await RunAtAsync(Utc("2027-01-06"))).ShouldBe(1);
        var occurrence = (await ListExpensesAsync(home, alex)).ShouldHaveSingleItem();
        await ExpectAsync(
            HttpMethod.Delete,
            ExpensePath(home, Id(occurrence)),
            bea,
            HttpStatusCode.OK,
            new { revision = 0 }
        );
        // Moving the rule back to the deleted date does not resurrect it.
        await UpdateRuleAsync(home, ruleId, alex, Edit(Rule(9000, alexId, "2027-01-05"), 1));
        (await RunAtAsync(Utc("2027-01-06"))).ShouldBe(0);
        (await OccurrencesAsync(ruleId, includeDeleted: true)).ShouldBe(["2027-01-05"]);
        (await OccurrencesAsync(ruleId)).ShouldBeEmpty();
        (await NextDateAsync(ruleId)).ShouldBe("2027-02-05");
        (await EventsAsync(ruleId)).Audits.ShouldBe(1);
    }

    [Fact]
    public async Task whenRuleInactiveOrHouseholdArchived_Runner_ShouldLeaveItUnclaimed()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        await ExtendSessionsAsync();
        At(Noon);
        var home = Id(await CreateHouseholdAsync(alex));
        var paused = Rule(9000, alexId, "2027-01-05");
        var pausedId = Id(await CreateRuleAsync(home, alex, paused));
        await UpdateRuleAsync(home, pausedId, alex, Edit(paused, 0, active: false));
        var solo = Id(await CreateHouseholdAsync(alex, "Studio"));
        var archivedId = Id(await CreateRuleAsync(solo, alex, Rule(9000, alexId, "2027-01-05")));
        await ExpectAsync(
            HttpMethod.Post,
            $"/api/households/{solo}/archive",
            alex,
            HttpStatusCode.OK
        );
        (await RunAtAsync(Utc("2027-03-01"))).ShouldBe(0);
        (await OccurrencesAsync(pausedId)).ShouldBeEmpty();
        (await OccurrencesAsync(archivedId)).ShouldBeEmpty();
        (
            await CountAsync(
                "SELECT count(*) FROM penny.household_recurring WHERE lease_token IS NOT NULL"
            )
        ).ShouldBe(0);
    }

    [Fact]
    public async Task whenOccurrenceRecorded_Projection_ShouldReplacePreviewWithRecordedShare()
    {
        var (alex, alexId, bea, _, home) = await HomeAsync();
        await AddAccountAsync(alex, "visa");
        var ruleId = Id(
            await CreateRuleAsync(
                home,
                alex,
                Rule(9000, alexId, "2027-01-05", extra: new { accountId = "visa" })
            )
        );
        At(Utc("2027-01-01"));
        var before = await ProjectionAsync(bea, "?month=2027-01");
        before.GetProperty("transactions").GetArrayLength().ShouldBe(0);
        before.GetProperty("scheduled").EnumerateArray().ShouldHaveSingleItem();
        (await RunAtAsync(Utc("2027-01-05"))).ShouldBe(1);
        var after = await ProjectionAsync(bea, "?month=2027-01");
        after.GetProperty("scheduled").GetArrayLength().ShouldBe(0);
        var recorded = after.GetProperty("transactions").EnumerateArray().ShouldHaveSingleItem();
        recorded.GetProperty("shareCents").GetInt64().ShouldBe(4500);
        recorded.TryGetProperty("accountId", out _).ShouldBeFalse();
        // The payer's private account is linked to the occurrence and shown only to them.
        var mine = (await ProjectionAsync(alex, "?month=2027-01"))
            .GetProperty("transactions")
            .EnumerateArray()
            .ShouldHaveSingleItem();
        mine.GetProperty("accountId").GetString().ShouldBe("visa");
        (await OccurrencesAsync(ruleId)).ShouldBe(["2027-01-05"]);
    }

    // MAZ-139: clients drop a cached preview when a recorded row has the same household,
    // `recurringId` and date. Recorded ids are random, so the rule id must be sent.
    [Fact]
    public async Task whenOccurrenceRecorded_Projection_ShouldCarryTheRuleIdOnTheRecordedShare()
    {
        var (alex, alexId, bea, _, home) = await HomeAsync();
        var ruleId = Id(await CreateRuleAsync(home, alex, Rule(9000, alexId, "2027-01-05")));
        At(Utc("2027-01-01"));
        var preview = (await ProjectionAsync(bea, "?month=2027-01"))
            .GetProperty("scheduled")
            .EnumerateArray()
            .ShouldHaveSingleItem();
        (await RunAtAsync(Utc("2027-01-05"))).ShouldBe(1);
        await CreateExpenseAsync(home, alex, Expense(2000, alexId, "2027-01-05"));

        var rows = (await ProjectionAsync(bea, "?month=2027-01"))
            .GetProperty("transactions")
            .EnumerateArray()
            .ToList();
        rows.Count.ShouldBe(2);
        var recorded = rows.Single(row => row.TryGetProperty("recurringId", out _));
        recorded.GetProperty("recurringId").GetString().ShouldBe(ruleId);
        recorded
            .GetProperty("recurringId")
            .GetString()
            .ShouldBe(preview.GetProperty("recurringId").GetString());
        recorded.GetProperty("date").GetString().ShouldBe(preview.GetProperty("date").GetString());
        recorded.GetProperty("householdId").GetString().ShouldBe(home);
        Id(recorded).ShouldNotBe(Id(preview));
        recorded.TryGetProperty("scheduled", out _).ShouldBeFalse();
        // A one-off expense has no rule and carries no `recurringId`.
        rows.Single(row => !row.TryGetProperty("recurringId", out _))
            .GetProperty("shareCents")
            .GetInt64()
            .ShouldBe(1000);
        // Year projections carry it too.
        (await ProjectionAsync(bea, "?year=2027"))
            .GetProperty("transactions")
            .EnumerateArray()
            .Count(row => row.TryGetProperty("recurringId", out var id) && id.GetString() == ruleId)
            .ShouldBe(1);
    }
}
