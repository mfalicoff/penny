using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Contracts;

// MAZ-62: runs the language-neutral scenarios of contracts/fixtures/full-stack-seeds.json
// through real HTTP, PostgreSQL (pg_trgm, pgvector) and the real model with the pinned
// clock, then checks their published search and state expectations. The Node runner
// (scripts/test-env/seed.mjs) runs the same steps against a full-stack environment.
public sealed partial class FullStackSeedTests(ApiFixture fixture) : SearchTestBase(fixture)
{
    private static JsonNode Seeds => ContractFixtures.Read("full-stack-seeds.json");

    private static JsonNode Scenario(string name) =>
        Seeds["scenarios"]!.AsArray().Single(item => item!["name"]!.GetValue<string>() == name)!;

    private static DateTimeOffset Instant(JsonNode node) =>
        DateTimeOffset.Parse(node.GetValue<string>(), CultureInfo.InvariantCulture);

    [GeneratedRegex(@"^\$(user|household|expense):(.+)$")]
    private static partial Regex Reference();

    private static JsonNode? Resolve(JsonNode? node, SeedContext context) =>
        node switch
        {
            JsonValue value
                when value.TryGetValue<string>(out var text)
                    && Reference().Match(text) is { Success: true } match => JsonValue.Create(
                match.Groups[1].Value switch
                {
                    "user" => context.UserIds[match.Groups[2].Value],
                    "household" => context.Households[match.Groups[2].Value],
                    _ => context.Expenses[match.Groups[2].Value],
                }
            ),
            JsonObject item => new JsonObject(
                item.Select(pair => KeyValuePair.Create(pair.Key, Resolve(pair.Value, context)))
            ),
            JsonArray items => new JsonArray([.. items.Select(child => Resolve(child, context))]),
            _ => node?.DeepClone(),
        };

    [GeneratedRegex(@"\$(user|household|expense):([a-z0-9-]+)")]
    private static partial Regex EmbeddedReference();

    // References inside a path, such as /api/households/$household:maison/expenses.
    private static string Interpolate(string text, SeedContext context) =>
        EmbeddedReference()
            .Replace(
                text,
                match => Resolve(JsonValue.Create(match.Value), context)!.GetValue<string>()
            );

    private async Task RefreshSessionsAsync(SeedContext context)
    {
        foreach (var (alias, email) in context.Emails)
        {
            using var login = await Client.PostAsJsonAsync(
                "/api/auth/login",
                new { email, password = TestPassword },
                Ct
            );
            login.StatusCode.ShouldBe(HttpStatusCode.OK);
            context.Tokens[alias] = (await login.Content.ReadFromJsonAsync<JsonElement>(Ct))
                .GetProperty("token")
                .GetString()!;
        }
    }

    private async Task<SeedContext> SeedAsync(JsonNode scenario)
    {
        var context = new SeedContext();
        var steps = scenario["steps"]!.AsArray();
        At(
            Instant(
                steps.FirstOrDefault(step => step!["clock"] is not null)?["clock"]
                    ?? scenario["clock"]!
            )
        );
        var name = scenario["name"]!.GetValue<string>();
        foreach (var alias in scenario["users"]!.AsArray().Select(item => item!.GetValue<string>()))
        {
            var email = $"{alias}.{name}@penny.test";
            var (token, userId) = await AccountAsync(email);
            (context.Emails[alias], context.Tokens[alias], context.UserIds[alias]) = (
                email,
                token,
                userId
            );
        }
        foreach (var step in steps.Select(step => step!.AsObject()))
        {
            var token = step["as"] is { } alias ? context.Tokens[alias.GetValue<string>()] : null;
            if (step["clock"] is { } clock)
            {
                At(Instant(clock));
                await RefreshSessionsAsync(context);
            }
            else if (step["ledger"] is { } ledger)
                await SeedLedgerAsync(token!, ledger);
            else if (step["rename"] is JsonObject rename)
                await SaveLedgerAsync(
                    token!,
                    document =>
                    {
                        foreach (var (kind, names) in rename)
                        foreach (var item in document[kind]!.AsArray())
                            if (names![item!["id"]!.GetValue<string>()] is { } renamed)
                                item["name"] = renamed.GetValue<string>();
                    }
                );
            else if ((step["createHousehold"] ?? step["createTrip"]) is { } create)
            {
                var body = create.DeepClone().AsObject();
                body.Remove("ref");
                var path = step["createTrip"] is null ? "/api/households" : "/api/households/trips";
                var created = await ExpectAsync(
                    HttpMethod.Post,
                    path,
                    token,
                    HttpStatusCode.Created,
                    body
                );
                context.Households[create["ref"]!.GetValue<string>()] = created
                    .GetProperty("household")
                    .GetProperty("id")
                    .GetString()!;
            }
            else if (step["invite"] is { } invite)
                context.Invites[invite["ref"]!.GetValue<string>()] = await InviteAsync(
                    context.Households[invite["household"]!.GetValue<string>()],
                    token!
                );
            else if (step["join"] is { } join)
            {
                using var joined = await JoinAsync(
                    token!,
                    context.Invites[join["invite"]!.GetValue<string>()],
                    join["timezoneOffsetMinutes"]?.GetValue<int>()
                );
                joined.IsSuccessStatusCode.ShouldBeTrue(await joined.Content.ReadAsStringAsync(Ct));
            }
            else if (step["expense"] is { } expense)
            {
                var created = await ExpectAsync(
                    HttpMethod.Post,
                    ExpensesPath(context.Households[expense["household"]!.GetValue<string>()]),
                    token,
                    HttpStatusCode.Created,
                    Resolve(expense["body"], context)
                );
                context.Expenses[expense["ref"]!.GetValue<string>()] = created
                    .GetProperty("expense")
                    .GetProperty("id")
                    .GetString()!;
            }
            else if (step["reimburse"] is { } reimburse)
            {
                var body = Resolve(reimburse, context)!.AsObject();
                var household = context.Households[reimburse["household"]!.GetValue<string>()];
                var month = reimburse["month"]!.GetValue<string>();
                body.Remove("household");
                body.Remove("month");
                await ExpectAsync(
                    HttpMethod.Post,
                    $"/api/households/{household}/months/{month}/reimbursements",
                    token,
                    HttpStatusCode.Created,
                    body
                );
            }
            else if (step["leave"] is { } leave)
                await ExpectAsync(
                    HttpMethod.Post,
                    $"/api/households/{context.Households[leave["household"]!.GetValue<string>()]}/leave",
                    token,
                    HttpStatusCode.OK
                );
            else if (step["sharedRecurring"] is { } rule)
            {
                var created = await ExpectAsync(
                    HttpMethod.Post,
                    $"/api/households/{context.Households[rule["household"]!.GetValue<string>()]}/recurring",
                    token,
                    HttpStatusCode.Created,
                    Resolve(rule["body"], context)
                );
                context.Rules[rule["ref"]!.GetValue<string>()] = created
                    .GetProperty("rule")
                    .GetProperty("id")
                    .GetString()!;
            }
            else
                throw new InvalidOperationException($"Unknown seed step {step.ToJsonString()}.");
        }
        At(Instant(scenario["clock"]!));
        await RefreshSessionsAsync(context);
        return context;
    }

    private static string Key(string key, SeedContext context) =>
        key.StartsWith("shared:$expense:", StringComparison.Ordinal)
            ? "shared:" + context.Expenses[key["shared:$expense:".Length..]]
            : key;

    [Fact]
    public async Task whenSearchableHouseholdSeeded_Search_ShouldMatchPublishedExpectations()
    {
        var scenario = Scenario("searchable-household");
        var context = await SeedAsync(scenario);
        await CatchUpAsync();
        foreach (var item in scenario["searchExpectations"]!.AsArray())
        {
            var why = item!["why"]!.GetValue<string>();
            var page = await SearchAsync(
                context.Tokens[item["as"]!.GetValue<string>()],
                item["request"]!
            );
            var keys = Keys(page);
            var expected = item["keys"]!
                .AsArray()
                .Select(key => Key(key!.GetValue<string>(), context))
                .ToList();
            keys.Take(expected.Count).ToList().ShouldBe(expected, why);
            Matches(page)
                .Take(expected.Count)
                .ToList()
                .ShouldBe(
                    [.. item["matches"]!.AsArray().Select(match => match?.GetValue<string>())],
                    why
                );
            if (item["meaningAllowedAfter"]!.GetValue<bool>())
                Matches(page).Skip(expected.Count).ShouldAllBe(match => match == "meaning", why);
            else
                keys.Count.ShouldBe(expected.Count, why);
            foreach (var excluded in item["excludes"]!.AsArray())
                keys.ShouldNotContain(Key(excluded!.GetValue<string>(), context), why);
        }
    }

    [Fact]
    public async Task whenSearchableHouseholdSeeded_RedesignStates_ShouldMatchServerFacts()
    {
        var context = await SeedAsync(Scenario("searchable-household"));
        var states = ContractFixtures.Read("redesign-states.json");
        // iphone-payment-stale: a share payment against an outdated expense revision is refused.
        var stale = states["states"]!
            .AsArray()
            .Single(item => item!["specimen"]!.GetValue<string>() == "iphone-payment-stale")![
            "staleWrite"
        ]!;
        foreach (var request in stale["requests"]!.AsArray())
        {
            using var response = await SendAsync(
                new HttpMethod(stale["method"]!.GetValue<string>()),
                Interpolate(stale["path"]!.GetValue<string>(), context),
                context.Tokens["bea"],
                Resolve(request!["body"], context)
            );
            var text = await response.Content.ReadAsStringAsync(Ct);
            ((int)response.StatusCode).ShouldBe(request["expectStatus"]!.GetValue<int>(), text);
            if (request["expectError"] is { } error)
                JsonDocument
                    .Parse(text)
                    .RootElement.GetProperty("error")
                    .GetString()
                    .ShouldBe(error.GetValue<string>());
        }

        // Recorded and scheduled October totals for alex (home, insights, schedule).
        var totals = states["totals"]!["alex-2026-10"]!;
        var ledger = (await GetLedgerAsync(context.Tokens["alex"]))["ledger"]!;
        long Personal(string kind) =>
            ledger["transactions"]!
                .AsArray()
                .Where(entry =>
                    entry!["kind"]!.GetValue<string>() == kind
                    && entry["date"]!
                        .GetValue<string>()
                        .StartsWith("2026-10", StringComparison.Ordinal)
                )
                .Sum(entry => entry!["share"]!.GetValue<long>());
        var projection = await ExpectAsync(
            HttpMethod.Get,
            "/api/households/projection?month=2026-10",
            context.Tokens["alex"],
            HttpStatusCode.OK
        );
        var shared = projection
            .GetProperty("transactions")
            .EnumerateArray()
            .Where(item =>
                item.GetProperty("date")
                    .GetString()!
                    .StartsWith("2026-10", StringComparison.Ordinal)
            )
            .Sum(item => item.GetProperty("shareCents").GetInt64());
        (Personal("expense") + shared).ShouldBe(
            totals["recorded"]!["expenseCents"]!.GetValue<long>()
        );
        Personal("income").ShouldBe(totals["recorded"]!["incomeCents"]!.GetValue<long>());
        Personal("investment").ShouldBe(totals["recorded"]!["investmentCents"]!.GetValue<long>());
        var scheduledShared = totals["scheduled"]!
            .AsArray()
            .Single(item => item!["source"]!.GetValue<string>() == "shared")!;
        projection
            .GetProperty("scheduled")
            .EnumerateArray()
            .Select(item =>
                (
                    item.GetProperty("title").GetString(),
                    item.GetProperty("date").GetString(),
                    item.GetProperty("shareCents").GetInt64()
                )
            )
            .ShouldContain(
                (
                    scheduledShared["title"]!.GetValue<string>(),
                    scheduledShared["date"]!.GetValue<string>(),
                    scheduledShared["shareCents"]!.GetValue<long>()
                )
            );
    }

    [Fact]
    public async Task whenFutureIncomeSeeded_RedesignTotals_ShouldSplitIncomeAtTheLocalToday()
    {
        // MAZ-136: Left to spend (recorded) counts income dated on or before the person's local
        // date; income after it is expected and counts toward Projected only. Expenses and
        // investments dated after today stay recorded (MAZ-139). The server stores the entries
        // as written; this checks the published totals against what it serves.
        var context = await SeedAsync(Scenario("future-income"));
        var totals = ContractFixtures.Read("redesign-states.json")["totals"]!["dana-2026-10"]!;
        var zone = TimeZoneInfo.FindSystemTimeZoneById(totals["timeZone"]!.GetValue<string>());
        var clock = Instant(totals["clock"]!);
        var today = TimeZoneInfo
            .ConvertTime(clock, zone)
            .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        today.ShouldBe(totals["today"]!.GetValue<string>());
        today.ShouldNotBe(
            clock.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            "the time zone moves today off the UTC date"
        );
        var month = today[..7];
        var ledger = (await GetLedgerAsync(context.Tokens["dana"]))["ledger"]!;
        var entries = ledger["transactions"]!
            .AsArray()
            .Select(entry => entry!)
            .Where(entry =>
                entry["date"]!.GetValue<string>().StartsWith(month, StringComparison.Ordinal)
            )
            .ToList();
        bool IsKind(JsonNode entry, string kind) => entry["kind"]!.GetValue<string>() == kind;
        bool IsAfterToday(JsonNode entry) =>
            string.CompareOrdinal(entry["date"]!.GetValue<string>(), today) > 0;
        static long Sum(IEnumerable<JsonNode> items) =>
            items.Sum(item => item["share"]!.GetValue<long>());
        static long Cents(JsonNode node, string name) => node[name]!.GetValue<long>();

        var recorded = totals["recorded"]!;
        Sum(entries.Where(entry => IsKind(entry, "expense")))
            .ShouldBe(Cents(recorded, "expenseCents"));
        Sum(entries.Where(entry => IsKind(entry, "investment")))
            .ShouldBe(Cents(recorded, "investmentCents"));
        Sum(entries.Where(entry => IsKind(entry, "income") && !IsAfterToday(entry)))
            .ShouldBe(Cents(recorded, "incomeCents"));
        entries
            .Any(entry => IsKind(entry, "expense") && IsAfterToday(entry))
            .ShouldBeTrue("a future-dated expense stays recorded");
        entries
            .Where(entry => IsKind(entry, "income") && IsAfterToday(entry))
            .Select(entry =>
                (
                    entry["title"]!.GetValue<string>(),
                    entry["date"]!.GetValue<string>(),
                    entry["share"]!.GetValue<long>()
                )
            )
            .ShouldBe(
                totals["expected"]!
                    .AsArray()
                    .Select(item =>
                        (
                            item!["title"]!.GetValue<string>(),
                            item["date"]!.GetValue<string>(),
                            Cents(item, "shareCents")
                        )
                    ),
                // The server does not promise the ledger's entry order.
                ignoreOrder: true
            );

        // The scheduled pay is the served rule's next occurrence; projected adds it and the
        // expected income to the recorded totals.
        var scheduled = totals["scheduled"]!.AsArray().Single()!;
        var rule = ledger["recurring"]!
            .AsArray()
            .Single(item =>
                item!["title"]!.GetValue<string>() == scheduled["title"]!.GetValue<string>()
            )!;
        rule["nextDate"]!.GetValue<string>().ShouldBe(scheduled["date"]!.GetValue<string>());
        rule["share"]!.GetValue<long>().ShouldBe(Cents(scheduled, "shareCents"));
        var expected = totals["expected"]!.AsArray().Sum(item => Cents(item!, "shareCents"));
        var projected = totals["projected"]!;
        Cents(projected, "incomeCents")
            .ShouldBe(Cents(recorded, "incomeCents") + expected + Cents(scheduled, "shareCents"));
        Cents(projected, "expenseCents").ShouldBe(Cents(recorded, "expenseCents"));
        Cents(projected, "investmentCents").ShouldBe(Cents(recorded, "investmentCents"));
    }

    [Fact]
    public async Task whenScenarioSeededTwice_Seed_ShouldProduceIdenticalNormalizedState()
    {
        async Task<string> SnapshotAsync()
        {
            await Fixture.ResetAsync(Ct);
            var context = await SeedAsync(Scenario("searchable-household"));
            var ids = context.UserIds.ToDictionary(pair => pair.Value, pair => "$user:" + pair.Key);
            foreach (var (name, id) in context.Households)
                ids[id] = "$household:" + name;
            foreach (var (name, id) in context.Expenses)
                ids[id] = "$expense:" + name;
            foreach (var (name, id) in context.Rules)
                ids[id] = "$rule:" + name;
            var parts = new List<string>();
            foreach (var alias in context.Tokens.Keys.Order(StringComparer.Ordinal))
            {
                parts.Add((await GetLedgerAsync(context.Tokens[alias])).ToJsonString());
                parts.Add(
                    (
                        await ExpectAsync(
                            HttpMethod.Get,
                            "/api/households/projection?month=2026-10",
                            context.Tokens[alias],
                            HttpStatusCode.OK
                        )
                    ).ToString()
                );
            }
            var text = string.Join("\n", parts);
            foreach (var (id, name) in ids)
                text = text.Replace(id, name, StringComparison.Ordinal);
            return text;
        }
        var first = await SnapshotAsync();
        var second = await SnapshotAsync();
        second.ShouldBe(first);
    }
}
