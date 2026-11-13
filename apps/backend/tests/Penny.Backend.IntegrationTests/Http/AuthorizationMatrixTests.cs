using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Http;

// MAZ-64 authorization matrix, driven by contracts/openapi.json so a new operation is
// covered as soon as it is documented. Every protected operation refuses anonymous
// callers with 401. Every operation on someone else's household, expense, rule, member
// or receipt is refused for a signed-in outsider, and every household write is refused
// for a former member, without leaking the victim's data and without changing any stored
// row. The full-stack seed probes (`outsider *` and `former member *` in
// full-stack-seeds.json) pin the exact status and message for the same calls.
public sealed class AuthorizationMatrixTests(ApiFixture fixture) : SharedRecurrenceTestBase(fixture)
{
    private const string HouseholdName = "Matrix private household";
    private const string ExpenseTitle = "Matrix private expense";

    private sealed record Operation(HttpMethod Method, string Path, bool Public);

    private sealed record Victim(
        string HouseholdId,
        string ExpenseId,
        string RuleId,
        string MemberId,
        string ReceiptId,
        string FormerToken
    );

    private static IReadOnlyList<Operation> Operations()
    {
        var spec = ContractFixtures.OpenApi();
        var operations = new List<Operation>();
        foreach (var (path, item) in spec["paths"]!.AsObject())
        foreach (var (method, operation) in item!.AsObject())
        {
            if (operation is not JsonObject { } definition || definition["responses"] is null)
                continue;
            var isPublic = definition["security"] is JsonArray { Count: 0 };
            operations.Add(new(new HttpMethod(method.ToUpperInvariant()), path, isPublic));
        }
        return operations;
    }

    [Fact]
    public async Task whenAnonymous_EveryProtectedOperation_ShouldReturnUnauthorized()
    {
        var protectedOperations = Operations().Where(operation => !operation.Public).ToList();
        protectedOperations.Count.ShouldBeGreaterThanOrEqualTo(34);
        var failures = new List<string>();
        foreach (var operation in protectedOperations)
        {
            var path = Fill(operation.Path, "unknown", "unknown", "unknown", "unknown", "unknown");
            using var response = await Client.SendAsync(Request(operation.Method, path, null), Ct);
            var text = await response.Content.ReadAsStringAsync(Ct);
            if (
                response.StatusCode != HttpStatusCode.Unauthorized
                || JsonDocument.Parse(text).RootElement.GetProperty("error").GetString() is null
            )
                failures.Add(
                    $"{operation.Method} {operation.Path}: {(int)response.StatusCode} {text}"
                );
        }
        failures.ShouldBeEmpty();
    }

    [Fact]
    public async Task whenOutsiderTargetsAnotherHousehold_EveryScopedOperation_ShouldRefuseWithoutLeaking()
    {
        var victim = await VictimAsync();
        var outsider = await AccountAsync("outsider@example.test");
        var before = await StateAsync();
        var scoped = Operations()
            .Where(operation =>
                operation.Path.StartsWith("/api/households/{id}", StringComparison.Ordinal)
                || operation.Path == "/api/receipts/{id}"
            )
            .ToList();
        scoped.Count.ShouldBeGreaterThan(20);

        var failures = new List<string>();
        foreach (var operation in scoped)
        {
            var path = Fill(
                operation.Path,
                operation.Path.StartsWith("/api/receipts", StringComparison.Ordinal)
                    ? victim.ReceiptId
                    : victim.HouseholdId,
                victim.ExpenseId,
                victim.RuleId,
                victim.MemberId,
                "2026-09"
            );
            foreach (var body in Bodies(operation.Method, victim))
                await ExpectRefusedAsync(operation, path, outsider.Token, body, failures);
        }
        failures.ShouldBeEmpty();
        (await StateAsync()).ShouldBe(before, "an outsider changed nothing");

        // Lists and projections never mention the household.
        foreach (var path in new[] { "/api/households", "/api/households/projection" })
        {
            using var response = await Client.SendAsync(
                Authorized(HttpMethod.Get, path, bearer: outsider.Token),
                Ct
            );
            response.StatusCode.ShouldBe(HttpStatusCode.OK);
            var text = await response.Content.ReadAsStringAsync(Ct);
            text.ShouldNotContain(victim.HouseholdId);
            text.ShouldNotContain(HouseholdName);
            text.ShouldNotContain(ExpenseTitle);
        }
    }

    [Fact]
    public async Task whenFormerMemberWrites_EveryHouseholdWrite_ShouldRefuseAndChangeNothing()
    {
        var victim = await VictimAsync();
        var before = await StateAsync();
        var writes = Operations()
            .Where(operation =>
                operation.Path.StartsWith("/api/households/{id}", StringComparison.Ordinal)
                && operation.Method != HttpMethod.Get
            )
            .ToList();
        writes.Count.ShouldBeGreaterThan(12);

        var failures = new List<string>();
        foreach (var operation in writes)
        {
            var path = Fill(
                operation.Path,
                victim.HouseholdId,
                victim.ExpenseId,
                victim.RuleId,
                victim.MemberId,
                "2026-09"
            );
            foreach (var body in Bodies(operation.Method, victim))
                await ExpectRefusedAsync(operation, path, victim.FormerToken, body, failures);
        }
        failures.ShouldBeEmpty();
        (await StateAsync()).ShouldBe(before, "a former member changed nothing");
    }

    // A refusal is 400, 403 or 404 with the error envelope: never success, and
    // never 409, which would mean the request reached the stored state.
    private async Task ExpectRefusedAsync(
        Operation operation,
        string path,
        string token,
        object? body,
        List<string> failures
    )
    {
        using var response = await Client.SendAsync(
            Request(operation.Method, path, token, body),
            Ct
        );
        var text = await response.Content.ReadAsStringAsync(Ct);
        var status = (int)response.StatusCode;
        var refused = status is 400 or 403 or 404;
        var leaked =
            text.Contains(HouseholdName, StringComparison.Ordinal)
            || text.Contains(ExpenseTitle, StringComparison.Ordinal);
        if (!refused || leaked)
            failures.Add(
                $"{operation.Method} {operation.Path} [{JsonSerializer.Serialize(body)}]: {status} {text}"
            );
    }

    // An empty body, and a body valid for a member, so a refusal cannot come only from
    // validation.
    private static IEnumerable<object?> Bodies(HttpMethod method, Victim victim)
    {
        if (method == HttpMethod.Get)
        {
            yield return null;
            yield break;
        }
        yield return new { };
        yield return new Dictionary<string, object?>(Expense(1000, victim.MemberId))
        {
            ["name"] = "Taken",
            ["currency"] = "CAD",
            ["startDate"] = "2026-11-01",
            ["endDate"] = "2026-11-08",
            ["nextDate"] = "2026-12-01",
            ["frequency"] = "monthly",
            ["revision"] = 0,
            ["active"] = true,
            ["fromUserId"] = victim.MemberId,
            ["toUserId"] = victim.MemberId,
            ["amountCents"] = 100,
        };
    }

    private static string Fill(
        string template,
        string id,
        string expenseId,
        string ruleId,
        string userId,
        string month
    ) =>
        template
            .Replace("{id}", Uri.EscapeDataString(id), StringComparison.Ordinal)
            .Replace("{expenseId}", Uri.EscapeDataString(expenseId), StringComparison.Ordinal)
            .Replace("{ruleId}", Uri.EscapeDataString(ruleId), StringComparison.Ordinal)
            .Replace("{userId}", Uri.EscapeDataString(userId), StringComparison.Ordinal)
            .Replace("{month}", month, StringComparison.Ordinal);

    private static HttpRequestMessage Request(
        HttpMethod method,
        string path,
        string? token,
        object? body = null
    )
    {
        var request = Authorized(method, path, bearer: token);
        if (method != HttpMethod.Get)
            request.Content = JsonContent.Create(body ?? new { });
        return request;
    }

    // alex's household with sam, a shared expense, a rule and alex's receipt; dee joined
    // after the expense (so she owes nothing) and left.
    private async Task<Victim> VictimAsync()
    {
        At(Noon);
        var alex = await AccountAsync("alex.matrix@example.test");
        var sam = await AccountAsync("sam.matrix@example.test");
        var dee = await AccountAsync("dee.matrix@example.test");
        var home = Id(await CreateHouseholdAsync(alex.Token, HouseholdName));
        await AdmitAsync(home, alex.Token, sam.Token);
        var expense = await CreateExpenseAsync(
            home,
            alex.Token,
            Expense(1000, alex.UserId, extra: new { title = ExpenseTitle })
        );
        var rule = await CreateRuleAsync(home, alex.Token, Rule(5000, alex.UserId, "2026-10-01"));
        await AdmitAsync(home, alex.Token, dee.Token);
        await ExpectAsync(
            HttpMethod.Post,
            $"/api/households/{home}/leave",
            dee.Token,
            HttpStatusCode.OK
        );
        var receipt = await ExpectAsync(
            HttpMethod.Post,
            "/api/receipts",
            alex.Token,
            HttpStatusCode.Created,
            new
            {
                name = "Private.pdf",
                mime = "application/pdf",
                base64 = Convert.ToBase64String("%PDF-1.7\n"u8.ToArray()),
            }
        );
        return new(home, Id(expense), Id(rule), sam.UserId, Id(receipt), dee.Token);
    }

    // Row counts and revisions of every table a household write can touch.
    private async Task<string> StateAsync() =>
        (string)
            (
                await ScalarAsync(
                    """
                    SELECT concat_ws(',',
                      (SELECT count(*) FROM penny.households WHERE archived_at IS NULL),
                      (SELECT string_agg(name, '|' ORDER BY id) FROM penny.households),
                      (SELECT count(*) FROM penny.household_member_periods),
                      (SELECT count(*) FROM penny.household_member_periods WHERE left_at IS NULL),
                      (SELECT count(*) FROM penny.household_invites),
                      (SELECT string_agg(id || ':' || revision || ':' || total_cents || ':' || (deleted_at IS NULL), '|' ORDER BY id) FROM penny.household_expenses),
                      (SELECT count(*) FROM penny.household_splits),
                      (SELECT count(*) FROM penny.household_reimbursements),
                      (SELECT string_agg(id || ':' || revision || ':' || active, '|' ORDER BY id) FROM penny.household_recurring),
                      (SELECT count(*) FROM penny.household_audit),
                      (SELECT count(*) FROM penny.receipts))
                    """
                )
            )!;
}
