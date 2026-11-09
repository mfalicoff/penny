using System.Net;
using System.Text;
using System.Text.Json;
using Penny.Backend.Application.Households;
using Penny.Backend.Domain.Households;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Shared expense CRUD over real HTTP and PostgreSQL: split modes and rounding,
// historical participants, payer privacy, receipts, revisions, soft deletion, moves
// and audit/outbox rows. All data is synthetic.
public sealed class SharedExpenseTests(ApiFixture fixture) : SharedExpenseTestBase(fixture)
{
    [Fact]
    public async Task whenMembersSplitExpense_CreateExpense_ShouldAllocateIntegerCentsByMode()
    {
        var (alex, alexId, bea, beaId, _, camId, home) = await HomeAsync();
        var sorted = new[] { alexId, beaId, camId }.Order(StringComparer.Ordinal).ToArray();

        var equal = await CreateExpenseAsync(home, alex, Expense(10_000, alexId));
        SplitUsers(equal).ShouldBe(sorted);
        Amounts(equal).ShouldBe([3334L, 3333L, 3333L]);
        equal.GetProperty("householdId").GetString().ShouldBe(home);
        equal.GetProperty("title").GetString().ShouldBe("Groceries");
        equal.GetProperty("date").GetString().ShouldBe("2026-09-28");
        equal.GetProperty("splitMode").GetString().ShouldBe("equal");
        equal.GetProperty("payments").GetArrayLength().ShouldBe(0);
        equal.GetProperty("paymentsClosed").GetBoolean().ShouldBeFalse();
        equal.GetProperty("category").GetProperty("color").GetString().ShouldBe("#6C9C79");
        equal.GetProperty("note").GetString().ShouldBe("");
        equal.GetProperty("revision").GetInt64().ShouldBe(0);
        equal.GetProperty("createdBy").GetString().ShouldBe(alexId);
        equal.GetProperty("createdAt").GetInt64().ShouldBe(Millis(Noon));
        equal.GetProperty("updatedBy").GetString().ShouldBe(alexId);
        equal.GetProperty("updatedAt").GetInt64().ShouldBe(Millis(Noon));
        foreach (var absent in new[] { "accountId", "receiptId", "receipt", "recurringId" })
            equal.TryGetProperty(absent, out _).ShouldBeFalse(absent);

        // Exact shares may be zero; percentage rounding hands out the odd cent.
        var exact = await CreateExpenseAsync(
            home,
            bea,
            Expense(9000, beaId, extra: Exact((camId, 3000), (alexId, 6000), (beaId, 0)))
        );
        exact
            .GetProperty("splits")
            .EnumerateArray()
            .ToDictionary(
                share => share.GetProperty("userId").GetString()!,
                share => share.GetProperty("amountCents").GetInt64()
            )
            .ShouldBe(
                new Dictionary<string, long>
                {
                    [alexId] = 6000,
                    [beaId] = 0,
                    [camId] = 3000,
                },
                ignoreOrder: true
            );
        var percent = await CreateExpenseAsync(
            home,
            alex,
            Expense(
                1,
                alexId,
                extra: Percent((sorted[2], 3334), (sorted[1], 3333), (sorted[0], 3333))
            )
        );
        Amounts(percent).ShouldBe([0L, 0L, 1L]);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_splits s JOIN penny.household_expenses e ON e.id = s.expense_id WHERE e.household_id = '{home}'"
            )
        ).ShouldBe(9L);
        (await ListExpensesAsync(home, bea)).Count.ShouldBe(3);
    }

    [Fact]
    public async Task whenRequestIsInvalid_CreateExpense_ShouldReturnLegacyMessagesInOrder()
    {
        var (alex, alexId, bea, beaId, _, camId, home) = await HomeAsync();
        var (outsider, _) = await AccountAsync("outsider@example.test");

        // Membership is checked before the body.
        await ExpectErrorAsync(
            HttpMethod.Post,
            ExpensesPath(home),
            outsider,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound,
            new { title = "" }
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            ExpensesPath("missing"),
            alex,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound,
            Expense(100, alexId)
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            ExpensesPath(home),
            alex,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidData,
            Expense(100, alexId, extra: new { totalCents = 0 })
        );
        using (var malformed = Authorized(HttpMethod.Post, ExpensesPath(home), bearer: alex))
        {
            malformed.Content = new StringContent("{", Encoding.UTF8, "application/json");
            using var response = await Client.SendAsync(malformed, Ct);
            response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
            (await response.Content.ReadAsStringAsync(Ct)).ShouldContain("Invalid JSON.");
        }

        async Task Rejected(string message, object extra, string payer) =>
            await ExpectErrorAsync(
                HttpMethod.Post,
                ExpensesPath(home),
                bea,
                HttpStatusCode.BadRequest,
                message,
                Expense(10_000, payer, extra: extra)
            );
        var (_, outsiderId) = await AccountAsync("payer@example.test");
        await Rejected(SharedExpenseService.PayerNotMember, new { }, outsiderId);
        await Rejected(ExpenseSplit.EveryMember, new { splitMode = "exact" }, alexId);
        await Rejected(ExpenseSplit.EveryMember, Exact((alexId, 5000), (beaId, 5000)), alexId);
        await Rejected(
            ExpenseSplit.EveryMember,
            Exact((alexId, 5000), (beaId, 5000), (outsiderId, 0)),
            alexId
        );
        await Rejected(
            ExpenseSplit.ExactAmounts,
            new
            {
                splitMode = "exact",
                allocations = new object[]
                {
                    new { userId = alexId, amountCents = 5000 },
                    new { userId = beaId, amountCents = 5000 },
                    new { userId = camId, percentBasisPoints = 0 },
                },
            },
            alexId
        );
        await Rejected(
            ExpenseSplit.PercentAmounts,
            new
            {
                splitMode = "percent",
                allocations = new object[]
                {
                    new { userId = alexId, percentBasisPoints = 5000 },
                    new { userId = beaId, percentBasisPoints = 5000 },
                    new { userId = camId, amountCents = 0 },
                },
            },
            alexId
        );
        await Rejected(
            ExpenseSplit.Total,
            Exact((alexId, 5000), (beaId, 2500), (camId, 2499)),
            alexId
        );
        await Rejected(
            ExpenseSplit.Total,
            Percent((alexId, 5000), (beaId, 2500), (camId, 2499)),
            alexId
        );
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_expenses WHERE household_id = '{home}'"
            )
        ).ShouldBe(0L);
        (await AuditCountAsync(home, "expense.created")).ShouldBe(0L);
    }

    [Fact]
    public async Task whenMembershipChangesOverTime_CreateExpense_ShouldSplitAmongMembersOnExpenseDate()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        At(Noon);
        var home = Id(await CreateHouseholdAsync(alex));
        At(new DateTimeOffset(2026, 10, 5, 12, 0, 0, TimeSpan.Zero));
        await AdmitAsync(home, alex, bea);

        // Joining never pulls a member into expenses dated before they joined.
        SplitUsers(await CreateExpenseAsync(home, alex, Expense(1000, alexId, "2026-10-04")))
            .ShouldBe([alexId]);
        var joined = await CreateExpenseAsync(
            home,
            alex,
            Expense(1000, alexId, "2026-10-05", Exact((alexId, 1000), (beaId, 0)))
        );
        SplitUsers(joined).Count.ShouldBe(2);
        await ExpectErrorAsync(
            HttpMethod.Post,
            ExpensesPath(home),
            alex,
            HttpStatusCode.BadRequest,
            SharedExpenseService.PayerNotMember,
            Expense(1000, beaId, "2026-10-04")
        );

        // After leaving, the departure day and later exclude them; earlier days don't.
        At(new DateTimeOffset(2026, 10, 10, 12, 0, 0, TimeSpan.Zero));
        await ExpectAsync(HttpMethod.Post, $"/api/households/{home}/leave", bea, HttpStatusCode.OK);
        SplitUsers(await CreateExpenseAsync(home, alex, Expense(1000, alexId, "2026-10-10")))
            .ShouldBe([alexId]);
        SplitUsers(await CreateExpenseAsync(home, alex, Expense(1000, alexId, "2026-10-09")))
            .Count.ShouldBe(2);

        // Shared trips split among every current member, whatever the booking date.
        var trip = Id(await CreateTripAsync(alex));
        await AdmitAsync(trip, alex, bea);
        Amounts(await CreateExpenseAsync(trip, bea, Expense(9000, beaId, "2026-08-01")))
            .ShouldBe([4500L, 4500L]);
    }

    [Fact]
    public async Task whenMemberJoinsAfterUtcMidnight_CreateExpense_ShouldUseLocalJoinDay()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, _) = await AccountAsync("bea@example.test");
        var (cam, _) = await AccountAsync("cam@example.test");
        // October 4 at 9:30 p.m. in Toronto.
        At(new DateTimeOffset(2026, 10, 5, 1, 30, 0, TimeSpan.Zero));
        var home = Id(await CreateHouseholdAsync(alex, offset: 240));
        await AdmitAsync(home, alex, bea, offset: 240);
        Amounts(await CreateExpenseAsync(home, alex, Expense(2000, alexId, "2026-10-04")))
            .ShouldBe([1000L, 1000L]);
        // An older client joined without an offset: its day comes from the caller's.
        await AdmitAsync(home, alex, cam);
        Amounts(
                await CreateExpenseAsync(
                    home,
                    alex,
                    Expense(3000, alexId, "2026-10-04", new { timezoneOffsetMinutes = 240 })
                )
            )
            .ShouldBe([1000L, 1000L, 1000L]);
        Amounts(await CreateExpenseAsync(home, alex, Expense(2000, alexId, "2026-10-04")))
            .ShouldBe([1000L, 1000L]);
    }

    [Fact]
    public async Task whenPayerLinksPrivateAccount_ExpenseFlow_ShouldExposeItOnlyToPayer()
    {
        var (alex, alexId, bea, beaId, cam, camId, home) = await HomeAsync();
        await AddAccountAsync(alex, "checking");
        await ExpectErrorAsync(
            HttpMethod.Post,
            ExpensesPath(home),
            bea,
            HttpStatusCode.Forbidden,
            SharedExpenseService.PayerOnlyAccount,
            Expense(10_000, alexId, extra: new { accountId = "checking" })
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            ExpensesPath(home),
            alex,
            HttpStatusCode.BadRequest,
            SharedExpenseService.AccountNotFound,
            Expense(10_000, alexId, extra: new { accountId = "savings" })
        );
        var created = await CreateExpenseAsync(
            home,
            alex,
            Expense(10_000, alexId, extra: new { accountId = "checking" })
        );
        var expenseId = Id(created);
        created.GetProperty("accountId").GetString().ShouldBe("checking");
        (await GetExpenseAsync(home, expenseId, bea))
            .TryGetProperty("accountId", out _)
            .ShouldBeFalse();
        (await ListExpensesAsync(home, cam))
            .Single()
            .TryGetProperty("accountId", out _)
            .ShouldBeFalse();
        (await ProjectionAsync(bea, "?month=2026-09"))
            .GetProperty("transactions")[0]
            .TryGetProperty("accountId", out _)
            .ShouldBeFalse();
        (await ProjectionAsync(alex, "?month=2026-09"))
            .GetProperty("transactions")[0]
            .GetProperty("accountId")
            .GetString()
            .ShouldBe("checking");

        // Another member's edit keeps the payer's account; they cannot set one.
        var exact = Expense(
            10_000,
            alexId,
            extra: Exact((alexId, 5000), (beaId, 2500), (camId, 2500))
        );
        await ExpectErrorAsync(
            HttpMethod.Put,
            ExpensePath(home, expenseId),
            bea,
            HttpStatusCode.Forbidden,
            SharedExpenseService.PayerOnlyAccount,
            WithRevision(Expense(10_000, alexId, extra: new { accountId = "checking" }), 0)
        );
        var edited = await UpdateExpenseAsync(home, expenseId, bea, WithRevision(exact, 0));
        edited.TryGetProperty("accountId", out _).ShouldBeFalse();
        (await GetExpenseAsync(home, expenseId, alex))
            .GetProperty("accountId")
            .GetString()
            .ShouldBe("checking");
        // The payer's own edit without an account clears it.
        await UpdateExpenseAsync(home, expenseId, alex, WithRevision(exact, 1));
        (await GetExpenseAsync(home, expenseId, alex))
            .TryGetProperty("accountId", out _)
            .ShouldBeFalse();

        // History and notifications never carry the account.
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_audit WHERE expense_id = '{expenseId}'"
            )
        ).ShouldBe(3L);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_audit WHERE expense_id = '{expenseId}' AND (coalesce(before_json::text, '') LIKE '%checking%' OR coalesce(after_json::text, '') LIKE '%checking%')"
            )
        ).ShouldBe(0L);
        (
            await CountAsync(
                "SELECT count(*) FROM penny.push_outbox WHERE payload::text LIKE '%checking%'"
            )
        ).ShouldBe(0L);
    }

    [Fact]
    public async Task whenReceiptIsAttached_ExpenseFlow_ShouldShareOnlyAvailableReceipts()
    {
        var (alex, alexId, bea, beaId, _, _, home) = await HomeAsync();
        await AddReceiptAsync(alexId, "receipt-alex", "Slip.pdf");
        await AddReceiptAsync(beaId, "receipt-bea", "Bea.pdf");
        await ExpectErrorAsync(
            HttpMethod.Post,
            ExpensesPath(home),
            bea,
            HttpStatusCode.BadRequest,
            SharedExpenseService.ReceiptUnavailable,
            Expense(1000, beaId, extra: new { receiptId = "receipt-alex" })
        );
        var created = await CreateExpenseAsync(
            home,
            alex,
            Expense(1000, alexId, extra: new { receiptId = "receipt-alex" })
        );
        created.GetProperty("receiptId").GetString().ShouldBe("receipt-alex");
        var receipt = (await GetExpenseAsync(home, Id(created), bea)).GetProperty("receipt");
        receipt.GetProperty("id").GetString().ShouldBe("receipt-alex");
        receipt.GetProperty("name").GetString().ShouldBe("Slip.pdf");
        receipt.GetProperty("mime").GetString().ShouldBe("application/pdf");
        receipt.GetProperty("uri").GetString().ShouldBe("/api/receipts/receipt-alex");
        // Once shared in the household, other members may attach it too; their own
        // uploads always work.
        await CreateExpenseAsync(
            home,
            bea,
            Expense(1000, beaId, extra: new { receiptId = "receipt-alex" })
        );
        await CreateExpenseAsync(
            home,
            bea,
            Expense(1000, beaId, extra: new { receiptId = "receipt-bea" })
        );
        var other = Id(await CreateHouseholdAsync(bea, "Other"));
        await ExpectErrorAsync(
            HttpMethod.Post,
            ExpensesPath(other),
            bea,
            HttpStatusCode.BadRequest,
            SharedExpenseService.ReceiptUnavailable,
            Expense(1000, beaId, extra: new { receiptId = "receipt-alex" })
        );
        // Encrypted filenames are never copied into plaintext history.
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_audit WHERE household_id = '{home}' AND after_json->>'receiptId' = 'receipt-alex' AND after_json->'receipt' ? 'uri' AND NOT (after_json->'receipt' ? 'name')"
            )
        ).ShouldBe(2L);
    }

    [Fact]
    public async Task whenFormerMemberReads_ExpenseFlow_ShouldSeeOnlyTheirOwnHistory()
    {
        var (alex, alexId, bea, beaId, cam, camId, home) = await HomeAsync();
        var (outsider, _) = await AccountAsync("outsider@example.test");
        var old = await CreateExpenseAsync(
            home,
            alex,
            Expense(9000, alexId, extra: Exact((alexId, 6000), (beaId, 0), (camId, 3000)))
        );
        await ExpectAsync(HttpMethod.Post, $"/api/households/{home}/leave", bea, HttpStatusCode.OK);
        var newer = await CreateExpenseAsync(home, alex, Expense(1200, alexId, "2026-10-01"));

        (await ListExpensesAsync(home, bea)).Select(Id).ShouldBe([Id(old)]);
        (await GetExpenseAsync(home, Id(old), bea)).GetProperty("id").GetString().ShouldBe(Id(old));
        await ExpectErrorAsync(
            HttpMethod.Get,
            ExpensePath(home, Id(newer)),
            bea,
            HttpStatusCode.NotFound,
            SharedExpenseService.ExpenseNotFound
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            ExpensesPath(home),
            bea,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound,
            Expense(100, beaId)
        );
        (await ListExpensesAsync(home, cam)).Count.ShouldBe(2);
        await ExpectErrorAsync(
            HttpMethod.Get,
            ExpensesPath(home),
            outsider,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound
        );
        await ExpectErrorAsync(
            HttpMethod.Get,
            ExpensePath(home, Id(old)),
            outsider,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound
        );

        // Month filter and its legacy validation; newest first.
        (await ListExpensesAsync(home, cam, "?month=2026-10"))
            .Select(Id)
            .ShouldBe([Id(newer)]);
        (await ListExpensesAsync(home, cam)).Select(Id).ShouldBe([Id(newer), Id(old)]);
        await ExpectErrorAsync(
            HttpMethod.Get,
            ExpensesPath(home) + "?month=2026-13",
            cam,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidData
        );

        // Archived households stay readable by members.
        await ExpectAsync(
            HttpMethod.Put,
            ExpensePath(home, Id(old)),
            alex,
            HttpStatusCode.OK,
            WithRevision(Expense(9000, alexId, extra: Exact((alexId, 9000), (camId, 0))), 0)
        );
        await ExpectAsync(
            HttpMethod.Put,
            ExpensePath(home, Id(newer)),
            alex,
            HttpStatusCode.OK,
            WithRevision(Expense(1200, alexId, "2026-10-01", Exact((alexId, 1200), (camId, 0))), 0)
        );
        await ExpectAsync(
            HttpMethod.Post,
            $"/api/households/{home}/archive",
            alex,
            HttpStatusCode.OK
        );
        (await ListExpensesAsync(home, cam)).Count.ShouldBe(2);
        await ExpectErrorAsync(
            HttpMethod.Post,
            ExpensesPath(home),
            alex,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound,
            Expense(100, alexId)
        );
    }

    [Fact]
    public async Task whenExpenseIsEditedOrDeleted_ExpenseFlow_ShouldCompareAndIncrementRevision()
    {
        var (alex, alexId, bea, _, _, _, home) = await HomeAsync();
        var created = await CreateExpenseAsync(home, alex, Expense(9000, alexId));
        var expenseId = Id(created);
        At(Noon.AddMinutes(5));
        var edited = await UpdateExpenseAsync(
            home,
            expenseId,
            bea,
            WithRevision(
                Expense(6000, alexId, extra: new { title = "  Market ", note = "Paid" }),
                0
            )
        );
        edited.GetProperty("revision").GetInt64().ShouldBe(1);
        edited.GetProperty("title").GetString().ShouldBe("Market");
        edited.GetProperty("totalCents").GetInt64().ShouldBe(6000);
        edited.GetProperty("updatedAt").GetInt64().ShouldBe(Millis(Noon.AddMinutes(5)));
        edited.GetProperty("createdAt").GetInt64().ShouldBe(Millis(Noon));
        edited.GetProperty("updatedBy").GetString().ShouldNotBe(alexId);
        Amounts(edited).ShouldBe([2000L, 2000L, 2000L]);

        await ExpectErrorAsync(
            HttpMethod.Put,
            ExpensePath(home, expenseId),
            alex,
            HttpStatusCode.Conflict,
            SharedExpenseService.Changed,
            WithRevision(Expense(1, alexId), 0)
        );
        await ExpectErrorAsync(
            HttpMethod.Put,
            ExpensePath(home, "missing"),
            alex,
            HttpStatusCode.NotFound,
            SharedExpenseService.ExpenseNotFound,
            WithRevision(Expense(1, alexId), 0)
        );
        await ExpectErrorAsync(
            HttpMethod.Put,
            ExpensePath(home, expenseId),
            alex,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidData,
            Expense(1, alexId)
        );
        (await GetExpenseAsync(home, expenseId, alex))
            .GetProperty("totalCents")
            .GetInt64()
            .ShouldBe(6000);

        // Delete: invalid body, stale revision, then a soft delete.
        await ExpectErrorAsync(
            HttpMethod.Delete,
            ExpensePath(home, expenseId),
            alex,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidData,
            new { revision = -1 }
        );
        await ExpectErrorAsync(
            HttpMethod.Delete,
            ExpensePath(home, expenseId),
            alex,
            HttpStatusCode.Conflict,
            SharedExpenseService.Changed,
            new { revision = 0 }
        );
        At(Noon.AddMinutes(10));
        (
            await ExpectAsync(
                HttpMethod.Delete,
                ExpensePath(home, expenseId),
                alex,
                HttpStatusCode.OK,
                new { revision = 1 }
            )
        )
            .GetProperty("ok")
            .GetBoolean()
            .ShouldBeTrue();
        await ExpectErrorAsync(
            HttpMethod.Delete,
            ExpensePath(home, expenseId),
            alex,
            HttpStatusCode.NotFound,
            SharedExpenseService.ExpenseNotFound,
            new { revision = 2 }
        );
        await ExpectErrorAsync(
            HttpMethod.Get,
            ExpensePath(home, expenseId),
            bea,
            HttpStatusCode.NotFound,
            SharedExpenseService.ExpenseNotFound
        );
        (await ListExpensesAsync(home, bea)).ShouldBeEmpty();
        // The row, its splits and its history stay; updated_at is left as legacy did.
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_expenses WHERE id = '{expenseId}' AND deleted_at IS NOT NULL AND revision = 2 AND updated_by = '{alexId}' AND (extract(epoch FROM updated_at) * 1000)::bigint = {Millis(Noon.AddMinutes(5))}"
            )
        ).ShouldBe(1L);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_splits WHERE expense_id = '{expenseId}'"
            )
        ).ShouldBe(3L);
        (await AuditCountAsync(home, "expense.created")).ShouldBe(1L);
        (await AuditCountAsync(home, "expense.updated")).ShouldBe(1L);
        (await AuditCountAsync(home, "expense.deleted")).ShouldBe(1L);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_audit WHERE action = 'expense.updated' AND before_json->>'totalCents' = '9000' AND after_json->>'totalCents' = '6000' AND (after_json->>'revision')::int = 1"
            )
        ).ShouldBe(1L);
        // Created and updated events notify the other current members; deletes don't.
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.push_outbox WHERE entity_id = '{expenseId}' AND event_type = 'expense.created' AND user_id <> '{alexId}'"
            )
        ).ShouldBe(2L);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.push_outbox WHERE entity_id = '{expenseId}' AND event_type = 'expense.updated'"
            )
        ).ShouldBe(2L);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.push_outbox WHERE entity_id = '{expenseId}' AND payload->>'month' = '2026-09' AND payload->>'expenseId' = '{expenseId}'"
            )
        ).ShouldBe(4L);
        (
            await CountAsync(
                "SELECT count(*) FROM penny.push_outbox WHERE event_type = 'expense.deleted'"
            )
        ).ShouldBe(0L);
    }

    [Fact]
    public async Task whenExpenseMoves_UpdateExpense_ShouldKeepIdentityAcrossHouseholds()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        At(Noon);
        var home = Id(await CreateHouseholdAsync(alex));
        var trip = Id(await CreateTripAsync(alex));
        var original = await CreateExpenseAsync(home, alex, Expense(4200, alexId));
        var expenseId = Id(original);
        var moved = await UpdateExpenseAsync(
            home,
            expenseId,
            alex,
            WithRevision(Expense(4200, alexId), 0, trip)
        );
        Id(moved).ShouldBe(expenseId);
        moved.GetProperty("householdId").GetString().ShouldBe(trip);
        moved.GetProperty("revision").GetInt64().ShouldBe(1);
        (await ListExpensesAsync(home, alex)).ShouldBeEmpty();
        (await ListExpensesAsync(trip, alex)).Count.ShouldBe(1);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_audit WHERE household_id = '{home}' AND expense_id = '{expenseId}' AND action = 'expense.moved' AND after_json IS NULL"
            )
        ).ShouldBe(1L);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_audit WHERE household_id = '{trip}' AND expense_id = '{expenseId}' AND action = 'expense.created' AND before_json IS NULL"
            )
        ).ShouldBe(1L);

        await ExpectErrorAsync(
            HttpMethod.Put,
            ExpensePath(trip, expenseId),
            alex,
            HttpStatusCode.Conflict,
            SharedExpenseService.Changed,
            WithRevision(Expense(4200, alexId), 0, home)
        );
        await ExpectErrorAsync(
            HttpMethod.Put,
            ExpensePath(trip, expenseId),
            alex,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound,
            WithRevision(Expense(4200, alexId), 1, "unavailable")
        );
        // A destination in another currency is refused.
        await Fixture.SqlAsync(
            $"""
            INSERT INTO penny.households (id, name, currency, creator_id, created_at) VALUES ('usd-home', 'USD', 'USD', '{alexId}', now());
            INSERT INTO penny.household_member_periods (id, household_id, user_id, joined_at) VALUES ('usd-period', 'usd-home', '{alexId}', now());
            """,
            Ct
        );
        await ExpectErrorAsync(
            HttpMethod.Put,
            ExpensePath(trip, expenseId),
            alex,
            HttpStatusCode.BadRequest,
            SharedExpenseService.DestinationCurrency,
            WithRevision(Expense(4200, alexId), 1, "usd-home")
        );
        var returned = await UpdateExpenseAsync(
            trip,
            expenseId,
            alex,
            WithRevision(Expense(4200, alexId), 1, home)
        );
        returned.GetProperty("householdId").GetString().ShouldBe(home);
        Id(returned).ShouldBe(expenseId);
    }

    // Three members of a household created at Noon (2026-09-28, UTC join days).
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
