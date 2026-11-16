using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Penny.Backend.Application.InboundMail;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Receipt addresses (MAZ-184, docs/plans/email-receipts.md#5-addresses): one live
// address per user, rotation revokes at once, expiry, extension, allowed senders and
// revocation, against real PostgreSQL. Only the local part hash is searchable.
public sealed class ReceiptEmailTests(ApiFixture fixture) : InboundMailTestBase(fixture)
{
    [Fact]
    public async Task whenNoAddressYet_Read_ShouldReportEnabledDomainAndNoAddress()
    {
        var (token, _) = await AccountAsync("reader@example.test");
        var envelope = await ExpectAsync(HttpMethod.Get, AddressPath, token, HttpStatusCode.OK);
        envelope.GetProperty("enabled").GetBoolean().ShouldBeTrue();
        envelope.GetProperty("domain").GetString().ShouldBe(ApiFixture.InboundMailDomain);
        envelope.GetProperty("address").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    [Fact]
    public async Task whenAddressCreated_Create_ShouldStoreOnlyHashAndSealedAddress()
    {
        At(Noon);
        var (token, userId) = await AccountAsync("create@example.test");
        var envelope = await ExpectAsync(
            HttpMethod.Post,
            AddressPath,
            token,
            HttpStatusCode.Created
        );
        var address = envelope.GetProperty("address");
        var text = address.GetProperty("address").GetString()!;
        text.ShouldMatch("^r-[a-z2-7]{20}@receipts\\.example\\.test$");
        address.GetProperty("createdAt").GetInt64().ShouldBe(Millis(Noon));
        address.GetProperty("expiresAt").GetInt64().ShouldBe(Millis(Noon.AddDays(90)));
        address.GetProperty("lastReceivedAt").ValueKind.ShouldBe(JsonValueKind.Null);
        address.GetProperty("allowedSenders").GetArrayLength().ShouldBe(0);

        var local = text.Split('@')[0];
        (
            await ScalarAsync(
                $"SELECT local_part_hash FROM penny.receipt_mail_addresses WHERE user_id = '{userId}'"
            )
        ).ShouldBe(ReceiptMailAddresses.Hash(local));
        var sealedAddress = (byte[])
            (
                await ScalarAsync(
                    $"SELECT address_encrypted FROM penny.receipt_mail_addresses WHERE user_id = '{userId}'"
                )
            )!;
        System.Text.Encoding.ASCII.GetString(sealedAddress).ShouldNotContain(local);

        var read = await ExpectAsync(HttpMethod.Get, AddressPath, token, HttpStatusCode.OK);
        read.GetProperty("address").GetProperty("address").GetString().ShouldBe(text);
    }

    [Fact]
    public async Task whenAddressRotated_Create_ShouldRevokeOldAndKeepAllowedSenders()
    {
        var (token, userId) = await AccountAsync("rotate@example.test");
        var old = await CreateAddressAsync(token);
        await ExpectAsync(
            HttpMethod.Patch,
            AddressPath,
            token,
            HttpStatusCode.OK,
            new { allowedSenders = new[] { "me@mail.example.test" } }
        );
        var rotated = await ExpectAsync(
            HttpMethod.Post,
            AddressPath,
            token,
            HttpStatusCode.Created
        );
        var fresh = LocalPart(rotated);
        fresh.ShouldNotBe(old);
        rotated
            .GetProperty("address")
            .GetProperty("allowedSenders")
            .EnumerateArray()
            .Select(value => value.GetString())
            .ShouldBe(["me@mail.example.test"]);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.receipt_mail_addresses WHERE user_id = '{userId}' AND revoked_at IS NULL"
            )
        ).ShouldBe(1);
        (await DeliverAsync(old, Mail())).ShouldBe(HttpStatusCode.NotFound);
        (await DeliverAsync(fresh, Mail())).ShouldBe(HttpStatusCode.Accepted);
    }

    [Fact]
    public async Task whenRotatedConcurrently_Create_ShouldLeaveExactlyOneLiveAddress()
    {
        var (token, userId) = await AccountAsync("race@example.test");
        var responses = await Task.WhenAll(
            Enumerable.Range(0, 4).Select(_ => SendAsync(HttpMethod.Post, AddressPath, token))
        );
        foreach (var response in responses)
        {
            response.StatusCode.ShouldBe(HttpStatusCode.Created);
            response.Dispose();
        }
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.receipt_mail_addresses WHERE user_id = '{userId}' AND revoked_at IS NULL"
            )
        ).ShouldBe(1);
    }

    [Fact]
    public async Task whenAddressExpires_Read_ShouldReturnNoAddressAndRefuseExtendAndMail()
    {
        At(Noon);
        var (token, _) = await AccountAsync("expire@example.test");
        var local = await CreateAddressAsync(token);
        At(Noon.AddDays(90));
        token = await SignInAsync("expire@example.test");
        var read = await ExpectAsync(HttpMethod.Get, AddressPath, token, HttpStatusCode.OK);
        read.GetProperty("address").ValueKind.ShouldBe(JsonValueKind.Null);
        await ExpectErrorAsync(
            HttpMethod.Patch,
            AddressPath,
            token,
            HttpStatusCode.NotFound,
            ReceiptEmailService.NoAddress,
            new { extend = true }
        );
        (await DeliverAsync(local, Mail())).ShouldBe(HttpStatusCode.NotFound);
        // A new address replaces the expired one.
        (await CreateAddressAsync(token)).ShouldNotBe(local);
    }

    [Fact]
    public async Task whenExtended_Update_ShouldRestartTheLifetimeFromNow()
    {
        At(Noon);
        var (token, _) = await AccountAsync("extend@example.test");
        await CreateAddressAsync(token);
        At(Noon.AddDays(80));
        token = await SignInAsync("extend@example.test");
        var extended = await ExpectAsync(
            HttpMethod.Patch,
            AddressPath,
            token,
            HttpStatusCode.OK,
            new { extend = true }
        );
        extended
            .GetProperty("address")
            .GetProperty("expiresAt")
            .GetInt64()
            .ShouldBe(Millis(Noon.AddDays(170)));
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"extend\":false}")]
    [InlineData("{\"extend\":\"yes\"}")]
    [InlineData("[]")]
    public async Task whenUpdateHasNothingToChange_Update_ShouldReturnBadRequest(string json)
    {
        var (token, _) = await AccountAsync("nothing@example.test");
        await CreateAddressAsync(token);
        using var request = Authorized(HttpMethod.Patch, AddressPath, bearer: token);
        request.Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
        using var response = await Client.SendAsync(request, Ct);
        await ShouldBeErrorAsync(
            response,
            HttpStatusCode.BadRequest,
            ReceiptEmailService.InvalidUpdate
        );
    }

    [Fact]
    public async Task whenAllowedSendersInvalid_Update_ShouldRefuseAndKeepTheList()
    {
        var (token, _) = await AccountAsync("senders@example.test");
        await CreateAddressAsync(token);
        await ExpectAsync(
            HttpMethod.Patch,
            AddressPath,
            token,
            HttpStatusCode.OK,
            new { allowedSenders = new[] { "Shop.Example.Test", "@mail.example.test" } }
        );
        foreach (
            var bad in new object[]
            {
                new[] { "not an address" },
                "shop.example.test",
                new object[] { 1 },
            }
        )
            await ExpectErrorAsync(
                HttpMethod.Patch,
                AddressPath,
                token,
                HttpStatusCode.BadRequest,
                AllowedSenders.Invalid,
                new { allowedSenders = bad }
            );
        var read = await ExpectAsync(HttpMethod.Get, AddressPath, token, HttpStatusCode.OK);
        read.GetProperty("address")
            .GetProperty("allowedSenders")
            .EnumerateArray()
            .Select(value => value.GetString())
            .ShouldBe(["mail.example.test", "shop.example.test"]);
    }

    [Fact]
    public async Task whenRevoked_Revoke_ShouldRefuseMailAndBeIdempotent()
    {
        var (token, _) = await AccountAsync("revoke@example.test");
        var local = await CreateAddressAsync(token);
        await ExpectAsync(HttpMethod.Delete, AddressPath, token, HttpStatusCode.OK);
        await ExpectAsync(HttpMethod.Delete, AddressPath, token, HttpStatusCode.OK);
        (await ExpectAsync(HttpMethod.Get, AddressPath, token, HttpStatusCode.OK))
            .GetProperty("address")
            .ValueKind.ShouldBe(JsonValueKind.Null);
        (await DeliverAsync(local, Mail())).ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task whenTooManyAddressesInADay_Create_ShouldReturnTooManyRequests()
    {
        At(Noon);
        var (token, _) = await AccountAsync("churn@example.test");
        for (var index = 0; index < 10; index++)
            await CreateAddressAsync(token);
        await ExpectErrorAsync(
            HttpMethod.Post,
            AddressPath,
            token,
            HttpStatusCode.TooManyRequests,
            ReceiptEmailService.TooManyAddresses
        );
        At(Noon.AddDays(1).AddSeconds(1));
        await CreateAddressAsync(token);
    }

    [Fact]
    public async Task whenOtherUserHasAnAddress_Read_ShouldOnlyShowTheirOwn()
    {
        var (alice, _) = await AccountAsync("alice@example.test");
        var (bob, _) = await AccountAsync("bob@example.test");
        var aliceAddress = await CreateAddressAsync(alice);
        (await ExpectAsync(HttpMethod.Get, AddressPath, bob, HttpStatusCode.OK))
            .GetProperty("address")
            .ValueKind.ShouldBe(JsonValueKind.Null);
        await ExpectAsync(HttpMethod.Delete, AddressPath, bob, HttpStatusCode.OK);
        (await DeliverAsync(aliceAddress, Mail())).ShouldBe(HttpStatusCode.Accepted);
    }

    [Fact]
    public async Task whenFeatureDisabled_ReceiptEmail_ShouldReportDisabledAndRefuseChanges()
    {
        await using var disabled = Fixture.Factory.WithWebHostBuilder(builder =>
            builder.UseSetting("InboundMail:Enabled", "false")
        );
        using var client = CreateClient(disabled);
        var token = await RegisterAsync("disabled@example.test", client);
        using (var request = Authorized(HttpMethod.Get, AddressPath, bearer: token))
        using (var response = await client.SendAsync(request, Ct))
        {
            var envelope = JsonDocument
                .Parse(await response.Content.ReadAsStringAsync(Ct))
                .RootElement;
            response.StatusCode.ShouldBe(HttpStatusCode.OK);
            envelope.GetProperty("enabled").GetBoolean().ShouldBeFalse();
            envelope.GetProperty("domain").ValueKind.ShouldBe(JsonValueKind.Null);
        }
        foreach (var method in new[] { HttpMethod.Post, HttpMethod.Patch, HttpMethod.Delete })
        {
            using var request = Authorized(method, AddressPath, bearer: token);
            using var response = await client.SendAsync(request, Ct);
            await ShouldBeErrorAsync(
                response,
                HttpStatusCode.NotFound,
                ReceiptEmailService.NotEnabled
            );
        }
    }
}
