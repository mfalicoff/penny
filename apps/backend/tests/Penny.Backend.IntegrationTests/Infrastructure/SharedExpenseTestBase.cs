using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Penny.Backend.Persistence.Schema;
using Shouldly;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// HTTP helpers for the shared-expense suites (MAZ-57). Rules (MAZ-59), monthly
// reimbursements (MAZ-58) and receipt rows are seeded through the admin connection
// (the receipt suites use the MAZ-60 endpoints). All data is synthetic.
public abstract class SharedExpenseTestBase(ApiFixture fixture) : HouseholdTestBase(fixture)
{
    protected static readonly object Groceries = new
    {
        name = "Groceries",
        icon = "basket-outline",
        color = "#6C9C79",
    };

    // A valid expense body; `extra` adds or replaces fields (null removes one).
    protected static Dictionary<string, object?> Expense(
        long totalCents,
        string payerUserId,
        string date = "2026-09-28",
        object? extra = null
    )
    {
        var body = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["title"] = "Groceries",
            ["totalCents"] = totalCents,
            ["date"] = date,
            ["payerUserId"] = payerUserId,
            ["splitMode"] = "equal",
            ["category"] = Groceries,
            ["note"] = "",
        };
        if (extra is not null)
            foreach (var property in JsonSerializer.SerializeToElement(extra).EnumerateObject())
                if (property.Value.ValueKind == JsonValueKind.Null)
                    body.Remove(property.Name);
                else
                    body[property.Name] = property.Value;
        return body;
    }

    protected static object Exact(params (string UserId, long Cents)[] shares) =>
        new
        {
            splitMode = "exact",
            allocations = shares.Select(share => new
            {
                userId = share.UserId,
                amountCents = share.Cents,
            }),
        };

    protected static object Percent(params (string UserId, long Points)[] shares) =>
        new
        {
            splitMode = "percent",
            allocations = shares.Select(share => new
            {
                userId = share.UserId,
                percentBasisPoints = share.Points,
            }),
        };

    protected static string ExpensesPath(string householdId) =>
        $"/api/households/{householdId}/expenses";

    protected static string ExpensePath(string householdId, string expenseId) =>
        $"/api/households/{householdId}/expenses/{expenseId}";

    protected async Task<JsonElement> CreateExpenseAsync(
        string householdId,
        string token,
        object body
    ) =>
        (
            await ExpectAsync(
                HttpMethod.Post,
                ExpensesPath(householdId),
                token,
                HttpStatusCode.Created,
                body
            )
        ).GetProperty("expense");

    protected async Task<JsonElement> GetExpenseAsync(
        string householdId,
        string expenseId,
        string token
    ) =>
        (
            await ExpectAsync(
                HttpMethod.Get,
                ExpensePath(householdId, expenseId),
                token,
                HttpStatusCode.OK
            )
        ).GetProperty("expense");

    protected async Task<JsonElement> UpdateExpenseAsync(
        string householdId,
        string expenseId,
        string token,
        Dictionary<string, object?> body
    ) =>
        (
            await ExpectAsync(
                HttpMethod.Put,
                ExpensePath(householdId, expenseId),
                token,
                HttpStatusCode.OK,
                body
            )
        ).GetProperty("expense");

    protected async Task<List<JsonElement>> ListExpensesAsync(
        string householdId,
        string token,
        string query = ""
    ) =>
        [
            .. (
                await ExpectAsync(
                    HttpMethod.Get,
                    ExpensesPath(householdId) + query,
                    token,
                    HttpStatusCode.OK
                )
            )
                .GetProperty("expenses")
                .EnumerateArray(),
        ];

    protected async Task<JsonElement> ProjectionAsync(string token, string query) =>
        await ExpectAsync(
            HttpMethod.Get,
            "/api/households/projection" + query,
            token,
            HttpStatusCode.OK
        );

    protected static Dictionary<string, object?> WithRevision(
        Dictionary<string, object?> body,
        long revision,
        string? targetHouseholdId = null
    )
    {
        var copy = new Dictionary<string, object?>(body, StringComparer.Ordinal)
        {
            ["revision"] = revision,
        };
        if (targetHouseholdId is not null)
            copy["targetHouseholdId"] = targetHouseholdId;
        return copy;
    }

    protected static List<long> Amounts(JsonElement expense) =>
        [
            .. expense
                .GetProperty("splits")
                .EnumerateArray()
                .Select(share => share.GetProperty("amountCents").GetInt64()),
        ];

    protected static List<string> SplitUsers(JsonElement expense) =>
        [
            .. expense
                .GetProperty("splits")
                .EnumerateArray()
                .Select(share => share.GetProperty("userId").GetString()!),
        ];

    protected static string Id(JsonElement element) => element.GetProperty("id").GetString()!;

    // Adds a payment account to the user's ledger through PUT /api/ledger.
    protected async Task AddAccountAsync(string token, string accountId)
    {
        var snapshot = await GetLedgerAsync(token);
        snapshot["ledger"]!["accounts"]!
            .AsArray()
            .Add(
                new JsonObject
                {
                    ["id"] = accountId,
                    ["name"] = "Checking",
                    ["type"] = "bank",
                }
            );
        using var saved = await PutLedgerAsync(token, snapshot);
        saved.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    // An uploaded receipt row (encrypted name); the file itself is never read here.
    protected async Task AddReceiptAsync(string userId, string id, string name)
    {
        var encrypted = Fixture.Receipts.Encrypt(
            userId,
            id,
            name,
            "application/pdf",
            "%PDF-1.4"u8,
            Noon
        );
        await using var context = PennyDbContext.Create(Fixture.Admin);
        context.Receipts.Add(encrypted.Row);
        await context.SaveChangesAsync(Ct);
    }

    // An active shared recurring rule (MAZ-59 owns their HTTP writes).
    protected async Task AddRuleAsync(
        string ruleId,
        string householdId,
        string payerId,
        long totalCents,
        string nextDate,
        string frequency,
        string splitMode = "equal",
        string? accountId = null,
        params (string UserId, long? Cents, int? Points)[] allocations
    )
    {
        var account = accountId is null ? "NULL" : $"'{accountId}'";
        await Fixture.SqlAsync(
            string.Create(
                CultureInfo.InvariantCulture,
                $"""
                INSERT INTO penny.household_recurring (id, household_id, title, total_cents, payer_id, split_mode, category_name, category_icon, category_color, note, account_id, frequency, next_date, anchor_day, active, created_by, revision)
                VALUES ('{ruleId}', '{householdId}', 'Rent', {totalCents}, '{payerId}', '{splitMode}', 'Home', 'home', '#ABCDEF', '', {account}, '{frequency}', DATE '{nextDate}', {int.Parse(
                    nextDate[8..],
                    CultureInfo.InvariantCulture
                )}, true, '{payerId}', 0);
                """
            ),
            Ct
        );
        foreach (var (userId, cents, points) in allocations)
            await Fixture.SqlAsync(
                string.Create(
                    CultureInfo.InvariantCulture,
                    $"INSERT INTO penny.household_recurring_allocations (recurring_id, user_id, amount_cents, percent_basis_points) VALUES ('{ruleId}', '{userId}', {(cents is null ? "NULL" : cents.Value.ToString(CultureInfo.InvariantCulture))}, {(points is null ? "NULL" : points.Value.ToString(CultureInfo.InvariantCulture))})"
                ),
                Ct
            );
    }

    protected Task<long> AuditCountAsync(string householdId, string action) =>
        CountAsync(
            $"SELECT count(*) FROM penny.household_audit WHERE household_id = '{householdId}' AND action = '{action}'"
        );

    protected static async Task<(HttpStatusCode Status, string? Error)> OutcomeAsync(
        Task<HttpResponseMessage> request
    )
    {
        using var response = await request;
        var text = await response.Content.ReadAsStringAsync(Ct);
        string? error = null;
        if (!response.IsSuccessStatusCode)
            error = JsonDocument.Parse(text).RootElement.GetProperty("error").GetString();
        return (response.StatusCode, error);
    }
}
