using System.Net;
using System.Text.Json;
using Penny.Backend.Application.Households;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Individual share payments (POST .../expenses/{expenseId}/payments) and the
// protections they give paid expenses. All data is synthetic.
public sealed class SharedExpensePaymentTests(ApiFixture fixture) : SharedExpenseTestBase(fixture)
{
    [Fact]
    public async Task whenDebtorPaysShare_PayExpense_ShouldRecordPaymentWithoutSpending()
    {
        var (alex, alexId, bea, beaId, cam, camId, home) = await HomeAsync();
        var created = await CreateExpenseAsync(home, alex, Expense(9000, alexId));
        var expenseId = Id(created);
        var projection = (await ProjectionAsync(bea, "?month=2026-09")).GetRawText();

        At(Noon.AddMinutes(1));
        var paid = await PayAsync(home, expenseId, bea, beaId, 0, HttpStatusCode.Created);
        var payment = paid.GetProperty("payments").EnumerateArray().Single();
        payment.GetProperty("fromUserId").GetString().ShouldBe(beaId);
        payment.GetProperty("amountCents").GetInt64().ShouldBe(3000);
        payment.GetProperty("createdAt").GetInt64().ShouldBe(Millis(Noon.AddMinutes(1)));
        payment.GetProperty("createdBy").GetString().ShouldBe(beaId);
        paid.GetProperty("revision").GetInt64().ShouldBe(1);
        paid.GetProperty("updatedBy").GetString().ShouldBe(beaId);
        paid.GetProperty("updatedAt").GetInt64().ShouldBe(Millis(Noon.AddMinutes(1)));
        paid.GetProperty("paymentsClosed").GetBoolean().ShouldBeFalse();
        // A payment settles a share; it is never spending.
        (await ProjectionAsync(bea, "?month=2026-09"))
            .GetRawText()
            .ShouldBe(projection);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_reimbursements WHERE expense_id = '{expenseId}' AND from_user_id = '{beaId}' AND to_user_id = '{alexId}' AND month = '2026-09' AND amount_cents = 3000"
            )
        ).ShouldBe(1L);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_audit WHERE expense_id = '{expenseId}' AND action = 'reimbursement.created' AND after_json->>'expenseId' = '{expenseId}' AND after_json->>'month' = '2026-09'"
            )
        ).ShouldBe(1L);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.push_outbox WHERE event_type = 'reimbursement.created' AND entity_id = '{expenseId}' AND payload->>'expenseId' = '{expenseId}'"
            )
        ).ShouldBe(2L);

        // The payer confirms another debtor's share; the month is then settled.
        var both = await PayAsync(home, expenseId, alex, camId, 1, HttpStatusCode.Created);
        both.GetProperty("payments").GetArrayLength().ShouldBe(2);
        await ExpectAsync(HttpMethod.Post, $"/api/households/{home}/leave", cam, HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenPaymentIsNotAllowed_PayExpense_ShouldRejectInLegacyOrder()
    {
        var (alex, alexId, bea, beaId, _, camId, home) = await HomeAsync();
        var (outsider, outsiderId) = await AccountAsync("outsider@example.test");
        var created = await CreateExpenseAsync(
            home,
            alex,
            Expense(9000, alexId, extra: Exact((alexId, 6000), (beaId, 0), (camId, 3000)))
        );
        var expenseId = Id(created);
        var path = ExpensePath(home, expenseId) + "/payments";

        // The body is validated before access.
        await ExpectErrorAsync(
            HttpMethod.Post,
            path,
            outsider,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidData,
            new { fromUserId = camId }
        );
        await Rejects(outsider, camId, 0, HttpStatusCode.NotFound, HouseholdService.NotFound);
        await ExpectErrorAsync(
            HttpMethod.Post,
            ExpensePath(home, "missing") + "/payments",
            bea,
            HttpStatusCode.NotFound,
            SharedExpenseService.ExpenseNotFound,
            new { fromUserId = camId, revision = 0 }
        );
        await Rejects(
            bea,
            camId,
            0,
            HttpStatusCode.Forbidden,
            SharedExpenseService.PaymentForbidden
        );
        await Rejects(
            alex,
            alexId,
            0,
            HttpStatusCode.BadRequest,
            SharedExpenseService.PayerOwnShare
        );
        await Rejects(alex, outsiderId, 0, HttpStatusCode.NotFound, HouseholdService.NotFound);
        await Rejects(bea, beaId, 0, HttpStatusCode.BadRequest, SharedExpenseService.PositiveShare);
        await Rejects(alex, camId, 5, HttpStatusCode.Conflict, SharedExpenseService.Changed);
        await PayAsync(home, expenseId, alex, camId, 0, HttpStatusCode.Created);
        await Rejects(alex, camId, 1, HttpStatusCode.Conflict, SharedExpenseService.AlreadyPaid);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_reimbursements WHERE household_id = '{home}'"
            )
        ).ShouldBe(1L);

        async Task Rejects(
            string token,
            string fromUserId,
            long revision,
            HttpStatusCode status,
            string message
        ) =>
            await ExpectErrorAsync(
                HttpMethod.Post,
                path,
                token,
                status,
                message,
                new { fromUserId, revision }
            );
    }

    [Fact]
    public async Task whenDebtorOrPayerLeft_PayExpense_ShouldRequireCurrentMembers()
    {
        var (alex, alexId, bea, beaId, _, camId, home) = await HomeAsync();
        var alexPaid = await CreateExpenseAsync(
            home,
            alex,
            Expense(6000, alexId, extra: Exact((alexId, 6000), (beaId, 0), (camId, 0)))
        );
        var beaPaid = await CreateExpenseAsync(
            home,
            bea,
            Expense(6000, beaId, extra: Exact((alexId, 3000), (beaId, 0), (camId, 3000)))
        );
        // Bea is owed money, so she cannot leave until alex and cam pay; record it as
        // monthly reimbursements (MAZ-58) so she is settled.
        await AddReimbursementAsync(home, "2026-09", alexId, beaId, 3000);
        await AddReimbursementAsync(home, "2026-09", camId, beaId, 3000);
        await ExpectAsync(HttpMethod.Post, $"/api/households/{home}/leave", bea, HttpStatusCode.OK);
        await ExpectErrorAsync(
            HttpMethod.Post,
            ExpensePath(home, Id(alexPaid)) + "/payments",
            alex,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound,
            new { fromUserId = beaId, revision = 0 }
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            ExpensePath(home, Id(beaPaid)) + "/payments",
            alex,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound,
            new { fromUserId = alexId, revision = 0 }
        );
    }

    [Fact]
    public async Task whenMonthHasMonthlyReimbursement_PayExpense_ShouldBeClosed()
    {
        var (alex, alexId, bea, beaId, _, _, home) = await HomeAsync();
        var created = await CreateExpenseAsync(home, alex, Expense(9000, alexId));
        var october = await CreateExpenseAsync(home, alex, Expense(9000, alexId, "2026-10-01"));
        await AddReimbursementAsync(home, "2026-09", beaId, alexId, 3000);
        var closed = await GetExpenseAsync(home, Id(created), bea);
        closed.GetProperty("paymentsClosed").GetBoolean().ShouldBeTrue();
        closed.GetProperty("payments").GetArrayLength().ShouldBe(0);
        await ExpectErrorAsync(
            HttpMethod.Post,
            ExpensePath(home, Id(created)) + "/payments",
            bea,
            HttpStatusCode.Conflict,
            SharedExpenseService.PaymentsClosed,
            new { fromUserId = beaId, revision = 0 }
        );
        (await GetExpenseAsync(home, Id(october), bea))
            .GetProperty("paymentsClosed")
            .GetBoolean()
            .ShouldBeFalse();
        await PayAsync(home, Id(october), bea, beaId, 0, HttpStatusCode.Created);
    }

    [Fact]
    public async Task whenExpenseIsPaid_UpdateOrDeleteExpense_ShouldProtectFinancesButAllowMetadata()
    {
        var (alex, alexId, bea, beaId, cam, camId, home) = await HomeAsync();
        var trip = Id(await CreateTripAsync(alex));
        var created = await CreateExpenseAsync(home, alex, Expense(6000, alexId));
        var paid = await PayAsync(home, Id(created), bea, beaId, 0, HttpStatusCode.Created);
        var original = Expense(6000, alexId);
        foreach (
            var change in new Dictionary<string, object?>[]
            {
                WithRevision(Expense(8000, alexId), 1),
                WithRevision(Expense(6000, beaId), 1),
                WithRevision(Expense(6000, alexId, "2026-10-01"), 1),
                WithRevision(original, 1, trip),
            }
        )
            await ExpectErrorAsync(
                HttpMethod.Put,
                ExpensePath(home, Id(created)),
                alex,
                HttpStatusCode.Conflict,
                SharedExpenseService.PaidLocked,
                change
            );
        await ExpectErrorAsync(
            HttpMethod.Put,
            ExpensePath(home, Id(created)),
            alex,
            HttpStatusCode.Conflict,
            SharedExpenseService.PaidShares,
            WithRevision(
                Expense(6000, alexId, extra: Exact((alexId, 4000), (beaId, 1000), (camId, 1000))),
                1
            )
        );
        await ExpectErrorAsync(
            HttpMethod.Delete,
            ExpensePath(home, Id(created)),
            alex,
            HttpStatusCode.Conflict,
            SharedExpenseService.PaidDelete,
            new { revision = 1 }
        );
        await ExpectErrorAsync(
            HttpMethod.Put,
            ExpensePath(home, Id(created)),
            alex,
            HttpStatusCode.Conflict,
            SharedExpenseService.Changed,
            WithRevision(original, 0)
        );

        // Membership changes cannot rewrite paid shares during metadata edits.
        await PayAsync(home, Id(created), alex, camId, 1, HttpStatusCode.Created);
        await ExpectAsync(HttpMethod.Post, $"/api/households/{home}/leave", cam, HttpStatusCode.OK);
        var metadata = await UpdateExpenseAsync(
            home,
            Id(created),
            alex,
            WithRevision(
                Expense(
                    6000,
                    alexId,
                    "2026-09-29",
                    new { title = "Corrected", note = "At the store" }
                ),
                2
            )
        );
        metadata.GetProperty("title").GetString().ShouldBe("Corrected");
        metadata.GetProperty("date").GetString().ShouldBe("2026-09-29");
        metadata
            .GetProperty("splits")
            .GetRawText()
            .ShouldBe(paid.GetProperty("splits").GetRawText());
        metadata.GetProperty("payments").GetArrayLength().ShouldBe(2);
        (await ListExpensesAsync(trip, alex)).ShouldBeEmpty();
    }

    private async Task<JsonElement> PayAsync(
        string householdId,
        string expenseId,
        string token,
        string fromUserId,
        long revision,
        HttpStatusCode status
    ) =>
        (
            await ExpectAsync(
                HttpMethod.Post,
                ExpensePath(householdId, expenseId) + "/payments",
                token,
                status,
                new { fromUserId, revision }
            )
        ).GetProperty("expense");

    private async Task<(
        string Alex,
        string AlexId,
        string Bea,
        string BeaId,
        string Cam,
        string CamId,
        string Home
    )> HomeAsync()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        var (cam, camId) = await AccountAsync("cam@example.test");
        At(Noon);
        var home = Id(await CreateHouseholdAsync(alex));
        await AdmitAsync(home, alex, bea);
        await AdmitAsync(home, alex, cam);
        return (alex, alexId, bea, beaId, cam, camId, home);
    }
}
