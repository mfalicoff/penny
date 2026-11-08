using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Application.Abstractions.Security;
using Penny.Backend.Application.Authentication;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

public sealed class AuthTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    private const string Email = "person@example.test";
    private const string SignIn = "Please sign in to continue.";

    [Fact]
    public async Task whenAccountRegistered_AuthFlow_ShouldIssueCookieAndBearerSessionUntilLogout()
    {
        using var registration = await Client.PostAsJsonAsync(
            "/api/auth/register",
            new { email = " PERSON@Example.TEST ", password = TestPassword },
            Ct
        );
        registration.StatusCode.ShouldBe(HttpStatusCode.Created);
        var session = (await registration.Content.ReadFromJsonAsync<SessionResponse>(Ct))!;
        session.Email.ShouldBe(Email);
        SessionTokens.IsWellFormed(session.Token).ShouldBeTrue();
        var setCookie = registration.Headers.GetValues("Set-Cookie").Single();
        setCookie.ShouldStartWith($"penny_session={session.Token};");
        foreach (
            var flag in new[]
            {
                "httponly",
                "secure",
                "samesite=lax",
                "path=/api",
                "max-age=2592000",
            }
        )
            setCookie.ToLowerInvariant().ShouldContain(flag);
        var cookie = setCookie.Split(';')[0];

        (await MeAsync(cookie: cookie)).ShouldBe(Email);
        (await MeAsync(bearer: session.Token)).ShouldBe(Email);

        // Only the token hash is stored; the account gets the legacy initial ledger.
        (
            await ScalarAsync(
                "SELECT count(*) FROM penny.sessions WHERE token_hash = @p",
                session.Token
            )
        ).ShouldBe(0L);
        (
            await ScalarAsync(
                "SELECT count(*) FROM penny.sessions WHERE token_hash = @p",
                SessionTokens.Hash(session.Token)
            )
        ).ShouldBe(1L);
        (
            await ScalarAsync(
                "SELECT revision FROM penny.ledgers l JOIN penny.users u ON u.id = l.user_id WHERE u.email = @p AND l.currency = 'CAD'",
                Email
            )
        ).ShouldBe(0L);
        (
            await ScalarAsync(
                "SELECT count(*) FROM penny.ledger_categories c JOIN penny.users u ON u.id = c.user_id WHERE u.email = @p",
                Email
            )
        ).ShouldBe(12L);
        var hash = (string)
            (
                await ScalarAsync(
                    "SELECT password || ':' || salt FROM penny.users WHERE email = @p",
                    Email
                )
            )!;
        hash.ShouldStartWith("AQAAAAI"); // Identity v3 hash, salt embedded
        hash.ShouldEndWith(":");

        using var logout = await Client.SendAsync(
            Authorized(HttpMethod.Post, "/api/auth/logout", cookie: cookie),
            Ct
        );
        logout.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await logout.Content.ReadFromJsonAsync<OkResponse>(Ct))!.Ok.ShouldBeTrue();
        var cleared = logout.Headers.GetValues("Set-Cookie").Single();
        cleared.ShouldStartWith("penny_session=;");
        cleared.ToLowerInvariant().ShouldContain("expires=thu, 01 jan 1970");
        cleared.ToLowerInvariant().ShouldContain("path=/api");

        using var revoked = await Client.SendAsync(
            Authorized(HttpMethod.Get, "/api/auth/me", bearer: session.Token),
            Ct
        );
        await ShouldBeErrorAsync(revoked, HttpStatusCode.Unauthorized, SignIn);
    }

    [Fact]
    public async Task whenBearerAndCookiePresented_Authenticate_ShouldPreferWellFormedBearer()
    {
        var token = await RegisterAsync(Email);
        var cookie = $"theme=dark; penny_session={token}";
        var unknown = new string('0', 64);
        (await StatusAsync(bearer: unknown, cookie: cookie)).ShouldBe(HttpStatusCode.Unauthorized);
        (await StatusAsync(bearer: token, cookie: $"penny_session={unknown}")).ShouldBe(
            HttpStatusCode.OK
        );
        (await StatusAsync(cookie: cookie)).ShouldBe(HttpStatusCode.OK);

        // Malformed Authorization headers fall back to the cookie, as in the legacy regex.
        foreach (
            var header in new[]
            {
                "Bearer " + token.ToUpperInvariant(),
                "bearer " + token,
                "Basic abc",
            }
        )
        {
            using var request = Authorized(HttpMethod.Get, "/api/auth/me", cookie: cookie);
            request.Headers.TryAddWithoutValidation("Authorization", header);
            using var response = await Client.SendAsync(request, Ct);
            response.StatusCode.ShouldBe(HttpStatusCode.OK);
        }
        (await StatusAsync(cookie: $"penny_session={token.ToUpperInvariant()}")).ShouldBe(
            HttpStatusCode.Unauthorized
        );
        (await StatusAsync(cookie: $"xpenny_session={token}")).ShouldBe(
            HttpStatusCode.Unauthorized
        );
        (await StatusAsync()).ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task whenSessionsBelongToDifferentAccounts_Logout_ShouldRevokeOnlyCurrentSession()
    {
        var first = await RegisterAsync(Email);
        var second = await LoginAsync(Email);
        var other = await RegisterAsync("other@example.test");
        first.ShouldNotBe(second);

        using var logout = await Client.SendAsync(
            Authorized(HttpMethod.Post, "/api/auth/logout", bearer: first),
            Ct
        );
        logout.StatusCode.ShouldBe(HttpStatusCode.OK);

        (await StatusAsync(bearer: first)).ShouldBe(HttpStatusCode.Unauthorized);
        (await MeAsync(bearer: second)).ShouldBe(Email);
        (await MeAsync(bearer: other)).ShouldBe("other@example.test");
        using var again = await Client.SendAsync(
            Authorized(HttpMethod.Post, "/api/auth/logout", bearer: first),
            Ct
        );
        await ShouldBeErrorAsync(again, HttpStatusCode.Unauthorized, SignIn);
    }

    [Fact]
    public async Task whenSessionReachesExpiry_Authenticate_ShouldRejectAtExactBoundary()
    {
        var issued = DateTimeOffset.Parse(
            "2030-01-01T00:00:00.123Z",
            System.Globalization.CultureInfo.InvariantCulture
        );
        var expires = issued.AddDays(30);
        Fixture.Factory.Clock.Set(issued.AddTicks(9999)); // sub-millisecond time is truncated
        var token = await RegisterAsync(Email);
        (
            await ScalarAsync(
                "SELECT expires_at FROM penny.sessions WHERE token_hash = @p",
                SessionTokens.Hash(token)
            )
        ).ShouldBe(expires.UtcDateTime);

        Fixture.Factory.Clock.Set(expires.AddMilliseconds(-1));
        (await StatusAsync(bearer: token)).ShouldBe(HttpStatusCode.OK);
        Fixture.Factory.Clock.Set(expires);
        (await StatusAsync(bearer: token)).ShouldBe(HttpStatusCode.Unauthorized);

        // Expired rows are purged only once strictly past expiry, when a session is issued.
        await LoginAsync(Email);
        (await ScalarAsync("SELECT count(*) FROM penny.sessions", null)).ShouldBe(2L);
        Fixture.Factory.Clock.Set(expires.AddMilliseconds(1));
        var fresh = await LoginAsync(Email);
        (
            await ScalarAsync(
                "SELECT count(*) FROM penny.sessions WHERE token_hash = @p",
                SessionTokens.Hash(token)
            )
        ).ShouldBe(0L);
        (await StatusAsync(bearer: fresh)).ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenCredentialsInvalid_Login_ShouldReturnGenericUnauthorized()
    {
        await RegisterAsync(Email);
        const string invalid = "Email or password is incorrect.";
        foreach (
            var body in new object[]
            {
                new { email = Email, password = "the wrong password" },
                new { email = "missing@example.test", password = TestPassword },
                new { email = Email },
                new { email = 5, password = TestPassword },
                new { },
                new[] { 1 },
            }
        )
        {
            using var response = await Client.PostAsJsonAsync("/api/auth/login", body, Ct);
            await ShouldBeErrorAsync(response, HttpStatusCode.Unauthorized, invalid);
            response.Headers.Contains("Set-Cookie").ShouldBeFalse();
        }
        using var text = await Client.PostAsync(
            "/api/auth/login",
            new StringContent($"email={Email}"),
            Ct
        );
        await ShouldBeErrorAsync(text, HttpStatusCode.Unauthorized, invalid);
        using var malformed = await Client.PostAsync(
            "/api/auth/login",
            new StringContent("{", Encoding.UTF8, "application/json"),
            Ct
        );
        await ShouldBeErrorAsync(malformed, HttpStatusCode.BadRequest, "Invalid JSON.");
        using var scalar = await Client.PostAsync(
            "/api/auth/login",
            new StringContent("\"x\"", Encoding.UTF8, "application/json"),
            Ct
        );
        await ShouldBeErrorAsync(scalar, HttpStatusCode.BadRequest, "Invalid JSON.");
        (await LoginAsync(" Person@Example.Test")).ShouldNotBeNullOrEmpty();
    }

    [Fact]
    public async Task whenRegistrationInvalidOrDuplicate_Register_ShouldReturnLegacyErrors()
    {
        await RegisterAsync(Email);
        using var duplicate = await Client.PostAsJsonAsync(
            "/api/auth/register",
            new { email = "PERSON@example.test", password = TestPassword },
            Ct
        );
        await ShouldBeErrorAsync(duplicate, HttpStatusCode.Conflict, AuthService.DuplicateEmail);
        foreach (
            var body in new object[]
            {
                new { email = "not-an-email", password = TestPassword },
                new { email = "new@example.test", password = "short" },
                new { },
            }
        )
        {
            using var response = await Client.PostAsJsonAsync("/api/auth/register", body, Ct);
            await ShouldBeErrorAsync(
                response,
                HttpStatusCode.BadRequest,
                AuthService.InvalidRegistration
            );
        }
        (await ScalarAsync("SELECT count(*) FROM penny.users", null)).ShouldBe(1L);
    }

    [Fact]
    public async Task whenRegistrationsRace_Register_ShouldCreateOneAccountAndConflictForLoser()
    {
        var responses = await Task.WhenAll(
            Client.PostAsJsonAsync(
                "/api/auth/register",
                new { email = Email, password = TestPassword },
                Ct
            ),
            Client.PostAsJsonAsync(
                "/api/auth/register",
                new { email = " PERSON@EXAMPLE.TEST ", password = TestPassword },
                Ct
            )
        );
        try
        {
            responses.Select(response => (int)response.StatusCode).Order().ShouldBe([201, 409]);
            await ShouldBeErrorAsync(
                responses.Single(response => response.StatusCode == HttpStatusCode.Conflict),
                HttpStatusCode.Conflict,
                AuthService.DuplicateEmail
            );
        }
        finally
        {
            foreach (var response in responses)
                response.Dispose();
        }
        (await ScalarAsync("SELECT count(*) FROM penny.users", null)).ShouldBe(1L);
        (await ScalarAsync("SELECT count(*) FROM penny.ledgers", null)).ShouldBe(1L);
        (await ScalarAsync("SELECT count(*) FROM penny.ledger_categories", null)).ShouldBe(12L);
        (await LoginAsync(Email)).ShouldNotBeNullOrEmpty();
    }

    [Fact]
    public async Task whenInitialLedgerCannotBeSaved_Register_ShouldRollBackAccount()
    {
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
            using var failed = await Client.PostAsJsonAsync(
                "/api/auth/register",
                new { email = Email, password = TestPassword },
                Ct
            );
            await ShouldBeErrorAsync(
                failed,
                HttpStatusCode.InternalServerError,
                "The server could not complete this request."
            );
            (await ScalarAsync("SELECT count(*) FROM penny.users", null)).ShouldBe(0L);
            (await ScalarAsync("SELECT count(*) FROM penny.ledgers", null)).ShouldBe(0L);
            (await ScalarAsync("SELECT count(*) FROM penny.sessions", null)).ShouldBe(0L);
        }
        finally
        {
            await Fixture.SqlAsync(
                "DROP TRIGGER IF EXISTS penny_test_fail_ledger ON penny.ledger_categories; DROP FUNCTION IF EXISTS public.penny_test_fail_ledger()",
                CancellationToken.None
            );
        }
        (await RegisterAsync(Email)).ShouldNotBeNullOrEmpty();
    }

    [Fact]
    public async Task whenRegistrationDisabled_Register_ShouldReturnForbiddenWhileLoginWorks()
    {
        await RegisterAsync(Email);
        await using var factory = new TestApiFactory(
            Fixture.RuntimeConnection,
            new Dictionary<string, string> { ["Auth:AllowRegistration"] = "false" }
        );
        using var client = CreateClient(factory);
        // Policy is checked before validation, as in the legacy service.
        using var disabled = await client.PostAsJsonAsync("/api/auth/register", new { }, Ct);
        await ShouldBeErrorAsync(
            disabled,
            HttpStatusCode.Forbidden,
            AuthService.RegistrationDisabled
        );
        using var login = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { email = Email, password = TestPassword },
            Ct
        );
        login.StatusCode.ShouldBe(HttpStatusCode.OK);
        login.Headers.GetValues("Set-Cookie").Single().ToLowerInvariant().ShouldContain("secure");
    }

    [Fact]
    public async Task whenRouteUnknown_SessionPolicy_ShouldRequireSessionBeforeNotFound()
    {
        using var anonymous = await Client.GetAsync("/api/missing", Ct);
        await ShouldBeErrorAsync(anonymous, HttpStatusCode.Unauthorized, SignIn);
        var token = await RegisterAsync(Email);
        using var request = Authorized(HttpMethod.Get, "/api/missing", bearer: token);
        using var authenticated = await Client.SendAsync(request, Ct);
        await ShouldBeErrorAsync(authenticated, HttpStatusCode.NotFound, "API route not found.");
    }

    [Fact]
    public async Task whenStoredHashUsesFewerIterations_Login_ShouldUpgradeStoredHash()
    {
        await RegisterAsync(Email);
        var weaker = new IdentityPasswordHasher(
            new PasswordHasherOptions { IterationCount = 1000 }
        ).Hash(TestPassword);
        await using (
            var update = Fixture.Admin.CreateCommand("UPDATE penny.users SET password = @hash")
        )
        {
            update.Parameters.AddWithValue("hash", weaker);
            await update.ExecuteNonQueryAsync(Ct);
        }
        await LoginAsync(Email);
        var stored = (string)
            (await ScalarAsync("SELECT password FROM penny.users WHERE email = @p", Email))!;
        stored.ShouldNotBe(weaker);
        new IdentityPasswordHasher().Verify(stored, TestPassword).ShouldBe(PasswordCheck.Success);
    }

    private async Task<string> LoginAsync(string email)
    {
        using var response = await Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email, password = TestPassword },
            Ct
        );
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var session = (await response.Content.ReadFromJsonAsync<SessionResponse>(Ct))!;
        session.Email.ShouldBe(Email);
        return session.Token;
    }

    private async Task<string?> MeAsync(string? bearer = null, string? cookie = null)
    {
        using var response = await Client.SendAsync(
            Authorized(HttpMethod.Get, "/api/auth/me", bearer, cookie),
            Ct
        );
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<JsonElement>(Ct))
            .GetProperty("email")
            .GetString();
    }

    private async Task<HttpStatusCode> StatusAsync(string? bearer = null, string? cookie = null)
    {
        using var response = await Client.SendAsync(
            Authorized(HttpMethod.Get, "/api/auth/me", bearer, cookie),
            Ct
        );
        return response.StatusCode;
    }

    private async Task<object?> ScalarAsync(string sql, object? parameter)
    {
        await using var command = Fixture.Admin.CreateCommand(sql);
        if (parameter is not null)
            command.Parameters.AddWithValue("p", parameter);
        return await command.ExecuteScalarAsync(Ct);
    }

    internal static async Task ShouldBeErrorAsync(
        HttpResponseMessage response,
        HttpStatusCode status,
        string message
    )
    {
        response.StatusCode.ShouldBe(status);
        (await response.Content.ReadFromJsonAsync<ApiError>(Ct))!.Error.ShouldBe(message);
        response.Headers.CacheControl!.NoStore.ShouldBeTrue();
    }
}
