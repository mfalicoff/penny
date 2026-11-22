using System.Net.Sockets;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Persistence.Migrations;
using Penny.Backend.Persistence.Schema;
using Shouldly;
using Xunit;

namespace Penny.Backend.UnitTests.Configuration;

public sealed class MigrationFailureTests
{
    private const string Secret = "never-print-this";

    [Fact]
    public void whenSchemaNewer_Describe_ShouldKeepPennysMessage()
    {
        var reason = MigrationFailure.Describe(
            new DatabaseSetupException(
                "Database schema is newer than this build. No migration was applied."
            )
        );
        reason.ShouldBe(
            "DatabaseSetupException: Database schema is newer than this build. No migration was applied."
        );
    }

    [Fact]
    public void whenExtensionsMissing_Describe_ShouldKeepPennysMessage() =>
        MigrationFailure
            .Describe(new DatabaseSetupException(SearchExtensions.Missing))
            .ShouldBe($"DatabaseSetupException: {SearchExtensions.Missing}");

    [Fact]
    public void whenLockHeld_Describe_ShouldNameTheLock() =>
        MigrationFailure
            .Describe(new MigrationLockedException())
            .ShouldBe(
                "MigrationLockedException: Another database migration holds the lock. Retry after it completes."
            );

    [Theory]
    [InlineData("28P01", "invalid_password")]
    [InlineData("42501", "insufficient_privilege")]
    [InlineData("3D000", "invalid_catalog_name")]
    [InlineData("57P03", "cannot_connect_now")]
    [InlineData("42P99", "syntax error or access rule violation")]
    [InlineData("ZZ999", "unknown")]
    public void whenPostgresFails_Describe_ShouldGiveSqlStateWithoutServerText(
        string sqlState,
        string condition
    )
    {
        var reason = MigrationFailure.Describe(
            new PostgresException($"value {Secret} rejected", "ERROR", "ERROR", sqlState)
        );
        reason.ShouldBe($"PostgresException: SQLSTATE {sqlState} ({condition})");
        reason.ShouldNotContain(Secret);
    }

    [Fact]
    public void whenEfWrapsPostgres_Describe_ShouldFindTheSqlState()
    {
        var reason = MigrationFailure.Describe(
            new DbUpdateException(
                $"An error occurred while saving {Secret}.",
                new PostgresException($"Key (id)=({Secret}) exists", "ERROR", "ERROR", "23505")
            )
        );
        reason.ShouldBe("DbUpdateException: SQLSTATE 23505 (unique_violation)");
    }

    [Fact]
    public void whenServerUnreachable_Describe_ShouldGiveNpgsqlMessageAndSocketError()
    {
        var reason = MigrationFailure.Describe(
            new NpgsqlException(
                "Failed to connect to 127.0.0.1:5433",
                new SocketException((int)SocketError.ConnectionRefused)
            )
        );
        reason.ShouldBe(
            "NpgsqlException: Failed to connect to 127.0.0.1:5433 (socket error ConnectionRefused)"
        );
    }

    [Fact]
    public void whenForeignInvalidOperation_Describe_ShouldGiveTypeOnly() =>
        MigrationFailure
            .Describe(new InvalidOperationException($"Password={Secret}"))
            .ShouldBe("InvalidOperationException");

    [Fact]
    public void whenIoFails_Describe_ShouldGiveTypeOnly() =>
        MigrationFailure.Describe(new IOException($"/secret/{Secret}")).ShouldBe("IOException");

    [Fact]
    public void whenTimedOut_Describe_ShouldSaySo() =>
        MigrationFailure
            .Describe(new TimeoutException(Secret))
            .ShouldBe("TimeoutException: timed out");

    [Fact]
    public void whenCancelled_Describe_ShouldSaySo() =>
        MigrationFailure
            .Describe(new OperationCanceledException())
            .ShouldBe("OperationCanceledException: cancelled");
}
