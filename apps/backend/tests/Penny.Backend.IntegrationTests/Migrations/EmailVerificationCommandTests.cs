using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Penny.Backend.Application.Authentication;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Migrations;
using Penny.Backend.Persistence.Schema;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

// The `verify-email` operator command and the backfill that marks existing accounts
// verified (MAZ-172).
public sealed class EmailVerificationCommandTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    private const string PreviousMigration = "20261123032002_AddEmailDelivery";

    [Fact]
    public async Task whenAccountUnverified_EmailVerificationCommand_ShouldMarkItVerifiedOnce()
    {
        await RegisterAsync("person@example.test");
        (await VerifiedAsync("person@example.test")).ShouldBeFalse();

        var first = await RunAsync(["verify-email", " Person@Example.TEST "]);
        first.ExitCode.ShouldBe(0, first.Error);
        first.Output.ShouldBeEmpty();
        first.Error.ShouldContain("Marked the account's email as verified.");
        first.Error.ShouldNotContain("person@example.test");
        first.Error.ShouldNotContain(Fixture.Connection);
        (await VerifiedAsync("person@example.test")).ShouldBeTrue();

        var again = await RunAsync(["verify-email", "person@example.test"]);
        again.ExitCode.ShouldBe(0, again.Error);
        again.Error.ShouldContain("already verified");
    }

    [Fact]
    public async Task whenEmailUnknownOrInvalid_EmailVerificationCommand_ShouldFail()
    {
        await RegisterAsync("person@example.test");
        foreach (
            var (arguments, message) in new (string[], string)[]
            {
                (["verify-email", "nobody@example.test"], EmailVerificationService.UnknownEmail),
                (["verify-email", "not-an-email"], PasswordResetService.InvalidEmail),
                (["verify-email"], "Usage: verify-email EMAIL"),
                (["verify-email", "person@example.test", "extra"], "Usage: verify-email EMAIL"),
            }
        )
        {
            var result = await RunAsync(arguments);
            result.ExitCode.ShouldBe(1);
            result.Output.ShouldBeEmpty();
            result.Error.ShouldContain(message);
        }
        var unconfigured = await MaintenanceProcess.RunAsync(
            null,
            ["verify-email", "person@example.test"],
            Ct,
            new Dictionary<string, string> { ["ConnectionStrings__Postgres"] = "" }
        );
        unconfigured.ExitCode.ShouldBe(1);
        unconfigured.Error.ShouldContain("ConnectionStrings__Postgres");
        (await VerifiedAsync("person@example.test")).ShouldBeFalse();
    }

    [Fact]
    public async Task whenAccountsExistBeforeVerification_Migration_ShouldMarkThemVerified()
    {
        await Fixture.SqlAsync("DROP SCHEMA penny CASCADE", Ct);
        await using (var context = PennyDbContext.Create(Fixture.App))
            await context.GetService<IMigrator>().MigrateAsync(PreviousMigration, Ct);
        await Fixture.SqlAsync(
            """
            INSERT INTO penny.users (id, email, password) VALUES
              ('user-password', 'person@example.test', 'hash'),
              ('user-provider', 'provider@example.test', '');
            """,
            Ct
        );
        await DatabaseMigrator.ApplyAsync(Fixture.App, Ct);
        await using var command = Fixture.Admin.CreateCommand(
            "SELECT count(*) FROM penny.users WHERE email_verified_at IS NOT NULL"
        );
        (await command.ExecuteScalarAsync(Ct)).ShouldBe(2L);
    }

    private Task<(int ExitCode, string Output, string Error)> RunAsync(string[] arguments) =>
        MaintenanceProcess.RunAsync(
            null,
            arguments,
            Ct,
            new Dictionary<string, string> { ["ConnectionStrings__Postgres"] = Fixture.Connection }
        );

    private async Task<bool> VerifiedAsync(string email)
    {
        await using var command = Fixture.Admin.CreateCommand(
            $"SELECT email_verified_at IS NOT NULL FROM penny.users WHERE email = '{email}'"
        );
        return (bool)(await command.ExecuteScalarAsync(Ct))!;
    }
}
