using System.Net;
using System.Text.Json;
using Penny.Backend.Application.Households;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Household audit history (GET /api/households/{id}/audit): order, expense filter,
// former-member visibility, the 500-event limit and private-data redaction. All data
// is synthetic.
public sealed class AuditTests(ApiFixture fixture) : SettlementTestBase(fixture)
{
    [Fact]
    public async Task whenHouseholdChanges_Audit_ShouldListEventsNewestFirstWithoutPrivateData()
    {
        var (alex, alexId, bea, beaId, _, _, home) = await HomeAsync();
        await AddAccountAsync(alex, "acct-alex");
        await AddReceiptAsync(alexId, "receipt-1", "Pharmacy.pdf");
        At(Noon.AddMinutes(1));
        var expense = await CreateExpenseAsync(
            home,
            alex,
            Expense(9000, alexId, extra: new { accountId = "acct-alex", receiptId = "receipt-1" })
        );
        At(Noon.AddMinutes(2));
        await UpdateExpenseAsync(
            home,
            Id(expense),
            alex,
            WithRevision(
                Expense(
                    9000,
                    alexId,
                    extra: new
                    {
                        accountId = "acct-alex",
                        receiptId = "receipt-1",
                        title = "Pharmacy",
                    }
                ),
                0
            )
        );
        At(MonthEnd);
        var transfer = await ReimburseAsync(home, bea, "2026-09", beaId, alexId, 3000);

        var events = await AuditAsync(home, bea);
        events
            .Select(item => item.GetProperty("action").GetString())
            .ShouldBe([
                "reimbursement.created",
                "expense.updated",
                "expense.created",
                "member.joined",
                "invite.created",
                "member.joined",
                "invite.created",
                "household.created",
            ]);
        var newest = events[0];
        newest.GetProperty("householdId").GetString().ShouldBe(home);
        newest.GetProperty("actorId").GetString().ShouldBe(beaId);
        newest.GetProperty("createdAt").GetInt64().ShouldBe(Millis(MonthEnd));
        newest.TryGetProperty("expenseId", out _).ShouldBeFalse();
        newest.GetProperty("before").ValueKind.ShouldBe(JsonValueKind.Null);
        newest.GetProperty("after").GetProperty("id").GetString().ShouldBe(Id(transfer));
        newest.GetProperty("after").GetProperty("amountCents").GetInt64().ShouldBe(3000);
        var updated = events[1];
        updated.GetProperty("expenseId").GetString().ShouldBe(Id(expense));
        updated.GetProperty("before").GetProperty("title").GetString().ShouldBe("Groceries");
        updated.GetProperty("after").GetProperty("title").GetString().ShouldBe("Pharmacy");
        events[^1].GetProperty("before").ValueKind.ShouldBe(JsonValueKind.Null);
        events[^1].GetProperty("after").GetProperty("id").GetString().ShouldBe(home);
        // The payer's account and the receipt's filename never appear, even for the
        // payer; the receipt id stays.
        foreach (var token in new[] { alex, bea })
        {
            var text = JsonSerializer.Serialize(await AuditAsync(home, token));
            text.ShouldNotContain("acct-alex");
            text.ShouldNotContain("Pharmacy.pdf");
            text.ShouldContain("receipt-1");
        }

        // One expense's history; an empty filter means the whole household.
        (await AuditAsync(home, alex, $"?expenseId={Id(expense)}"))
            .Select(item => item.GetProperty("action").GetString())
            .ShouldBe(["expense.updated", "expense.created"]);
        (await AuditAsync(home, alex, "?expenseId=")).Count.ShouldBe(events.Count);
        (await AuditAsync(home, alex, "?expenseId=unknown")).ShouldBeEmpty();
        // Outsiders and unknown households look the same.
        var (outsider, _) = await AccountAsync("outsider@example.test");
        await ExpectErrorAsync(
            HttpMethod.Get,
            AuditPath(home),
            outsider,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound
        );
        await ExpectErrorAsync(
            HttpMethod.Get,
            AuditPath("missing"),
            alex,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound
        );
    }

    [Fact]
    public async Task whenStoredSnapshotHasPrivateData_Audit_ShouldRedactIt()
    {
        var (alex, alexId, bea, _, _, _, home) = await HomeAsync();
        // A stored row that still carries the payer's account and the receipt name.
        await Fixture.SqlAsync(
            $$$"""
            INSERT INTO penny.household_audit (id, household_id, expense_id, actor_id, action, before_json, after_json, created_at)
            VALUES ('unredacted-event', '{{{home}}}', 'unredacted-expense', '{{{alexId}}}', 'expense.updated',
              '{"title":"Old","accountId":"acct-secret","receipt":{"id":"r9","name":"Secret.pdf","mime":"application/pdf"}}',
              '{"title":"New","accountId":"acct-secret"}', TIMESTAMPTZ '2026-09-28 12:30:00+00');
            """,
            Ct
        );
        foreach (var token in new[] { alex, bea })
        {
            var unredacted = (
                await AuditAsync(home, token, "?expenseId=unredacted-expense")
            ).Single();
            unredacted.GetProperty("before").TryGetProperty("accountId", out _).ShouldBeFalse();
            unredacted
                .GetProperty("before")
                .GetProperty("receipt")
                .TryGetProperty("name", out _)
                .ShouldBeFalse();
            unredacted
                .GetProperty("before")
                .GetProperty("receipt")
                .GetProperty("id")
                .GetString()
                .ShouldBe("r9");
            unredacted.GetProperty("after").TryGetProperty("accountId", out _).ShouldBeFalse();
            unredacted.GetProperty("after").GetProperty("title").GetString().ShouldBe("New");
        }
    }

    [Fact]
    public async Task whenMemberLeft_Audit_ShouldShowOnlyTheirHistory()
    {
        var (alex, alexId, bea, beaId, cam, camId, home) = await HomeAsync();
        var shared = await CreateExpenseAsync(home, alex, Expense(9000, alexId));
        var without = await CreateExpenseAsync(
            home,
            alex,
            Expense(9000, alexId, extra: Exact((alexId, 4500), (beaId, 0), (camId, 4500)))
        );
        var camPaid = await CreateExpenseAsync(
            home,
            cam,
            Expense(500, camId, extra: Exact((alexId, 0), (beaId, 0), (camId, 500)))
        );
        At(MonthEnd.AddHours(1));
        await ReimburseAsync(home, bea, "2026-09", beaId, alexId, 3000);
        await ExpectAsync(HttpMethod.Post, $"/api/households/{home}/leave", bea, HttpStatusCode.OK);
        At(MonthEnd.AddHours(2));
        // After bea left: a household event and an edit of her old expense.
        await InviteAsync(home, alex);
        await UpdateExpenseAsync(
            home,
            Id(shared),
            alex,
            WithRevision(Expense(9000, alexId, extra: new { title = "Renamed" }), 0)
        );
        var after = await CreateExpenseAsync(home, alex, Expense(1000, alexId, "2026-10-01"));

        var visible = await AuditAsync(home, bea);
        // Her expenses' whole history (also after she left), and household events up to
        // her departure; never expenses without her share or later household events.
        visible.ShouldContain(item =>
            item.GetProperty("action").GetString() == "expense.updated"
            && item.GetProperty("expenseId").GetString() == Id(shared)
        );
        // Expenses with her zero share are still hers.
        var expenseIds = visible
            .Where(item => item.TryGetProperty("expenseId", out _))
            .Select(item => item.GetProperty("expenseId").GetString())
            .ToHashSet();
        expenseIds.ShouldBe([Id(shared), Id(without), Id(camPaid)], ignoreOrder: true);
        expenseIds.ShouldNotContain(Id(after));
        visible.ShouldContain(item => item.GetProperty("action").GetString() == "member.left");
        visible
            .Where(item => !item.TryGetProperty("expenseId", out _))
            .Select(item => item.GetProperty("createdAt").GetInt64())
            .ShouldAllBe(createdAt => createdAt <= Millis(MonthEnd.AddHours(1)));
        (await AuditAsync(home, bea, $"?expenseId={Id(after)}")).ShouldBeEmpty();
        (await AuditAsync(home, cam)).Count.ShouldBeGreaterThan(visible.Count);
    }

    [Fact]
    public async Task whenHistoryIsLong_Audit_ShouldLimitHouseholdEventsButNotOneExpense()
    {
        var (alex, alexId, _, _, _, _, home) = await HomeAsync();
        // 520 synthetic events with the same instant: the later row comes first.
        await Fixture.SqlAsync(
            $"""
            INSERT INTO penny.household_audit (id, household_id, expense_id, actor_id, action, before_json, after_json, created_at)
            SELECT 'bulk-' || lpad(n::text, 3, '0'), '{home}', 'bulk-expense', '{alexId}', 'expense.updated', NULL, jsonb_build_object('n', n), TIMESTAMPTZ '2026-09-29 00:00:00+00'
            FROM generate_series(1, 520) AS n;
            """,
            Ct
        );
        var events = await AuditAsync(home, alex);
        events.Count.ShouldBe(SettlementService.AuditLimit);
        events[0].GetProperty("id").GetString().ShouldBe("bulk-520");
        events[1].GetProperty("id").GetString().ShouldBe("bulk-519");
        var expense = await AuditAsync(home, alex, "?expenseId=bulk-expense");
        expense.Count.ShouldBe(520);
        expense[^1].GetProperty("after").GetProperty("n").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task whenHouseholdArchived_Audit_ShouldStayReadable()
    {
        var (alex, _, bea, _, _, _, home) = await HomeAsync();
        await ExpectAsync(
            HttpMethod.Post,
            $"/api/households/{home}/archive",
            alex,
            HttpStatusCode.OK
        );
        (await AuditAsync(home, bea))[0]
            .GetProperty("action")
            .GetString()
            .ShouldBe("household.archived");
        (await RecapAsync(home, bea, "2026-09"))
            .GetProperty("expenses")
            .GetArrayLength()
            .ShouldBe(0);
    }
}
