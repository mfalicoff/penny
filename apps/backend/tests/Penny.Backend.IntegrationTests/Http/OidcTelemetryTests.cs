using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Penny.Backend.Application.Diagnostics;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Http;

// MAZ-127: outgoing provider calls (discovery, keys, token, user info) are client
// spans inside the sign-in request's trace, reduced to the provider's origin, and no
// code, secret, token or email reaches any signal.
public sealed class OidcTelemetryTests(ApiFixture fixture, FakeOidcProvider provider)
    : OidcTestBase(fixture, provider)
{
    private const string Email = "telemetry-sso@example.test";

    [Fact]
    public async Task whenOidcSignInRuns_Telemetry_ShouldTraceProviderCallsWithoutSecrets()
    {
        await using var collector = new SilentCollector();
        var capture = new TelemetryCapture();
        var settings = FakeOidcProvider.Settings();
        foreach (var (key, value) in TelemetryCapture.Settings(collector.Endpoint))
            settings[key] = value;
        await using var api = Provider.CreateApi(
            Fixture.RuntimeConnection,
            settings,
            capture.Configure
        );
        using var client = CreateClient(api);

        var (transaction, callbackUrl) = await BeginAsync(
            client,
            new FakeOidcGrant { Subject = "subject-telemetry", Email = Email }
        );
        using var response = await CompleteAsync(client, transaction, callbackUrl);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var token = (await response.Content.ReadFromJsonAsync<JsonElement>(Ct))
            .GetProperty("token")
            .GetString()!;
        TelemetryCapture.Flush(api.Services);

        var complete = capture.Spans.Single(span =>
            span.Kind == ActivityKind.Server
            && Equals(span.GetTagItem("http.route"), "api/auth/oidc/complete")
        );
        var calls = capture
            .Spans.Where(span =>
                span.Kind == ActivityKind.Client
                && span.Source.Name == "System.Net.Http"
                && span.TraceId == complete.TraceId
            )
            .ToList();
        calls.ShouldNotBeEmpty();
        calls.ShouldAllBe(span => Equals(span.GetTagItem("url.full"), FakeOidcProvider.Issuer));
        capture
            .Points("penny.auth.sign_ins")
            .ShouldContain(tags =>
                Equals(tags[BackendTelemetry.MethodAttribute], "oidc")
                && Equals(tags[BackendTelemetry.OutcomeAttribute], "success")
            );

        var code = Microsoft
            .AspNetCore.WebUtilities.QueryHelpers.ParseQuery(new Uri(callbackUrl).Query)["code"]
            .ToString();
        code.ShouldNotBeEmpty();
        var exported = capture.Text().ToList();
        foreach (
            var secret in new[]
            {
                Email,
                token,
                transaction,
                code,
                FakeOidcProvider.ClientSecret,
                "subject-telemetry",
            }
        )
            exported.ShouldAllBe(
                text => !text.Contains(secret, StringComparison.OrdinalIgnoreCase),
                $"an exported signal contains a sensitive value ({secret.Length} characters)"
            );
    }
}
