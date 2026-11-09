using System.Net;
using System.Text.Json.Nodes;
using Penny.Backend.Application.Households;
using Penny.Backend.Application.Ledgers;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Concurrent shared-expense writes against real PostgreSQL row locks. Each race is
// repeated, and its outcome is checked against the committed rows. All data is
// synthetic.
public sealed class SharedExpenseConcurrencyTests(ApiFixture fixture)
    : SharedExpenseTestBase(fixture)
{
    private const int Rounds = 4;

    [Fact]
    public async Task whenTwoMembersEditSameRevision_UpdateExpense_ShouldCommitExactlyOne()
    {
        var (alex, alexId, bea, _, home) = await HomeAsync();
        for (var round = 0; round < Rounds; round++)
        {
            var expenseId = Id(await CreateExpenseAsync(home, alex, Expense(1000, alexId)));
            var results = await Task.WhenAll(
                OutcomeAsync(
                    SendAsync(
                        HttpMethod.Put,
                        ExpensePath(home, expenseId),
                        alex,
                        WithRevision(Expense(2000, alexId), 0)
                    )
                ),
                OutcomeAsync(
                    SendAsync(
                        HttpMethod.Put,
                        ExpensePath(home, expenseId),
                        bea,
                        WithRevision(Expense(3000, alexId), 0)
                    )
                )
            );
            results.Count(result => result.Status == HttpStatusCode.OK).ShouldBe(1);
            results.ShouldContain(result =>
                result.Status == HttpStatusCode.Conflict
                && result.Error == SharedExpenseService.Changed
            );
            var total = results[0].Status == HttpStatusCode.OK ? 2000 : 3000;
            (
                await CountAsync(
                    $"SELECT count(*) FROM penny.household_expenses WHERE id = '{expenseId}' AND revision = 1 AND total_cents = {total}"
                )
            ).ShouldBe(1L);
            (
                await CountAsync(
                    $"SELECT coalesce(sum(amount_cents), 0)::bigint FROM penny.household_splits WHERE expense_id = '{expenseId}'"
                )
            ).ShouldBe(total);
            (
                await CountAsync(
                    $"SELECT count(*) FROM penny.household_audit WHERE expense_id = '{expenseId}' AND action = 'expense.updated'"
                )
            ).ShouldBe(1L);
        }
    }

    [Fact]
    public async Task whenExpenseDeletedTwiceOrWhileEdited_ExpenseFlow_ShouldSerializeOnTheHousehold()
    {
        var (alex, alexId, bea, _, home) = await HomeAsync();
        for (var round = 0; round < Rounds; round++)
        {
            var expenseId = Id(await CreateExpenseAsync(home, alex, Expense(1000, alexId)));
            var deletes = await Task.WhenAll(
                OutcomeAsync(
                    SendAsync(
                        HttpMethod.Delete,
                        ExpensePath(home, expenseId),
                        alex,
                        new { revision = 0 }
                    )
                ),
                OutcomeAsync(
                    SendAsync(
                        HttpMethod.Delete,
                        ExpensePath(home, expenseId),
                        bea,
                        new { revision = 0 }
                    )
                )
            );
            deletes.Count(result => result.Status == HttpStatusCode.OK).ShouldBe(1);
            // The loser waited on the household lock, then found the expense deleted.
            deletes.ShouldContain(result =>
                result.Status == HttpStatusCode.NotFound
                && result.Error == SharedExpenseService.ExpenseNotFound
            );
            (
                await CountAsync(
                    $"SELECT count(*) FROM penny.household_audit WHERE expense_id = '{expenseId}' AND action = 'expense.deleted'"
                )
            ).ShouldBe(1L);

            var edited = Id(await CreateExpenseAsync(home, alex, Expense(1000, alexId)));
            var race = await Task.WhenAll(
                OutcomeAsync(
                    SendAsync(
                        HttpMethod.Put,
                        ExpensePath(home, edited),
                        bea,
                        WithRevision(Expense(5000, alexId), 0)
                    )
                ),
                OutcomeAsync(
                    SendAsync(
                        HttpMethod.Delete,
                        ExpensePath(home, edited),
                        alex,
                        new { revision = 0 }
                    )
                )
            );
            var (update, delete) = (race[0], race[1]);
            if (update.Status == HttpStatusCode.OK)
            {
                delete.Status.ShouldBe(HttpStatusCode.Conflict);
                delete.Error.ShouldBe(SharedExpenseService.Changed);
                (
                    await CountAsync(
                        $"SELECT count(*) FROM penny.household_expenses WHERE id = '{edited}' AND deleted_at IS NULL AND revision = 1"
                    )
                ).ShouldBe(1L);
            }
            else
            {
                update.Status.ShouldBe(HttpStatusCode.NotFound);
                update.Error.ShouldBe(SharedExpenseService.ExpenseNotFound);
                delete.Status.ShouldBe(HttpStatusCode.OK);
                (
                    await CountAsync(
                        $"SELECT count(*) FROM penny.household_expenses WHERE id = '{edited}' AND deleted_at IS NOT NULL AND revision = 1"
                    )
                ).ShouldBe(1L);
            }
        }
    }

    [Fact]
    public async Task whenEditRacesMemberLeaving_ExpenseFlow_ShouldNeverLeaveFormerMemberUnsettled()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        At(Noon);
        for (var round = 0; round < Rounds; round++)
        {
            var home = Id(await CreateHouseholdAsync(alex));
            await AdmitAsync(home, alex, bea);
            // Bea owes nothing yet; the edit would make her owe half.
            var expenseId = Id(
                await CreateExpenseAsync(
                    home,
                    alex,
                    Expense(1000, alexId, extra: Exact((alexId, 1000), (beaId, 0)))
                )
            );
            var results = await Task.WhenAll(
                OutcomeAsync(
                    SendAsync(
                        HttpMethod.Put,
                        ExpensePath(home, expenseId),
                        alex,
                        WithRevision(Expense(1000, alexId), 0)
                    )
                ),
                OutcomeAsync(SendAsync(HttpMethod.Post, $"/api/households/{home}/leave", bea))
            );
            var (edit, leave) = (results[0], results[1]);
            edit.Status.ShouldBe(HttpStatusCode.OK);
            var share = await CountAsync(
                $"SELECT coalesce(sum(amount_cents), 0)::bigint FROM penny.household_splits WHERE expense_id = '{expenseId}' AND user_id = '{beaId}'"
            );
            if (leave.Status == HttpStatusCode.OK)
                // Leaving won: the edit, dated on the departure day, excludes her.
                share.ShouldBe(0L);
            else
            {
                // The edit won: she owes her share and cannot leave.
                leave.Status.ShouldBe(HttpStatusCode.Conflict);
                leave.Error.ShouldBe(HouseholdService.UnsettledExit);
                share.ShouldBe(500L);
            }
        }
    }

    [Fact]
    public async Task whenEditRacesArchive_ExpenseFlow_ShouldNeverArchiveUnsettledHousehold()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        At(Noon);
        for (var round = 0; round < Rounds; round++)
        {
            var home = Id(await CreateHouseholdAsync(alex));
            await AdmitAsync(home, alex, bea);
            var expenseId = Id(
                await CreateExpenseAsync(
                    home,
                    alex,
                    Expense(1000, alexId, extra: Exact((alexId, 1000), (beaId, 0)))
                )
            );
            var results = await Task.WhenAll(
                OutcomeAsync(
                    SendAsync(
                        HttpMethod.Put,
                        ExpensePath(home, expenseId),
                        bea,
                        WithRevision(Expense(1000, alexId), 0)
                    )
                ),
                OutcomeAsync(SendAsync(HttpMethod.Post, $"/api/households/{home}/archive", alex))
            );
            var (edit, archive) = (results[0], results[1]);
            if (archive.Status == HttpStatusCode.OK)
            {
                edit.Status.ShouldBe(HttpStatusCode.NotFound);
                edit.Error.ShouldBe(HouseholdService.NotFound);
                (
                    await CountAsync(
                        $"SELECT count(*) FROM penny.household_expenses WHERE id = '{expenseId}' AND revision = 0"
                    )
                ).ShouldBe(1L);
            }
            else
            {
                archive.Status.ShouldBe(HttpStatusCode.Conflict);
                archive.Error.ShouldBe(HouseholdService.UnsettledArchive);
                edit.Status.ShouldBe(HttpStatusCode.OK);
            }
        }
    }

    [Fact]
    public async Task whenCreateRacesAccountDeletion_ExpenseFlow_ShouldNeverLinkMissingAccount()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        At(Noon);
        var home = Id(await CreateHouseholdAsync(alex));
        for (var round = 0; round < Rounds; round++)
        {
            var accountId = $"checking-{round}";
            await AddAccountAsync(alex, accountId);
            var snapshot = await GetLedgerAsync(alex);
            var accounts = snapshot["ledger"]!["accounts"]!.AsArray();
            accounts.Remove(
                accounts.Single(account => account!["id"]!.GetValue<string>() == accountId)
            );
            var results = await Task.WhenAll(
                OutcomeAsync(
                    SendAsync(
                        HttpMethod.Post,
                        ExpensesPath(home),
                        alex,
                        Expense(1000, alexId, extra: new { accountId })
                    )
                ),
                OutcomeAsync(PutLedgerAsync(alex, JsonNode.Parse(snapshot.ToJsonString())!))
            );
            var (create, save) = (results[0], results[1]);
            var linked = await CountAsync(
                $"SELECT count(*) FROM penny.household_expenses WHERE account_id = '{accountId}' AND deleted_at IS NULL"
            );
            var exists = await CountAsync(
                $"SELECT count(*) FROM penny.ledger_accounts WHERE user_id = '{alexId}' AND id = '{accountId}'"
            );
            if (create.Status == HttpStatusCode.Created)
            {
                // The expense committed first; the ledger save then saw the link.
                save.Status.ShouldBe(HttpStatusCode.BadRequest);
                save.Error.ShouldBe(LedgerService.LinkedAccount);
                (linked, exists).ShouldBe((1L, 1L));
            }
            else
            {
                create.Status.ShouldBe(HttpStatusCode.BadRequest);
                create.Error.ShouldBe(SharedExpenseService.AccountNotFound);
                save.Status.ShouldBe(HttpStatusCode.OK);
                (linked, exists).ShouldBe((0L, 0L));
            }
        }
    }

    private async Task<(
        string Alex,
        string AlexId,
        string Bea,
        string BeaId,
        string Home
    )> HomeAsync()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        At(Noon);
        var home = Id(await CreateHouseholdAsync(alex));
        await AdmitAsync(home, alex, bea);
        return (alex, alexId, bea, beaId, home);
    }
}
