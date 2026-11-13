using Npgsql;

namespace Penny.Backend.Persistence.Migrations;

// MAZ-63: `migrate --grant-runtime` applies development/grant-runtime.sql (embedded
// verbatim, so the file stays the single source) as the schema owner right after the
// migration, in one transaction. It is idempotent and grants only to `penny_runtime`.
public static class RuntimeGrants
{
    public const string ResourceName = "Penny.Backend.Persistence.grant-runtime.sql";

    public static string Sql()
    {
        using var stream =
            typeof(RuntimeGrants).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException("The runtime grant script is missing.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    public static async Task ApplyAsync(
        NpgsqlDataSource source,
        CancellationToken cancellationToken
    )
    {
        await using var connection = await source.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using (var command = new NpgsqlCommand(Sql(), connection, transaction))
            await command.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }
}
