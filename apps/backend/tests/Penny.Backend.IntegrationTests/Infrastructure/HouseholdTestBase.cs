using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Penny.Backend.Api.Contracts;
using Shouldly;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// HTTP helpers for the household suites. Membership tests seed balances with SQL
// through the admin connection (monthly reimbursements have no .NET endpoint until
// MAZ-58); shared-expense suites use SharedExpenseTestBase. All data is synthetic.
public abstract class HouseholdTestBase(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    protected static readonly DateTimeOffset Noon = new(2026, 9, 28, 12, 0, 0, TimeSpan.Zero);

    protected void At(DateTimeOffset instant) => Fixture.Factory.Clock.Set(instant);

    protected static long Millis(DateTimeOffset instant) => instant.ToUnixTimeMilliseconds();

    // Registers an account; returns its bearer token and user id.
    protected async Task<(string Token, string UserId)> AccountAsync(string email)
    {
        var token = await RegisterAsync(email);
        var userId = (string)
            (await ScalarAsync($"SELECT id FROM penny.users WHERE email = '{email}'"))!;
        return (token, userId);
    }

    protected async Task<HttpResponseMessage> SendAsync(
        HttpMethod method,
        string path,
        string? token,
        object? body = null
    )
    {
        using var request = Authorized(method, path, bearer: token);
        if (body is not null)
            request.Content = JsonContent.Create(body);
        return await Client.SendAsync(request, Ct);
    }

    protected async Task<JsonElement> ExpectAsync(
        HttpMethod method,
        string path,
        string? token,
        HttpStatusCode status,
        object? body = null
    )
    {
        using var response = await SendAsync(method, path, token, body);
        var text = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(status, text);
        return JsonDocument.Parse(text).RootElement.Clone();
    }

    protected async Task ExpectErrorAsync(
        HttpMethod method,
        string path,
        string? token,
        HttpStatusCode status,
        string message,
        object? body = null
    )
    {
        using var response = await SendAsync(method, path, token, body);
        var text = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(status, text);
        JsonSerializer
            .Deserialize<ApiError>(text, JsonSerializerOptions.Web)!
            .Error.ShouldBe(message);
    }

    protected async Task<JsonElement> CreateHouseholdAsync(
        string token,
        string name = "Home",
        int? offset = null
    ) =>
        (
            await ExpectAsync(
                HttpMethod.Post,
                "/api/households",
                token,
                HttpStatusCode.Created,
                offset is null
                    ? new { name, currency = "CAD" }
                    : new
                    {
                        name,
                        currency = "CAD",
                        timezoneOffsetMinutes = offset,
                    }
            )
        ).GetProperty("household");

    protected async Task<JsonElement> CreateTripAsync(
        string token,
        string startDate = "2026-11-01",
        string endDate = "2026-11-08"
    ) =>
        (
            await ExpectAsync(
                HttpMethod.Post,
                "/api/households/trips",
                token,
                HttpStatusCode.Created,
                new
                {
                    name = "Coast",
                    currency = "CAD",
                    startDate,
                    endDate,
                }
            )
        ).GetProperty("household");

    protected async Task<string> InviteAsync(string householdId, string creatorToken) =>
        (
            await ExpectAsync(
                HttpMethod.Post,
                $"/api/households/{householdId}/invites",
                creatorToken,
                HttpStatusCode.Created
            )
        )
            .GetProperty("code")
            .GetString()!;

    protected Task<HttpResponseMessage> JoinAsync(string token, string code, int? offset = null) =>
        SendAsync(
            HttpMethod.Post,
            "/api/households/join",
            token,
            offset is null ? new { code } : new { code, timezoneOffsetMinutes = offset }
        );

    // Creates an invite and joins with it, expecting success.
    protected async Task<JsonElement> AdmitAsync(
        string householdId,
        string creatorToken,
        string token,
        int? offset = null
    )
    {
        var code = await InviteAsync(householdId, creatorToken);
        using var joined = await JoinAsync(token, code, offset);
        var text = await joined.Content.ReadAsStringAsync(Ct);
        joined.StatusCode.ShouldBe(HttpStatusCode.OK, text);
        return JsonDocument.Parse(text).RootElement.GetProperty("household").Clone();
    }

    protected async Task<JsonElement> DetailAsync(string householdId, string token) =>
        await ExpectAsync(
            HttpMethod.Get,
            $"/api/households/{householdId}",
            token,
            HttpStatusCode.OK
        );

    protected async Task<JsonElement> MemberAsync(string householdId, string token, string userId)
    {
        foreach (
            var member in (await DetailAsync(householdId, token))
                .GetProperty("members")
                .EnumerateArray()
        )
            if (member.GetProperty("userId").GetString() == userId)
                return member;
        throw new ShouldAssertException($"Member {userId} is not listed.");
    }

    protected async Task<List<string>> ListIdsAsync(string token) =>
        [
            .. (await ExpectAsync(HttpMethod.Get, "/api/households", token, HttpStatusCode.OK))
                .GetProperty("households")
                .EnumerateArray()
                .Select(household => household.GetProperty("id").GetString()!),
        ];

    // A live shared expense of `totalCents` paid by `payerId`, split as given.
    protected async Task AddExpenseAsync(
        string householdId,
        string payerId,
        long totalCents,
        string date,
        params (string UserId, long Cents)[] splits
    )
    {
        var id = Guid.NewGuid().ToString("N");
        await Fixture.SqlAsync(
            string.Create(
                CultureInfo.InvariantCulture,
                $"""
                INSERT INTO penny.household_expenses (id, household_id, title, total_cents, expense_date, payer_id, split_mode, category_name, category_icon, category_color, note, revision, created_by, created_at, updated_by, updated_at)
                VALUES ('{id}', '{householdId}', 'Groceries', {totalCents}, DATE '{date}', '{payerId}', 'exact', 'Groceries', 'basket-outline', '#6C9C79', '', 0, '{payerId}', now(), '{payerId}', now());
                """
            ),
            Ct
        );
        foreach (var (userId, cents) in splits)
            await Fixture.SqlAsync(
                string.Create(
                    CultureInfo.InvariantCulture,
                    $"INSERT INTO penny.household_splits (expense_id, user_id, amount_cents) VALUES ('{id}', '{userId}', {cents})"
                ),
                Ct
            );
    }

    protected Task AddReimbursementAsync(
        string householdId,
        string month,
        string fromUserId,
        string toUserId,
        long cents
    ) =>
        Fixture.SqlAsync(
            string.Create(
                CultureInfo.InvariantCulture,
                $"""
                INSERT INTO penny.household_reimbursements (id, household_id, month, from_user_id, to_user_id, amount_cents, created_by, created_at)
                VALUES ('{Guid.NewGuid():N}', '{householdId}', '{month}', '{fromUserId}', '{toUserId}', {cents}, '{fromUserId}', now());
                """
            ),
            Ct
        );

    protected async Task<object?> ScalarAsync(string sql)
    {
        await using var command = Fixture.Admin.CreateCommand(sql);
        return await command.ExecuteScalarAsync(Ct);
    }

    protected async Task<long> CountAsync(string sql) => (long)(await ScalarAsync(sql))!;

    protected async Task<JsonNode> GetLedgerAsync(string token)
    {
        using var response = await SendAsync(HttpMethod.Get, "/api/ledger", token);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return JsonNode.Parse(await response.Content.ReadAsStringAsync(Ct))!;
    }

    protected Task<HttpResponseMessage> PutLedgerAsync(string token, JsonNode snapshot) =>
        SendAsync(HttpMethod.Put, "/api/ledger", token, snapshot);
}
