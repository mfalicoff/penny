using System.Net;
using Penny.Backend.Application.Households;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Month recaps (GET .../months/{month}) and monthly reimbursements (POST
// .../months/{month}/reimbursements) against real PostgreSQL. All data is synthetic.
public sealed class SettlementTests(ApiFixture fixture) : SettlementTestBase(fixture)
{
    [Fact]
    public async Task whenMonthHasExpenses_MonthRecap_ShouldReturnBalancesSuggestionsAndOverdue()
    {
        var (alex, alexId, bea, beaId, _, camId, home) = await HomeAsync();
        await AddAccountAsync(alex, "acct-alex");
        var created = await CreateExpenseAsync(
            home,
            alex,
            Expense(9000, alexId, extra: new { accountId = "acct-alex" })
        );

        var recap = await RecapAsync(home, bea, "2026-09");
        recap.GetProperty("month").GetString().ShouldBe("2026-09");
        var listed = recap.GetProperty("expenses").EnumerateArray().Single();
        Id(listed).ShouldBe(Id(created));
        // The payer's private account reaches only the payer.
        listed.TryGetProperty("accountId", out _).ShouldBeFalse();
        (await RecapAsync(home, alex, "2026-09"))
            .GetProperty("expenses")[0]
            .GetProperty("accountId")
            .GetString()
            .ShouldBe("acct-alex");
        recap.GetProperty("reimbursements").GetArrayLength().ShouldBe(0);
        var balances = Balances(recap);
        balances.Count.ShouldBe(3);
        balances[alexId].ShouldBe(6000);
        balances[beaId].ShouldBe(-3000);
        balances[camId].ShouldBe(-3000);
        recap
            .GetProperty("balances")
            .EnumerateArray()
            .Select(balance => balance.GetProperty("userId").GetString())
            .ShouldBe(new[] { alexId, beaId, camId }.Order(StringComparer.Ordinal));
        Suggestions(recap)
            .ShouldBe([(beaId, alexId, 3000L), (camId, alexId, 3000L)], ignoreOrder: true);
        recap.GetProperty("overdue").GetBoolean().ShouldBeFalse();
        OverdueMonths(recap).ShouldBeEmpty();

        // Once October starts (UTC), September is overdue, also from October's recap.
        At(new DateTimeOffset(2026, 10, 1, 0, 0, 0, TimeSpan.Zero));
        var late = await RecapAsync(home, bea, "2026-09");
        late.GetProperty("overdue").GetBoolean().ShouldBeTrue();
        OverdueMonths(late).ShouldBe(["2026-09"]);
        var october = await RecapAsync(home, bea, "2026-10");
        october.GetProperty("overdue").GetBoolean().ShouldBeFalse();
        october.GetProperty("balances").GetArrayLength().ShouldBe(0);
        OverdueMonths(october).ShouldBe(["2026-09"]);
        // A month without any rows is empty and settled.
        var empty = await RecapAsync(home, bea, "2025-01");
        empty.GetProperty("expenses").GetArrayLength().ShouldBe(0);
        empty.GetProperty("suggestions").GetArrayLength().ShouldBe(0);
        empty.GetProperty("overdue").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task whenMonthEndApproaches_Reimburse_ShouldOpenOnTheLastUtcDay()
    {
        var (alex, alexId, bea, beaId, _, _, home) = await HomeAsync();
        await CreateExpenseAsync(home, alex, Expense(9000, alexId));

        // 11:59 p.m. UTC on Sep 29 is still before the last day, whatever the zone.
        At(MonthEnd.AddMilliseconds(-1));
        await ExpectErrorAsync(
            HttpMethod.Post,
            ReimbursementsPath(home, "2026-09"),
            bea,
            HttpStatusCode.Conflict,
            SettlementService.MonthOpen,
            Transfer(beaId, alexId, 3000)
        );
        // The rejected attempt wrote nothing.
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_reimbursements WHERE household_id = '{home}'"
            )
        ).ShouldBe(0L);
        // Midnight UTC on Sep 30 (8 p.m. on Sep 29 in Toronto) opens the month.
        At(MonthEnd);
        await ReimburseAsync(home, bea, "2026-09", beaId, alexId, 3000);
        // A later month is still open; an earlier one can be settled any time after.
        await ExpectErrorAsync(
            HttpMethod.Post,
            ReimbursementsPath(home, "2026-10"),
            bea,
            HttpStatusCode.Conflict,
            SettlementService.MonthOpen,
            Transfer(beaId, alexId, 3000)
        );
    }

    [Fact]
    public async Task whenMembersSettle_Reimburse_ShouldSettlePartiallyThenCompletelyWithoutSpending()
    {
        var (alex, alexId, bea, beaId, cam, camId, home) = await HomeAsync();
        var expense = await CreateExpenseAsync(home, alex, Expense(9000, alexId));
        var projection = (await ProjectionAsync(bea, "?month=2026-09")).GetRawText();
        var searchDocuments = await CountAsync("SELECT count(*) FROM penny.search_documents");
        At(MonthEnd.AddHours(9));

        // Partial: bea pays her full suggested transfer; cam still owes.
        var first = await ReimburseAsync(home, bea, "2026-09", beaId, alexId, 3000);
        first.GetProperty("householdId").GetString().ShouldBe(home);
        first.GetProperty("month").GetString().ShouldBe("2026-09");
        first.GetProperty("fromUserId").GetString().ShouldBe(beaId);
        first.GetProperty("toUserId").GetString().ShouldBe(alexId);
        first.GetProperty("amountCents").GetInt64().ShouldBe(3000);
        first.GetProperty("createdBy").GetString().ShouldBe(beaId);
        first.GetProperty("createdAt").GetInt64().ShouldBe(Millis(MonthEnd.AddHours(9)));
        first.TryGetProperty("expenseId", out _).ShouldBeFalse();
        var partial = await RecapAsync(home, cam, "2026-09");
        Balances(partial)[beaId].ShouldBe(0);
        Suggestions(partial).ShouldBe([(camId, alexId, 3000L)]);
        var listed = partial.GetProperty("reimbursements").EnumerateArray().Single();
        Id(listed).ShouldBe(Id(first));
        listed.TryGetProperty("expenseId", out _).ShouldBeFalse();
        // The month is closed to individual share payments.
        (await GetExpenseAsync(home, Id(expense), cam))
            .GetProperty("paymentsClosed")
            .GetBoolean()
            .ShouldBeTrue();
        await ExpectErrorAsync(
            HttpMethod.Post,
            ExpensePath(home, Id(expense)) + "/payments",
            cam,
            HttpStatusCode.Conflict,
            SharedExpenseService.PaymentsClosed,
            new { fromUserId = camId, revision = 0 }
        );

        // Repeating the same transfer is no longer a full suggestion.
        await ExpectErrorAsync(
            HttpMethod.Post,
            ReimbursementsPath(home, "2026-09"),
            bea,
            HttpStatusCode.Conflict,
            SettlementService.NotSuggested,
            Transfer(beaId, alexId, 3000)
        );
        // The creditor may record the debtor's transfer; part of it is not enough.
        await ExpectErrorAsync(
            HttpMethod.Post,
            ReimbursementsPath(home, "2026-09"),
            alex,
            HttpStatusCode.Conflict,
            SettlementService.NotSuggested,
            Transfer(camId, alexId, 2999)
        );
        await ReimburseAsync(home, alex, "2026-09", camId, alexId, 3000);
        var settled = await RecapAsync(home, cam, "2026-09");
        Balances(settled).Values.ShouldAllBe(cents => cents == 0);
        settled.GetProperty("suggestions").GetArrayLength().ShouldBe(0);
        settled.GetProperty("reimbursements").GetArrayLength().ShouldBe(2);
        At(October);
        (await RecapAsync(home, cam, "2026-09"))
            .GetProperty("overdue")
            .GetBoolean()
            .ShouldBeFalse();
        await ExpectErrorAsync(
            HttpMethod.Post,
            ReimbursementsPath(home, "2026-09"),
            cam,
            HttpStatusCode.Conflict,
            SettlementService.NotSuggested,
            Transfer(camId, alexId, 3000)
        );

        // Reimbursements are never spending: projections and search are unchanged.
        (await ProjectionAsync(bea, "?month=2026-09"))
            .GetRawText()
            .ShouldBe(projection);
        (await CountAsync("SELECT count(*) FROM penny.search_documents")).ShouldBe(searchDocuments);
        // One audit row per transfer, without an expense, and push rows for the other
        // current members keyed by the event (legacy payload without `expenseId`).
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_audit WHERE household_id = '{home}' AND action = 'reimbursement.created' AND expense_id IS NULL AND after_json->>'month' = '2026-09' AND NOT after_json ? 'expenseId'"
            )
        ).ShouldBe(2L);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.push_outbox o JOIN penny.household_audit a ON a.id = o.entity_id WHERE o.household_id = '{home}' AND o.event_type = 'reimbursement.created' AND o.payload->>'eventId' = a.id AND o.payload->>'month' = '2026-09' AND NOT o.payload ? 'expenseId' AND o.user_id <> a.actor_id"
            )
        ).ShouldBe(4L);

        // Everyone is settled, so members may leave and the household may be archived.
        await ExpectAsync(HttpMethod.Post, $"/api/households/{home}/leave", bea, HttpStatusCode.OK);
        await ExpectAsync(HttpMethod.Post, $"/api/households/{home}/leave", cam, HttpStatusCode.OK);
        await ExpectAsync(
            HttpMethod.Post,
            $"/api/households/{home}/archive",
            alex,
            HttpStatusCode.OK
        );
        // Archived households stay readable but accept no reimbursements.
        (await RecapAsync(home, alex, "2026-09"))
            .GetProperty("reimbursements")
            .GetArrayLength()
            .ShouldBe(2);
        await ExpectErrorAsync(
            HttpMethod.Post,
            ReimbursementsPath(home, "2026-09"),
            alex,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound,
            Transfer(camId, alexId, 3000)
        );
    }

    [Fact]
    public async Task whenSharesWerePaidIndividually_Reimburse_ShouldPayOnlyTheRemainder()
    {
        var (alex, alexId, bea, beaId, _, camId, home) = await HomeAsync();
        var first = await CreateExpenseAsync(
            home,
            alex,
            Expense(6000, alexId, extra: Exact((alexId, 3000), (beaId, 3000), (camId, 0)))
        );
        await CreateExpenseAsync(
            home,
            alex,
            Expense(6000, alexId, extra: Exact((alexId, 3000), (beaId, 3000), (camId, 0)))
        );
        await ExpectAsync(
            HttpMethod.Post,
            ExpensePath(home, Id(first)) + "/payments",
            bea,
            HttpStatusCode.Created,
            new { fromUserId = beaId, revision = 0 }
        );
        At(MonthEnd);
        var recap = await RecapAsync(home, bea, "2026-09");
        Balances(recap)[beaId].ShouldBe(-3000);
        Balances(recap)[camId].ShouldBe(0);
        Suggestions(recap).ShouldBe([(beaId, alexId, 3000L)]);
        recap
            .GetProperty("reimbursements")
            .EnumerateArray()
            .Single()
            .GetProperty("expenseId")
            .GetString()
            .ShouldBe(Id(first));
        // The whole month's debt is no longer a suggestion; the remainder is.
        await ExpectErrorAsync(
            HttpMethod.Post,
            ReimbursementsPath(home, "2026-09"),
            bea,
            HttpStatusCode.Conflict,
            SettlementService.NotSuggested,
            Transfer(beaId, alexId, 6000)
        );
        await ReimburseAsync(home, bea, "2026-09", beaId, alexId, 3000);
        Balances(await RecapAsync(home, alex, "2026-09")).Values.ShouldAllBe(cents => cents == 0);
    }

    [Fact]
    public async Task whenReimbursementIsNotAllowed_Reimburse_ShouldRejectInLegacyOrder()
    {
        var (alex, alexId, bea, beaId, cam, camId, home) = await HomeAsync();
        var (outsider, outsiderId) = await AccountAsync("outsider@example.test");
        await CreateExpenseAsync(home, alex, Expense(9000, alexId));
        At(MonthEnd);
        var path = ReimbursementsPath(home, "2026-09");

        // Access comes first: outsiders, unknown households and bad month values.
        await ExpectErrorAsync(
            HttpMethod.Post,
            path,
            outsider,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound,
            new { }
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            ReimbursementsPath("missing", "2026-09"),
            bea,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound,
            Transfer(beaId, alexId, 3000)
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            ReimbursementsPath(home, "2026-13"),
            bea,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidData,
            Transfer(beaId, alexId, 3000)
        );
        foreach (
            var body in new object[]
            {
                new { fromUserId = beaId, toUserId = alexId },
                new
                {
                    fromUserId = beaId,
                    toUserId = alexId,
                    amountCents = 0,
                },
                new
                {
                    fromUserId = beaId,
                    toUserId = alexId,
                    amountCents = 30.5,
                },
                new
                {
                    fromUserId = "",
                    toUserId = alexId,
                    amountCents = 3000,
                },
            }
        )
            await ExpectErrorAsync(
                HttpMethod.Post,
                path,
                bea,
                HttpStatusCode.BadRequest,
                HouseholdService.InvalidData,
                body
            );
        await ExpectErrorAsync(
            HttpMethod.Post,
            path,
            bea,
            HttpStatusCode.BadRequest,
            SettlementService.SameMember,
            Transfer(beaId, beaId, 3000)
        );
        // Only the two people involved can record a transfer.
        await ExpectErrorAsync(
            HttpMethod.Post,
            path,
            cam,
            HttpStatusCode.Forbidden,
            SettlementService.NotInvolved,
            Transfer(beaId, alexId, 3000)
        );
        // The direction and the amount must match a suggestion exactly.
        await ExpectErrorAsync(
            HttpMethod.Post,
            path,
            bea,
            HttpStatusCode.Conflict,
            SettlementService.NotSuggested,
            Transfer(alexId, beaId, 3000)
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            path,
            bea,
            HttpStatusCode.Conflict,
            SettlementService.NotSuggested,
            Transfer(beaId, outsiderId, 3000)
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            path,
            cam,
            HttpStatusCode.Conflict,
            SettlementService.NotSuggested,
            Transfer(camId, alexId, 3001)
        );
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_reimbursements WHERE household_id = '{home}'"
            )
        ).ShouldBe(0L);
        (await AuditCountAsync(home, "reimbursement.created")).ShouldBe(0L);
    }

    [Fact]
    public async Task whenMonthsAreSeparate_MonthRecap_ShouldNeverOffsetOneMonthWithAnother()
    {
        var (alex, alexId, bea, beaId, _, camId, home) = await HomeAsync(
            new DateTimeOffset(2026, 7, 1, 12, 0, 0, TimeSpan.Zero)
        );
        // August: bea owes alex 30.00. September: alex owes bea 30.00.
        await CreateExpenseAsync(
            home,
            alex,
            Expense(6000, alexId, "2026-08-15", Exact((alexId, 3000), (beaId, 3000), (camId, 0)))
        );
        await CreateExpenseAsync(
            home,
            bea,
            Expense(6000, beaId, "2026-09-15", Exact((alexId, 3000), (beaId, 3000), (camId, 0)))
        );
        At(October);
        var august = await RecapAsync(home, alex, "2026-08");
        Suggestions(august).ShouldBe([(beaId, alexId, 3000L)]);
        august.GetProperty("overdue").GetBoolean().ShouldBeTrue();
        OverdueMonths(august).ShouldBe(["2026-08", "2026-09"]);
        Suggestions(await RecapAsync(home, alex, "2026-09")).ShouldBe([(alexId, beaId, 3000L)]);
        // Neither can leave: a credit in one month does not pay a debt in another.
        await ExpectErrorAsync(
            HttpMethod.Post,
            $"/api/households/{home}/leave",
            bea,
            HttpStatusCode.Conflict,
            HouseholdService.UnsettledExit
        );

        await ReimburseAsync(home, bea, "2026-08", beaId, alexId, 3000);
        var september = await RecapAsync(home, bea, "2026-09");
        OverdueMonths(september).ShouldBe(["2026-09"]);
        Balances(await RecapAsync(home, bea, "2026-08")).Values.ShouldAllBe(cents => cents == 0);
        await ReimburseAsync(home, bea, "2026-09", alexId, beaId, 3000);
        OverdueMonths(await RecapAsync(home, bea, "2026-09")).ShouldBeEmpty();
        // Cam had zero shares in both months and was never in a suggestion.
        Balances(august)[camId].ShouldBe(0);
        await ExpectAsync(HttpMethod.Post, $"/api/households/{home}/leave", bea, HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenMemberLeftAfterSettling_MonthRecap_ShouldShowOnlyTheirHistory()
    {
        var (alex, alexId, bea, beaId, cam, camId, home) = await HomeAsync();
        var shared = await CreateExpenseAsync(home, alex, Expense(9000, alexId));
        At(MonthEnd.AddHours(1));
        await ReimburseAsync(home, bea, "2026-09", beaId, alexId, 3000);
        await ExpectAsync(HttpMethod.Post, $"/api/households/{home}/leave", bea, HttpStatusCode.OK);
        // After bea left: an expense dated on her departure day (without her), cam's
        // transfer and an October expense.
        At(MonthEnd.AddHours(2));
        var later = await CreateExpenseAsync(home, alex, Expense(2000, alexId, "2026-09-30"));
        SplitUsers(later).ShouldBe(new[] { alexId, camId }.Order(StringComparer.Ordinal));
        await ReimburseAsync(home, cam, "2026-09", camId, alexId, 4000);
        await CreateExpenseAsync(home, alex, Expense(1000, alexId, "2026-10-01"));

        var mine = await RecapAsync(home, bea, "2026-09");
        mine.GetProperty("expenses").EnumerateArray().Select(Id).ShouldBe([Id(shared)]);
        mine.GetProperty("reimbursements")
            .EnumerateArray()
            .Select(item => item.GetProperty("fromUserId").GetString())
            .ShouldBe([beaId]);
        Balances(mine)[beaId].ShouldBe(0);
        // Months after the one she left in are not hers.
        await ExpectErrorAsync(
            HttpMethod.Get,
            MonthPath(home, "2026-10"),
            bea,
            HttpStatusCode.NotFound,
            SettlementService.MonthNotFound
        );
        // Current members see everything, settled.
        var all = await RecapAsync(home, cam, "2026-09");
        all.GetProperty("expenses").GetArrayLength().ShouldBe(2);
        all.GetProperty("reimbursements").GetArrayLength().ShouldBe(2);
        Balances(all).Values.ShouldAllBe(cents => cents == 0);
        // Outsiders and invalid months.
        var (outsider, _) = await AccountAsync("outsider@example.test");
        await ExpectErrorAsync(
            HttpMethod.Get,
            MonthPath(home, "2026-09"),
            outsider,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound
        );
        await ExpectErrorAsync(
            HttpMethod.Get,
            MonthPath(home, "2026-9"),
            alex,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidData
        );
        await ExpectErrorAsync(
            HttpMethod.Get,
            MonthPath(home, "2026-00"),
            alex,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidData
        );
    }
}
