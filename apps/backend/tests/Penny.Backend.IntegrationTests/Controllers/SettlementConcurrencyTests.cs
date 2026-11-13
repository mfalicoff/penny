using System.Net;
using Penny.Backend.Application.Households;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Concurrent and repeated monthly reimbursements against real PostgreSQL row locks.
// Each race is repeated in a fresh month, and its outcome is checked against the
// committed rows: balances always net to zero, nobody is ever reimbursed twice, and a
// member never leaves with an unsettled balance. All data is synthetic.
public sealed class SettlementConcurrencyTests(ApiFixture fixture) : SettlementTestBase(fixture)
{
    private const int Rounds = 4;

    [Fact]
    public async Task whenSameTransferSubmittedConcurrently_Reimburse_ShouldRecordExactlyOne()
    {
        var (alex, alexId, bea, beaId, _, camId, home) = await HomeAsync(
            new DateTimeOffset(2026, 1, 1, 12, 0, 0, TimeSpan.Zero)
        );
        At(October);
        for (var round = 0; round < Rounds; round++)
        {
            var month = $"2026-0{round + 2}";
            await CreateExpenseAsync(
                home,
                alex,
                Expense(
                    6000,
                    alexId,
                    month + "-10",
                    Exact((alexId, 3000), (beaId, 3000), (camId, 0))
                )
            );
            // The debtor double-submits while the creditor records the same transfer.
            var results = await Task.WhenAll(
                OutcomeAsync(SendReimbursementAsync(home, bea, month, beaId, alexId, 3000)),
                OutcomeAsync(SendReimbursementAsync(home, bea, month, beaId, alexId, 3000)),
                OutcomeAsync(SendReimbursementAsync(home, alex, month, beaId, alexId, 3000))
            );
            results.Count(result => result.Status == HttpStatusCode.Created).ShouldBe(1);
            results
                .Where(result => result.Status != HttpStatusCode.Created)
                .ShouldAllBe(result =>
                    result.Status == HttpStatusCode.Conflict
                    && result.Error == SettlementService.NotSuggested
                );
            (
                await CountAsync(
                    $"SELECT count(*) FROM penny.household_reimbursements WHERE household_id = '{home}' AND month = '{month}'"
                )
            ).ShouldBe(1L);
            (
                await CountAsync(
                    $"SELECT count(*) FROM penny.household_audit WHERE household_id = '{home}' AND action = 'reimbursement.created' AND after_json->>'month' = '{month}'"
                )
            ).ShouldBe(1L);
            var recap = await RecapAsync(home, alex, month);
            Balances(recap).Values.ShouldAllBe(cents => cents == 0);
        }
    }

    [Fact]
    public async Task whenSharePaymentRacesMonthlyTransfer_SettlementFlow_ShouldNeverPayTwice()
    {
        var (alex, alexId, bea, beaId, _, camId, home) = await HomeAsync(
            new DateTimeOffset(2026, 1, 1, 12, 0, 0, TimeSpan.Zero)
        );
        At(October);
        for (var round = 0; round < Rounds; round++)
        {
            var month = $"2026-0{round + 2}";
            var expense = await CreateExpenseAsync(
                home,
                alex,
                Expense(
                    6000,
                    alexId,
                    month + "-10",
                    Exact((alexId, 3000), (beaId, 3000), (camId, 0))
                )
            );
            var results = await Task.WhenAll(
                OutcomeAsync(SendReimbursementAsync(home, bea, month, beaId, alexId, 3000)),
                OutcomeAsync(
                    SendAsync(
                        HttpMethod.Post,
                        ExpensePath(home, Id(expense)) + "/payments",
                        bea,
                        new { fromUserId = beaId, revision = 0 }
                    )
                )
            );
            // Whichever commits first settles bea; the other sees it under the lock.
            results.Count(result => result.Status == HttpStatusCode.Created).ShouldBe(1);
            var loser = results.Single(result => result.Status != HttpStatusCode.Created);
            loser.Status.ShouldBe(HttpStatusCode.Conflict);
            loser.Error.ShouldBeOneOf(
                SettlementService.NotSuggested,
                SharedExpenseService.PaymentsClosed
            );
            (
                await CountAsync(
                    $"SELECT count(*) FROM penny.household_reimbursements WHERE household_id = '{home}' AND month = '{month}' AND from_user_id = '{beaId}'"
                )
            ).ShouldBe(1L);
            Balances(await RecapAsync(home, alex, month)).Values.ShouldAllBe(cents => cents == 0);
        }
    }

    [Fact]
    public async Task whenTransferRacesExpenseEdit_SettlementFlow_ShouldKeepBalancesZeroSum()
    {
        var (alex, alexId, bea, beaId, _, camId, home) = await HomeAsync(
            new DateTimeOffset(2026, 1, 1, 12, 0, 0, TimeSpan.Zero)
        );
        At(October);
        for (var round = 0; round < Rounds; round++)
        {
            var month = $"2026-0{round + 2}";
            var expense = await CreateExpenseAsync(
                home,
                alex,
                Expense(
                    6000,
                    alexId,
                    month + "-10",
                    Exact((alexId, 3000), (beaId, 3000), (camId, 0))
                )
            );
            var results = await Task.WhenAll(
                OutcomeAsync(SendReimbursementAsync(home, bea, month, beaId, alexId, 3000)),
                OutcomeAsync(
                    SendAsync(
                        HttpMethod.Put,
                        ExpensePath(home, Id(expense)),
                        alex,
                        WithRevision(
                            Expense(
                                8000,
                                alexId,
                                month + "-10",
                                Exact((alexId, 4000), (beaId, 4000), (camId, 0))
                            ),
                            0
                        )
                    )
                )
            );
            // The edit always commits (an unpaid expense); the transfer commits only if
            // it ran first. Either way the month nets to zero and bea owes exactly the
            // remaining difference.
            results[1].Status.ShouldBe(HttpStatusCode.OK);
            var recap = await RecapAsync(home, alex, month);
            Balances(recap).Values.Sum().ShouldBe(0);
            if (results[0].Status == HttpStatusCode.Created)
                Suggestions(recap).ShouldBe([(beaId, alexId, 1000L)]);
            else
            {
                results[0].Status.ShouldBe(HttpStatusCode.Conflict);
                results[0].Error.ShouldBe(SettlementService.NotSuggested);
                Suggestions(recap).ShouldBe([(beaId, alexId, 4000L)]);
            }
        }
    }

    [Fact]
    public async Task whenMemberLeavesWhileSettling_SettlementFlow_ShouldNeverLeaveUnsettled()
    {
        for (var round = 0; round < Rounds; round++)
        {
            var (alex, alexId) = await AccountAsync($"alex{round}@example.test");
            var (bea, beaId) = await AccountAsync($"bea{round}@example.test");
            At(Noon);
            var home = Id(await CreateHouseholdAsync(alex));
            await AdmitAsync(home, alex, bea);
            await CreateExpenseAsync(home, alex, Expense(6000, alexId));
            At(MonthEnd);
            var results = await Task.WhenAll(
                OutcomeAsync(SendReimbursementAsync(home, alex, "2026-09", beaId, alexId, 3000)),
                OutcomeAsync(SendAsync(HttpMethod.Post, $"/api/households/{home}/leave", bea))
            );
            results[0].Status.ShouldBe(HttpStatusCode.Created);
            // The leave either ran first (unsettled, refused) or saw the transfer.
            if (results[1].Status != HttpStatusCode.OK)
            {
                results[1].Status.ShouldBe(HttpStatusCode.Conflict);
                results[1].Error.ShouldBe(HouseholdService.UnsettledExit);
            }
            Balances(await RecapAsync(home, alex, "2026-09"))
                .Values.ShouldAllBe(cents => cents == 0);
        }
    }
}
