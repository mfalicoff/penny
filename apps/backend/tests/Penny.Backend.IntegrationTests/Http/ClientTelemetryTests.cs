using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Penny.Backend.Api.ClientTelemetry;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Http;

// MAZ-129: the authenticated client telemetry endpoint. The collector is the forwarder's
// captured HTTP handler, so these tests see exactly what would leave the API.
public sealed class ClientTelemetryTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    private const string FaroUrl = "http://alloy.internal.test:12347/collect";
    private const string OtlpEndpoint = "http://alloy.internal.test:4319";

    // Synthetic financial text that must never reach the collector.
    private const string Email = "quokka.payer@example.test";
    private const string Title = "Quokkatitle groceries";
    private const string Amount = "158.77";
    private const string Search = "zanzibarsearch";
    private const string HouseholdId = "3f2b9c1e-7a1d-4e0b-9a54-1c2d3e4f5a6b";

    private static Dictionary<string, string> Settings(bool replay = false, int permits = 1000) =>
        new()
        {
            ["ClientTelemetry:FaroUrl"] = FaroUrl,
            ["ClientTelemetry:OtlpEndpoint"] = OtlpEndpoint,
            ["ClientTelemetry:OtlpHeaders"] = "Authorization=Basic%20c3ludGhldGlj",
            ["ClientTelemetry:SessionReplay"] = replay ? "true" : "false",
            ["ClientTelemetry:RateLimitPermits"] = permits.ToString(
                System.Globalization.CultureInfo.InvariantCulture
            ),
            ["ClientTelemetry:MaxPayloadBytes"] = "32768",
        };

    private TestApiFactory Host(
        CapturingCollector collector,
        Dictionary<string, string> settings
    ) =>
        new(Fixture.Connection, settings, services =>
            services
                .AddHttpClient(ClientTelemetryForwarder.HttpClientName)
                .ConfigurePrimaryHttpMessageHandler(() => collector)
        );

    private static JsonObject Faro(params (string Key, JsonNode Value)[] parts)
    {
        var body = new JsonObject
        {
            ["meta"] = new JsonObject
            {
                ["sdk"] = new JsonObject { ["name"] = "faro-web-sdk", ["version"] = "2.14.0" },
                ["app"] = new JsonObject { ["name"] = "penny-web", ["version"] = "3.0.0" },
                ["session"] = new JsonObject { ["id"] = "aBcDeFgHiJ" },
                ["page"] = new JsonObject
                {
                    ["url"] = $"https://penny.example.test/households/{HouseholdId}?q={Search}",
                },
                ["user"] = new JsonObject { ["email"] = Email, ["id"] = "user-1" },
                ["geo"] = new JsonObject { ["city"] = "Lisbon" },
            },
        };
        foreach (var (key, value) in parts)
            body[key] = value;
        return body;
    }

    private static HttpRequestMessage Post(
        string path,
        string token,
        string json,
        string? key = null
    )
    {
        var request = Authorized(HttpMethod.Post, path, token);
        request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        if (key is not null)
            request.Headers.Add("Idempotency-Key", key);
        return request;
    }

    [Fact]
    public async Task whenServerHasTelemetryOff_TelemetryEndpoints_ShouldReturnNotFoundAndInfoShouldSayOff()
    {
        var token = await RegisterAsync("telemetry-off@example.test");
        foreach (
            var path in new[]
            {
                "/api/telemetry/faro",
                "/api/telemetry/otlp/v1/traces",
                "/api/telemetry/otlp/v1/logs",
            }
        )
        {
            using var response = await Client.SendAsync(
                Post(path, token, Faro().ToJsonString()),
                Ct
            );
            response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
            (await response.Content.ReadFromJsonAsync<JsonElement>(Ct))
                .GetProperty("error")
                .GetString()
                .ShouldBe("Client telemetry is off on this server.");
        }
        var info = await Client.GetFromJsonAsync<JsonElement>("/api/info", Ct);
        var telemetry = info.GetProperty("telemetry");
        telemetry.GetProperty("web").GetBoolean().ShouldBeFalse();
        telemetry.GetProperty("sessionReplay").GetBoolean().ShouldBeFalse();
        telemetry.GetProperty("native").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task whenRequestHasNoSession_FaroReport_ShouldReturnUnauthorizedAndForwardNothing()
    {
        var collector = new CapturingCollector();
        await using var factory = Host(collector, Settings());
        using var client = CreateClient(factory);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/telemetry/faro")
        {
            Content = new StringContent(Faro().ToJsonString(), Encoding.UTF8, "application/json"),
        };
        using var response = await client.SendAsync(request, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        var info = await client.GetFromJsonAsync<JsonElement>("/api/info", Ct);
        info.GetProperty("telemetry").GetProperty("web").GetBoolean().ShouldBeTrue();
        info.GetProperty("telemetry").GetProperty("native").GetBoolean().ShouldBeTrue();
        collector.Count.ShouldBe(0);
    }

    [Fact]
    public async Task whenReportCarriesFinancialText_FaroReport_ShouldForwardItScrubbedOnce()
    {
        var collector = new CapturingCollector();
        await using var factory = Host(collector, Settings());
        using var client = CreateClient(factory);
        var token = await RegisterAsync("telemetry-faro@example.test", client);
        var body = Faro(
            (
                "exceptions",
                new JsonArray(
                    new JsonObject
                    {
                        ["type"] = "TypeError",
                        ["value"] = $"Cannot save \"{Title}\" for {Amount} by {Email}",
                        ["stacktrace"] = new JsonObject
                        {
                            ["frames"] = new JsonArray(
                                new JsonObject
                                {
                                    ["filename"] =
                                        $"https://penny.example.test/assets/index-Bx3a9.js?token={Search}",
                                    ["function"] = "save",
                                    ["lineno"] = 12,
                                }
                            ),
                        },
                        ["context"] = new JsonObject { ["note"] = Title },
                    }
                )
            ),
            (
                "measurements",
                new JsonArray(
                    new JsonObject
                    {
                        ["type"] = "web-vitals",
                        ["values"] = new JsonObject { ["lcp"] = 1234.5 },
                    }
                )
            )
        );

        using (
            var accepted = await client.SendAsync(
                Post("/api/telemetry/faro", token, body.ToJsonString(), "key-0123456789"),
                Ct
            )
        )
            accepted.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        // Faro retries with the same key after a timeout: accepted again, not forwarded again.
        using (
            var repeat = await client.SendAsync(
                Post("/api/telemetry/faro", token, body.ToJsonString(), "key-0123456789"),
                Ct
            )
        )
            repeat.StatusCode.ShouldBe(HttpStatusCode.Accepted);

        var forwarded = await collector.NextAsync(Ct);
        forwarded.Url.ShouldBe(new Uri(FaroUrl));
        forwarded.Headers.ShouldNotContainKey("Authorization");
        forwarded.Headers.ShouldNotContainKey("Cookie");
        // MAZ-289: Grafana Cloud's collector refuses a report without its session header.
        forwarded.Headers[FaroPayload.SessionHeader].ShouldBe("aBcDeFgHiJ");
        foreach (
            var secret in new[]
            {
                Email,
                "Quokkatitle",
                Amount,
                Search,
                HouseholdId,
                "Lisbon",
                token,
            }
        )
            forwarded.Body.ShouldNotContain(secret);
        var sent = JsonNode.Parse(forwarded.Body)!;
        sent["meta"]!["user"].ShouldBeNull();
        sent["meta"]!["geo"].ShouldBeNull();
        sent["exceptions"]![0]!["context"].ShouldBeNull();
        sent["meta"]!["page"]!["url"]!
            .GetValue<string>()
            .ShouldBe("https://penny.example.test/households/:id");
        sent["exceptions"]![0]!["value"]!
            .GetValue<string>()
            .ShouldBe("Cannot save <text> for <n> by <email>");
        sent["exceptions"]![0]!["stacktrace"]!["frames"]![0]!["filename"]!
            .GetValue<string>()
            .ShouldBe("https://penny.example.test/assets/index-Bx3a9.js");
        sent["measurements"]![0]!["values"]!["lcp"]!.GetValue<double>().ShouldBe(1234.5);

        // A fresh key is a new report.
        using (
            var next = await client.SendAsync(
                Post("/api/telemetry/faro", token, body.ToJsonString(), "key-9876543210"),
                Ct
            )
        )
            next.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        await collector.NextAsync(Ct);
        collector.Count.ShouldBe(0);
    }

    private static JsonObject ReplayEvent(string rrweb) =>
        new()
        {
            ["name"] = "faro.session_recording.event",
            ["domain"] = "replay",
            ["attributes"] = new JsonObject
            {
                ["event"] = rrweb,
                ["recording_id"] = "rec_0123456789",
                ["gen"] = "0",
                ["seq"] = "4",
            },
        };

    // A full snapshot and an input, as rrweb would record a page that forgot to mask.
    private static string UnmaskedSnapshot() =>
        new JsonObject
        {
            ["type"] = 2,
            ["data"] = new JsonObject
            {
                ["node"] = new JsonObject
                {
                    ["type"] = 2,
                    ["tagName"] = "button",
                    ["attributes"] = new JsonObject
                    {
                        ["class"] = "row",
                        ["aria-label"] = $"{Title} {Amount}",
                        ["title"] = Email,
                        ["data-entry-id"] = HouseholdId,
                        ["href"] = $"/households/{HouseholdId}?q={Search}",
                        ["src"] = "data:image/png;base64,QUJD",
                    },
                    ["childNodes"] = new JsonArray(
                        new JsonObject { ["type"] = 3, ["textContent"] = Title },
                        new JsonObject
                        {
                            ["type"] = 3,
                            ["textContent"] = ".row{color:red}",
                            ["isStyle"] = true,
                        }
                    ),
                },
            },
            ["timestamp"] = 1,
        }.ToJsonString();

    [Fact]
    public async Task whenReplayEventCarriesText_FaroReport_ShouldForwardItMasked()
    {
        var collector = new CapturingCollector();
        await using var factory = Host(collector, Settings(replay: true));
        using var client = CreateClient(factory);
        var token = await RegisterAsync("telemetry-replay@example.test", client);
        var input = new JsonObject
        {
            ["type"] = 3,
            ["data"] = new JsonObject
            {
                ["source"] = 5,
                ["id"] = 7,
                ["text"] = Search,
                ["isChecked"] = false,
            },
            ["timestamp"] = 2,
        }.ToJsonString();
        var body = Faro(
            ("events", new JsonArray(ReplayEvent(UnmaskedSnapshot()), ReplayEvent(input)))
        );

        using var response = await client.SendAsync(
            Post("/api/telemetry/faro", token, body.ToJsonString()),
            Ct
        );
        response.StatusCode.ShouldBe(HttpStatusCode.Accepted);

        var forwarded = await collector.NextAsync(Ct);
        foreach (var secret in new[] { Email, "Quokkatitle", Amount, Search, HouseholdId, "QUJD" })
            forwarded.Body.ShouldNotContain(secret);
        var events = JsonNode.Parse(forwarded.Body)!["events"]!.AsArray();
        events.Count.ShouldBe(2);
        events[0]!["attributes"]!["seq"]!.GetValue<string>().ShouldBe("4");
        var snapshot = JsonNode.Parse(events[0]!["attributes"]!["event"]!.GetValue<string>())!;
        var node = snapshot["data"]!["node"]!;
        node["attributes"]!["class"]!.GetValue<string>().ShouldBe("row");
        node["attributes"]!["aria-label"]!
            .GetValue<string>()
            .ShouldBe("*********** ********* ******");
        node["attributes"]!["href"]!.GetValue<string>().ShouldBe("/households/:id");
        node["attributes"]!["src"]!.GetValue<string>().ShouldBe("data:,");
        node["childNodes"]![0]!["textContent"]!
            .GetValue<string>()
            .ShouldBe("*********** *********");
        node["childNodes"]![1]!["textContent"]!.GetValue<string>().ShouldBe(".row{color:red}");
        var typed = JsonNode.Parse(events[1]!["attributes"]!["event"]!.GetValue<string>())!;
        typed["data"]!["text"]!.GetValue<string>().ShouldBe("**************");
    }

    [Fact]
    public async Task whenServerOffersNoReplay_FaroReport_ShouldDropReplayEvents()
    {
        var collector = new CapturingCollector();
        await using var factory = Host(collector, Settings(replay: false));
        using var client = CreateClient(factory);
        var token = await RegisterAsync("telemetry-noreplay@example.test", client);
        var body = Faro(
            (
                "events",
                new JsonArray(
                    ReplayEvent(UnmaskedSnapshot()),
                    new JsonObject { ["name"] = "route_change" }
                )
            )
        );
        using var response = await client.SendAsync(
            Post("/api/telemetry/faro", token, body.ToJsonString()),
            Ct
        );
        response.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        var events = JsonNode.Parse((await collector.NextAsync(Ct)).Body)!["events"]!.AsArray();
        events.Select(item => item!["name"]!.GetValue<string>()).ShouldBe(["route_change"]);
    }

    [Fact]
    public async Task whenReportIsMalformedOrTooLarge_FaroReport_ShouldBeRefused()
    {
        var collector = new CapturingCollector();
        await using var factory = Host(collector, Settings(replay: true));
        using var client = CreateClient(factory);
        var token = await RegisterAsync("telemetry-invalid@example.test", client);

        var otherApp = Faro();
        otherApp["meta"]!["app"]!["name"] = "penny-backend";
        var unknownKey = Faro(("ledger", new JsonArray()));
        var notList = Faro(("logs", new JsonObject()));
        var badReplay = Faro(("events", new JsonArray(ReplayEvent("not json"))));
        foreach (
            var json in new[]
            {
                "not json",
                "[]",
                otherApp.ToJsonString(),
                unknownKey.ToJsonString(),
                notList.ToJsonString(),
                badReplay.ToJsonString(),
            }
        )
        {
            using var response = await client.SendAsync(
                Post("/api/telemetry/faro", token, json),
                Ct
            );
            response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, json);
        }

        using (var plain = Authorized(HttpMethod.Post, "/api/telemetry/faro", token))
        {
            plain.Content = new StringContent(Faro().ToJsonString(), Encoding.UTF8, "text/plain");
            using var response = await client.SendAsync(plain, Ct);
            response.StatusCode.ShouldBe(HttpStatusCode.UnsupportedMediaType);
        }
        using (var gzip = Post("/api/telemetry/faro", token, Faro().ToJsonString()))
        {
            gzip.Content!.Headers.ContentEncoding.Add("gzip");
            using var response = await client.SendAsync(gzip, Ct);
            response.StatusCode.ShouldBe(HttpStatusCode.UnsupportedMediaType);
        }
        var oversized = Faro(
            ("logs", new JsonArray(new JsonObject { ["message"] = new string('x', 40_000) }))
        );
        using (
            var response = await client.SendAsync(
                Post("/api/telemetry/faro", token, oversized.ToJsonString()),
                Ct
            )
        )
            response.StatusCode.ShouldBe(HttpStatusCode.RequestEntityTooLarge);
        // Chunked, so the size is only known while reading.
        using (var chunked = Authorized(HttpMethod.Post, "/api/telemetry/faro", token))
        {
            chunked.Content = new StreamContent(
                new MemoryStream(Encoding.UTF8.GetBytes(oversized.ToJsonString()))
            );
            chunked.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
            chunked.Headers.TransferEncodingChunked = true;
            using var response = await client.SendAsync(chunked, Ct);
            response.StatusCode.ShouldBe(HttpStatusCode.RequestEntityTooLarge);
        }
        collector.Count.ShouldBe(0);
    }

    [Fact]
    public async Task whenSessionSendsTooMany_FaroReport_ShouldReturnTooManyRequestsWithRetryAfter()
    {
        var collector = new CapturingCollector();
        await using var factory = Host(collector, Settings(permits: 2));
        using var client = CreateClient(factory);
        var token = await RegisterAsync("telemetry-limit@example.test", client);
        for (var attempt = 0; attempt < 2; attempt++)
        {
            using var accepted = await client.SendAsync(
                Post("/api/telemetry/faro", token, Faro().ToJsonString()),
                Ct
            );
            accepted.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        }
        using var limited = await client.SendAsync(
            Post("/api/telemetry/faro", token, Faro().ToJsonString()),
            Ct
        );
        limited.StatusCode.ShouldBe((HttpStatusCode)429);
        limited.Headers.RetryAfter.ShouldNotBeNull();
        (await limited.Content.ReadFromJsonAsync<JsonElement>(Ct))
            .GetProperty("error")
            .GetString()
            .ShouldBe(ClientTelemetryRateLimit.Message);
        // Another person's session has its own allowance.
        var other = await RegisterAsync("telemetry-limit-other@example.test", client);
        using var fresh = await client.SendAsync(
            Post("/api/telemetry/faro", other, Faro().ToJsonString()),
            Ct
        );
        fresh.StatusCode.ShouldBe(HttpStatusCode.Accepted);
    }

    private static JsonObject Logs(string service, string message) =>
        new()
        {
            ["resourceLogs"] = new JsonArray(
                new JsonObject
                {
                    ["resource"] = new JsonObject
                    {
                        ["attributes"] = new JsonArray(
                            new JsonObject
                            {
                                ["key"] = "service.name",
                                ["value"] = new JsonObject { ["stringValue"] = service },
                            }
                        ),
                    },
                    ["scopeLogs"] = new JsonArray(
                        new JsonObject
                        {
                            ["logRecords"] = new JsonArray(
                                new JsonObject
                                {
                                    ["severityNumber"] = 21,
                                    ["body"] = new JsonObject { ["stringValue"] = message },
                                    ["attributes"] = new JsonArray(
                                        new JsonObject
                                        {
                                            ["key"] = "exception.message",
                                            ["value"] = new JsonObject
                                            {
                                                ["stringValue"] = message,
                                            },
                                        },
                                        new JsonObject
                                        {
                                            ["key"] = "url.full",
                                            ["value"] = new JsonObject
                                            {
                                                ["stringValue"] =
                                                    $"https://penny.example.test/api/search?q={Search}",
                                            },
                                        }
                                    ),
                                }
                            ),
                        }
                    ),
                }
            ),
        };

    [Fact]
    public async Task whenNativeAppSendsLogs_OtlpLogs_ShouldForwardScrubbedWithServerHeaders()
    {
        var collector = new CapturingCollector();
        await using var factory = Host(collector, Settings());
        using var client = CreateClient(factory);
        var token = await RegisterAsync("telemetry-ios@example.test", client);

        using (
            var impersonation = await client.SendAsync(
                Post(
                    "/api/telemetry/otlp/v1/logs",
                    token,
                    Logs("penny-backend", "x").ToJsonString()
                ),
                Ct
            )
        )
            impersonation.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        using (
            var wrongSignal = await client.SendAsync(
                Post("/api/telemetry/otlp/v1/traces", token, Logs("penny-ios", "x").ToJsonString()),
                Ct
            )
        )
            wrongSignal.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var crash = $"Crash saving \"{Title}\" {Amount} for {Email}";
        using (
            var accepted = await client.SendAsync(
                Post("/api/telemetry/otlp/v1/logs", token, Logs("penny-ios", crash).ToJsonString()),
                Ct
            )
        )
            accepted.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        var forwarded = await collector.NextAsync(Ct);
        forwarded.Url.ShouldBe(new Uri(OtlpEndpoint + "/v1/logs"));
        forwarded.Headers["Authorization"].ShouldBe("Basic c3ludGhldGlj");
        forwarded.Headers.ShouldNotContainKey(FaroPayload.SessionHeader);
        foreach (var secret in new[] { Email, "Quokkatitle", Amount, Search, token })
            forwarded.Body.ShouldNotContain(secret);
        var record = JsonNode.Parse(forwarded.Body)!["resourceLogs"]![0]!["scopeLogs"]![0]![
            "logRecords"
        ]![0]!;
        record["body"]!["stringValue"]!
            .GetValue<string>()
            .ShouldBe("Crash saving <text> <n> for <email>");
        record["attributes"]![0]!["value"]!["stringValue"]!
            .GetValue<string>()
            .ShouldBe("Crash saving <text> <n> for <email>");
        record["attributes"]![1]!["value"]!["stringValue"]!
            .GetValue<string>()
            .ShouldBe("https://penny.example.test/api/search");
        collector.Count.ShouldBe(0);
    }

    [Fact]
    public async Task whenCollectorRefusesReport_Forwarder_ShouldLogScrubbedReasonWithoutUrlOrKey()
    {
        // A collector URL that carries a key, as Grafana Cloud's does.
        const string key = "f00dfeedcafe4242";
        var settings = Settings();
        settings["ClientTelemetry:FaroUrl"] = $"{FaroUrl}/{key}";
        var collector = new CapturingCollector
        {
            Status = HttpStatusCode.BadRequest,
            ResponseBody =
                $"missing X-Faro-Session-Id header, activate the SessionInstrumentation\n(app {key} at {FaroUrl}/{key} for {Email}) "
                + new string('x', 400),
        };
        var logs = new CapturingLoggerProvider();
        await using var factory = new TestApiFactory(Fixture.Connection, settings, services =>
        {
            services
                .AddHttpClient(ClientTelemetryForwarder.HttpClientName)
                .ConfigurePrimaryHttpMessageHandler(() => collector);
            services.AddSingleton<ILoggerProvider>(logs);
        });
        using var client = CreateClient(factory);
        var token = await RegisterAsync("telemetry-refused@example.test", client);

        using (
            var accepted = await client.SendAsync(
                Post("/api/telemetry/faro", token, Faro().ToJsonString()),
                Ct
            )
        )
            accepted.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        await collector.NextAsync(Ct);

        string? refused = null;
        for (var attempt = 0; attempt < 100 && refused is null; attempt++)
        {
            refused = logs.Messages.FirstOrDefault(message =>
                message.Contains("refused a faro report", StringComparison.Ordinal)
            );
            if (refused is null)
                await Task.Delay(50, Ct);
        }
        refused.ShouldNotBeNull();
        refused.ShouldContain(
            "HTTP 400: missing X-Faro-Session-Id header, activate the SessionInstrumentation"
        );
        refused.ShouldNotContain(key);
        refused.ShouldNotContain("alloy.internal.test");
        refused.ShouldNotContain(Email);
        refused.ShouldNotContain(new string('x', ClientTelemetryForwarder.ReasonLength));
    }

    [Fact]
    public async Task whenCollectorNeverAnswers_FaroReport_ShouldBeAcceptedWithoutWaiting()
    {
        await using var silent = new SilentCollector();
        var settings = Settings();
        settings["ClientTelemetry:FaroUrl"] = silent.Endpoint + "/collect";
        await using var factory = new TestApiFactory(Fixture.Connection, settings);
        using var client = CreateClient(factory);
        var token = await RegisterAsync("telemetry-silent@example.test", client);
        var timer = Stopwatch.StartNew();
        for (var attempt = 0; attempt < 3; attempt++)
        {
            using var response = await client.SendAsync(
                Post("/api/telemetry/faro", token, Faro().ToJsonString()),
                Ct
            );
            response.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        }
        timer.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(5));
        using var ready = await client.GetAsync("/api/ready", Ct);
        ready.StatusCode.ShouldBe(HttpStatusCode.OK);
    }
}
