using System.Net;
using System.Text.Json;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// HTTP helpers for the settlement and audit suites (MAZ-58). Expenses are created
// through HTTP; the clock is pinned so the month-end cutoff and overdue months are
// deterministic. All data is synthetic.
public abstract class SettlementTestBase(ApiFixture fixture) : SharedExpenseTestBase(fixture)
{
    // Sep 30, 2026 is the last day of September: reimbursements open at UTC midnight.
    protected static readonly DateTimeOffset MonthEnd = new(2026, 9, 30, 0, 0, 0, TimeSpan.Zero);

    protected static readonly DateTimeOffset October = new(2026, 10, 2, 12, 0, 0, TimeSpan.Zero);

    protected static string MonthPath(string householdId, string month) =>
        $"/api/households/{householdId}/months/{month}";

    protected static string ReimbursementsPath(string householdId, string month) =>
        MonthPath(householdId, month) + "/reimbursements";

    protected static string AuditPath(string householdId, string query = "") =>
        $"/api/households/{householdId}/audit{query}";

    protected Task<JsonElement> RecapAsync(string householdId, string token, string month) =>
        ExpectAsync(HttpMethod.Get, MonthPath(householdId, month), token, HttpStatusCode.OK);

    protected static object Transfer(string fromUserId, string toUserId, long amountCents) =>
        new
        {
            fromUserId,
            toUserId,
            amountCents,
        };

    protected async Task<JsonElement> ReimburseAsync(
        string householdId,
        string token,
        string month,
        string fromUserId,
        string toUserId,
        long amountCents
    ) =>
        (
            await ExpectAsync(
                HttpMethod.Post,
                ReimbursementsPath(householdId, month),
                token,
                HttpStatusCode.Created,
                Transfer(fromUserId, toUserId, amountCents)
            )
        ).GetProperty("reimbursement");

    protected Task<HttpResponseMessage> SendReimbursementAsync(
        string householdId,
        string token,
        string month,
        string fromUserId,
        string toUserId,
        long amountCents
    ) =>
        SendAsync(
            HttpMethod.Post,
            ReimbursementsPath(householdId, month),
            token,
            Transfer(fromUserId, toUserId, amountCents)
        );

    protected async Task<List<JsonElement>> AuditAsync(
        string householdId,
        string token,
        string query = ""
    ) =>
        [
            .. (
                await ExpectAsync(
                    HttpMethod.Get,
                    AuditPath(householdId, query),
                    token,
                    HttpStatusCode.OK
                )
            )
                .GetProperty("events")
                .EnumerateArray(),
        ];

    protected static Dictionary<string, long> Balances(JsonElement recap) =>
        recap
            .GetProperty("balances")
            .EnumerateArray()
            .ToDictionary(
                balance => balance.GetProperty("userId").GetString()!,
                balance => balance.GetProperty("balanceCents").GetInt64(),
                StringComparer.Ordinal
            );

    protected static List<(string From, string To, long Cents)> Suggestions(JsonElement recap) =>
        [
            .. recap
                .GetProperty("suggestions")
                .EnumerateArray()
                .Select(suggestion =>
                    (
                        suggestion.GetProperty("fromUserId").GetString()!,
                        suggestion.GetProperty("toUserId").GetString()!,
                        suggestion.GetProperty("amountCents").GetInt64()
                    )
                ),
        ];

    protected static List<string> OverdueMonths(JsonElement recap) =>
        [
            .. recap
                .GetProperty("overdueMonths")
                .EnumerateArray()
                .Select(month => month.GetString()!),
        ];

    // Three members (alex creates, bea and cam join), by default on Sep 28, 2026 at
    // noon UTC; expenses can be dated from that day on.
    protected async Task<(
        string Alex,
        string AlexId,
        string Bea,
        string BeaId,
        string Cam,
        string CamId,
        string Home
    )> HomeAsync(DateTimeOffset? joined = null)
    {
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        var (cam, camId) = await AccountAsync("cam@example.test");
        At(joined ?? Noon);
        var home = Id(await CreateHouseholdAsync(alex));
        await AdmitAsync(home, alex, bea);
        await AdmitAsync(home, alex, cam);
        At(Noon);
        // The clock moves past the synthetic sessions' 30 days in some tests.
        await Fixture.SqlAsync(
            "UPDATE penny.sessions SET expires_at = TIMESTAMPTZ '2099-01-01 00:00:00+00'",
            Ct
        );
        return (alex, alexId, bea, beaId, cam, camId, home);
    }
}
