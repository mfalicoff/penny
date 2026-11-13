using System.Globalization;
using System.Net;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Penny.Backend.Application.Households;
using Penny.Backend.Persistence.Configuration;
using Penny.Backend.Persistence.Repositories;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// HTTP and runner helpers for the shared recurrence suites (MAZ-59). The shared host
// runs no worker: tests call the runner with the pinned clock, or build independent
// runners (own data source and clock) to act as separate worker processes. All data
// is synthetic.
public abstract class SharedRecurrenceTestBase(ApiFixture fixture) : SharedExpenseTestBase(fixture)
{
    protected static string RulesPath(string householdId) =>
        $"/api/households/{householdId}/recurring";

    protected static string RulePath(string householdId, string ruleId) =>
        $"/api/households/{householdId}/recurring/{ruleId}";

    // A legacy rule body; `extra` adds or replaces fields (null removes one).
    protected static Dictionary<string, object?> Rule(
        long totalCents,
        string payerUserId,
        string nextDate,
        string frequency = "monthly",
        object? extra = null
    )
    {
        var body = Expense(totalCents, payerUserId);
        body.Remove("date");
        body["title"] = "Rent";
        body["nextDate"] = nextDate;
        body["frequency"] = frequency;
        if (extra is not null)
            foreach (var property in JsonSerializer.SerializeToElement(extra).EnumerateObject())
                if (property.Value.ValueKind == JsonValueKind.Null)
                    body.Remove(property.Name);
                else
                    body[property.Name] = property.Value;
        return body;
    }

    // A rule body for PUT with the edited revision and active flag.
    protected static Dictionary<string, object?> Edit(
        Dictionary<string, object?> body,
        long revision,
        bool active = true
    ) => new(body, StringComparer.Ordinal) { ["revision"] = revision, ["active"] = active };

    protected async Task<JsonElement> CreateRuleAsync(
        string householdId,
        string token,
        object body
    ) =>
        (
            await ExpectAsync(
                HttpMethod.Post,
                RulesPath(householdId),
                token,
                HttpStatusCode.Created,
                body
            )
        ).GetProperty("rule");

    protected async Task<JsonElement> UpdateRuleAsync(
        string householdId,
        string ruleId,
        string token,
        object body
    ) =>
        (
            await ExpectAsync(
                HttpMethod.Put,
                RulePath(householdId, ruleId),
                token,
                HttpStatusCode.OK,
                body
            )
        ).GetProperty("rule");

    protected async Task<List<JsonElement>> ListRulesAsync(string householdId, string token) =>
        [
            .. (await ExpectAsync(HttpMethod.Get, RulesPath(householdId), token, HttpStatusCode.OK))
                .GetProperty("rules")
                .EnumerateArray(),
        ];

    // The shared host's runner (its TimeProvider is the fixture's pinned clock).
    protected SharedRecurrenceRunner Runner =>
        Fixture.Factory.Services.GetRequiredService<SharedRecurrenceRunner>();

    // Pins the clock and runs passes until nothing is due; returns occurrences recorded.
    protected async Task<int> RunAtAsync(DateTimeOffset instant)
    {
        At(instant);
        return await Runner.RunUntilIdleAsync(Ct);
    }

    // An independent runner, as another worker process would have: its own pool of
    // runtime connections and its own clock.
    protected (SharedRecurrenceRunner Runner, NpgsqlDataSource Source) NewRunner(
        TimeProvider clock,
        int commandTimeoutSeconds = 30
    )
    {
        var source = DatabaseSettings
            .Create(Fixture.RuntimeConnection, 10, 5, commandTimeoutSeconds)
            .CreateDataSource();
        return (
            new SharedRecurrenceRunner(
                new PostgresSharedExpenseRepository(source, Fixture.Receipts),
                clock
            ),
            source
        );
    }

    protected static DateTimeOffset Utc(string date, int hour = 12, int minute = 0, int second = 0)
    {
        var day = DateOnly.ParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        return new(day.Year, day.Month, day.Day, hour, minute, second, TimeSpan.Zero);
    }

    // Occurrence dates the rule recorded (soft-deleted ones too when `includeDeleted`).
    protected Task<List<string>> OccurrencesAsync(string ruleId, bool includeDeleted = false) =>
        TextColumnAsync(
            $"SELECT to_char(expense_date, 'YYYY-MM-DD') FROM penny.household_expenses WHERE recurring_id = '{ruleId}'{(includeDeleted ? "" : " AND deleted_at IS NULL")} ORDER BY expense_date"
        );

    protected async Task<string> NextDateAsync(string ruleId) =>
        (string)
            (
                await ScalarAsync(
                    $"SELECT to_char(next_date, 'YYYY-MM-DD') FROM penny.household_recurring WHERE id = '{ruleId}'"
                )
            )!;

    // Expense events, outbox rows and search documents of the rule's occurrences.
    protected async Task<(long Audits, long Outbox, long Documents)> EventsAsync(string ruleId) =>
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_audit a JOIN penny.household_expenses e ON e.id = a.expense_id WHERE e.recurring_id = '{ruleId}' AND a.action = 'expense.created'"
            ),
            await CountAsync(
                $"SELECT count(*) FROM penny.push_outbox o JOIN penny.household_expenses e ON e.id = o.entity_id WHERE e.recurring_id = '{ruleId}'"
            ),
            await CountAsync(
                $"SELECT count(*) FROM penny.search_documents d JOIN penny.household_expenses e ON e.id = d.expense_id WHERE e.recurring_id = '{ruleId}'"
            )
        );

    // An expense's shares by member id.
    protected static Dictionary<string, long> Shares(JsonElement expense) =>
        expense
            .GetProperty("splits")
            .EnumerateArray()
            .ToDictionary(
                share => share.GetProperty("userId").GetString()!,
                share => share.GetProperty("amountCents").GetInt64(),
                StringComparer.Ordinal
            );

    protected async Task<List<string>> TextColumnAsync(string sql)
    {
        await using var command = Fixture.Admin.CreateCommand(sql);
        await using var reader = await command.ExecuteReaderAsync(Ct);
        var values = new List<string>();
        while (await reader.ReadAsync(Ct))
            values.Add(reader.GetString(0));
        return values;
    }

    // Waits until `count` runtime connections are blocked on locks (fails after 10 s).
    protected async Task WaitForLockWaitAsync(int count = 1)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (DateTime.UtcNow < deadline)
        {
            if (
                await CountAsync(
                    "SELECT count(*) FROM pg_stat_activity WHERE usename = 'penny_runtime' AND wait_event_type = 'Lock'"
                ) >= count
            )
                return;
            await Task.Delay(25, Ct);
        }
        throw new TimeoutException("The runner never waited for the held lock.");
    }

    // Alex creates a household on 2026-09-28 (UTC) and Bea joins the same day.
    protected async Task<(
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
        await ExtendSessionsAsync();
        return (alex, alexId, bea, beaId, home);
    }

    // Recurrence tests move the clock months ahead; the synthetic sessions (30 days)
    // must outlive that.
    protected Task ExtendSessionsAsync() =>
        Fixture.SqlAsync(
            "UPDATE penny.sessions SET expires_at = TIMESTAMPTZ '2099-01-01 00:00:00+00'",
            Ct
        );
}
