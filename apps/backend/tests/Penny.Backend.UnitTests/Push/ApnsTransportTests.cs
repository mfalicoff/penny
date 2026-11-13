using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Penny.Backend.Api.Push;
using Penny.Backend.Application.Push;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Push;

public sealed class ApnsTransportTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static (ApnsTransport Transport, StubHandler Handler, ApnsProviderToken Tokens) Create(
        Func<HttpRequestMessage, string, HttpResponseMessage> respond,
        Penny.Backend.UnitTests.Push.MutableClock? clock = null
    )
    {
        var handler = new StubHandler(respond);
        var credentials = PushSamples.Credentials(out _);
        var tokens = new ApnsProviderToken(credentials, clock ?? new MutableClock(PushSamples.Now));
        return (
            new ApnsTransport(
                new HttpClient(handler),
                credentials,
                tokens,
                NullLogger<ApnsTransport>.Instance
            ),
            handler,
            tokens
        );
    }

    private static HttpResponseMessage Error(HttpStatusCode status, string reason) =>
        new(status) { Content = new StringContent($$"""{"reason":"{{reason}}"}""") };

    [Fact]
    public async Task whenMessageSent_SendAsync_ShouldPostHttp2AlertToEnvironmentGatewayWithDeepLinkKeys()
    {
        var (transport, handler, _) = Create(
            (_, _) =>
            {
                var ok = new HttpResponseMessage(HttpStatusCode.OK);
                ok.Headers.Add("apns-id", "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d");
                return ok;
            }
        );

        var outcomes = await transport.SendAsync(
            [PushSamples.Message(), PushSamples.Message(environment: PushProviders.Sandbox)],
            Ct
        );

        outcomes.ShouldAllBe(outcome => outcome.Kind == PushOutcomeKind.Accepted);
        outcomes[0].TicketId.ShouldBe("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d");
        var hosts = handler
            .Requests.Select(item => item.Request.RequestUri!.GetLeftPart(UriPartial.Authority))
            .ToList();
        hosts.ShouldBe(
            [ApnsTransport.ProductionHost, ApnsTransport.SandboxHost],
            ignoreOrder: true
        );
        var (request, body) = handler.Requests[0];
        request.Method.ShouldBe(HttpMethod.Post);
        request.Version.ShouldBe(HttpVersion.Version20);
        request.VersionPolicy.ShouldBe(HttpVersionPolicy.RequestVersionExact);
        request.RequestUri!.AbsolutePath.ShouldBe($"/3/device/{PushSamples.ApnsToken}");
        request.Headers.Authorization!.Scheme.ShouldBe("bearer");
        request.Headers.GetValues("apns-topic").Single().ShouldBe("org.example.penny");
        request.Headers.GetValues("apns-push-type").Single().ShouldBe("alert");
        request.Headers.GetValues("apns-priority").Single().ShouldBe("10");
        request
            .Headers.GetValues("apns-collapse-id")
            .Single()
            .ShouldBe("0123456789abcdef0123456789abcdef");
        request
            .Headers.GetValues("apns-expiration")
            .Single()
            .ShouldBe(
                PushSamples
                    .Now.AddHours(24)
                    .ToUnixTimeSeconds()
                    .ToString(System.Globalization.CultureInfo.InvariantCulture)
            );
        Guid.TryParse(request.Headers.GetValues("apns-id").Single(), out _).ShouldBeTrue();
        using var json = JsonDocument.Parse(body);
        var root = json.RootElement;
        root.GetProperty("aps")
            .GetProperty("alert")
            .GetProperty("title")
            .GetString()
            .ShouldBe("New household expense");
        root.GetProperty("aps").GetProperty("sound").GetString().ShouldBe("default");
        root.GetProperty("householdId").GetString().ShouldBe("home");
        root.GetProperty("month").GetString().ShouldBe("2026-09");
        root.GetProperty("expenseId").GetString().ShouldBe("expense-1");
        root.GetProperty("eventId").GetString().ShouldBe("event-1");
    }

    [Fact]
    public void whenSameDeliveryRetried_NotificationId_ShouldStayStablePerDevice()
    {
        ApnsTransport
            .NotificationId(PushSamples.Message())
            .ShouldBe(ApnsTransport.NotificationId(PushSamples.Message()));
        ApnsTransport
            .NotificationId(PushSamples.Message())
            .ShouldNotBe(
                ApnsTransport.NotificationId(PushSamples.Message(token: new string('f', 64)))
            );
    }

    [Theory]
    [InlineData(410, "Unregistered", PushOutcomeKind.InvalidToken)]
    [InlineData(410, "ExpiredToken", PushOutcomeKind.InvalidToken)]
    [InlineData(400, "BadDeviceToken", PushOutcomeKind.InvalidToken)]
    [InlineData(400, "BadTopic", PushOutcomeKind.Retry)]
    [InlineData(400, "DeviceTokenNotForTopic", PushOutcomeKind.Retry)]
    [InlineData(403, "InvalidProviderToken", PushOutcomeKind.Retry)]
    [InlineData(403, "ExpiredProviderToken", PushOutcomeKind.Retry)]
    [InlineData(429, "TooManyRequests", PushOutcomeKind.Retry)]
    [InlineData(500, "InternalServerError", PushOutcomeKind.Retry)]
    [InlineData(503, "ServiceUnavailable", PushOutcomeKind.Retry)]
    [InlineData(413, "PayloadTooLarge", PushOutcomeKind.Permanent)]
    [InlineData(400, "BadPayload", PushOutcomeKind.Permanent)]
    [InlineData(405, "MethodNotAllowed", PushOutcomeKind.Permanent)]
    public async Task whenApnsAnswersError_SendAsync_ShouldClassifyByStatusAndReason(
        int status,
        string reason,
        PushOutcomeKind expected
    )
    {
        var (transport, _, _) = Create((_, _) => Error((HttpStatusCode)status, reason));

        var outcome = (await transport.SendAsync([PushSamples.Message()], Ct))[0];

        outcome.Kind.ShouldBe(expected);
        outcome.Reason.ShouldBe($"apns:{status}:{reason}");
        outcome.Reason!.ShouldNotContain(PushSamples.ApnsToken);
    }

    [Fact]
    public async Task whenApnsRateLimitsWithRetryAfter_SendAsync_ShouldCarryRequestedDelay()
    {
        var (transport, _, _) = Create(
            (_, _) =>
            {
                var response = Error(HttpStatusCode.ServiceUnavailable, "ServiceUnavailable");
                response.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(
                    TimeSpan.FromSeconds(120)
                );
                return response;
            }
        );

        var outcome = (await transport.SendAsync([PushSamples.Message()], Ct))[0];

        outcome.RetryAfter.ShouldBe(TimeSpan.FromSeconds(120));
    }

    [Fact]
    public async Task whenNetworkFailsOrReasonIsUnexpected_SendAsync_ShouldRetryWithRedactedCodes()
    {
        var calls = 0;
        var (transport, _, _) = Create(
            (_, _) =>
                ++calls == 1
                    ? throw new HttpRequestException("connection reset")
                    : new HttpResponseMessage(HttpStatusCode.BadGateway)
                    {
                        Content = new StringContent("""{"reason":"<script>token a1b2</script>"}"""),
                    }
        );

        (await transport.SendAsync([PushSamples.Message()], Ct))[0]
            .ShouldBe(PushOutcome.Retry("apns:network"));
        (await transport.SendAsync([PushSamples.Message()], Ct))[0]
            .ShouldBe(PushOutcome.Retry("apns:502:unknown"));
    }

    [Fact]
    public async Task whenProviderTokenExpiredAndOldEnough_SendAsync_ShouldMintNewTokenForNextSend()
    {
        var clock = new MutableClock(PushSamples.Now);
        var (transport, handler, _) = Create(
            (_, _) => Error(HttpStatusCode.Forbidden, "ExpiredProviderToken"),
            clock
        );

        await transport.SendAsync([PushSamples.Message()], Ct);
        await transport.SendAsync([PushSamples.Message()], Ct);
        clock.Advance(ApnsProviderToken.MinimumAge);
        await transport.SendAsync([PushSamples.Message()], Ct);
        await transport.SendAsync([PushSamples.Message()], Ct);

        var jwts = handler
            .Requests.Select(item => item.Request.Headers.Authorization!.Parameter)
            .ToList();
        jwts[1].ShouldBe(jwts[0], "a token younger than 20 minutes is not replaced");
        jwts[2].ShouldBe(jwts[0]);
        jwts[3].ShouldNotBe(jwts[2], "an expired token at least 20 minutes old is replaced");
    }
}
