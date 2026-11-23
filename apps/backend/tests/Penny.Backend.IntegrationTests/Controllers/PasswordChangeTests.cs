using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Penny.Backend.Application.Authentication;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Signed-in password changes (MAZ-171): the current password must verify, the new one
// follows the sign-up rule, other sessions end and this one stays.
public sealed class PasswordChangeTests(ApiFixture fixture) : HouseholdTestBase(fixture)
{
    private const string NewPassword = "a different test password";

    [Fact]
    public async Task whenCurrentPasswordVerifies_ChangePassword_ShouldKeepThisSessionAndEndTheOthers()
    {
        var at = new DateTimeOffset(2026, 11, 20, 9, 30, 0, TimeSpan.Zero);
        At(at);
        var (token, _) = await AccountAsync("change@example.test");
        var other = await LoginAsync("change@example.test", TestPassword);
        (await ExpectAsync(HttpMethod.Get, "/api/profile", token, HttpStatusCode.OK))
            .TryGetProperty("passwordChangedAt", out _)
            .ShouldBeFalse();

        await ExpectAsync(
            HttpMethod.Post,
            "/api/auth/password",
            token,
            HttpStatusCode.OK,
            new { currentPassword = TestPassword, newPassword = NewPassword }
        );

        (await ExpectAsync(HttpMethod.Get, "/api/profile", token, HttpStatusCode.OK))
            .GetProperty("passwordChangedAt")
            .GetInt64()
            .ShouldBe(at.ToUnixTimeMilliseconds());
        await ExpectErrorAsync(
            HttpMethod.Get,
            "/api/auth/me",
            other,
            HttpStatusCode.Unauthorized,
            AuthService.SignInRequired
        );
        using (
            var old = await Client.PostAsJsonAsync(
                "/api/auth/login",
                new { email = "change@example.test", password = TestPassword },
                Ct
            )
        )
            old.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await LoginAsync("change@example.test", NewPassword)).ShouldNotBeNullOrEmpty();
    }

    [Fact]
    public async Task whenCurrentPasswordWrong_ChangePassword_ShouldReturnBadRequestAndChangeNothing()
    {
        var (token, _) = await AccountAsync("wrong@example.test");
        var other = await LoginAsync("wrong@example.test", TestPassword);

        await ExpectErrorAsync(
            HttpMethod.Post,
            "/api/auth/password",
            token,
            HttpStatusCode.BadRequest,
            AuthService.WrongCurrentPassword,
            new { currentPassword = "not the password", newPassword = NewPassword }
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            "/api/auth/password",
            token,
            HttpStatusCode.BadRequest,
            AuthService.WrongCurrentPassword,
            new { newPassword = NewPassword }
        );

        // The mistake ends no session, and the old password still signs in.
        await ExpectAsync(HttpMethod.Get, "/api/auth/me", token, HttpStatusCode.OK);
        await ExpectAsync(HttpMethod.Get, "/api/auth/me", other, HttpStatusCode.OK);
        (await LoginAsync("wrong@example.test", TestPassword)).ShouldNotBeNullOrEmpty();
    }

    [Theory]
    [InlineData("short")]
    [InlineData("")]
    [InlineData(null)]
    public async Task whenNewPasswordBreaksRules_ChangePassword_ShouldReturnBadRequest(
        string? newPassword
    )
    {
        var (token, _) = await AccountAsync("weak@example.test");

        await ExpectErrorAsync(
            HttpMethod.Post,
            "/api/auth/password",
            token,
            HttpStatusCode.BadRequest,
            AuthService.InvalidNewPassword,
            new { currentPassword = TestPassword, newPassword }
        );

        (await LoginAsync("weak@example.test", TestPassword)).ShouldNotBeNullOrEmpty();
    }

    [Fact]
    public async Task whenSignedOut_ChangePassword_ShouldReturnUnauthorized()
    {
        using var response = await Client.PostAsJsonAsync(
            "/api/auth/password",
            new { currentPassword = TestPassword, newPassword = NewPassword },
            Ct
        );
        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
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
}
