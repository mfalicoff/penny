using System.Net;
using System.Text;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using MimeKit;
using Npgsql;
using Penny.Backend.Application.Abstractions.InboundMail;
using Penny.Backend.Application.InboundMail;
using Penny.Backend.Application.Push;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Repositories;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// The inbound mail worker on real PostgreSQL (MAZ-184, doc task 7): accepted mail
// becomes owner-only receipts in an inbox item, atomically; a crash mid-message is
// retried after the lease with no duplicates; renderer outages back off; rejections
// store nothing; raw MIME is deleted after success and swept after 7 days otherwise.
// The renderer is a fake that returns a fixed PDF (penny-render has its own test).
public sealed class InboundMailProcessingTests(ApiFixture fixture) : InboundMailTestBase(fixture)
{
    private readonly FakeRenderer renderer = new();

    private WebApplicationFactory<Program> Host() => InboundMailHost.With(Fixture, renderer);

    private static byte[] MailWithInvoice(byte[] invoice) =>
        InboundMailHost.MailWithInvoice(invoice);

    private static Task<long> RunAsync(WebApplicationFactory<Program> host) =>
        InboundMailHost.ProcessAsync(host, Ct);

    private async Task<string> StatusAsync() =>
        (string)
            (
                await ScalarAsync(
                    "SELECT status || ':' || coalesce(reason_code, '') FROM penny.inbound_messages"
                )
            )!;

    [Fact]
    public async Task whenMessageDelivered_Process_ShouldStoreOwnerOnlyReceiptsInTheInbox()
    {
        At(Noon);
        await using var host = Host();
        using var client = CreateClient(host);
        var (token, userId) = await AccountAsync("process@example.test");
        var (other, _) = await AccountAsync("other@example.test");
        var local = await CreateAddressAsync(token);
        var invoice = TestPdf.Create(2);
        (await DeliverAsync(local, MailWithInvoice(invoice), client)).ShouldBe(
            HttpStatusCode.Accepted
        );

        (await RunAsync(host)).ShouldBe(1);

        (await StatusAsync()).ShouldBe("done:");
        (await ScalarAsync("SELECT storage_path FROM penny.inbound_messages")).ShouldBe(
            DBNull.Value
        );
        InboundFiles().ShouldBeEmpty();
        (
            await ScalarAsync(
                $"SELECT status FROM penny.receipt_inbox_items WHERE user_id = '{userId}'"
            )
        ).ShouldBe("to_attach");
        (await ScalarAsync("SELECT sender_verified FROM penny.receipt_inbox_items")).ShouldBe(
            false
        );
        (
            (DateTime)(await ScalarAsync("SELECT expires_at FROM penny.receipt_inbox_items"))!
        ).ShouldBe(Noon.AddDays(30).UtcDateTime);
        var subject = (byte[])
            (await ScalarAsync("SELECT subject_encrypted FROM penny.receipt_inbox_items"))!;
        Encoding.UTF8.GetString(subject).ShouldNotContain("Order 1042");

        var links = new List<(string Kind, string ReceiptId)>();
        await using (
            var reader = await Fixture
                .Admin.CreateCommand(
                    "SELECT kind, receipt_id FROM penny.receipt_inbox_receipts ORDER BY position"
                )
                .ExecuteReaderAsync(Ct)
        )
            while (await reader.ReadAsync(Ct))
                links.Add((reader.GetString(0), reader.GetString(1)));
        links.Select(link => link.Kind).ShouldBe(["email", "attachment"]);
        (
            await CountAsync("SELECT count(*) FROM penny.receipt_texts WHERE status = 'pending'")
        ).ShouldBe(2);
        (
            await CountAsync($"SELECT count(*) FROM penny.receipts WHERE user_id = '{userId}'")
        ).ShouldBe(2);

        using (
            var download = Authorized(
                HttpMethod.Get,
                "/api/receipts/" + links[1].ReceiptId,
                bearer: token
            )
        )
        using (var response = await client.SendAsync(download, Ct))
        {
            response.StatusCode.ShouldBe(HttpStatusCode.OK);
            (await response.Content.ReadAsByteArrayAsync(Ct)).ShouldBe(invoice);
        }
        using (
            var download = Authorized(
                HttpMethod.Get,
                "/api/receipts/" + links[0].ReceiptId,
                bearer: token
            )
        )
        using (var response = await client.SendAsync(download, Ct))
            (await response.Content.ReadAsByteArrayAsync(Ct))
                .AsSpan()
                .StartsWith("%PDF-"u8)
                .ShouldBeTrue();
        using (
            var download = Authorized(
                HttpMethod.Get,
                "/api/receipts/" + links[1].ReceiptId,
                bearer: other
            )
        )
        using (var response = await client.SendAsync(download, Ct))
            response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task whenWorkerDiesMidMessage_Process_ShouldFinishOnceAfterTheLeaseWithoutDuplicates()
    {
        At(Noon);
        await using var host = Host();
        using var client = CreateClient(host);
        var (token, _) = await AccountAsync("crash@example.test");
        var local = await CreateAddressAsync(token);
        (await DeliverAsync(local, MailWithInvoice(TestPdf.Create()), client)).ShouldBe(
            HttpStatusCode.Accepted
        );
        var queue = host.Services.GetRequiredService<IInboundMailQueue>();
        var stale = (
            await queue.ClaimAsync("stale-worker", Noon, Noon.AddMinutes(3), 1, 4, Ct)
        ).Single();

        (await RunAsync(host)).ShouldBe(0); // Still leased by the dead worker.
        At(Noon.AddMinutes(3));
        (await RunAsync(host)).ShouldBe(1);

        var lateConversion = new MailConversion(
            null,
            MailAuthentication.Missing,
            "late",
            "late",
            [new ConvertedReceipt("email", "late.pdf", "application/pdf", TestPdf.Create())]
        );
        (
            await queue.CompleteAsync(
                stale,
                "stale-worker",
                lateConversion,
                Noon,
                Noon.AddDays(30),
                Ct
            )
        ).ShouldBeFalse();
        (await CountAsync("SELECT count(*) FROM penny.receipt_inbox_items")).ShouldBe(1);
        (await CountAsync("SELECT count(*) FROM penny.receipts")).ShouldBe(2);
        Directory
            .EnumerateFiles(Fixture.ReceiptRoot, "*", SearchOption.AllDirectories)
            .Select(path => Path.GetRelativePath(Fixture.ReceiptRoot, path))
            .Count(path => !path.StartsWith("inbound", StringComparison.Ordinal))
            .ShouldBe(2);
        (await ScalarAsync("SELECT attempts FROM penny.inbound_messages")).ShouldBe(2);
    }

    [Fact]
    public async Task whenRendererUnavailable_Process_ShouldBackOffThenFailAndSweepTheRawFile()
    {
        At(Noon);
        renderer.Down = true;
        await using var host = Host();
        using var client = CreateClient(host);
        var (token, _) = await AccountAsync("down@example.test");
        var local = await CreateAddressAsync(token);
        (await DeliverAsync(local, MailWithInvoice(TestPdf.Create()), client)).ShouldBe(
            HttpStatusCode.Accepted
        );

        var now = Noon;
        var waits = new List<TimeSpan>();
        for (var attempt = 1; attempt <= 4; attempt++)
        {
            (await RunAsync(host)).ShouldBe(1);
            if (attempt < 4)
            {
                (await StatusAsync()).ShouldBe("pending:");
                var due = new DateTimeOffset(
                    (DateTime)(await ScalarAsync("SELECT due_at FROM penny.inbound_messages"))!,
                    TimeSpan.Zero
                );
                waits.Add(due - now);
                now = due;
                At(now);
            }
        }
        waits.ShouldBe([
            TimeSpan.FromSeconds(30),
            TimeSpan.FromMinutes(2),
            TimeSpan.FromMinutes(8),
        ]);
        (await StatusAsync()).ShouldBe("failed:render_unavailable");
        renderer.Calls.ShouldBe(4);
        (await CountAsync("SELECT count(*) FROM penny.receipt_inbox_items")).ShouldBe(0);
        InboundFiles().Count.ShouldBe(1); // Kept for diagnosis.

        At(now.AddDays(7).AddMinutes(1));
        await RunAsync(host);
        InboundFiles().ShouldBeEmpty();
        (await ScalarAsync("SELECT storage_path FROM penny.inbound_messages")).ShouldBe(
            DBNull.Value
        );
    }

    [Fact]
    public async Task whenSenderNotOnTheAllowlist_Process_ShouldRejectWithoutStoringReceipts()
    {
        await using var host = Host();
        using var client = CreateClient(host);
        var (token, _) = await AccountAsync("allow@example.test");
        var local = await CreateAddressAsync(token);
        await ExpectAsync(
            HttpMethod.Patch,
            AddressPath,
            token,
            HttpStatusCode.OK,
            new { allowedSenders = new[] { "shop.example.test" } }
        );
        // Listed domain, but no verified DMARC result from the ingress.
        (await DeliverAsync(local, MailWithInvoice(TestPdf.Create()), client)).ShouldBe(
            HttpStatusCode.Accepted
        );

        await RunAsync(host);

        (await StatusAsync()).ShouldBe("rejected:sender_not_allowed");
        (await ScalarAsync("SELECT auth_dmarc FROM penny.inbound_messages")).ShouldBe("unknown");
        (await CountAsync("SELECT count(*) FROM penny.receipts")).ShouldBe(0);
        (await CountAsync("SELECT count(*) FROM penny.receipt_inbox_items")).ShouldBe(0);
        renderer.Calls.ShouldBe(0);
    }

    [Fact]
    public async Task whenRawFileMissing_Process_ShouldFailAsUnreadable()
    {
        await using var host = Host();
        using var client = CreateClient(host);
        var (token, _) = await AccountAsync("missing@example.test");
        var local = await CreateAddressAsync(token);
        (await DeliverAsync(local, MailWithInvoice(TestPdf.Create()), client)).ShouldBe(
            HttpStatusCode.Accepted
        );
        foreach (var path in InboundFiles())
            File.Delete(Path.Combine(Fixture.ReceiptRoot, path));

        await RunAsync(host);

        (await StatusAsync()).ShouldBe("failed:unreadable");
    }

    [Fact]
    public async Task whenOwnerHasDevice_Process_ShouldEnqueueOneReceiptPushDeliveredWithTheInboxLink()
    {
        At(Noon);
        await using var host = Host();
        using var client = CreateClient(host);
        var (token, userId) = await AccountAsync("push@example.test");
        var (other, _) = await AccountAsync("bystander@example.test");
        await RegisterApnsAsync(token, ApnsToken(1));
        await RegisterApnsAsync(other, ApnsToken(2));
        var local = await CreateAddressAsync(token);
        (await DeliverAsync(local, MailWithInvoice(TestPdf.Create()), client)).ShouldBe(
            HttpStatusCode.Accepted
        );

        await RunAsync(host);

        var itemId = (string)(await ScalarAsync("SELECT id FROM penny.receipt_inbox_items"))!;
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.push_outbox WHERE user_id = '{userId}' AND household_id IS NULL AND event_type = 'receipt.received' AND entity_id = '{itemId}' AND payload->>'inboxItemId' = '{itemId}' AND payload->>'eventId' = id AND (SELECT count(*) FROM jsonb_object_keys(payload)) = 2"
            )
        ).ShouldBe(1);
        (await CountAsync("SELECT count(*) FROM penny.push_outbox")).ShouldBe(1);

        var apns = new FakePushTransport(PushProviders.Apns);
        (await PushRunner(apns).RunOnceAsync(Ct)).Accepted.ShouldBe(1);
        (await apns.SentToAsync(ApnsToken(2))).ShouldBeEmpty("only the owner is notified");
        var sent = (await apns.SentToAsync(ApnsToken(1))).Single();
        sent.Title.ShouldBe("New receipt");
        sent.Body.ShouldBe("An emailed receipt is ready to attach.");
        var payload = sent.Payload.ShouldBeOfType<ReceiptInboxPushPayload>();
        payload.InboxItemId.ShouldBe(itemId);
        payload.ThreadId.ShouldBe("receipt-inbox");
        payload.ToDictionary().Keys.ShouldBe(["inboxItemId", "eventId"]);
        (await CountAsync("SELECT count(*) FROM penny.push_outbox WHERE sent_at IS NULL")).ShouldBe(
            0
        );
    }

    [Fact]
    public async Task whenOwnerHasNoDevice_Process_ShouldEnqueueNoPush()
    {
        await using var host = Host();
        using var client = CreateClient(host);
        var (token, _) = await AccountAsync("quiet@example.test");
        var (other, _) = await AccountAsync("elsewhere@example.test");
        await RegisterApnsAsync(other, ApnsToken(3));
        var local = await CreateAddressAsync(token);
        (await DeliverAsync(local, MailWithInvoice(TestPdf.Create()), client)).ShouldBe(
            HttpStatusCode.Accepted
        );

        await RunAsync(host);

        (await CountAsync("SELECT count(*) FROM penny.receipt_inbox_items")).ShouldBe(1);
        (await CountAsync("SELECT count(*) FROM penny.push_outbox")).ShouldBe(0);
    }

    [Fact]
    public async Task whenSameMessageResent_Process_ShouldNotEnqueueASecondPush()
    {
        await using var host = Host();
        using var client = CreateClient(host);
        var (token, _) = await AccountAsync("resend@example.test");
        await RegisterApnsAsync(token, ApnsToken(4));
        var local = await CreateAddressAsync(token);
        var mail = MailWithInvoice(TestPdf.Create());
        (await DeliverAsync(local, mail, client)).ShouldBe(HttpStatusCode.Accepted);
        await RunAsync(host);

        // A later timestamp, so the replay cache does not refuse the copy.
        Fixture.Factory.Clock.Set(Fixture.Factory.Clock.GetUtcNow().AddSeconds(1));
        (await DeliverAsync(local, mail, client)).ShouldBe(HttpStatusCode.Accepted);
        await RunAsync(host);

        (await StoredMessagesAsync()).ShouldBe(1);
        (await CountAsync("SELECT count(*) FROM penny.receipt_inbox_items")).ShouldBe(1);
        (
            await CountAsync(
                "SELECT count(*) FROM penny.push_outbox WHERE event_type = 'receipt.received'"
            )
        ).ShouldBe(1);
    }

    private static string ApnsToken(int seed) =>
        Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData([(byte)seed]));

    private Task RegisterApnsAsync(string bearer, string token) =>
        ExpectAsync(
            HttpMethod.Post,
            "/api/push/devices",
            bearer,
            HttpStatusCode.Created,
            new
            {
                token,
                platform = "ios",
                provider = "apns",
                environment = "production",
            }
        );

    private PushDeliveryRunner PushRunner(FakePushTransport apns) =>
        new(
            new PostgresPushRepository(
                Fixture.Factory.Services.GetRequiredService<NpgsqlDataSource>()
            ),
            [apns],
            Fixture.Factory.Clock
        );
}
