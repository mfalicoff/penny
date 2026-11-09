using System.Net;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Push;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// `POST/DELETE /api/push/devices` over real HTTP and PostgreSQL (MAZ-61): legacy Expo
// tokens and native APNs tokens with their environment, per-session ownership, and
// cleanup on logout, transfer and removal. All tokens are synthetic.
public sealed class PushDeviceTests(ApiFixture fixture) : PushTestBase(fixture)
{
    [Fact]
    public async Task whenNoSession_RegisterDevice_ShouldReturnUnauthorized()
    {
        await ExpectErrorAsync(
            HttpMethod.Post,
            DevicesPath,
            null,
            HttpStatusCode.Unauthorized,
            AuthService.SignInRequired,
            new { token = ExpoToken, platform = "ios" }
        );
        await ExpectErrorAsync(
            HttpMethod.Delete,
            DevicesPath,
            null,
            HttpStatusCode.Unauthorized,
            AuthService.SignInRequired,
            new { token = ExpoToken }
        );
    }

    [Fact]
    public async Task whenLegacyAndNativeTokensRegistered_RegisterDevice_ShouldStoreProviderAndEnvironment()
    {
        var token = await RegisterAsync("device@example.test");

        (
            await ExpectAsync(
                HttpMethod.Post,
                DevicesPath,
                token,
                HttpStatusCode.Created,
                new { token = ExpoToken, platform = "android" }
            )
        )
            .GetProperty("ok")
            .GetBoolean()
            .ShouldBeTrue();
        await RegisterApnsAsync(token, ApnsToken(1).ToUpperInvariant(), "sandbox");
        await RegisterApnsAsync(token, ApnsToken(2), "production");

        (
            await ScalarAsync(
                "SELECT string_agg(platform || '/' || provider || '/' || coalesce(environment, '-'), ',' ORDER BY platform, environment NULLS FIRST) FROM penny.push_devices"
            )
        ).ShouldBe("android/expo/-,ios/apns/production,ios/apns/sandbox");
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.push_devices WHERE token = '{ApnsToken(1)}'"
            )
        ).ShouldBe(1, "APNs tokens are stored lower-case");
    }

    [Theory]
    [InlineData("""{"token":"not-a-token","platform":"ios"}""")]
    [InlineData("""{"token":"ExponentPushToken[device_one]","platform":"web"}""")]
    [InlineData(
        """{"token":"ExponentPushToken[device_one]","platform":"ios","environment":"sandbox"}"""
    )]
    [InlineData("""{"token":"ExponentPushToken[device_one]","platform":"ios","provider":"fcm"}""")]
    [InlineData(
        """{"token":"ExponentPushToken[device_one]","platform":"ios","provider":"apns","environment":"sandbox"}"""
    )]
    [InlineData(
        """{"token":"a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90","platform":"ios","provider":"apns"}"""
    )]
    [InlineData(
        """{"token":"a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90","platform":"ios","provider":"apns","environment":"development"}"""
    )]
    [InlineData(
        """{"token":"a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90","platform":"android","provider":"apns","environment":"production"}"""
    )]
    [InlineData(
        """{"token":"a1b2c3d4e5f60718293a4b5c6d7e8f9","platform":"ios","provider":"apns","environment":"production"}"""
    )]
    [InlineData(
        """{"token":"zzb2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90","platform":"ios","provider":"apns","environment":"production"}"""
    )]
    [InlineData("""{"platform":"ios"}""")]
    [InlineData("""[]""")]
    public async Task whenDeviceInvalid_RegisterDevice_ShouldReturnLegacyMessage(string body)
    {
        var token = await RegisterAsync("invalid-device@example.test");
        using var request = Authorized(HttpMethod.Post, DevicesPath, bearer: token);
        request.Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");

        using var response = await Client.SendAsync(request, Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync(Ct)).ShouldBe(
            $$"""{"error":"{{PushDeviceService.InvalidDevice}}"}"""
        );
        (await CountAsync("SELECT count(*) FROM penny.push_devices")).ShouldBe(0);
    }

    [Fact]
    public async Task whenOtherSessionRemovesToken_RemoveDevice_ShouldOnlyRemoveTheOwningSessionsDevice()
    {
        var owner = await RegisterAsync("owner@example.test");
        var otherSession = (
            await ExpectAsync(
                HttpMethod.Post,
                "/api/auth/login",
                null,
                HttpStatusCode.OK,
                new { email = "owner@example.test", password = TestPassword }
            )
        )
            .GetProperty("token")
            .GetString()!;
        var stranger = await RegisterAsync("stranger@example.test");
        await RegisterApnsAsync(owner, ApnsToken(1), "production");

        await ExpectAsync(
            HttpMethod.Delete,
            DevicesPath,
            stranger,
            HttpStatusCode.OK,
            new { token = ApnsToken(1) }
        );
        await ExpectAsync(
            HttpMethod.Delete,
            DevicesPath,
            otherSession,
            HttpStatusCode.OK,
            new { token = ApnsToken(1) }
        );
        (await CountAsync("SELECT count(*) FROM penny.push_devices")).ShouldBe(1);

        await ExpectAsync(
            HttpMethod.Delete,
            DevicesPath,
            owner,
            HttpStatusCode.OK,
            new { token = ApnsToken(1).ToUpperInvariant() }
        );
        (await CountAsync("SELECT count(*) FROM penny.push_devices")).ShouldBe(0);
        await ExpectErrorAsync(
            HttpMethod.Delete,
            DevicesPath,
            owner,
            HttpStatusCode.BadRequest,
            PushDeviceService.InvalidDevice,
            new { token = 7 }
        );
    }

    [Fact]
    public async Task whenSessionLogsOut_Logout_ShouldRemoveItsDevicesButKeepOtherSessions()
    {
        var first = await RegisterAsync("logout@example.test");
        var second = (
            await ExpectAsync(
                HttpMethod.Post,
                "/api/auth/login",
                null,
                HttpStatusCode.OK,
                new { email = "logout@example.test", password = TestPassword }
            )
        )
            .GetProperty("token")
            .GetString()!;
        await RegisterExpoAsync(first);
        await RegisterApnsAsync(second, ApnsToken(2), "sandbox");

        await ExpectAsync(HttpMethod.Post, "/api/auth/logout", first, HttpStatusCode.OK);

        (await ScalarAsync("SELECT string_agg(provider, ',') FROM penny.push_devices")).ShouldBe(
            "apns"
        );
    }

    [Fact]
    public async Task whenTokenMovesToAnotherUser_RegisterDevice_ShouldFinishPreviousOwnersPendingDeliveries()
    {
        var (householdId, alex, sam) = await HouseholdAsync();
        await RegisterApnsAsync(sam.Token, ApnsToken(3), "production");
        await CreateExpenseAsync(householdId, alex.Token, Expense(1000, alex.UserId));
        Apns.Respond = _ => PushOutcome.Retry("apns:503:ServiceUnavailable");
        await Runner().RunOnceAsync(Ct);
        (await PendingAsync()).ShouldBe(1);

        // The device signs in as alex: sam's queued notification must not reach it.
        await RegisterApnsAsync(alex.Token, ApnsToken(3), "production");

        (await PendingAsync()).ShouldBe(0);
        (
            await ScalarAsync(
                $"SELECT last_error FROM penny.push_deliveries WHERE token = '{ApnsToken(3)}'"
            )
        ).ShouldBe("device-transferred");
        (await ScalarAsync("SELECT user_id FROM penny.push_devices")).ShouldBe(alex.UserId);
    }

    [Fact]
    public async Task whenExpoRetired_RegisterDevice_ShouldRefuseExpoButAcceptApns()
    {
        await using var retired = new TestApiFactory(
            Fixture.RuntimeConnection,
            new Dictionary<string, string> { ["Push:Expo:Enabled"] = "false" }
        );
        using var client = CreateClient(retired);
        var token = await RegisterAsync("retired@example.test", client);

        using (var expo = Authorized(HttpMethod.Post, DevicesPath, bearer: token))
        {
            expo.Content = System.Net.Http.Json.JsonContent.Create(
                new { token = ExpoToken, platform = "ios" }
            );
            using var response = await client.SendAsync(expo, Ct);
            response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        }
        using var apns = Authorized(HttpMethod.Post, DevicesPath, bearer: token);
        apns.Content = System.Net.Http.Json.JsonContent.Create(
            new
            {
                token = ApnsToken(4),
                platform = "ios",
                provider = "apns",
                environment = "production",
            }
        );
        using var accepted = await client.SendAsync(apns, Ct);
        accepted.StatusCode.ShouldBe(HttpStatusCode.Created);
    }

    [Fact]
    public async Task whenDatabaseWritesInvalidCombination_PushDevices_ShouldRejectByConstraint()
    {
        var (_, alex, _) = await HouseholdAsync();
        await RegisterExpoAsync(alex.Token);

        await Should.ThrowAsync<Npgsql.PostgresException>(() =>
            Fixture.SqlAsync(
                "UPDATE penny.push_devices SET provider = 'apns', environment = NULL",
                Ct
            )
        );
        await Should.ThrowAsync<Npgsql.PostgresException>(() =>
            Fixture.SqlAsync(
                "UPDATE penny.push_devices SET provider = 'apns', environment = 'production', platform = 'android'",
                Ct
            )
        );
    }
}
