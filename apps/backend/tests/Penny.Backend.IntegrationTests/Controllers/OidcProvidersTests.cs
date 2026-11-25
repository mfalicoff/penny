using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Penny.Backend.Application.Authentication;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// MAZ-170: several configured providers, Apple's posted response through the callback relay,
// its generated client secret, name and string `email_verified`, a missing or relay email,
// and native sign-in with a platform ID token.
public sealed class OidcProvidersTests(ApiFixture fixture, FakeOidcProvider provider)
    : OidcTestBase(fixture, provider)
{
    private const string AppleUser =
        """{"name":{"firstName":"Ada","lastName":"Lovelace"},"email":"ada@example.test"}""";

    [Fact]
    public async Task whenSeveralProvidersConfigured_Config_ShouldListEachInOrder()
    {
        await using var api = Provider.CreateApi(Fixture.Connection, Provider.MultiSettings());
        using var client = CreateClient(api);

        (await client.GetStringAsync("/api/auth/oidc", Ct)).ShouldBe(
            """{"enabled":true,"label":"Synthetic SSO","providers":[{"id":"sso","label":"Synthetic SSO","icon":"sso","native":false},{"id":"apple","label":"Apple","icon":"apple","native":true},{"id":"second","label":"Second provider","icon":"sso","native":false}]}"""
        );
    }

    [Fact]
    public async Task whenProviderNamed_Start_ShouldSignInWithThatProviderOnly()
    {
        await using var api = Provider.CreateApi(Fixture.Connection, Provider.MultiSettings());
        using var client = CreateClient(api);

        var challenge = await StartAsync(client, provider: "second");
        var url = challenge.GetProperty("authorizationUrl").GetString()!;
        url.ShouldStartWith(FakeOidcProvider.SecondIssuer + "/authorize?");
        QueryHelpers
            .ParseQuery(new Uri(url).Query)["client_id"]
            .ToString()
            .ShouldBe(FakeOidcProvider.SecondClientId);
        (await ScalarAsync("SELECT provider_id FROM penny.oidc_attempts")).ShouldBe("second");
        using var response = await CompleteAsync(
            client,
            challenge.GetProperty("transaction").GetString()!,
            Provider.Authorize(url)
        );
        var token = await TokenAsync(response);

        var profile = await ProfileAsync(client, token);
        profile.GetProperty("signIn").GetString().ShouldBe("oidc");
        profile.GetProperty("provider").GetString().ShouldBe("Second provider");
        profile.GetProperty("providerId").GetString().ShouldBe("second");
        profile.GetProperty("providerIcon").GetString().ShouldBe("sso");
        (await ScalarAsync("SELECT issuer FROM penny.oidc_identities")).ShouldBe(
            FakeOidcProvider.SecondIssuer
        );
    }

    [Fact]
    public async Task whenProviderOmitted_Start_ShouldUseTheFirstProvider()
    {
        await using var api = Provider.CreateApi(Fixture.Connection, Provider.MultiSettings());
        using var client = CreateClient(api);

        var challenge = await StartAsync(client);

        challenge
            .GetProperty("authorizationUrl")
            .GetString()
            .ShouldStartWith(FakeOidcProvider.Issuer + "/authorize?");
        (await ScalarAsync("SELECT provider_id FROM penny.oidc_attempts")).ShouldBe("sso");
    }

    [Theory]
    [InlineData(
        """{"redirectUri":"https://penny.example.test/auth/callback","provider":"google"}"""
    )]
    [InlineData("""{"redirectUri":"https://penny.example.test/auth/callback","provider":"SSO"}""")]
    public async Task whenProviderNotConfigured_Start_ShouldReturnBadRequestAndStoreNothing(
        string body
    )
    {
        await using var api = Provider.CreateApi(Fixture.Connection, Provider.MultiSettings());
        using var client = CreateClient(api);

        using var response = await client.PostAsync(
            "/api/auth/oidc/start",
            new StringContent(body, Encoding.UTF8, "application/json"),
            Ct
        );

        await AuthTests.ShouldBeErrorAsync(
            response,
            HttpStatusCode.BadRequest,
            OidcService.ProviderNotConfigured
        );
        (await ScalarAsync("SELECT count(*) FROM penny.oidc_attempts")).ShouldBe(0L);
    }

    [Fact]
    public async Task whenRedirectNotAllowedForProvider_Start_ShouldReturnBadRequest()
    {
        // `second` allows only the web redirect, not the app's.
        await using var api = Provider.CreateApi(Fixture.Connection, Provider.MultiSettings());
        using var client = CreateClient(api);

        using var response = await client.PostAsJsonAsync(
            "/api/auth/oidc/start",
            new { redirectUri = FakeOidcProvider.NativeRedirect, provider = "second" },
            Ct
        );

        await AuthTests.ShouldBeErrorAsync(
            response,
            HttpStatusCode.BadRequest,
            OidcService.RedirectNotConfigured
        );
    }

    [Fact]
    public async Task whenTwoProvidersShareSubjectOrEmail_Complete_ShouldKeepEachAccountOnOneProvider()
    {
        await using var api = Provider.CreateApi(Fixture.Connection, Provider.MultiSettings());
        using var client = CreateClient(api);
        var grant = new FakeOidcGrant { Subject = "same-subject", Email = "first@example.test" };
        await TokenAsync(await SignInAsync(client, grant));

        // The same subject at another issuer is another person: a new account.
        using (
            var other = await SignInAsync(
                client,
                grant with
                {
                    Email = "second@example.test",
                },
                provider: "second"
            )
        )
            await TokenAsync(other);
        (await ScalarAsync("SELECT count(*) FROM penny.users")).ShouldBe(2L);

        // The first account's email at the second provider is never linked.
        using var collision = await SignInAsync(
            client,
            new FakeOidcGrant { Subject = "another", Email = "first@example.test" },
            provider: "second"
        );
        await AuthTests.ShouldBeErrorAsync(
            collision,
            HttpStatusCode.Conflict,
            AuthService.OidcEmailInUse
        );
        (await ScalarAsync("SELECT count(*) FROM penny.oidc_identities")).ShouldBe(2L);
    }

    [Fact]
    public async Task whenAppleSignsIn_CallbackAndComplete_ShouldRelayTheFormPostAndCreateTheAccount()
    {
        await using var api = Provider.CreateApi(Fixture.Connection, Provider.MultiSettings());
        using var client = NoRedirectClient(api);

        var challenge = await StartAsync(client, provider: "apple");
        var url = challenge.GetProperty("authorizationUrl").GetString()!;
        url.ShouldStartWith(FakeOidcProvider.AppleIssuer + "/authorize?");
        var query = QueryHelpers.ParseQuery(new Uri(url).Query);
        query["redirect_uri"].ToString().ShouldBe(FakeOidcProvider.AppleCallback);
        query["response_mode"].ToString().ShouldBe("form_post");
        query["scope"].ToString().ShouldBe("openid email name");
        var (callbackUri, form) = Provider.AuthorizePost(url, user: AppleUser);
        callbackUri.ShouldBe(FakeOidcProvider.AppleCallback);

        var location = await RelayAsync(client, form);

        location.ShouldStartWith(FakeOidcProvider.WebRedirect + "?code=");
        var relayed = QueryHelpers.ParseQuery(new Uri(location).Query);
        relayed.Keys.Order(StringComparer.Ordinal).ShouldBe(["code", "state", "user"]);
        relayed["state"].ToString().ShouldBe(query["state"].ToString());
        relayed["user"].ToString().ShouldBe(AppleUser);
        // The relay only reads the attempt; the app still completes it.
        (await ScalarAsync("SELECT count(*) FROM penny.oidc_attempts")).ShouldBe(1L);
        using var response = await CompleteAsync(
            client,
            challenge.GetProperty("transaction").GetString()!,
            location
        );
        var token = await TokenAsync(response);
        Provider.TokenRequests.ShouldBe(1);

        var profile = await ProfileAsync(client, token);
        profile.GetProperty("email").GetString().ShouldBe("person@example.test");
        profile.GetProperty("emailVerified").GetBoolean().ShouldBeTrue();
        profile.GetProperty("displayName").GetString().ShouldBe("Ada Lovelace");
        profile.GetProperty("nameEditable").GetBoolean().ShouldBeFalse();
        profile.GetProperty("avatarEditable").GetBoolean().ShouldBeTrue();
        profile.GetProperty("providerId").GetString().ShouldBe("apple");
        profile.GetProperty("providerIcon").GetString().ShouldBe("apple");
        profile.GetProperty("provider").GetString().ShouldBe("Apple");
        profile.TryGetProperty("avatarUrl", out _).ShouldBeFalse();
    }

    [Fact]
    public async Task whenAppleSignsInAgainWithoutName_Complete_ShouldKeepTheFirstName()
    {
        await using var api = Provider.CreateApi(Fixture.Connection, Provider.MultiSettings());
        using var client = NoRedirectClient(api);
        await TokenAsync(await AppleSignInAsync(client, user: AppleUser));

        var token = await TokenAsync(await AppleSignInAsync(client));

        (await ProfileAsync(client, token))
            .GetProperty("displayName")
            .GetString()
            .ShouldBe("Ada Lovelace");
        (await ScalarAsync("SELECT count(*) FROM penny.users")).ShouldBe(1L);
    }

    [Fact]
    public async Task whenAppleSendsAPrivateRelayEmail_Complete_ShouldUseItAsTheVerifiedEmail()
    {
        await using var api = Provider.CreateApi(Fixture.Connection, Provider.MultiSettings());
        using var client = NoRedirectClient(api);

        using var response = await AppleSignInAsync(
            client,
            new FakeOidcGrant { Email = "x7k2m9q4@privaterelay.appleid.com" }
        );

        (await response.Content.ReadFromJsonAsync<JsonElement>(Ct))
            .GetProperty("email")
            .GetString()
            .ShouldBe("x7k2m9q4@privaterelay.appleid.com");
        (await ScalarAsync("SELECT email_verified_at IS NOT NULL FROM penny.users")).ShouldBe(true);
    }

    [Fact]
    public async Task whenAppleSendsNoEmail_Complete_ShouldRefuseANewAccountButSignInAnExistingOne()
    {
        await using var api = Provider.CreateApi(Fixture.Connection, Provider.MultiSettings());
        using var client = NoRedirectClient(api);
        var noEmail = new FakeOidcGrant
        {
            Claims = new Dictionary<string, object?> { ["email"] = null },
        };

        using (var refused = await AppleSignInAsync(client, noEmail))
            await AuthTests.ShouldBeErrorAsync(
                refused,
                HttpStatusCode.Unauthorized,
                OidcService.NotVerified
            );
        (await ScalarAsync("SELECT count(*) FROM penny.users")).ShouldBe(0L);

        await TokenAsync(await AppleSignInAsync(client));
        using var again = await AppleSignInAsync(client, noEmail);
        again.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await again.Content.ReadFromJsonAsync<JsonElement>(Ct))
            .GetProperty("email")
            .GetString()
            .ShouldBe("person@example.test");
    }

    [Fact]
    public async Task whenAppleEmailIsNotVerified_Complete_ShouldRefuse()
    {
        await using var api = Provider.CreateApi(Fixture.Connection, Provider.MultiSettings());
        using var client = NoRedirectClient(api);

        using var response = await AppleSignInAsync(
            client,
            new FakeOidcGrant
            {
                Claims = new Dictionary<string, object?> { ["email_verified"] = "false" },
            }
        );

        await AuthTests.ShouldBeErrorAsync(
            response,
            HttpStatusCode.Unauthorized,
            OidcService.NotVerified
        );
    }

    [Fact]
    public async Task whenAppStartedTheAttempt_Callback_ShouldRelayToTheAppRedirect()
    {
        await using var api = Provider.CreateApi(Fixture.Connection, Provider.MultiSettings());
        using var client = NoRedirectClient(api);
        var challenge = await StartAsync(client, FakeOidcProvider.NativeRedirect, "apple");
        var (_, form) = Provider.AuthorizePost(
            challenge.GetProperty("authorizationUrl").GetString()!
        );

        var location = await RelayAsync(client, form);

        location.ShouldStartWith(FakeOidcProvider.NativeRedirect + "?code=");
        using var response = await CompleteAsync(
            client,
            challenge.GetProperty("transaction").GetString()!,
            location
        );
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenCallbackDoesNotMatchAPendingAttempt_Callback_ShouldRefuse()
    {
        await using var api = Provider.CreateApi(Fixture.Connection, Provider.MultiSettings());
        using var client = NoRedirectClient(api);
        var challenge = await StartAsync(client, provider: "apple");
        var (_, form) = Provider.AuthorizePost(
            challenge.GetProperty("authorizationUrl").GetString()!
        );

        using (
            var unknown = await PostFormAsync(
                client,
                "/api/auth/oidc/callback/apple",
                "code=x&state=unknown"
            )
        )
            await AuthTests.ShouldBeErrorAsync(
                unknown,
                HttpStatusCode.Unauthorized,
                OidcService.Expired
            );
        // The attempt belongs to Apple, not to the provider in the path.
        using (
            var other = await PostFormAsync(
                client,
                "/api/auth/oidc/callback/sso",
                $"code=x&state={form["state"]}"
            )
        )
            await AuthTests.ShouldBeErrorAsync(
                other,
                HttpStatusCode.NotFound,
                OidcService.ProviderNotConfigured
            );
        using (
            var repeated = await PostFormAsync(
                client,
                "/api/auth/oidc/callback/apple",
                $"code=x&code=y&state={form["state"]}"
            )
        )
            await AuthTests.ShouldBeErrorAsync(
                repeated,
                HttpStatusCode.BadRequest,
                OidcService.InvalidResponse
            );
        using (
            var json = await client.PostAsJsonAsync(
                "/api/auth/oidc/callback/apple",
                new { state = form["state"] },
                Ct
            )
        )
            await AuthTests.ShouldBeErrorAsync(
                json,
                HttpStatusCode.BadRequest,
                OidcService.InvalidResponse
            );
        // After its expiry the attempt is no longer relayed.
        api.Clock.Set(api.Clock.GetUtcNow() + OidcService.Lifetime);
        using var expired = await PostFormAsync(
            client,
            "/api/auth/oidc/callback/apple",
            $"code=x&state={form["state"]}"
        );
        await AuthTests.ShouldBeErrorAsync(
            expired,
            HttpStatusCode.Unauthorized,
            OidcService.Expired
        );
    }

    [Fact]
    public async Task whenProviderRedirectsWithAQuery_Callback_ShouldRelayAGet()
    {
        await using var api = Provider.CreateApi(Fixture.Connection, Provider.MultiSettings());
        using var client = NoRedirectClient(api);
        var challenge = await StartAsync(client, provider: "apple");
        var (_, form) = Provider.AuthorizePost(
            challenge.GetProperty("authorizationUrl").GetString()!
        );

        using var response = await client.GetAsync(
            QueryHelpers.AddQueryString("/api/auth/oidc/callback/apple", form),
            Ct
        );

        response.StatusCode.ShouldBe(HttpStatusCode.SeeOther);
        response.Headers.Location!.OriginalString.ShouldStartWith(
            FakeOidcProvider.WebRedirect + "?code="
        );
    }

    [Fact]
    public async Task whenNativeIdTokenMatchesTheAttempt_NativeComplete_ShouldCreateTheAccountWithTheName()
    {
        await using var api = Provider.CreateApi(Fixture.Connection, Provider.MultiSettings());
        using var client = CreateClient(api);
        var challenge = await NativeStartAsync(client);
        var nonce = challenge.GetProperty("nonce").GetString()!;
        nonce.ShouldMatch("^[a-f0-9]{64}$");
        (await ScalarAsync("SELECT redirect_uri IS NULL FROM penny.oidc_attempts")).ShouldBe(true);

        using var response = await NativeCompleteAsync(
            client,
            new
            {
                transaction = challenge.GetProperty("transaction").GetString(),
                idToken = Provider.NativeIdToken(nonce),
                givenName = "Ada",
                familyName = "Lovelace",
            }
        );
        var token = await TokenAsync(response);
        response.Headers.GetValues("Set-Cookie").Single().ShouldStartWith("penny_session=");

        var profile = await ProfileAsync(client, token);
        profile.GetProperty("displayName").GetString().ShouldBe("Ada Lovelace");
        profile.GetProperty("providerId").GetString().ShouldBe("apple");
        (await ScalarAsync("SELECT issuer FROM penny.oidc_identities")).ShouldBe(
            FakeOidcProvider.AppleIssuer
        );
        Provider.TokenRequests.ShouldBe(0);

        // The web flow and the app's own sign-in reach the same Apple account.
        using var web = await AppleSignInAsync(NoRedirectClient(api));
        (await TokenAsync(web)).ShouldNotBe(token);
        (await ScalarAsync("SELECT count(*) FROM penny.users")).ShouldBe(1L);
    }

    [Fact]
    public async Task whenNativeIdTokenIsWrong_NativeComplete_ShouldRefuseAndConsumeTheAttempt()
    {
        await using var api = Provider.CreateApi(Fixture.Connection, Provider.MultiSettings());
        using var client = CreateClient(api);
        foreach (
            var idToken in new Func<string, string>[]
            {
                _ => Provider.NativeIdToken("0".PadLeft(64, '0')),
                nonce => Provider.NativeIdToken(nonce, audience: FakeOidcProvider.AppleClientId),
                nonce => Provider.NativeIdToken(nonce, issuer: FakeOidcProvider.SecondIssuer),
                nonce =>
                    Provider.NativeIdToken(nonce, new FakeOidcGrant { WrongSigningKey = true }),
                _ => "not-a-token",
            }
        )
        {
            var challenge = await NativeStartAsync(client);
            var transaction = challenge.GetProperty("transaction").GetString();
            var body = new
            {
                transaction,
                idToken = idToken(challenge.GetProperty("nonce").GetString()!),
            };
            using (var refused = await NativeCompleteAsync(client, body))
                await AuthTests.ShouldBeErrorAsync(
                    refused,
                    HttpStatusCode.Unauthorized,
                    OidcService.NotVerified
                );
            using var replay = await NativeCompleteAsync(client, body);
            await AuthTests.ShouldBeErrorAsync(
                replay,
                HttpStatusCode.Unauthorized,
                OidcService.Expired
            );
        }
        (await ScalarAsync("SELECT count(*) FROM penny.users")).ShouldBe(0L);
    }

    [Fact]
    public async Task whenAttemptKindsAreMixed_Complete_ShouldTreatTheAttemptAsExpired()
    {
        await using var api = Provider.CreateApi(Fixture.Connection, Provider.MultiSettings());
        using var client = CreateClient(api);
        var native = await NativeStartAsync(client);
        var nonce = native.GetProperty("nonce").GetString()!;
        using (
            var asWeb = await CompleteAsync(
                client,
                native.GetProperty("transaction").GetString()!,
                FakeOidcProvider.WebRedirect + "?code=x&state=y"
            )
        )
            await AuthTests.ShouldBeErrorAsync(
                asWeb,
                HttpStatusCode.Unauthorized,
                OidcService.Expired
            );

        var web = await StartAsync(client, provider: "apple");
        using var asNative = await NativeCompleteAsync(
            client,
            new
            {
                transaction = web.GetProperty("transaction").GetString(),
                idToken = Provider.NativeIdToken(nonce),
            }
        );
        await AuthTests.ShouldBeErrorAsync(
            asNative,
            HttpStatusCode.Unauthorized,
            OidcService.Expired
        );
    }

    [Theory]
    [InlineData("sso", OidcService.NativeNotConfigured)]
    [InlineData("google", OidcService.ProviderNotConfigured)]
    [InlineData(null, OidcService.ProviderNotConfigured)]
    public async Task whenProviderHasNoNativeSignIn_NativeStart_ShouldReturnBadRequest(
        string? provider,
        string message
    )
    {
        await using var api = Provider.CreateApi(Fixture.Connection, Provider.MultiSettings());
        using var client = CreateClient(api);

        using var response = await client.PostAsJsonAsync(
            "/api/auth/oidc/native/start",
            new { provider },
            Ct
        );

        await AuthTests.ShouldBeErrorAsync(response, HttpStatusCode.BadRequest, message);
    }

    [Fact]
    public async Task whenOidcNotConfigured_NewRoutes_ShouldReturnNotFound()
    {
        foreach (
            var path in new[] { "/api/auth/oidc/native/start", "/api/auth/oidc/native/complete" }
        )
        {
            using var response = await Client.PostAsJsonAsync(path, new { }, Ct);
            await AuthTests.ShouldBeErrorAsync(
                response,
                HttpStatusCode.NotFound,
                OidcService.NotConfigured
            );
        }
        using var callback = await Client.GetAsync("/api/auth/oidc/callback/apple?state=x", Ct);
        await AuthTests.ShouldBeErrorAsync(
            callback,
            HttpStatusCode.NotFound,
            OidcService.NotConfigured
        );
    }

    [Fact]
    public async Task whenOnlyDictionaryProvidersConfigured_Startup_ShouldServeThem()
    {
        var settings = Provider
            .MultiSettings()
            .Where(pair =>
                !pair.Key.StartsWith("Oidc:", StringComparison.Ordinal)
                || pair.Key.StartsWith("Oidc:Providers:", StringComparison.Ordinal)
            )
            .ToDictionary();
        await using var api = Provider.CreateApi(Fixture.Connection, settings);
        using var client = CreateClient(api);

        var config = await client.GetFromJsonAsync<JsonElement>("/api/auth/oidc", Ct);

        config.GetProperty("label").GetString().ShouldBe("Apple");
        config
            .GetProperty("providers")
            .EnumerateArray()
            .Select(entry => entry.GetProperty("id").GetString())
            .ShouldBe(["apple", "second"]);
        // A client from before MAZ-170 sends no provider and gets the first one.
        (await StartAsync(client))
            .GetProperty("authorizationUrl")
            .GetString()
            .ShouldStartWith(FakeOidcProvider.AppleIssuer + "/authorize?");
    }

    private async Task<HttpResponseMessage> AppleSignInAsync(
        HttpClient client,
        FakeOidcGrant? grant = null,
        string? user = null
    )
    {
        var challenge = await StartAsync(client, provider: "apple");
        var (_, form) = Provider.AuthorizePost(
            challenge.GetProperty("authorizationUrl").GetString()!,
            grant,
            user
        );
        return await CompleteAsync(
            client,
            challenge.GetProperty("transaction").GetString()!,
            await RelayAsync(client, form)
        );
    }

    // Plays the browser posting Apple's form to the API's callback, from Apple's page.
    private static async Task<string> RelayAsync(
        HttpClient client,
        Dictionary<string, string?> form
    )
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/oidc/callback/apple")
        {
            Content = new FormUrlEncodedContent(form),
        };
        request.Headers.Add("Origin", FakeOidcProvider.AppleIssuer);
        using var response = await client.SendAsync(request, Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.SeeOther);
        return response.Headers.Location!.OriginalString;
    }

    private static async Task<HttpResponseMessage> PostFormAsync(
        HttpClient client,
        string path,
        string form
    )
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent(form, Encoding.UTF8, "application/x-www-form-urlencoded"),
        };
        request.Headers.Add("Origin", FakeOidcProvider.AppleIssuer);
        return await client.SendAsync(request, Ct);
    }

    private static async Task<JsonElement> NativeStartAsync(HttpClient client)
    {
        using var response = await client.PostAsJsonAsync(
            "/api/auth/oidc/native/start",
            new { provider = "apple" },
            Ct
        );
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
    }

    private static Task<HttpResponseMessage> NativeCompleteAsync(HttpClient client, object body) =>
        client.PostAsJsonAsync("/api/auth/oidc/native/complete", body, Ct);

    private static async Task<string> TokenAsync(HttpResponseMessage response)
    {
        response.StatusCode.ShouldBe(
            HttpStatusCode.OK,
            await response.Content.ReadAsStringAsync(Ct)
        );
        return (await response.Content.ReadFromJsonAsync<JsonElement>(Ct))
            .GetProperty("token")
            .GetString()!;
    }

    private static async Task<JsonElement> ProfileAsync(HttpClient client, string token)
    {
        using var response = await client.SendAsync(
            Authorized(HttpMethod.Get, "/api/profile", bearer: token),
            Ct
        );
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return await response.Content.ReadFromJsonAsync<JsonElement>(Ct);
    }

    private static HttpClient NoRedirectClient(TestApiFactory api)
    {
        api.StartServer();
        return api.CreateClient(
            new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false,
                HandleCookies = false,
                BaseAddress = api.ClientOptions.BaseAddress,
            }
        );
    }
}
