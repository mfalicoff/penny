using Npgsql;

namespace Penny.Backend.IntegrationTests.Infrastructure;

public sealed class RestoredDatabase(
    NpgsqlDataSource source,
    NpgsqlDataSource admin,
    string database
) : IAsyncDisposable
{
    public NpgsqlDataSource Source { get; } = source;

    public async ValueTask DisposeAsync()
    {
        await Source.DisposeAsync();
        // The name is generated internally from a fixed prefix and hexadecimal GUID.
        await using var command = admin.CreateCommand($"DROP DATABASE {database} WITH (FORCE)");
        await command.ExecuteNonQueryAsync(CancellationToken.None);
    }
}
