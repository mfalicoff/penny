using System.Net;
using System.Text.Json;
using Penny.Backend.Application.Households;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// GET /api/households/projection: the caller's shares of recorded shared expenses
// and month previews of scheduled occurrences. All data is synthetic.
public sealed class HouseholdProjectionTests(ApiFixture fixture) : SharedExpenseTestBase(fixture)
{
    [Fact]
    public async Task whenSharesProjected_Projection_ShouldReturnViewerSharesOnceByPeriod()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        At(Noon);
        var home = Id(await CreateHouseholdAsync(alex));
        await AdmitAsync(home, alex, bea);
        await AddReceiptAsync(alexId, "receipt-alex", "Slip.pdf");
        var september = await CreateExpenseAsync(
            home,
            alex,
            Expense(9001, alexId, extra: new { receiptId = "receipt-alex", note = "Market" })
        );
        var october = await CreateExpenseAsync(home, bea, Expense(5000, beaId, "2026-10-02"));
        await CreateExpenseAsync(home, alex, Expense(4000, alexId, "2027-01-05"));

        var month = await ProjectionAsync(bea, "?month=2026-09");
        month.GetProperty("scheduled").GetArrayLength().ShouldBe(0);
        var row = month.GetProperty("transactions").EnumerateArray().Single();
        Id(row).ShouldBe(Id(september));
        row.GetProperty("householdId").GetString().ShouldBe(home);
        row.GetProperty("householdName").GetString().ShouldBe("Home");
        row.GetProperty("householdCurrency").GetString().ShouldBe("CAD");
        row.GetProperty("title").GetString().ShouldBe("Groceries");
        row.GetProperty("date").GetString().ShouldBe("2026-09-28");
        row.GetProperty("totalCents").GetInt64().ShouldBe(9001);
        // 9001 split two ways: the odd cent goes to the lexically first id.
        row.GetProperty("shareCents")
            .GetInt64()
            .ShouldBe(string.CompareOrdinal(beaId, alexId) < 0 ? 4501 : 4500);
        row.GetProperty("payerUserId").GetString().ShouldBe(alexId);
        row.GetProperty("note").GetString().ShouldBe("Market");
        row.GetProperty("category").GetProperty("name").GetString().ShouldBe("Groceries");
        row.GetProperty("receipt").GetProperty("name").GetString().ShouldBe("Slip.pdf");
        foreach (var absent in new[] { "accountId", "scheduled", "recurringId", "receiptId" })
            row.TryGetProperty(absent, out _).ShouldBeFalse(absent);

        // Year and unfiltered projections, newest first.
        (await ProjectionAsync(bea, "?year=2026"))
            .GetProperty("transactions")
            .EnumerateArray()
            .Select(Id)
            .ShouldBe([Id(october), Id(september)]);
        (await ProjectionAsync(bea, "")).GetProperty("transactions").GetArrayLength().ShouldBe(3);
        // An empty value is absent, as in Express.
        (await ProjectionAsync(bea, "?month=&year="))
            .GetProperty("transactions")
            .GetArrayLength()
            .ShouldBe(3);

        // A member who left and rejoined still gets each expense once.
        await Fixture.SqlAsync(
            $"INSERT INTO penny.household_member_periods (id, household_id, user_id, joined_at, left_at) VALUES ('old-period', '{home}', '{beaId}', now() - interval '2 years', now() - interval '1 year')",
            Ct
        );
        (await ProjectionAsync(bea, "")).GetProperty("transactions").GetArrayLength().ShouldBe(3);

        // Deleted expenses leave the projection.
        await ExpectAsync(
            HttpMethod.Delete,
            ExpensePath(home, Id(october)),
            bea,
            HttpStatusCode.OK,
            new { revision = 0 }
        );
        (await ProjectionAsync(bea, "?year=2026"))
            .GetProperty("transactions")
            .GetArrayLength()
            .ShouldBe(1);
        (await ProjectionAsync(alex, "?year=2027"))
            .GetProperty("transactions")
            .GetArrayLength()
            .ShouldBe(1);
    }

    [Fact]
    public async Task whenQueryIsInvalid_Projection_ShouldRejectLikeLegacy()
    {
        var (alex, _) = await AccountAsync("alex@example.test");
        await ExpectErrorAsync(
            HttpMethod.Get,
            "/api/households/projection?month=2026-13",
            alex,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidData
        );
        await ExpectErrorAsync(
            HttpMethod.Get,
            "/api/households/projection?year=26",
            alex,
            HttpStatusCode.BadRequest,
            SharedExpenseService.InvalidYear
        );
        await ExpectErrorAsync(
            HttpMethod.Get,
            "/api/households/projection?month=2026-01&year=x",
            alex,
            HttpStatusCode.BadRequest,
            SharedExpenseService.InvalidYear
        );
        // Repeated parameters are arrays in Express and are ignored.
        (await ProjectionAsync(alex, "?month=2026-13&month=x"))
            .GetProperty("transactions")
            .GetArrayLength()
            .ShouldBe(0);
        (await ProjectionAsync(alex, "?month=0000-01"))
            .GetRawText()
            .ShouldBe("""{"transactions":[],"scheduled":[]}""");
        await ExpectErrorAsync(
            HttpMethod.Get,
            "/api/households/projection",
            null,
            HttpStatusCode.Unauthorized,
            Penny.Backend.Application.Authentication.AuthService.SignInRequired
        );
    }

    [Fact]
    public async Task whenFormerMemberProjects_Projection_ShouldIncludeOnlyTheirShares()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        var (outsider, _) = await AccountAsync("outsider@example.test");
        At(Noon);
        var home = Id(await CreateHouseholdAsync(alex));
        await AdmitAsync(home, alex, bea);
        await CreateExpenseAsync(
            home,
            alex,
            Expense(9000, alexId, extra: Exact((alexId, 9000), (beaId, 0)))
        );
        await AddRuleAsync("rule-home", home, alexId, 9000, "2026-10-28", "monthly");
        await ExpectAsync(HttpMethod.Post, $"/api/households/{home}/leave", bea, HttpStatusCode.OK);
        await CreateExpenseAsync(home, alex, Expense(1200, alexId, "2026-10-01"));

        // Legacy answered 404 here once the household had expenses without them.
        var past = await ProjectionAsync(bea, "");
        past.GetProperty("transactions")
            .EnumerateArray()
            .Single()
            .GetProperty("shareCents")
            .GetInt64()
            .ShouldBe(0);
        (await ProjectionAsync(bea, "?month=2026-10"))
            .GetRawText()
            .ShouldBe("""{"transactions":[],"scheduled":[]}""");
        (await ProjectionAsync(outsider, "?month=2026-10"))
            .GetRawText()
            .ShouldBe("""{"transactions":[],"scheduled":[]}""");
        (await ProjectionAsync(alex, "?month=2026-10"))
            .GetProperty("scheduled")
            .GetArrayLength()
            .ShouldBe(1);
    }

    [Fact]
    public async Task whenRulesAreDue_Projection_ShouldPreviewScheduledSharesWithoutWriting()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        At(Noon);
        var home = Id(await CreateHouseholdAsync(alex));
        await AdmitAsync(home, alex, bea);
        await AddAccountAsync(alex, "checking");
        await AddRuleAsync(
            "rule-rent",
            home,
            alexId,
            9000,
            "2026-10-28",
            "monthly",
            accountId: "checking"
        );
        var before = await CountAsync("SELECT count(*) FROM penny.household_expenses");

        var projection = await ProjectionAsync(bea, "?month=2026-10");
        projection.GetProperty("transactions").GetArrayLength().ShouldBe(0);
        var preview = projection.GetProperty("scheduled").EnumerateArray().Single();
        Id(preview).ShouldBe("rule-rent:2026-10-28");
        preview.GetProperty("date").GetString().ShouldBe("2026-10-28");
        preview.GetProperty("shareCents").GetInt64().ShouldBe(4500);
        preview.GetProperty("totalCents").GetInt64().ShouldBe(9000);
        preview.GetProperty("scheduled").GetBoolean().ShouldBeTrue();
        preview.GetProperty("recurringId").GetString().ShouldBe("rule-rent");
        preview.GetProperty("householdName").GetString().ShouldBe("Home");
        preview.GetProperty("title").GetString().ShouldBe("Rent");
        preview.TryGetProperty("accountId", out _).ShouldBeFalse();
        (await ProjectionAsync(alex, "?month=2026-10"))
            .GetProperty("scheduled")[0]
            .GetProperty("accountId")
            .GetString()
            .ShouldBe("checking");
        (await ProjectionAsync(bea, "?year=2026"))
            .GetProperty("scheduled")
            .GetArrayLength()
            .ShouldBe(0);
        (await ProjectionAsync(bea, "")).GetProperty("scheduled").GetArrayLength().ShouldBe(0);
        (await ProjectionAsync(bea, "?month=2026-09"))
            .GetProperty("scheduled")
            .GetArrayLength()
            .ShouldBe(0);
        // Later months are previewed too, without moving the rule.
        (await ProjectionAsync(bea, "?month=2027-02"))
            .GetProperty("scheduled")[0]
            .GetProperty("date")
            .GetString()
            .ShouldBe("2027-02-28");
        (await CountAsync("SELECT count(*) FROM penny.household_expenses")).ShouldBe(before);
        (
            await CountAsync(
                "SELECT count(*) FROM penny.household_recurring WHERE next_date = DATE '2026-10-28'"
            )
        ).ShouldBe(1L);

        // Recorded and soft-deleted occurrences are consumed, never previewed again.
        await AddRuleAsync("rule-weekly", home, alexId, 9000, "2026-10-05", "weekly");
        Dates(await ProjectionAsync(bea, "?month=2026-10"), "rule-weekly")
            .ShouldBe(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
        await Fixture.SqlAsync(
            $"""
            INSERT INTO penny.household_expenses (id, household_id, title, total_cents, expense_date, payer_id, split_mode, category_name, category_icon, category_color, note, recurring_id, revision, created_by, created_at, updated_by, updated_at, deleted_at)
            VALUES ('occurrence-1', '{home}', 'Rent', 9000, DATE '2026-10-05', '{alexId}', 'equal', 'Home', 'home', '#ABCDEF', '', 'rule-weekly', 0, '{alexId}', now(), '{alexId}', now(), NULL),
                   ('occurrence-2', '{home}', 'Rent', 9000, DATE '2026-10-12', '{alexId}', 'equal', 'Home', 'home', '#ABCDEF', '', 'rule-weekly', 1, '{alexId}', now(), '{alexId}', now(), now());
            INSERT INTO penny.household_splits (expense_id, user_id, amount_cents) VALUES ('occurrence-1', '{alexId}', 4500), ('occurrence-1', '{beaId}', 4500), ('occurrence-2', '{alexId}', 4500), ('occurrence-2', '{beaId}', 4500);
            """,
            Ct
        );
        var materialized = await ProjectionAsync(bea, "?month=2026-10");
        Dates(materialized, "rule-weekly").ShouldBe(["2026-10-19", "2026-10-26"]);
        materialized
            .GetProperty("transactions")
            .EnumerateArray()
            .Select(Id)
            .ShouldBe(["occurrence-1"]);

        // Paused rules produce no previews.
        await Fixture.SqlAsync(
            "UPDATE penny.household_recurring SET active = false WHERE id = 'rule-weekly'",
            Ct
        );
        Dates(await ProjectionAsync(bea, "?month=2026-10"), "rule-weekly").ShouldBeEmpty();
    }

    [Fact]
    public async Task whenMembershipChangesBetweenOccurrences_Projection_ShouldUseOccurrenceDateMembers()
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        var (cam, _) = await AccountAsync("cam@example.test");
        At(Noon);
        var home = Id(await CreateHouseholdAsync(alex));
        await AdmitAsync(home, alex, bea);
        await AddRuleAsync(
            "rule-exact",
            home,
            alexId,
            9000,
            "2026-10-05",
            "weekly",
            "exact",
            null,
            (alexId, 6000, null),
            (beaId, 3000, null)
        );
        At(new DateTimeOffset(2026, 10, 7, 12, 0, 0, TimeSpan.Zero));
        await AdmitAsync(home, alex, cam);
        At(new DateTimeOffset(2026, 10, 15, 12, 0, 0, TimeSpan.Zero));
        await ExpectAsync(HttpMethod.Post, $"/api/households/{home}/leave", bea, HttpStatusCode.OK);

        // The stored split applies while the same members remain, then equal shares.
        (await ProjectionAsync(alex, "?month=2026-10"))
            .GetProperty("scheduled")
            .EnumerateArray()
            .Select(entry =>
                (entry.GetProperty("date").GetString(), entry.GetProperty("shareCents").GetInt64())
            )
            .ShouldBe([
                ("2026-10-05", 6000L),
                ("2026-10-12", 3000L),
                ("2026-10-19", 4500L),
                ("2026-10-26", 4500L),
            ]);
        (await ProjectionAsync(bea, "?month=2026-10"))
            .GetRawText()
            .ShouldBe("""{"transactions":[],"scheduled":[]}""");
        (await ProjectionAsync(cam, "?month=2026-10"))
            .GetProperty("scheduled")
            .GetArrayLength()
            .ShouldBe(3);
    }

    private static List<string> Dates(JsonElement projection, string ruleId) =>
        [
            .. projection
                .GetProperty("scheduled")
                .EnumerateArray()
                .Where(entry => entry.GetProperty("recurringId").GetString() == ruleId)
                .Select(entry => entry.GetProperty("date").GetString()!),
        ];
}
