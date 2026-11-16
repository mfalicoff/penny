using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Penny.Backend.Application.InboundMail;
using Shouldly;

namespace Penny.Backend.IntegrationTests.Infrastructure;

// HTTP helpers for the emailed receipt suites (MAZ-184): receipt addresses and requests
// signed like apps/email-worker signs them. All mail is synthetic.
public abstract class InboundMailTestBase(ApiFixture fixture) : HouseholdTestBase(fixture)
{
    protected const string AddressPath = "/api/receipt-email";
    protected const string IngressPath = "/api/inbound-mail";
    protected const string RecipientsPath = "/api/inbound-mail/recipients";

    protected static byte[] Mail(string subject = "Your receipt", string body = "Thanks!") =>
        Encoding.ASCII.GetBytes(
            $"From: Shop <orders@shop.example.test>\r\nTo: someone@receipts.example.test\r\nSubject: {subject}\r\nDate: Mon, 16 Nov 2026 12:00:00 +0000\r\n\r\n{body}\r\n"
        );

    protected static string LocalPart(JsonElement envelope) =>
        envelope.GetProperty("address").GetProperty("address").GetString()!.Split('@')[0];

    protected async Task<string> CreateAddressAsync(string token) =>
        LocalPart(await ExpectAsync(HttpMethod.Post, AddressPath, token, HttpStatusCode.Created));

    protected string Now() =>
        Fixture
            .Factory.Clock.GetUtcNow()
            .ToUnixTimeSeconds()
            .ToString(CultureInfo.InvariantCulture);

    protected string Sign(string purpose, string timestamp, string subject, byte[] body) =>
        InboundMailSignature.Compute(Fixture.InboundMailSecret, purpose, timestamp, subject, body);

    // A request signed for `recipient` (or with the given parts overridden).
    protected HttpRequestMessage Delivery(
        string recipient,
        byte[] raw,
        string? timestamp = null,
        string? signature = null,
        string? signedRecipient = null
    )
    {
        timestamp ??= Now();
        var request = new HttpRequestMessage(HttpMethod.Post, IngressPath)
        {
            Content = new ByteArrayContent(raw),
        };
        request.Content.Headers.ContentType = new("message/rfc822");
        request.Headers.Add("X-Penny-Recipient", recipient);
        request.Headers.Add("X-Penny-Timestamp", timestamp);
        request.Headers.Add(
            "X-Penny-Signature",
            signature
                ?? Sign(
                    InboundMailSignature.MessagePurpose,
                    timestamp,
                    signedRecipient ?? recipient,
                    raw
                )
        );
        return request;
    }

    protected async Task<HttpStatusCode> DeliverAsync(
        string recipient,
        byte[] raw,
        HttpClient? client = null
    )
    {
        using var request = Delivery(recipient, raw);
        using var response = await (client ?? Client).SendAsync(request, Ct);
        return response.StatusCode;
    }

    protected HttpRequestMessage RecipientsRequest(
        string? timestamp = null,
        string? signature = null
    )
    {
        timestamp ??= Now();
        var request = new HttpRequestMessage(HttpMethod.Get, RecipientsPath);
        request.Headers.Add("X-Penny-Timestamp", timestamp);
        request.Headers.Add(
            "X-Penny-Signature",
            signature
                ?? Sign(
                    InboundMailSignature.RecipientsPurpose,
                    timestamp,
                    InboundMailSignature.RecipientsPath,
                    []
                )
        );
        return request;
    }

    // Sessions last 30 days (SessionTokens.Lifetime); tests that move the clock past an
    // address lifetime sign in again.
    protected async Task<string> SignInAsync(string email)
    {
        using var response = await Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email, password = TestPassword },
            Ct
        );
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonElement>(Ct))
            .GetProperty("token")
            .GetString()!;
    }

    protected Task<long> StoredMessagesAsync() =>
        CountAsync("SELECT count(*) FROM penny.inbound_messages");

    protected List<string> InboundFiles()
    {
        var directory = Path.Combine(Fixture.ReceiptRoot, "inbound");
        return Directory.Exists(directory)
            ?
            [
                .. Directory
                    .EnumerateFiles(directory, "*", SearchOption.AllDirectories)
                    .Select(path =>
                        Path.GetRelativePath(Fixture.ReceiptRoot, path).Replace('\\', '/')
                    ),
            ]
            : [];
    }

    protected static async Task ShouldBeErrorAsync(
        HttpResponseMessage response,
        HttpStatusCode status,
        string message
    )
    {
        var text = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(status, text);
        JsonDocument.Parse(text).RootElement.GetProperty("error").GetString().ShouldBe(message);
    }
}
