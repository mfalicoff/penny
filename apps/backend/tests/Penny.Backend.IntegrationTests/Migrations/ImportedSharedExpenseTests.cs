using System.Globalization;
using System.Net;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Households;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Import;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

// Imported SQLite shared expenses (LegacyDatabase: trip household `h`, expense `e`
// split between `legacy:user-01` and former member `oidc-user` and paid by an
// individual payment, recurring rule `rule`, receipt `receipt` and the creator's
// `bank` account) served through HTTP with imported sessions. All data is synthetic.
public sealed class ImportedSharedExpenseTests(ApiFixture fixture) : SharedExpenseTestBase(fixture)
{
    private const string Creator = "legacy:user-01";
    private const string Former = "oidc-user";
    private const long SessionExpiry = 1893456000000; // 2030-01-01T00:00:00Z
    private static readonly string CreatorToken = new('a', 64);
    private static readonly string FormerToken = new('b', 64);

    [Fact]
    public async Task whenSqliteExpensesImported_ExpenseFlow_ShouldReadEditAndProjectThroughHttp()
    {
        await ImportAsync();
        At(new DateTimeOffset(2026, 11, 8, 12, 0, 0, TimeSpan.Zero));

        var expense = (await ListExpensesAsync("h", CreatorToken)).Single();
        Id(expense).ShouldBe("e");
        expense.GetProperty("title").GetString().ShouldBe("Historical purchase");
        expense.GetProperty("date").GetString().ShouldBe("2024-02-29");
        expense.GetProperty("revision").GetInt64().ShouldBe(7);
        expense.GetProperty("createdAt").GetInt64().ShouldBe(1700000000001);
        expense.GetProperty("recurringId").GetString().ShouldBe("deleted-recurring-rule");
        expense.GetProperty("category").GetProperty("name").GetString().ShouldBe("Food");
        SplitUsers(expense).ShouldBe([Creator, Former]);
        Amounts(expense).ShouldBe([5000L, 5000L]);
        var payment = expense.GetProperty("payments").EnumerateArray().Single();
        payment.GetProperty("fromUserId").GetString().ShouldBe(Former);
        payment.GetProperty("amountCents").GetInt64().ShouldBe(5000);
        payment.GetProperty("createdAt").GetInt64().ShouldBe(1700000000001);
        expense.GetProperty("paymentsClosed").GetBoolean().ShouldBeFalse();
        // The former member keeps the expense they took part in.
        (await GetExpenseAsync("h", "e", FormerToken))
            .GetProperty("note")
            .GetString()
            .ShouldBe(expense.GetProperty("note").GetString());

        // Personal projections: one share each; the creator previews the imported
        // rule (the former member's period ended, so the occurrence is split equally).
        var former = await ProjectionAsync(FormerToken, "?month=2024-02");
        var share = former.GetProperty("transactions").EnumerateArray().Single();
        share.GetProperty("shareCents").GetInt64().ShouldBe(5000);
        share.GetProperty("householdName").GetString().ShouldBe("Café 東京");
        former.GetProperty("scheduled").GetArrayLength().ShouldBe(0);
        var creator = await ProjectionAsync(CreatorToken, "?month=2024-03");
        var preview = creator.GetProperty("scheduled").EnumerateArray().Single();
        Id(preview).ShouldBe("rule:2024-03-31");
        preview.GetProperty("shareCents").GetInt64().ShouldBe(10000);

        // The paid expense keeps its finances; metadata edits bump the revision.
        await ExpectErrorAsync(
            HttpMethod.Delete,
            ExpensePath("h", "e"),
            CreatorToken,
            HttpStatusCode.Conflict,
            SharedExpenseService.PaidDelete,
            new { revision = 7 }
        );
        var edited = await UpdateExpenseAsync(
            "h",
            "e",
            CreatorToken,
            WithRevision(Expense(10000, Creator, "2024-02-29", new { title = "Renamed" }), 7)
        );
        edited.GetProperty("revision").GetInt64().ShouldBe(8);
        Amounts(edited).ShouldBe([5000L, 5000L]);

        // New expenses link the imported receipt and the creator's imported account.
        var created = await CreateExpenseAsync(
            "h",
            CreatorToken,
            Expense(2500, Creator, "2024-03-01", new { receiptId = "receipt", accountId = "bank" })
        );
        created.GetProperty("receipt").GetProperty("name").GetString().ShouldBe("synthetic.pdf");
        created.GetProperty("accountId").GetString().ShouldBe("bank");
        SplitUsers(created).ShouldBe([Creator]);
        (await ListExpensesAsync("h", FormerToken)).Select(Id).ShouldBe(["e"]);
        (await AuditCountAsync("h", "expense.updated")).ShouldBe(2L);
    }

    private async Task ImportAsync()
    {
        using var legacy = new LegacyDatabase();
        legacy.Execute(
            string.Create(
                CultureInfo.InvariantCulture,
                $$"""
                INSERT INTO sessions VALUES('{{SessionTokens.Hash(
                    CreatorToken
                )}}','{{Creator}}',{{SessionExpiry}});
                INSERT INTO sessions VALUES('{{SessionTokens.Hash(
                    FormerToken
                )}}','{{Former}}',{{SessionExpiry}});
                """
            )
        );
        legacy.Seal();
        await SqliteImporter.RunAsync(
            Fixture.Admin,
            Fixture.Receipts,
            legacy.SnapshotPath,
            legacy.Sha256,
            ImportMode.Import,
            null,
            Ct
        );
    }
}
