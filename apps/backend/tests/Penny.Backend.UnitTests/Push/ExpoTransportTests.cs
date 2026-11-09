using System.Net;
using System.Text.Json;
using Penny.Backend.Api.Push;
using Penny.Backend.Application.Push;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Push;

public sealed class ExpoTransportTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static HttpResponseMessage Json(
        string json,
        HttpStatusCode status = HttpStatusCode.OK
    ) =>
        new(status)
        {
            Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json"),
        };

    [Fact]
    public async Task whenMessagesSent_SendAsync_ShouldPostLegacyExpoShapeAndMapTickets()
    {
        var handler = new StubHandler(
            (_, _) =>
                Json(
                    """{"data":[{"status":"ok","id":"ticket-1"},{"status":"error","details":{"error":"DeviceNotRegistered"}},{"status":"error","details":{"error":"MessageRateExceeded"}},{"status":"error","message":"x","details":{"error":"MessageTooBig"}}]}"""
                )
        );
        var transport = new ExpoTransport(new HttpClient(handler));
        var message = PushSamples.Message(PushSamples.ExpoToken, null);

        var outcomes = await transport.SendAsync([message, message, message, message], Ct);

        outcomes.ShouldBe([
            PushOutcome.Accepted("ticket-1"),
            PushOutcome.InvalidToken("expo:DeviceNotRegistered"),
            PushOutcome.Retry("expo:MessageRateExceeded"),
            PushOutcome.Permanent("expo:MessageTooBig"),
        ]);
        var (request, body) = handler.Requests.Single();
        request.RequestUri!.ToString().ShouldBe(ExpoTransport.SendUrl);
        using var json = JsonDocument.Parse(body);
        var first = json.RootElement[0];
        first.GetProperty("to").GetString().ShouldBe(PushSamples.ExpoToken);
        first.GetProperty("sound").GetString().ShouldBe("default");
        first.GetProperty("channelId").GetString().ShouldBe("households");
        first
            .GetProperty("data")
            .GetRawText()
            .ShouldBe(
                """{"householdId":"home","month":"2026-09","expenseId":"expense-1","eventId":"event-1"}"""
            );
    }

    [Theory]
    [InlineData(400, PushOutcomeKind.Permanent)]
    [InlineData(429, PushOutcomeKind.Retry)]
    [InlineData(503, PushOutcomeKind.Retry)]
    public async Task whenExpoRejectsRequest_SendAsync_ShouldBePermanentOnlyForNonRateLimit4xx(
        int status,
        PushOutcomeKind expected
    )
    {
        var transport = new ExpoTransport(
            new HttpClient(
                new StubHandler((_, _) => new HttpResponseMessage((HttpStatusCode)status))
            )
        );

        var outcome = (
            await transport.SendAsync([PushSamples.Message(PushSamples.ExpoToken, null)], Ct)
        )[0];

        outcome.ShouldBe(new PushOutcome(expected, $"expo:http-{status}"));
    }

    [Fact]
    public async Task whenTicketCountMismatches_SendAsync_ShouldRetryEveryMessage()
    {
        var transport = new ExpoTransport(
            new HttpClient(new StubHandler((_, _) => Json("""{"data":[]}""")))
        );

        (
            await transport.SendAsync([PushSamples.Message(PushSamples.ExpoToken, null)], Ct)
        ).ShouldBe([PushOutcome.Retry("expo:invalid-response")]);
    }

    [Fact]
    public async Task whenReceiptsRequested_CheckAsync_ShouldMapStatusesAndOmitPendingTickets()
    {
        var handler = new StubHandler(
            (_, _) =>
                Json(
                    """{"data":{"a":{"status":"ok"},"b":{"status":"error","details":{"error":"DeviceNotRegistered"}},"c":{"status":"error","details":{"error":"MessageRateExceeded"}},"d":{"status":"error"}}}"""
                )
        );
        var transport = new ExpoTransport(new HttpClient(handler));

        var receipts = await transport.CheckAsync(["a", "b", "c", "d", "e"], Ct);

        receipts.ShouldNotBeNull();
        receipts.ShouldBe(
            new Dictionary<string, PushReceiptStatus>
            {
                ["a"] = PushReceiptStatus.Ok,
                ["b"] = PushReceiptStatus.DeviceNotRegistered,
                ["c"] = PushReceiptStatus.RateExceeded,
                ["d"] = PushReceiptStatus.Error,
            },
            ignoreOrder: true
        );
        handler
            .Requests.Single()
            .Request.RequestUri!.ToString()
            .ShouldBe(ExpoTransport.ReceiptsUrl);
        handler.Requests.Single().Body.ShouldBe("""{"ids":["a","b","c","d","e"]}""");
        (
            await new ExpoTransport(
                new HttpClient(
                    new StubHandler((_, _) => new HttpResponseMessage(HttpStatusCode.BadGateway))
                )
            ).CheckAsync(["a"], Ct)
        ).ShouldBeNull();
        (
            await new ExpoTransport(
                new HttpClient(
                    new StubHandler((_, _) => new HttpResponseMessage(HttpStatusCode.BadRequest))
                )
            ).CheckAsync(["a"], Ct)
        )!
            ["a"]
            .ShouldBe(PushReceiptStatus.Error);
    }
}
