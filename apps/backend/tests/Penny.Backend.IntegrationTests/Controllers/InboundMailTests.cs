using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Penny.Backend.Api.Controllers;
using Penny.Backend.Application.InboundMail;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// The signed ingress and the Worker's recipient list (MAZ-184,
// docs/plans/email-receipts.md#signed-endpoint): forged, replayed, oversized,
// unknown-address and over-limit requests store nothing; accepted mail is sealed and
// pending; the list holds only hashes of live addresses.
public sealed class InboundMailTests(ApiFixture fixture) : InboundMailTestBase(fixture)
{
    [Fact]
    public async Task whenSignedMessageForLiveAddress_Receive_ShouldStoreSealedPendingMessage()
    {
        At(Noon);
        var (token, userId) = await AccountAsync("ingress@example.test");
        var local = await CreateAddressAsync(token);
        var raw = Mail("Order 1042 confirmed");
        using var request = Delivery(local, raw);
        using var response = await Client.SendAsync(request, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Accepted);

        await using var reader = await Fixture
            .Admin.CreateCommand(
                $"SELECT id, status, storage_path, size_bytes, key_salt, file_nonce, due_at IS NOT NULL FROM penny.inbound_messages WHERE user_id = '{userId}'"
            )
            .ExecuteReaderAsync(Ct);
        (await reader.ReadAsync(Ct)).ShouldBeTrue();
        var id = reader.GetString(0);
        reader.GetString(1).ShouldBe("pending");
        var path = reader.GetString(2);
        path.ShouldMatch("^inbound/[0-9a-f]{2}/[0-9a-f]{32}$");
        reader.GetInt64(3).ShouldBe(raw.Length);
        var salt = (byte[])reader.GetValue(4);
        var nonce = (byte[])reader.GetValue(5);
        reader.GetBoolean(6).ShouldBeTrue();
        (await reader.ReadAsync(Ct)).ShouldBeFalse();

        InboundFiles().ShouldBe([path]);
        var sealedBytes = await File.ReadAllBytesAsync(Path.Combine(Fixture.ReceiptRoot, path), Ct);
        Encoding.ASCII.GetString(sealedBytes).ShouldNotContain("Order 1042");
        Fixture.InboundMail.Open(1, salt, nonce, sealedBytes, "raw", userId, id).ShouldBe(raw);
        (
            await ScalarAsync(
                $"SELECT last_received_at FROM penny.receipt_mail_addresses WHERE user_id = '{userId}'"
            )
        ).ShouldNotBeNull();
    }

    [Fact]
    public async Task whenSignatureMissingOrWrong_Receive_ShouldReturnUnauthorizedAndStoreNothing()
    {
        var (token, _) = await AccountAsync("forged@example.test");
        var local = await CreateAddressAsync(token);
        var raw = Mail();
        var now = Now();
        var stale = (Fixture.Factory.Clock.GetUtcNow().ToUnixTimeSeconds() - 301).ToString(
            System.Globalization.CultureInfo.InvariantCulture
        );
        var forged = new List<HttpRequestMessage>
        {
            new(HttpMethod.Post, IngressPath) { Content = new ByteArrayContent(raw) },
            Delivery(local, raw, signature: new string('0', 64)),
            Delivery(local, raw, signedRecipient: "r-bbbbbbbbbbbbbbbbbbbb"),
            Delivery(local, raw, timestamp: stale, signature: Sign("message", stale, local, raw)),
            Delivery(local, raw, signature: Sign("recipients", now, local, raw)),
            Delivery(local, raw, signature: Sign("message", now, local, [.. raw, 0x20])),
            Delivery("postmaster", raw),
        };
        foreach (var request in forged)
        {
            using (request)
            using (var response = await Client.SendAsync(request, Ct))
                await ShouldBeErrorAsync(
                    response,
                    HttpStatusCode.Unauthorized,
                    InboundMailController.BadSignature
                );
        }
        (await StoredMessagesAsync()).ShouldBe(0);
        InboundFiles().ShouldBeEmpty();
    }

    [Fact]
    public async Task whenAddressUnknown_Receive_ShouldReturnNotFoundAfterVerifyingSignature()
    {
        using var request = Delivery(ReceiptMailAddresses.NewLocalPart(), Mail());
        using var response = await Client.SendAsync(request, Ct);
        await ShouldBeErrorAsync(
            response,
            HttpStatusCode.NotFound,
            InboundMailController.UnknownAddressMessage
        );
        (await StoredMessagesAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task whenRequestReplayed_Receive_ShouldRefuseTheCopy()
    {
        var (token, _) = await AccountAsync("replay@example.test");
        var local = await CreateAddressAsync(token);
        var raw = Mail();
        var timestamp = Now();
        var signature = Sign("message", timestamp, local, raw);
        using (var first = Delivery(local, raw, timestamp, signature))
        using (var response = await Client.SendAsync(first, Ct))
            response.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        using (var copy = Delivery(local, raw, timestamp, signature))
        using (var response = await Client.SendAsync(copy, Ct))
            response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await StoredMessagesAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task whenSameMessageForwardedTwice_Receive_ShouldStoreItOnce()
    {
        var (token, _) = await AccountAsync("twice@example.test");
        var local = await CreateAddressAsync(token);
        (await DeliverAsync(local, Mail())).ShouldBe(HttpStatusCode.Accepted);
        Fixture.Factory.Clock.Set(Fixture.Factory.Clock.GetUtcNow().AddSeconds(1));
        (await DeliverAsync(local, Mail())).ShouldBe(HttpStatusCode.Accepted);
        (await StoredMessagesAsync()).ShouldBe(1);
        InboundFiles().Count.ShouldBe(1);
    }

    [Fact]
    public async Task whenSameMessageRacing_Receive_ShouldStoreItOnce()
    {
        var (token, _) = await AccountAsync("racing@example.test");
        var local = await CreateAddressAsync(token);
        var raw = Mail();
        var statuses = await Task.WhenAll(
            Enumerable
                .Range(0, 6)
                .Select(async index =>
                {
                    // Distinct timestamps, so the replay cache does not refuse the copies.
                    var timestamp = (
                        Fixture.Factory.Clock.GetUtcNow().ToUnixTimeSeconds() - index
                    ).ToString(System.Globalization.CultureInfo.InvariantCulture);
                    using var request = Delivery(local, raw, timestamp);
                    using var response = await Client.SendAsync(request, Ct);
                    return response.StatusCode;
                })
        );
        statuses.ShouldAllBe(status => status == HttpStatusCode.Accepted);
        (await StoredMessagesAsync()).ShouldBe(1);
        InboundFiles().Count.ShouldBe(1);
    }

    [Fact]
    public async Task whenHourlyLimitReached_Receive_ShouldReturnTooManyRequestsUntilTheHourPasses()
    {
        At(Noon);
        var (token, _) = await AccountAsync("flood@example.test");
        var local = await CreateAddressAsync(token);
        for (var index = 0; index < 20; index++)
        {
            At(Noon.AddSeconds(index));
            (await DeliverAsync(local, Mail(body: $"Receipt {index}"))).ShouldBe(
                HttpStatusCode.Accepted
            );
        }
        At(Noon.AddMinutes(30));
        using (var request = Delivery(local, Mail(body: "One too many")))
        using (var response = await Client.SendAsync(request, Ct))
            await ShouldBeErrorAsync(
                response,
                HttpStatusCode.TooManyRequests,
                InboundMailController.RateLimitedMessage
            );
        (await StoredMessagesAsync()).ShouldBe(20);
        At(Noon.AddHours(1).AddMinutes(1));
        (await DeliverAsync(local, Mail(body: "Next hour"))).ShouldBe(HttpStatusCode.Accepted);
    }

    [Fact]
    public async Task whenUserHasTooManyWaitingMessages_Receive_ShouldReturnTooManyRequests()
    {
        await using var strict = Fixture.Factory.WithWebHostBuilder(builder =>
            builder.UseSetting("InboundMail:MaxPendingPerUser", "2")
        );
        using var client = CreateClient(strict);
        var (token, _) = await AccountAsync("backlog@example.test");
        var local = await CreateAddressAsync(token);
        (await DeliverAsync(local, Mail(body: "1"), client)).ShouldBe(HttpStatusCode.Accepted);
        (await DeliverAsync(local, Mail(body: "2"), client)).ShouldBe(HttpStatusCode.Accepted);
        (await DeliverAsync(local, Mail(body: "3"), client)).ShouldBe(
            HttpStatusCode.TooManyRequests
        );
        (await StoredMessagesAsync()).ShouldBe(2);
    }

    [Fact]
    public async Task whenMessageTooLarge_Receive_ShouldReturnPayloadTooLargeAndStoreNothing()
    {
        var (token, _) = await AccountAsync("large@example.test");
        var local = await CreateAddressAsync(token);
        // Over the JSON body limit but within the message limit: accepted.
        var big = Mail(body: new string('a', 200 * 1024));
        (await DeliverAsync(local, big)).ShouldBe(HttpStatusCode.Accepted);
        var tooBig = Mail(body: new string('b', ApiFixture.InboundMailMaxBytes));
        using var request = Delivery(local, tooBig);
        using var response = await Client.SendAsync(request, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.RequestEntityTooLarge);
        (await StoredMessagesAsync()).ShouldBe(1);
    }

    [Fact]
    public async Task whenBrowserOriginPresent_Receive_ShouldNotBeRefusedByTheOriginCheck()
    {
        var (token, _) = await AccountAsync("origin@example.test");
        var local = await CreateAddressAsync(token);
        using var request = Delivery(local, Mail());
        request.Headers.Add("Origin", "https://evil.example.test");
        using var response = await Client.SendAsync(request, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Accepted);
    }

    [Fact]
    public async Task whenFeatureDisabled_InboundMail_ShouldReturnNotFound()
    {
        await using var disabled = Fixture.Factory.WithWebHostBuilder(builder =>
            builder.UseSetting("InboundMail:Enabled", "false")
        );
        using var client = CreateClient(disabled);
        using (var request = Delivery(ReceiptMailAddresses.NewLocalPart(), Mail()))
        using (var response = await client.SendAsync(request, Ct))
            response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        using (var request = RecipientsRequest())
        using (var response = await client.SendAsync(request, Ct))
            response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task whenSigned_Recipients_ShouldListOnlyLiveHashesWithVersion()
    {
        At(Noon);
        var (alice, _) = await AccountAsync("list-alice@example.test");
        var (bob, _) = await AccountAsync("list-bob@example.test");
        var (carol, _) = await AccountAsync("list-carol@example.test");
        var live = await CreateAddressAsync(alice);
        var revoked = await CreateAddressAsync(bob);
        await ExpectAsync(HttpMethod.Delete, AddressPath, bob, HttpStatusCode.OK);
        At(Noon.AddDays(-89));
        var expired = await CreateAddressAsync(carol);
        At(Noon.AddDays(2));

        using var request = RecipientsRequest();
        using var response = await Client.SendAsync(request, Ct);
        var text = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, text);
        var list = JsonDocument.Parse(text).RootElement;
        list.GetProperty("hashes")
            .EnumerateArray()
            .Select(value => value.GetString())
            .ShouldBe([ReceiptMailAddresses.Hash(live)]);
        text.ShouldNotContain(live);
        text.ShouldNotContain(ReceiptMailAddresses.Hash(revoked));
        text.ShouldNotContain(ReceiptMailAddresses.Hash(expired));
        var version = list.GetProperty("version").GetString()!;
        version.ShouldMatch("^[0-9a-f]{32}$");
        response.Headers.ETag!.Tag.ShouldBe($"\"{version}\"");

        using var unchanged = RecipientsRequest();
        unchanged.Headers.TryAddWithoutValidation("If-None-Match", $"\"{version}\"");
        using (var cached = await Client.SendAsync(unchanged, Ct))
            cached.StatusCode.ShouldBe(HttpStatusCode.NotModified);

        await CreateAddressAsync(bob);
        using var changed = RecipientsRequest();
        changed.Headers.TryAddWithoutValidation("If-None-Match", $"\"{version}\"");
        using var refreshed = await Client.SendAsync(changed, Ct);
        refreshed.StatusCode.ShouldBe(HttpStatusCode.OK);
        JsonDocument
            .Parse(await refreshed.Content.ReadAsStringAsync(Ct))
            .RootElement.GetProperty("hashes")
            .GetArrayLength()
            .ShouldBe(2);
    }

    [Fact]
    public async Task whenNotSignedForRecipients_Recipients_ShouldReturnUnauthorized()
    {
        var now = Now();
        foreach (
            var request in new[]
            {
                new HttpRequestMessage(HttpMethod.Get, RecipientsPath),
                RecipientsRequest(signature: new string('0', 64)),
                RecipientsRequest(
                    now,
                    Sign("message", now, InboundMailSignature.RecipientsPath, [])
                ),
                RecipientsRequest(now, Sign("recipients", now, "/api/inbound-mail", [])),
            }
        )
        {
            using (request)
            using (var response = await Client.SendAsync(request, Ct))
                await ShouldBeErrorAsync(
                    response,
                    HttpStatusCode.Unauthorized,
                    InboundMailController.BadSignature
                );
        }
    }
}
