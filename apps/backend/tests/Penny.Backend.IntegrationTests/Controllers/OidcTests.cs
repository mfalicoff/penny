using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.IdentityModel.Tokens;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Application.Authentication;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

public sealed class OidcTests(ApiFixture fixture, FakeOidcProvider provider)
    : OidcTestBase(fixture, provider)
{
    private const string Email = "person@example.test";

    [Fact]
    public async Task whenOidcNotConfigured_OidcRoutes_ShouldReportDisabledAndReturnNotFound()
    {
        // The shared host has no OIDC settings.
        using (var config = await Client.GetAsync("/api/auth/oidc", Ct))
        {
            config.StatusCode.ShouldBe(HttpStatusCode.OK);
            (await config.Content.ReadAsStringAsync(Ct)).ShouldBe("""{"enabled":false}""");
        }
        foreach (var path in new[] { "/api/auth/oidc/start", "/api/auth/oidc/complete" })
        {
            using var response = await Client.PostAsJsonAsync(path, new { }, Ct);
            await AuthTests.ShouldBeErrorAsync(
                response,
                HttpStatusCode.NotFound,
                OidcService.NotConfigured
            );
            // As with express.json(), malformed JSON is rejected before the route runs.
            using var malformed = await Client.PostAsync(
                path,
                new StringContent("{", Encoding.UTF8, "application/json"),
                Ct
            );
            await AuthTests.ShouldBeErrorAsync(
                malformed,
                HttpStatusCode.BadRequest,
                "Invalid JSON."
            );
        }
    }

    [Fact]
    public async Task whenOidcConfigured_Start_ShouldReturnPkceAuthorizationUrlAndStoreHashedAttempt()
    {
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection);
        using var client = CreateClient(api);
        (await client.GetFromJsonAsync<JsonElement>("/api/auth/oidc", Ct))
            .GetRawText()
            .ShouldBe("""{"enabled":true,"label":"Synthetic SSO"}""");
        var now = DateTimeOffset.FromUnixTimeMilliseconds(1_900_000_000_123);
        api.Clock.Set(now);

        var challenge = await StartAsync(client, FakeOidcProvider.NativeRedirect);
        var transaction = challenge.GetProperty("transaction").GetString()!;
        transaction.ShouldMatch("^[a-f0-9]{64}$");
        challenge
            .GetProperty("expiresAt")
            .GetInt64()
            .ShouldBe(now.AddMinutes(10).ToUnixTimeMilliseconds());
        var url = challenge.GetProperty("authorizationUrl").GetString()!;
        url.ShouldStartWith(FakeOidcProvider.Issuer + "/authorize?");
        url.ShouldNotContain(transaction);
        url.ShouldNotContain(FakeOidcProvider.ClientSecret);
        var query = QueryHelpers.ParseQuery(new Uri(url).Query);
        query
            .Keys.Order(StringComparer.Ordinal)
            .ShouldBe([
                "client_id",
                "code_challenge",
                "code_challenge_method",
                "nonce",
                "redirect_uri",
                "response_type",
                "scope",
                "state",
            ]);
        query["response_type"].ToString().ShouldBe("code");
        query["client_id"].ToString().ShouldBe(FakeOidcProvider.ClientId);
        query["redirect_uri"].ToString().ShouldBe(FakeOidcProvider.NativeRedirect);
        query["scope"].ToString().ShouldBe("openid email profile");
        query["code_challenge_method"].ToString().ShouldBe("S256");

        // Only the transaction hash is stored, with the secrets that bind the callback.
        await using var command = Fixture.Admin.CreateCommand(
            "SELECT transaction_hash, redirect_uri, state, nonce, code_verifier, expires_at FROM penny.oidc_attempts"
        );
        await using var reader = await command.ExecuteReaderAsync(Ct);
        (await reader.ReadAsync(Ct)).ShouldBeTrue();
        reader.GetString(0).ShouldBe(SessionTokens.Hash(transaction));
        reader.GetString(1).ShouldBe(FakeOidcProvider.NativeRedirect);
        reader.GetString(2).ShouldBe(query["state"].ToString());
        reader.GetString(3).ShouldBe(query["nonce"].ToString());
        Base64UrlEncoder
            .Encode(SHA256.HashData(Encoding.ASCII.GetBytes(reader.GetString(4))))
            .ShouldBe(query["code_challenge"].ToString());
        reader.GetFieldValue<DateTimeOffset>(5).ShouldBe(now.AddMinutes(10));
        (await reader.ReadAsync(Ct)).ShouldBeFalse();
    }

    [Theory]
    [InlineData("""{"redirectUri":"https://attacker.example.test/auth/callback"}""")]
    [InlineData("""{"redirectUri":"https://penny.example.test/auth/callback/"}""")]
    [InlineData("""{"redirectUri":7}""")]
    [InlineData("{}")]
    [InlineData("[]")]
    public async Task whenRedirectUriNotConfigured_Start_ShouldReturnBadRequest(string body)
    {
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection);
        using var client = CreateClient(api);
        using var response = await client.PostAsync(
            "/api/auth/oidc/start",
            new StringContent(body, Encoding.UTF8, "application/json"),
            Ct
        );
        await AuthTests.ShouldBeErrorAsync(
            response,
            HttpStatusCode.BadRequest,
            OidcService.RedirectNotConfigured
        );
        (await ScalarAsync("SELECT count(*) FROM penny.oidc_attempts")).ShouldBe(0L);
    }

    [Fact]
    public async Task whenNewIdentityAndRegistrationAllowed_Complete_ShouldCreateAccountWithLedgerAndSession()
    {
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection);
        using var client = CreateClient(api);
        var (transaction, callbackUrl) = await BeginAsync(client);

        using var completed = await CompleteAsync(client, transaction, callbackUrl);
        completed.StatusCode.ShouldBe(HttpStatusCode.OK);
        var session = (await completed.Content.ReadFromJsonAsync<SessionResponse>(Ct))!;
        session.Email.ShouldBe(Email);
        session.Token.ShouldMatch("^[a-f0-9]{64}$");
        var cookie = completed.Headers.GetValues("Set-Cookie").Single();
        cookie.ShouldStartWith($"penny_session={session.Token};");
        cookie.ShouldContain("httponly");
        cookie.ShouldContain("secure");
        cookie.ShouldContain("samesite=lax");
        cookie.ShouldContain("path=/api");
        cookie.ShouldContain("max-age=2592000");
        completed.Headers.CacheControl!.NoStore.ShouldBeTrue();
        (await MeAsync(client, session.Token)).ShouldBe(Email);

        // One user with an empty password, a random salt, the identity, the initial
        // ledger and a hashed session; the attempt is gone.
        (await ScalarAsync("SELECT count(*) FROM penny.users WHERE password = ''")).ShouldBe(1L);
        (await ScalarAsync("SELECT salt FROM penny.users"))
            .ShouldBeOfType<string>()
            .ShouldMatch("^[a-f0-9]{32}$");
        (
            await ScalarAsync(
                $"SELECT count(*) FROM penny.oidc_identities i JOIN penny.users u ON u.id = i.user_id WHERE i.issuer = '{FakeOidcProvider.Issuer}' AND i.subject = 'subject-01' AND u.email = '{Email}'"
            )
        ).ShouldBe(1L);
        (await ScalarAsync("SELECT revision FROM penny.ledgers")).ShouldBe(0L);
        (await ScalarAsync("SELECT count(*) FROM penny.ledger_categories")).ShouldBe(12L);
        (
            await ScalarAsync(
                $"SELECT count(*) FROM penny.sessions WHERE token_hash = '{SessionTokens.Hash(session.Token)}'"
            )
        ).ShouldBe(1L);
        (await ScalarAsync("SELECT count(*) FROM penny.oidc_attempts")).ShouldBe(0L);

        // Single use: replaying the same completion is refused without a provider call.
        using var replay = await CompleteAsync(client, transaction, callbackUrl);
        await AuthTests.ShouldBeErrorAsync(
            replay,
            HttpStatusCode.Unauthorized,
            OidcService.Expired
        );
        Provider.TokenRequests.ShouldBe(1);

        // The OIDC-only account cannot sign in with a password.
        using var password = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { email = Email, password = "" },
            Ct
        );
        password.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task whenProviderEmailChanges_Complete_ShouldSignInToSameAccountByIssuerAndSubject()
    {
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection);
        using var client = CreateClient(api);
        using (var first = await SignInAsync(client))
            first.StatusCode.ShouldBe(HttpStatusCode.OK);
        using var changed = await SignInAsync(
            client,
            new FakeOidcGrant { Email = "renamed@example.test" },
            FakeOidcProvider.NativeRedirect
        );
        changed.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await changed.Content.ReadFromJsonAsync<SessionResponse>(Ct))!.Email.ShouldBe(Email);
        (await ScalarAsync("SELECT count(*) FROM penny.users")).ShouldBe(1L);
        (await ScalarAsync("SELECT count(*) FROM penny.sessions")).ShouldBe(2L);

        // A different subject with a new email is a different account.
        using var other = await SignInAsync(
            client,
            new FakeOidcGrant { Subject = "subject-02", Email = "second@example.test" }
        );
        other.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await ScalarAsync("SELECT count(*) FROM penny.users")).ShouldBe(2L);
    }

    [Fact]
    public async Task whenRegistrationDisabled_Complete_ShouldRejectNewIdentitiesButSignInExisting()
    {
        await using (var open = Provider.CreateApi(Fixture.RuntimeConnection))
        {
            using var client = CreateClient(open);
            using var created = await SignInAsync(client);
            created.StatusCode.ShouldBe(HttpStatusCode.OK);
        }
        await using var closed = Provider.CreateApi(
            Fixture.RuntimeConnection,
            FakeOidcProvider.Settings(allowRegistration: false)
        );
        using var closedClient = CreateClient(closed);
        using var refused = await SignInAsync(
            closedClient,
            new FakeOidcGrant { Subject = "subject-02", Email = "new@example.test" }
        );
        await AuthTests.ShouldBeErrorAsync(
            refused,
            HttpStatusCode.Forbidden,
            AuthService.OidcRegistrationDisabled
        );
        using var existing = await SignInAsync(closedClient);
        existing.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await ScalarAsync("SELECT count(*) FROM penny.users")).ShouldBe(1L);
    }

    [Fact]
    public async Task whenEmailBelongsToPasswordAccount_Complete_ShouldConflictWithoutLinking()
    {
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection);
        using var client = CreateClient(api);
        var password = await RegisterAsync(Email, client);
        using var conflict = await SignInAsync(client);
        await AuthTests.ShouldBeErrorAsync(
            conflict,
            HttpStatusCode.Conflict,
            AuthService.OidcEmailInUse
        );
        (await ScalarAsync("SELECT count(*) FROM penny.oidc_identities")).ShouldBe(0L);
        (await ScalarAsync("SELECT count(*) FROM penny.users")).ShouldBe(1L);
        (await MeAsync(client, password)).ShouldBe(Email);
    }

    [Fact]
    public async Task whenFirstSignInsRace_Complete_ShouldCreateOneAccount()
    {
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection);
        using var client = CreateClient(api);
        var attempts = new[] { await BeginAsync(client), await BeginAsync(client) };
        var responses = await Task.WhenAll(
            attempts.Select(attempt =>
                CompleteAsync(client, attempt.Transaction, attempt.CallbackUrl)
            )
        );
        try
        {
            // The loser either waited for the winner's commit (conflict) or found the
            // committed identity afterwards (signed in); it never creates a second user.
            responses.ShouldContain(response => response.StatusCode == HttpStatusCode.OK);
            responses.ShouldAllBe(response =>
                response.StatusCode == HttpStatusCode.OK
                || response.StatusCode == HttpStatusCode.Conflict
            );
        }
        finally
        {
            foreach (var response in responses)
                response.Dispose();
        }
        (await ScalarAsync("SELECT count(*) FROM penny.users")).ShouldBe(1L);
        (await ScalarAsync("SELECT count(*) FROM penny.oidc_identities")).ShouldBe(1L);
        (await ScalarAsync("SELECT count(*) FROM penny.ledgers")).ShouldBe(1L);
        (await ScalarAsync("SELECT count(*) FROM penny.ledger_categories")).ShouldBe(12L);
    }

    [Fact]
    public async Task whenSameAttemptRedeemedConcurrently_Complete_ShouldExchangeOnce()
    {
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection);
        using var client = CreateClient(api);
        var (transaction, callbackUrl) = await BeginAsync(client);
        var responses = await Task.WhenAll(
            Enumerable.Range(0, 4).Select(_ => CompleteAsync(client, transaction, callbackUrl))
        );
        try
        {
            responses
                .Select(response => (int)response.StatusCode)
                .Order()
                .ShouldBe([200, 401, 401, 401]);
        }
        finally
        {
            foreach (var response in responses)
                response.Dispose();
        }
        Provider.TokenRequests.ShouldBe(1);
        (await ScalarAsync("SELECT count(*) FROM penny.sessions")).ShouldBe(1L);
    }

    [Fact]
    public async Task whenAttemptExpiredOrUnknown_Complete_ShouldRejectWithoutExchange()
    {
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection);
        using var client = CreateClient(api);
        var start = DateTimeOffset.FromUnixTimeMilliseconds(1_900_000_000_000);
        api.Clock.Set(start);
        var expired = await BeginAsync(client);
        var current = await BeginAsync(client);

        api.Clock.Set(start + OidcService.Lifetime);
        using (var late = await CompleteAsync(client, expired.Transaction, expired.CallbackUrl))
            await AuthTests.ShouldBeErrorAsync(
                late,
                HttpStatusCode.Unauthorized,
                OidcService.Expired
            );
        using (
            var unknown = await CompleteAsync(client, SessionTokens.Create(), current.CallbackUrl)
        )
            await AuthTests.ShouldBeErrorAsync(
                unknown,
                HttpStatusCode.Unauthorized,
                OidcService.Expired
            );
        Provider.TokenRequests.ShouldBe(0);

        // An attempt is valid until one millisecond before its expiry.
        api.Clock.Set(start + OidcService.Lifetime - TimeSpan.FromMilliseconds(1));
        using (var onTime = await CompleteAsync(client, current.Transaction, current.CallbackUrl))
            onTime.StatusCode.ShouldBe(HttpStatusCode.OK);

        // Starting a new attempt purges expired ones.
        var stale = await BeginAsync(client);
        api.Clock.Set(start + TimeSpan.FromMinutes(30));
        await BeginAsync(client);
        (
            await ScalarAsync(
                $"SELECT count(*) FROM penny.oidc_attempts WHERE transaction_hash = '{SessionTokens.Hash(stale.Transaction)}'"
            )
        ).ShouldBe(0L);
        (await ScalarAsync("SELECT count(*) FROM penny.oidc_attempts")).ShouldBe(1L);
    }

    [Theory]
    [InlineData("""{"transaction":"abc","callbackUrl":"penny://auth/callback?code=x"}""")]
    [InlineData(
        """{"transaction":"ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789","callbackUrl":"x"}"""
    )]
    [InlineData(
        """{"transaction":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}"""
    )]
    [InlineData(
        """{"transaction":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","callbackUrl":5}"""
    )]
    [InlineData("{}")]
    public async Task whenBodyInvalid_Complete_ShouldReturnBadRequest(string body)
    {
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection);
        using var client = CreateClient(api);
        using var response = await client.PostAsync(
            "/api/auth/oidc/complete",
            new StringContent(body, Encoding.UTF8, "application/json"),
            Ct
        );
        await AuthTests.ShouldBeErrorAsync(
            response,
            HttpStatusCode.BadRequest,
            OidcService.InvalidResponse
        );
    }

    [Fact]
    public async Task whenCallbackTooLong_Complete_ShouldRejectBeforeConsumingAttempt()
    {
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection);
        using var client = CreateClient(api);
        var (transaction, callbackUrl) = await BeginAsync(client);
        using (
            var tooLong = await CompleteAsync(
                client,
                transaction,
                callbackUrl + "&padding=" + new string('x', OidcService.MaxCallbackLength)
            )
        )
            await AuthTests.ShouldBeErrorAsync(
                tooLong,
                HttpStatusCode.BadRequest,
                OidcService.InvalidResponse
            );
        using var completed = await CompleteAsync(client, transaction, callbackUrl);
        completed.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenCallbackDoesNotMatchAttempt_Complete_ShouldRejectWithoutExchange()
    {
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection);
        using var client = CreateClient(api);
        var tampered = new Func<string, string>[]
        {
            // Wrong, missing and repeated state.
            callback => callback.Replace("state=", "state=x", StringComparison.Ordinal),
            callback => callback.Replace("&state=", "&other=", StringComparison.Ordinal),
            callback => callback + "&state=" + QueryState(callback),
            // Redirect URI mismatch: another configured URI, a lookalike, case or a fragment.
            callback =>
                callback.Replace(
                    FakeOidcProvider.WebRedirect,
                    FakeOidcProvider.NativeRedirect,
                    StringComparison.Ordinal
                ),
            callback =>
                callback.Replace(
                    FakeOidcProvider.WebRedirect,
                    FakeOidcProvider.WebRedirect + "/",
                    StringComparison.Ordinal
                ),
            callback =>
                callback.Replace("https://penny", "https://PENNY", StringComparison.Ordinal),
            callback => callback + "#fragment",
            callback => callback.Split('?')[0],
            // The user cancelled at the provider.
            callback => callback + "&error=access_denied",
            // Missing code, or a different issuer in the response.
            callback => callback.Replace("code=", "kode=", StringComparison.Ordinal),
            callback => callback + "&iss=" + Uri.EscapeDataString("https://other.example.test"),
        };
        foreach (var tamper in tampered)
        {
            var (transaction, callbackUrl) = await BeginAsync(client);
            using var response = await CompleteAsync(client, transaction, tamper(callbackUrl));
            await AuthTests.ShouldBeErrorAsync(
                response,
                HttpStatusCode.Unauthorized,
                OidcService.NotVerified
            );
            // The failed attempt is consumed: a retry with the genuine callback fails too.
            using var retry = await CompleteAsync(client, transaction, callbackUrl);
            await AuthTests.ShouldBeErrorAsync(
                retry,
                HttpStatusCode.Unauthorized,
                OidcService.Expired
            );
        }
        Provider.TokenRequests.ShouldBe(0);
        (await ScalarAsync("SELECT count(*) FROM penny.users")).ShouldBe(0L);
    }

    [Fact]
    public async Task whenProviderAdvertisesIssuerParameter_Complete_ShouldRequireMatchingIssuer()
    {
        Provider.SendsIssuer = true;
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection);
        using var client = CreateClient(api);
        var (transaction, callbackUrl) = await BeginAsync(client);
        var withoutIssuer = callbackUrl[..callbackUrl.IndexOf("&iss=", StringComparison.Ordinal)];
        using (var missing = await CompleteAsync(client, transaction, withoutIssuer))
            await AuthTests.ShouldBeErrorAsync(
                missing,
                HttpStatusCode.Unauthorized,
                OidcService.NotVerified
            );
        using var completed = await SignInAsync(client);
        completed.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenIdTokenOrEmailInvalid_Complete_ShouldReturnUnauthorized()
    {
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection);
        using var client = CreateClient(api);
        var expired = DateTimeOffset.UtcNow.AddMinutes(-5).ToUnixTimeSeconds();
        var grants = new[]
        {
            Claims("nonce", "wrong-nonce"),
            Claims("nonce", null),
            Claims("aud", "other-client"),
            Claims("iss", "https://other.example.test"),
            Claims("exp", expired),
            Claims("exp", null),
            Claims("sub", null),
            Claims("email_verified", false),
            Claims("email_verified", "true"),
            Claims("email_verified", null),
            Claims("email", "not-an-email"),
            Claims("email", " person@example.test"),
            new FakeOidcGrant { WrongSigningKey = true },
            // UserInfo fallback: subject must match and the email must be verified.
            new FakeOidcGrant
            {
                Claims = new Dictionary<string, object?> { ["email"] = null },
                UserInfoSubject = "someone-else",
            },
            new FakeOidcGrant
            {
                Claims = new Dictionary<string, object?> { ["email"] = null },
                UserInfoEmailVerified = false,
            },
        };
        foreach (var grant in grants)
        {
            using var response = await SignInAsync(client, grant);
            await AuthTests.ShouldBeErrorAsync(
                response,
                HttpStatusCode.Unauthorized,
                OidcService.NotVerified
            );
        }
        Provider.TokenRequests.ShouldBe(grants.Length);
        (await ScalarAsync("SELECT count(*) FROM penny.users")).ShouldBe(0L);
        (await ScalarAsync("SELECT count(*) FROM penny.sessions")).ShouldBe(0L);
        (await ScalarAsync("SELECT count(*) FROM penny.oidc_attempts")).ShouldBe(0L);
    }

    [Fact]
    public async Task whenEmailOnlyInUserInfo_Complete_ShouldUseVerifiedUserInfoEmail()
    {
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection);
        using var client = CreateClient(api);
        using var response = await SignInAsync(
            client,
            new FakeOidcGrant
            {
                Email = "Mixed.Case@Example.TEST",
                Claims = new Dictionary<string, object?>
                {
                    ["email"] = null,
                    ["email_verified"] = null,
                },
            }
        );
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        // Provider emails are lowercased, as in the legacy server.
        (await response.Content.ReadFromJsonAsync<SessionResponse>(Ct))!.Email.ShouldBe(
            "mixed.case@example.test"
        );
    }

    [Fact]
    public async Task whenProviderUnavailableOrMisadvertised_Start_ShouldReturnBadRequestAndDiscardAttempt()
    {
        Provider.Available = false;
        await using (var down = Provider.CreateApi(Fixture.RuntimeConnection))
        {
            using var client = CreateClient(down);
            using var response = await client.PostAsJsonAsync(
                "/api/auth/oidc/start",
                new { redirectUri = FakeOidcProvider.WebRedirect },
                Ct
            );
            await AuthTests.ShouldBeErrorAsync(
                response,
                HttpStatusCode.BadRequest,
                OidcService.ProviderUnavailable
            );
        }
        Provider.Available = true;
        Provider.DiscoveryIssuer = FakeOidcProvider.Issuer + "/";
        await using (var mismatched = Provider.CreateApi(Fixture.RuntimeConnection))
        {
            using var client = CreateClient(mismatched);
            using var response = await client.PostAsJsonAsync(
                "/api/auth/oidc/start",
                new { redirectUri = FakeOidcProvider.WebRedirect },
                Ct
            );
            await AuthTests.ShouldBeErrorAsync(
                response,
                HttpStatusCode.BadRequest,
                OidcService.ProviderUnavailable
            );
        }
        (await ScalarAsync("SELECT count(*) FROM penny.oidc_attempts")).ShouldBe(0L);
    }

    [Fact]
    public async Task whenServerRestartsDuringSignIn_Complete_ShouldFinishOnNewHost()
    {
        (string Transaction, string CallbackUrl) attempt;
        await using (var before = Provider.CreateApi(Fixture.RuntimeConnection))
        {
            using var client = CreateClient(before);
            attempt = await BeginAsync(client);
        }
        await using var after = Provider.CreateApi(Fixture.RuntimeConnection);
        using var restarted = CreateClient(after);
        using var completed = await CompleteAsync(
            restarted,
            attempt.Transaction,
            attempt.CallbackUrl
        );
        completed.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenTooManyAttemptsPending_Start_ShouldReturnForbiddenUntilTheyExpire()
    {
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection);
        using var client = CreateClient(api);
        var now = DateTimeOffset.UtcNow;
        api.Clock.Set(now);
        await Fixture.SqlAsync(
            $"""
            INSERT INTO penny.oidc_attempts
            SELECT encode(sha256(i::text::bytea), 'hex'), '{FakeOidcProvider.WebRedirect}', 's', 'n', repeat('v', 43),
                   to_timestamp({now.ToUnixTimeMilliseconds()} / 1000.0) + interval '1 minute'
            FROM generate_series(1, {OidcService.MaxPendingAttempts}) AS i
            """,
            Ct
        );
        using (
            var refused = await client.PostAsJsonAsync(
                "/api/auth/oidc/start",
                new { redirectUri = FakeOidcProvider.WebRedirect },
                Ct
            )
        )
            await AuthTests.ShouldBeErrorAsync(
                refused,
                HttpStatusCode.Forbidden,
                OidcService.TooManyAttempts
            );
        api.Clock.Set(now.AddMinutes(2));
        await StartAsync(client);
        (await ScalarAsync("SELECT count(*) FROM penny.oidc_attempts")).ShouldBe(1L);
    }

    [Fact]
    public async Task whenInitialLedgerCannotBeSaved_Complete_ShouldRollBackAccountAndIdentity()
    {
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection);
        using var client = CreateClient(api);
        await Fixture.SqlAsync(
            """
            CREATE FUNCTION public.penny_test_fail_ledger() RETURNS trigger LANGUAGE plpgsql
              AS $$ BEGIN RAISE EXCEPTION 'synthetic ledger failure'; END $$;
            CREATE TRIGGER penny_test_fail_ledger BEFORE INSERT ON penny.ledger_categories
              FOR EACH ROW EXECUTE FUNCTION public.penny_test_fail_ledger();
            """,
            Ct
        );
        try
        {
            using var failed = await SignInAsync(client);
            await AuthTests.ShouldBeErrorAsync(
                failed,
                HttpStatusCode.InternalServerError,
                "The server could not complete this request."
            );
            (await ScalarAsync("SELECT count(*) FROM penny.users")).ShouldBe(0L);
            (await ScalarAsync("SELECT count(*) FROM penny.oidc_identities")).ShouldBe(0L);
            (await ScalarAsync("SELECT count(*) FROM penny.ledgers")).ShouldBe(0L);
            (await ScalarAsync("SELECT count(*) FROM penny.sessions")).ShouldBe(0L);
        }
        finally
        {
            await Fixture.SqlAsync(
                "DROP TRIGGER IF EXISTS penny_test_fail_ledger ON penny.ledger_categories; DROP FUNCTION IF EXISTS public.penny_test_fail_ledger()",
                CancellationToken.None
            );
        }
        using var retried = await SignInAsync(client);
        retried.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenOidcSettingsInvalid_Startup_ShouldFailWithSettingNameAndNoSecret()
    {
        var settings = FakeOidcProvider.Settings();
        settings["Oidc:RedirectUris"] = "https://penny.example.test/auth/callback?next=/";
        await using var api = Provider.CreateApi(Fixture.RuntimeConnection, settings);
        var error = Should.Throw<InvalidOperationException>(() => api.StartServer());
        error.Message.ShouldContain("Oidc:RedirectUris");
        error.Message.ShouldNotContain(FakeOidcProvider.ClientSecret);
    }

    private static FakeOidcGrant Claims(string name, object? value) =>
        new() { Claims = new Dictionary<string, object?> { [name] = value } };

    private static string QueryState(string callback) =>
        QueryHelpers.ParseQuery(new Uri(callback).Query)["state"].ToString();

    private static async Task<string> MeAsync(HttpClient client, string token)
    {
        using var response = await client.SendAsync(
            Authorized(HttpMethod.Get, "/api/auth/me", bearer: token),
            Ct
        );
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<MeResponse>(Ct))!.Email;
    }
}
