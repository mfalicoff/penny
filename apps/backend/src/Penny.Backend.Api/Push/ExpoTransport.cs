using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Penny.Backend.Application.Push;

namespace Penny.Backend.Api.Push;

// The legacy Expo Push Service transport and its receipts (legacy
// server/application/push.ts), kept while legacy Expo tokens coexist with APNs
// (MAZ-61). Messages keep the legacy shape: title/body, `sound: default`,
// `channelId: households` and the household payload as `data`. Whole-request
// failures are permanent for 4xx other than 429 and retried otherwise.
public sealed partial class ExpoTransport(HttpClient http) : IPushTransport, IPushReceiptChecker
{
    public const string HttpClientName = "expo-push";
    public const string SendUrl = "https://exp.host/--/api/v2/push/send";
    public const string ReceiptsUrl = "https://exp.host/--/api/v2/push/getReceipts";
    public const int MaxBatch = 100;

    public string Provider => PushProviders.Expo;

    public async Task<IReadOnlyList<PushOutcome>> SendAsync(
        IReadOnlyList<PushMessage> messages,
        CancellationToken cancellationToken
    )
    {
        var outcomes = new List<PushOutcome>(messages.Count);
        foreach (var batch in messages.Chunk(MaxBatch))
            outcomes.AddRange(await SendBatchAsync(batch, cancellationToken));
        return outcomes;
    }

    public async Task<IReadOnlyDictionary<string, PushReceiptStatus>?> CheckAsync(
        IReadOnlyList<string> ticketIds,
        CancellationToken cancellationToken
    )
    {
        var (status, document) = await PostAsync(
            ReceiptsUrl,
            new JsonObject { ["ids"] = new JsonArray([.. ticketIds.Select(id => (JsonNode?)id)]) },
            cancellationToken
        );
        using (document)
        {
            if (document is null)
                return IsPermanent(status)
                    ? ticketIds
                        .Distinct(StringComparer.Ordinal)
                        .ToDictionary(
                            id => id,
                            _ => PushReceiptStatus.Error,
                            StringComparer.Ordinal
                        )
                    : null;
            if (
                document.RootElement.ValueKind != JsonValueKind.Object
                || !document.RootElement.TryGetProperty("data", out var data)
                || data.ValueKind != JsonValueKind.Object
            )
                return null;
            var receipts = new Dictionary<string, PushReceiptStatus>(StringComparer.Ordinal);
            foreach (var id in ticketIds)
            {
                if (
                    !data.TryGetProperty(id, out var receipt)
                    || receipt.ValueKind != JsonValueKind.Object
                )
                    continue;
                var state = Text(receipt, "status");
                if (state == "ok")
                    receipts[id] = PushReceiptStatus.Ok;
                else if (state == "error")
                    receipts[id] = ErrorCode(receipt) switch
                    {
                        "DeviceNotRegistered" => PushReceiptStatus.DeviceNotRegistered,
                        "MessageRateExceeded" => PushReceiptStatus.RateExceeded,
                        _ => PushReceiptStatus.Error,
                    };
            }
            return receipts;
        }
    }

    private async Task<IReadOnlyList<PushOutcome>> SendBatchAsync(
        PushMessage[] batch,
        CancellationToken cancellationToken
    )
    {
        var body = new JsonArray([
            .. batch.Select(message =>
                (JsonNode?)
                    new JsonObject
                    {
                        ["to"] = message.Token,
                        ["title"] = message.Title,
                        ["body"] = message.Body,
                        ["sound"] = "default",
                        ["channelId"] = "households",
                        ["data"] = new JsonObject(
                            message
                                .Payload.ToDictionary()
                                .Select(pair =>
                                    KeyValuePair.Create(pair.Key, (JsonNode?)pair.Value)
                                )
                        ),
                    }
            ),
        ]);
        var (status, document) = await PostAsync(SendUrl, body, cancellationToken);
        using (document)
        {
            if (document is null)
            {
                var reason = status is null ? "expo:network" : $"expo:http-{(int)status}";
                return
                [
                    .. batch.Select(_ =>
                        IsPermanent(status)
                            ? PushOutcome.Permanent(reason)
                            : PushOutcome.Retry(reason)
                    ),
                ];
            }
            if (
                document.RootElement.ValueKind != JsonValueKind.Object
                || !document.RootElement.TryGetProperty("data", out var tickets)
                || tickets.ValueKind != JsonValueKind.Array
                || tickets.GetArrayLength() != batch.Length
            )
                return [.. batch.Select(_ => PushOutcome.Retry("expo:invalid-response"))];
            return [.. tickets.EnumerateArray().Select(Ticket)];
        }
    }

    private static PushOutcome Ticket(JsonElement ticket)
    {
        if (ticket.ValueKind != JsonValueKind.Object)
            return PushOutcome.Permanent("expo:invalid-ticket");
        var status = Text(ticket, "status");
        if (status == "ok" && Text(ticket, "id") is { Length: > 0 } id)
            return PushOutcome.Accepted(id);
        if (status != "error")
            return PushOutcome.Permanent("expo:invalid-ticket");
        return ErrorCode(ticket) switch
        {
            "DeviceNotRegistered" => PushOutcome.InvalidToken("expo:DeviceNotRegistered"),
            "MessageRateExceeded" => PushOutcome.Retry("expo:MessageRateExceeded"),
            { } code => PushOutcome.Permanent($"expo:{code}"),
            null => PushOutcome.Permanent("expo:rejected"),
        };
    }

    // The response document on 2xx; otherwise the status (null: network or timeout).
    private async Task<(HttpStatusCode? Status, JsonDocument? Document)> PostAsync(
        string url,
        JsonNode body,
        CancellationToken cancellationToken
    )
    {
        try
        {
            using var response = await http.PostAsJsonAsync(url, body, cancellationToken);
            if (!response.IsSuccessStatusCode)
                return (response.StatusCode, null);
            try
            {
                return (
                    response.StatusCode,
                    await JsonDocument.ParseAsync(
                        await response.Content.ReadAsStreamAsync(cancellationToken),
                        cancellationToken: cancellationToken
                    )
                );
            }
            catch (JsonException)
            {
                return (HttpStatusCode.BadGateway, null);
            }
        }
        catch (HttpRequestException)
        {
            return (null, null);
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return (null, null);
        }
    }

    private static bool IsPermanent(HttpStatusCode? status) =>
        status is { } code
        && (int)code is >= 400 and < 500
        && code != HttpStatusCode.TooManyRequests;

    private static string? Text(JsonElement value, string name) =>
        value.TryGetProperty(name, out var field) && field.ValueKind == JsonValueKind.String
            ? field.GetString()
            : null;

    // `details.error`, kept only when it looks like an Expo error code.
    private static string? ErrorCode(JsonElement value) =>
        value.TryGetProperty("details", out var details)
        && details.ValueKind == JsonValueKind.Object
        && Text(details, "error") is { } code
        && Code().IsMatch(code)
            ? code
            : null;

    [GeneratedRegex("^[A-Za-z]{1,64}$")]
    private static partial Regex Code();
}
