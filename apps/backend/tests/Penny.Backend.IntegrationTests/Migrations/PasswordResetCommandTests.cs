using System.Net;
using Penny.Backend.Application.Authentication;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

public sealed class PasswordResetCommandTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    [Fact]
    public async Task whenAccountExists_PasswordResetCommand_ShouldPrintOnlyTheCodeAndStoreItsHash()
    {
        await RegisterAsync("person@example.test");
        var first = await RunAsync(" Person@Example.TEST ");
        first.ExitCode.ShouldBe(0, first.Error);
        var token = first.Output.TrimEnd('\n', '\r');
        // stdout carries exactly one line: the code, for piping to the delivery channel.
        SessionTokens.IsWellFormed(token).ShouldBeTrue(first.Output);
        first.Error.ShouldContain("expires at");
        first.Error.ShouldNotContain(token);
        first.Error.ShouldNotContain(SessionTokens.Hash(token));
        first.Error.ShouldNotContain(Fixture.RuntimeConnection);
        first.Error.ShouldNotContain("Password=");
        (await ScalarAsync("SELECT token_hash FROM penny.password_resets")).ShouldBe(
            SessionTokens.Hash(token)
        );

        // Running it again supersedes the first code.
        var second = await RunAsync("person@example.test");
        second.ExitCode.ShouldBe(0, second.Error);
        var current = second.Output.Trim();
        current.ShouldNotBe(token);
        using (var stale = await ResetPasswordAsync(new { token, password = "a new password!" }))
            stale.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        using var redeemed = await ResetPasswordAsync(
            new { token = current, password = "a new password!" }
        );
        redeemed.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenEmailUnknownOrInvalid_PasswordResetCommand_ShouldFailWithoutIssuingCode()
    {
        await RegisterAsync("person@example.test");
        foreach (
            var (arguments, message) in new (string[], string)[]
            {
                (["reset-password", "nobody@example.test"], PasswordResetService.UnknownEmail),
                (["reset-password", "not-an-email"], PasswordResetService.InvalidEmail),
                (["reset-password"], "Usage: reset-password EMAIL"),
                (["reset-password", "person@example.test", "extra"], "Usage: reset-password EMAIL"),
            }
        )
        {
            var result = await MaintenanceProcess.RunAsync(
                null,
                arguments,
                Ct,
                new Dictionary<string, string>
                {
                    ["ConnectionStrings__Postgres"] = Fixture.RuntimeConnection,
                }
            );
            result.ExitCode.ShouldBe(1);
            result.Output.ShouldBeEmpty();
            result.Error.ShouldContain(message);
        }
        var unconfigured = await MaintenanceProcess.RunAsync(
            null,
            ["reset-password", "person@example.test"],
            Ct,
            new Dictionary<string, string> { ["ConnectionStrings__Postgres"] = "" }
        );
        unconfigured.ExitCode.ShouldBe(1);
        unconfigured.Output.ShouldBeEmpty();
        unconfigured.Error.ShouldContain("ConnectionStrings__Postgres");
        (await ScalarAsync("SELECT count(*) FROM penny.password_resets")).ShouldBe(0L);
    }

    private Task<(int ExitCode, string Output, string Error)> RunAsync(string email) =>
        MaintenanceProcess.RunAsync(
            null,
            ["reset-password", email],
            Ct,
            new Dictionary<string, string>
            {
                ["ConnectionStrings__Postgres"] = Fixture.RuntimeConnection,
            }
        );

    private async Task<object?> ScalarAsync(string sql)
    {
        await using var command = Fixture.Admin.CreateCommand(sql);
        return await command.ExecuteScalarAsync(Ct);
    }
}
