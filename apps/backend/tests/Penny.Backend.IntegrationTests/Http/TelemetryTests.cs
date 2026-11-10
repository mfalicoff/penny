using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using OpenTelemetry.Metrics;
using OpenTelemetry.Trace;
using Penny.Backend.Api.Configuration;
using Penny.Backend.Api.Middleware;
using Penny.Backend.Application.Diagnostics;
using Penny.Backend.Application.Search;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Http;

// MAZ-127: the host's traces, metrics and logs, captured in memory next to an OTLP
// exporter aimed at a collector that never answers.
public sealed class TelemetryTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    private const string EmailA = "telemetry-alex@example.test";
    private const string EmailB = "telemetry-bea@example.test";
    private const string NewPassword = "a fresh telemetry passphrase";
    private const string HouseholdName = "Quokkahousehold";
    private const string EntryTitle = "Quokkatitle";
    private const string EntryNote = "Zanzibarnote";
    private const long EntryCents = 9_876_543;
    private const string SearchText = "Quokkasearchterm";
    private const string ExceptionText = "synthetic-secret-not-for-http";

    [Fact]
    public async Task whenSensitiveFlowsRun_Telemetry_ShouldExportCorrelatedSignalsWithoutSensitiveValues()
    {
        await using var collector = new SilentCollector();
        var capture = new TelemetryCapture();
        var settings = TelemetryCapture.Settings(collector.Endpoint);
        settings["Search:RateLimitPermits"] = "2";
        await using var factory = new TestApiFactory(
            Fixture.RuntimeConnection,
            settings,
            capture.Configure
        );
        using var client = CreateClient(factory);
        var secrets = new List<string>
        {
            EmailA,
            EmailB,
            TestPassword,
            NewPassword,
            HouseholdName,
            EntryTitle,
            EntryNote,
            EntryCents.ToString(System.Globalization.CultureInfo.InvariantCulture),
            "98765.43",
            SearchText,
            ExceptionText,
        };

        // Auth: registration, a good and a bad password sign-in.
        var alex = await RegisterAsync(EmailA, client);
        var bea = await RegisterAsync(EmailB, client);
        secrets.AddRange([alex, bea]);
        using (var login = await LoginAsync(client, EmailA, TestPassword))
            login.StatusCode.ShouldBe(HttpStatusCode.OK);
        using (var refused = await LoginAsync(client, EmailA, "not the password"))
            refused.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        // Ledger: a save with private text and amount, then a stale save (409).
        using (var read = await SendAsync(client, HttpMethod.Get, "/api/ledger", alex))
        {
            var snapshot = JsonNode.Parse(await read.Content.ReadAsStringAsync(Ct))!;
            var ledger = ContractFixtures.Read("search-cases.json")["serverLedger"]!.DeepClone();
            ledger["transactions"]!
                .AsArray()
                .Add(
                    new JsonObject
                    {
                        ["id"] = "t-telemetry",
                        ["title"] = EntryTitle,
                        ["date"] = "2026-11-02",
                        ["kind"] = "expense",
                        ["total"] = EntryCents,
                        ["share"] = EntryCents,
                        ["categoryId"] = "food",
                        ["note"] = EntryNote,
                    }
                );
            snapshot["ledger"] = ledger;
            using (
                var saved = await SendAsync(client, HttpMethod.Put, "/api/ledger", alex, snapshot)
            )
                saved.StatusCode.ShouldBe(
                    HttpStatusCode.OK,
                    await saved.Content.ReadAsStringAsync(Ct)
                );
            using var stale = await SendAsync(
                client,
                HttpMethod.Put,
                "/api/ledger",
                alex,
                snapshot
            );
            stale.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        }

        // Households: create, invite, join with the code and with a wrong code.
        string code;
        using (
            var created = await SendAsync(
                client,
                HttpMethod.Post,
                "/api/households",
                alex,
                new { name = HouseholdName, currency = "CAD" }
            )
        )
        {
            created.StatusCode.ShouldBe(HttpStatusCode.Created);
            var household = (await created.Content.ReadFromJsonAsync<JsonElement>(Ct))
                .GetProperty("household")
                .GetProperty("id")
                .GetString()!;
            using var invite = await SendAsync(
                client,
                HttpMethod.Post,
                $"/api/households/{household}/invites",
                alex
            );
            invite.StatusCode.ShouldBe(HttpStatusCode.Created);
            code = (await invite.Content.ReadFromJsonAsync<JsonElement>(Ct))
                .GetProperty("code")
                .GetString()!;
            secrets.Add(code);
        }
        using (
            var joined = await SendAsync(
                client,
                HttpMethod.Post,
                "/api/households/join",
                bea,
                new { code }
            )
        )
            joined.StatusCode.ShouldBe(HttpStatusCode.OK);
        using (
            var wrong = await SendAsync(
                client,
                HttpMethod.Post,
                "/api/households/join",
                bea,
                new { code = "ZZZZ-ZZZZ-ZZZZ" }
            )
        )
            ((int)wrong.StatusCode).ShouldBeInRange(400, 499);

        // Password reset: an operator-issued code redeemed over HTTP.
        var reset = await IssueResetAsync(EmailA, factory);
        secrets.Add(reset.Token);
        using (
            var redeemed = await ResetPasswordAsync(
                new { token = reset.Token, password = NewPassword },
                client
            )
        )
            redeemed.StatusCode.ShouldBe(HttpStatusCode.OK);
        alex = await LoginTokenAsync(client, EmailA, NewPassword);
        secrets.Add(alex);

        // Search: private text, then past the per-session limit (2) for a 429.
        for (var attempt = 0; attempt < 3; attempt++)
        {
            using var search = await SendAsync(
                client,
                HttpMethod.Post,
                "/api/v1/search/transactions",
                alex,
                new { query = SearchText }
            );
            search.StatusCode.ShouldBe(
                attempt < 2 ? HttpStatusCode.OK : HttpStatusCode.TooManyRequests
            );
        }

        // An unexpected failure under a client-supplied W3C trace context.
        var traceId = ActivityTraceId.CreateRandom();
        var parentId = ActivitySpanId.CreateRandom();
        string requestId;
        using (var failing = new HttpRequestMessage(HttpMethod.Get, "/api/test/unexpected"))
        {
            failing.Headers.Add("traceparent", $"00-{traceId}-{parentId}-01");
            using var failed = await client.SendAsync(failing, Ct);
            failed.StatusCode.ShouldBe(HttpStatusCode.InternalServerError);
            requestId = failed.Headers.GetValues(RequestCorrelationMiddleware.Header).Single();
        }

        // The embedding worker's work, driven explicitly as other search tests do.
        (
            await factory.Services.GetRequiredService<SearchEmbeddingService>().CatchUpAsync(Ct)
        ).ShouldBeGreaterThan(0);

        TelemetryCapture.Flush(factory.Services);

        // Traces: requests by route template, SQL inside them, the honoured parent,
        // the request id and the worker span.
        var server = capture.Spans.Where(span => span.Kind == ActivityKind.Server).ToList();
        server.ShouldContain(span => Equals(span.GetTagItem("http.route"), "api/ledger"));
        server.ShouldAllBe(span => span.GetTagItem("url.path") == null);
        server.ShouldAllBe(span => span.GetTagItem("url.query") == null);
        var ledgerSpan = server.First(span => Equals(span.GetTagItem("http.route"), "api/ledger"));
        capture.Spans.ShouldContain(span =>
            span.Source.Name == "Npgsql"
            && span.TraceId == ledgerSpan.TraceId
            && span.ParentSpanId != default
        );
        var failedSpan = server.Single(span => span.TraceId == traceId);
        failedSpan.ParentSpanId.ShouldBe(parentId);
        failedSpan.GetTagItem(RequestCorrelationMiddleware.RequestIdAttribute).ShouldBe(requestId);
        failedSpan.GetTagItem("http.response.status_code").ShouldBe(500);
        capture.Spans.ShouldContain(span =>
            span.Source.Name == BackendTelemetry.Name
            && span.OperationName == BackendTelemetry.SearchEmbeddingJob
        );

        // Logs: the error line carries the request and trace ids and is correlated.
        var error = capture.Logs.Single(log =>
            log.Message?.StartsWith("API request failed", StringComparison.Ordinal) == true
        );
        error.TraceId.ShouldBe(traceId);
        error.Message.ShouldBe(
            $"API request failed (InvalidOperationException); request {requestId}, trace {traceId}"
        );
        capture.Logs.ShouldContain(log =>
            log.Category == typeof(RequestCorrelationMiddleware).FullName
            && log.TraceId == ledgerSpan.TraceId
            && log.Text.Contains($"RequestId={ledgerSpan.GetTagItem("penny.request_id")}")
        );

        // Metrics: framework, runtime, pool and app counters. (Kestrel meters are
        // registered too, but this host runs on TestServer.)
        capture.MetricNames.ShouldContain("http.server.request.duration");
        capture.MetricNames.ShouldContain(name =>
            name.StartsWith("dotnet.", StringComparison.Ordinal)
        );
        capture.MetricNames.ShouldContain(name =>
            name.StartsWith("db.client.", StringComparison.Ordinal)
        );
        var signIns = capture.Points("penny.auth.sign_ins").ToList();
        signIns.ShouldContain(tags =>
            Equals(tags[BackendTelemetry.MethodAttribute], "password")
            && Equals(tags[BackendTelemetry.OutcomeAttribute], "success")
        );
        signIns.ShouldContain(tags =>
            Equals(tags[BackendTelemetry.MethodAttribute], "password")
            && Equals(tags[BackendTelemetry.OutcomeAttribute], "failure")
            && Equals(tags[BackendTelemetry.ErrorTypeAttribute], "unauthorized")
        );
        signIns.ShouldContain(tags =>
            Equals(tags[BackendTelemetry.MethodAttribute], "registration")
        );
        capture
            .Points("penny.rate_limit.rejections")
            .ShouldContain(tags => Equals(tags[BackendTelemetry.PolicyAttribute], "search"));
        capture.MetricNames.ShouldContain("penny.ledger.conflicts");
        var joins = capture.Points("penny.household.joins").ToList();
        joins.ShouldContain(tags => Equals(tags[BackendTelemetry.OutcomeAttribute], "success"));
        joins.ShouldContain(tags => Equals(tags[BackendTelemetry.OutcomeAttribute], "failure"));
        capture
            .Points("penny.job.lag")
            .ShouldContain(tags =>
                Equals(tags[BackendTelemetry.JobAttribute], BackendTelemetry.SearchEmbeddingJob)
            );
        var pool = capture
            .MetricNames.Where(name => name.StartsWith("db.client.", StringComparison.Ordinal))
            .SelectMany(capture.Points)
            .SelectMany(tags => tags)
            .Where(tag => tag.Key.EndsWith("pool.name", StringComparison.Ordinal))
            .Select(tag => tag.Value)
            .Distinct()
            .ToList();
        // The host names its pool; the connection string never becomes the name. (The
        // Npgsql meter is process-wide, so other tests' data sources may appear too.)
        pool.ShouldContain(Penny.Backend.Persistence.Configuration.DatabaseSettings.DataSourceName);
        var runtime = new Npgsql.NpgsqlConnectionStringBuilder(Fixture.RuntimeConnection);
        pool.ShouldAllBe(name =>
            !string.Concat(name).Contains(runtime.Username!, StringComparison.Ordinal)
            && !string.Concat(name).Contains("Password", StringComparison.OrdinalIgnoreCase)
        );

        // Privacy: no credential, code, private text or amount in any signal.
        var exported = capture.Text().ToList();
        exported.ShouldNotBeEmpty();
        foreach (var secret in secrets)
            exported.ShouldAllBe(
                text => !text.Contains(secret, StringComparison.OrdinalIgnoreCase),
                $"an exported signal contains a sensitive value ({secret.Length} characters)"
            );
        exported.ShouldAllBe(text =>
            !text.Contains("Password=", StringComparison.OrdinalIgnoreCase)
        );
    }

    [Fact]
    public async Task whenCollectorNeverAnswers_Requests_ShouldSucceedWithoutDelay()
    {
        await using var collector = new SilentCollector();
        var settings = TelemetryCapture.Settings(collector.Endpoint);
        // Export as often as the SDK allows, so requests overlap export attempts.
        settings["OTEL_BSP_SCHEDULE_DELAY"] = "10";
        settings["OTEL_BLRP_SCHEDULE_DELAY"] = "10";
        settings["OTEL_METRIC_EXPORT_INTERVAL"] = "50";
        await using var factory = new TestApiFactory(Fixture.RuntimeConnection, settings);
        using var client = CreateClient(factory);
        factory.Services.GetRequiredService<TelemetryOptions>().Enabled.ShouldBeTrue();
        var token = await RegisterAsync("telemetry-silent@example.test", client);
        var slowest = TimeSpan.Zero;
        for (var request = 0; request < 30; request++)
        {
            var started = Stopwatch.GetTimestamp();
            using var response = await SendAsync(client, HttpMethod.Get, "/api/ledger", token);
            response.StatusCode.ShouldBe(HttpStatusCode.OK);
            var elapsed = Stopwatch.GetElapsedTime(started);
            if (elapsed > slowest)
                slowest = elapsed;
        }
        // Exports block on the silent collector (1 s timeout); requests never wait on them.
        collector.Connections.ShouldBeGreaterThan(0);
        slowest.ShouldBeLessThan(TimeSpan.FromMilliseconds(750));
    }

    [Fact]
    public async Task whenNoEndpointConfigured_Host_ShouldRegisterNoTelemetry()
    {
        var services = Fixture.Factory.Services;
        services.GetRequiredService<TelemetryOptions>().Enabled.ShouldBeFalse();
        services.GetService<TracerProvider>().ShouldBeNull();
        services.GetService<MeterProvider>().ShouldBeNull();
        services.GetService<OpenTelemetry.Logs.LoggerProvider>().ShouldBeNull();
        using var response = await Client.GetAsync("/api/health", Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenTelemetrySettingInvalid_Startup_ShouldFailNamingSettingWithoutValue()
    {
        const string header = "secret-collector-token";
        await using var factory = new TestApiFactory(
            Fixture.RuntimeConnection,
            new Dictionary<string, string>
            {
                ["OTEL_EXPORTER_OTLP_ENDPOINT"] = "https://collector.example.test",
                ["OTEL_EXPORTER_OTLP_HEADERS"] = header,
            }
        );
        var error = Should.Throw<InvalidOperationException>(() => factory.CreateClient());
        error.Message.ShouldContain("OTEL_EXPORTER_OTLP_HEADERS");
        error.Message.ShouldNotContain(header);
    }

    private static Task<HttpResponseMessage> LoginAsync(
        HttpClient client,
        string email,
        string password
    ) => client.PostAsJsonAsync("/api/auth/login", new { email, password }, Ct);

    private static async Task<string> LoginTokenAsync(
        HttpClient client,
        string email,
        string password
    )
    {
        using var response = await LoginAsync(client, email, password);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<JsonElement>(Ct))
            .GetProperty("token")
            .GetString()!;
    }

    private static async Task<HttpResponseMessage> SendAsync(
        HttpClient client,
        HttpMethod method,
        string path,
        string token,
        object? body = null
    )
    {
        using var request = Authorized(method, path, bearer: token);
        if (body is not null)
            request.Content = JsonContent.Create(body);
        return await client.SendAsync(request, Ct);
    }
}
