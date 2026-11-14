using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Application.Abstractions.Security;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Domain.Errors;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

public sealed class PasswordResetTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    private const string Email = "person@example.test";
    private const string NewPassword = "a brand new password";
    private const string Invalid = PasswordResetService.InvalidToken;

    [Fact]
    public async Task whenCurrentHashAccountReset_PasswordResetFlow_ShouldReplacePasswordAndRevokeEverySession()
    {
        var bearer = await RegisterAsync(Email);
        var cookie = await LoginAsync(Email, TestPassword);
        var other = await RegisterAsync("other@example.test");
        var userId = (string)
            (await ScalarAsync("SELECT id FROM penny.users WHERE email = @p", Email))!;
        await Fixture.SqlAsync(
            $"INSERT INTO penny.push_devices (token, user_id, session_hash, platform, provider, environment, updated_at) VALUES ('device-1', '{userId}', '{SessionTokens.Hash(bearer)}', 'ios', 'apns', 'production', now())",
            Ct
        );

        var reset = await IssueResetAsync(" PERSON@Example.TEST ");
        reset.HadPassword.ShouldBeTrue();
        SessionTokens.IsWellFormed(reset.Token).ShouldBeTrue();
        // Only SHA-256(code) is stored.
        (await ScalarAsync("SELECT token_hash FROM penny.password_resets", null)).ShouldBe(
            SessionTokens.Hash(reset.Token)
        );
        (
            await ScalarAsync(
                "SELECT count(*) FROM penny.password_resets WHERE token_hash = @p",
                reset.Token
            )
        ).ShouldBe(0L);

        using var response = await ResetPasswordAsync(
            new { token = reset.Token, password = NewPassword }
        );
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await response.Content.ReadFromJsonAsync<OkResponse>(Ct))!.Ok.ShouldBeTrue();
        // No session is issued; the user signs in normally.
        response.Headers.Contains("Set-Cookie").ShouldBeFalse();
        response.Headers.CacheControl!.NoStore.ShouldBeTrue();

        // Every session of the account is revoked (bearer and cookie), push devices
        // cascade, and other accounts are untouched.
        (await StatusAsync(bearer: bearer)).ShouldBe(HttpStatusCode.Unauthorized);
        (await StatusAsync(cookie: $"penny_session={cookie}")).ShouldBe(
            HttpStatusCode.Unauthorized
        );
        (await ScalarAsync("SELECT count(*) FROM penny.push_devices", null)).ShouldBe(0L);
        (await StatusAsync(bearer: other)).ShouldBe(HttpStatusCode.OK);
        (await ScalarAsync("SELECT count(*) FROM penny.password_resets", null)).ShouldBe(0L);

        // The new password is an Identity hash.
        var stored = (string)
            (await ScalarAsync("SELECT password FROM penny.users WHERE email = @p", Email))!;
        new IdentityPasswordHasher().Verify(stored, NewPassword).ShouldBe(PasswordCheck.Success);
        using (
            var old = await Client.PostAsJsonAsync(
                "/api/auth/login",
                new { email = Email, password = TestPassword },
                Ct
            )
        )
            await AuthTests.ShouldBeErrorAsync(
                old,
                HttpStatusCode.Unauthorized,
                AuthService.InvalidCredentials
            );
        var signedIn = await LoginAsync(Email, NewPassword);
        (await StatusAsync(bearer: signedIn)).ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenCodeAlreadyUsed_PasswordReset_ShouldRejectReuseWithGenericError()
    {
        await RegisterAsync(Email);
        var reset = await IssueResetAsync(Email);
        using (
            var first = await ResetPasswordAsync(
                new { token = reset.Token, password = NewPassword }
            )
        )
            first.StatusCode.ShouldBe(HttpStatusCode.OK);
        var session = await LoginAsync(Email, NewPassword);

        using var again = await ResetPasswordAsync(
            new { token = reset.Token, password = "an attacker's password" }
        );
        await AuthTests.ShouldBeErrorAsync(again, HttpStatusCode.BadRequest, Invalid);
        // The rejected reuse changed nothing.
        (await StatusAsync(bearer: session)).ShouldBe(HttpStatusCode.OK);
        await LoginAsync(Email, NewPassword);
    }

    [Fact]
    public async Task whenNewerCodeIssued_PasswordReset_ShouldRejectSupersededCode()
    {
        await RegisterAsync(Email);
        await RegisterAsync("other@example.test");
        var superseded = await IssueResetAsync(Email);
        var unrelated = await IssueResetAsync("other@example.test");
        var current = await IssueResetAsync(Email);
        (await ScalarAsync("SELECT count(*) FROM penny.password_resets", null)).ShouldBe(2L);

        using (
            var stale = await ResetPasswordAsync(
                new { token = superseded.Token, password = NewPassword }
            )
        )
            await AuthTests.ShouldBeErrorAsync(stale, HttpStatusCode.BadRequest, Invalid);
        using (
            var fresh = await ResetPasswordAsync(
                new { token = current.Token, password = NewPassword }
            )
        )
            fresh.StatusCode.ShouldBe(HttpStatusCode.OK);
        // Codes are per account: another user's code is unaffected.
        using (
            var otherReset = await ResetPasswordAsync(
                new { token = unrelated.Token, password = NewPassword }
            )
        )
            otherReset.StatusCode.ShouldBe(HttpStatusCode.OK);
        await LoginAsync(Email, NewPassword);
    }

    [Fact]
    public async Task whenCodeReachesExpiry_PasswordReset_ShouldAcceptBeforeBoundaryThenRejectAndPurge()
    {
        await RegisterAsync(Email);
        await RegisterAsync("other@example.test");
        var issuedAt = DateTimeOffset.FromUnixTimeMilliseconds(1893456000123);
        Fixture.Factory.Clock.Set(issuedAt);
        var early = await IssueResetAsync(Email);
        early.ExpiresAt.ShouldBe(issuedAt.AddHours(24));

        // Valid while expires_at > now, to the millisecond.
        Fixture.Factory.Clock.Set(early.ExpiresAt.AddMilliseconds(-1));
        using (
            var valid = await ResetPasswordAsync(
                new { token = early.Token, password = NewPassword }
            )
        )
            valid.StatusCode.ShouldBe(HttpStatusCode.OK);

        Fixture.Factory.Clock.Set(issuedAt);
        var late = await IssueResetAsync(Email);
        Fixture.Factory.Clock.Set(late.ExpiresAt);
        using (
            var expired = await ResetPasswordAsync(
                new { token = late.Token, password = "too late a password" }
            )
        )
            await AuthTests.ShouldBeErrorAsync(expired, HttpStatusCode.BadRequest, Invalid);
        // The expired code was purged when it was presented and changed nothing.
        (await ScalarAsync("SELECT count(*) FROM penny.password_resets", null)).ShouldBe(0L);
        await LoginAsync(Email, NewPassword);

        // Issuing any code also purges other accounts' expired codes.
        Fixture.Factory.Clock.Set(issuedAt);
        await IssueResetAsync(Email);
        Fixture.Factory.Clock.Set(issuedAt.AddHours(24));
        await IssueResetAsync("other@example.test");
        (await ScalarAsync("SELECT count(*) FROM penny.password_resets", null)).ShouldBe(1L);
        (
            await ScalarAsync(
                "SELECT u.email FROM penny.password_resets r JOIN penny.users u ON u.id = r.user_id",
                null
            )
        ).ShouldBe("other@example.test");
    }

    [Fact]
    public async Task whenPasswordInvalid_PasswordReset_ShouldRejectWithoutConsumingCode()
    {
        await RegisterAsync(Email);
        var reset = await IssueResetAsync(Email);
        foreach (
            var body in new object[]
            {
                new { token = reset.Token },
                new { token = reset.Token, password = new string('x', 9) },
                new { token = reset.Token, password = new string('x', 257) },
                new { token = reset.Token, password = 1234567890 },
            }
        )
        {
            using var rejected = await ResetPasswordAsync(body);
            await AuthTests.ShouldBeErrorAsync(
                rejected,
                HttpStatusCode.BadRequest,
                PasswordResetService.InvalidPassword
            );
        }
        (await ScalarAsync("SELECT count(*) FROM penny.password_resets", null)).ShouldBe(1L);

        // The 256-unit limit is inclusive, and the code is still usable.
        var longest = new string('x', 256);
        using (
            var accepted = await ResetPasswordAsync(new { token = reset.Token, password = longest })
        )
            accepted.StatusCode.ShouldBe(HttpStatusCode.OK);
        await LoginAsync(Email, longest);
    }

    [Fact]
    public async Task whenCodeMalformedOrUnknown_PasswordReset_ShouldReturnOneGenericError()
    {
        await RegisterAsync(Email);
        var reset = await IssueResetAsync(Email);
        foreach (
            var body in new object[]
            {
                new { },
                new { password = NewPassword },
                new { token = reset.Token.ToUpperInvariant(), password = NewPassword },
                new { token = reset.Token[..63], password = NewPassword },
                new { token = reset.Token + "0", password = NewPassword },
                new { token = " " + reset.Token, password = NewPassword },
                new { token = SessionTokens.Create(), password = NewPassword },
                // A malformed code is reported before the password.
                new { token = "not-a-code", password = "short" },
                new { token = 42, password = NewPassword },
            }
        )
        {
            using var rejected = await ResetPasswordAsync(body);
            await AuthTests.ShouldBeErrorAsync(rejected, HttpStatusCode.BadRequest, Invalid);
        }
        // A session token is not a reset code.
        var session = await LoginAsync(Email, TestPassword);
        using (
            var swapped = await ResetPasswordAsync(new { token = session, password = NewPassword })
        )
            await AuthTests.ShouldBeErrorAsync(swapped, HttpStatusCode.BadRequest, Invalid);

        // Non-JSON bodies read as `{}`; malformed JSON keeps the shared message.
        using (
            var text = await Client.PostAsync(
                "/api/auth/password-reset",
                new StringContent(
                    $"{{\"token\":\"{reset.Token}\",\"password\":\"{NewPassword}\"}}",
                    Encoding.UTF8,
                    "text/plain"
                ),
                Ct
            )
        )
            await AuthTests.ShouldBeErrorAsync(text, HttpStatusCode.BadRequest, Invalid);
        using (
            var malformed = await Client.PostAsync(
                "/api/auth/password-reset",
                new StringContent("{\"token\":", Encoding.UTF8, "application/json"),
                Ct
            )
        )
            await AuthTests.ShouldBeErrorAsync(
                malformed,
                HttpStatusCode.BadRequest,
                "Invalid JSON."
            );

        // None of these consumed the real code.
        using var ok = await ResetPasswordAsync(
            new { token = reset.Token, password = NewPassword }
        );
        ok.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenSameCodeRedeemedConcurrently_PasswordReset_ShouldSucceedExactlyOnce()
    {
        await RegisterAsync(Email);
        var reset = await IssueResetAsync(Email);
        var passwords = Enumerable
            .Range(0, 6)
            .Select(index => $"concurrent password {index}")
            .ToArray();
        using var start = new SemaphoreSlim(0);
        var attempts = passwords
            .Select(async password =>
            {
                await start.WaitAsync(Ct);
                using var response = await ResetPasswordAsync(
                    new { token = reset.Token, password }
                );
                var error = response.IsSuccessStatusCode
                    ? null
                    : (await response.Content.ReadFromJsonAsync<ApiError>(Ct))!.Error;
                return (password, response.StatusCode, error);
            })
            .ToArray();
        start.Release(passwords.Length);
        var results = await Task.WhenAll(attempts);

        results.Count(result => result.StatusCode == HttpStatusCode.OK).ShouldBe(1);
        results
            .Where(result => result.StatusCode != HttpStatusCode.OK)
            .ShouldAllBe(result =>
                result.StatusCode == HttpStatusCode.BadRequest && result.error == Invalid
            );
        var winner = results.Single(result => result.StatusCode == HttpStatusCode.OK).password;
        await LoginAsync(Email, winner);
        (await ScalarAsync("SELECT count(*) FROM penny.password_resets", null)).ShouldBe(0L);
    }

    [Fact]
    public async Task whenOperatorInputInvalid_IssueReset_ShouldFailWithoutStoringCode()
    {
        await RegisterAsync(Email);
        var invalid = await Should.ThrowAsync<BackendFailure>(() =>
            IssueResetAsync("not-an-email")
        );
        invalid.Message.ShouldBe(PasswordResetService.InvalidEmail);
        var unknown = await Should.ThrowAsync<BackendFailure>(() =>
            IssueResetAsync("nobody@example.test")
        );
        unknown.Kind.ShouldBe(FailureKind.NotFound);
        (await ScalarAsync("SELECT count(*) FROM penny.password_resets", null)).ShouldBe(0L);
    }

    private async Task<string> LoginAsync(string email, string password)
    {
        using var response = await Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email, password },
            Ct
        );
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<JsonElement>(Ct))
            .GetProperty("token")
            .GetString()!;
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
}
