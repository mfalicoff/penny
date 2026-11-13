using System.Security.Cryptography;
using System.Text;
using Npgsql;

namespace Penny.Backend.Persistence.Migrations;

// `migrate --bootstrap` prepares a database as its administrator, so no initialization
// script has to be mounted into PostgreSQL: development/bootstrap.sql (embedded verbatim)
// creates the restricted roles, the penny schema and the extensions when missing, then
// both role passwords are set from the configured connection strings. Every run sets
// them again, so the configuration stays the source of truth and rotating a password is
// a configuration change. Only SCRAM-SHA-256 verifiers are sent, never the passwords.
public static class DatabaseBootstrap
{
    public const string ResourceName = "Penny.Backend.Persistence.bootstrap.sql";
    public const string MigrationRole = "penny_migrator";
    public const string RuntimeRole = "penny_runtime";
    private const int ScramIterations = 4096;

    public static string Sql()
    {
        using var stream =
            typeof(DatabaseBootstrap).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException("The bootstrap script is missing.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    public static async Task ApplyAsync(
        NpgsqlDataSource administrator,
        string migrationPassword,
        string runtimePassword,
        CancellationToken cancellationToken
    )
    {
        ArgumentException.ThrowIfNullOrEmpty(migrationPassword);
        ArgumentException.ThrowIfNullOrEmpty(runtimePassword);
        await using var connection = await administrator.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        // Two bootstraps at once would race on CREATE ROLE; the second waits instead.
        await using (
            var command = new NpgsqlCommand(
                "SELECT pg_advisory_xact_lock(hashtext('penny-bootstrap'))",
                connection,
                transaction
            )
        )
            await command.ExecuteNonQueryAsync(cancellationToken);
        await using (var command = new NpgsqlCommand(Sql(), connection, transaction))
            await command.ExecuteNonQueryAsync(cancellationToken);
        await SetPasswordAsync(
            connection,
            transaction,
            MigrationRole,
            migrationPassword,
            cancellationToken
        );
        await SetPasswordAsync(
            connection,
            transaction,
            RuntimeRole,
            runtimePassword,
            cancellationToken
        );
        await transaction.CommitAsync(cancellationToken);
    }

    private static async Task SetPasswordAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string role,
        string password,
        CancellationToken cancellationToken
    )
    {
        // ALTER ROLE takes no bind parameters: the server quotes the verifier itself.
        string statement;
        await using (
            var format = new NpgsqlCommand(
                "SELECT format('ALTER ROLE %I PASSWORD %L', @role, @verifier)",
                connection,
                transaction
            )
        )
        {
            format.Parameters.AddWithValue("role", role);
            format.Parameters.AddWithValue("verifier", ScramVerifier(password));
            statement = (string)(await format.ExecuteScalarAsync(cancellationToken))!;
        }
        await using var alter = new NpgsqlCommand(statement, connection, transaction);
        await alter.ExecuteNonQueryAsync(cancellationToken);
    }

    // PostgreSQL's stored form (RFC 5802/7677): SCRAM-SHA-256$iterations:salt$StoredKey:ServerKey.
    public static string ScramVerifier(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var salted = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password),
            salt,
            ScramIterations,
            HashAlgorithmName.SHA256,
            32
        );
        var storedKey = SHA256.HashData(HMACSHA256.HashData(salted, "Client Key"u8));
        var serverKey = HMACSHA256.HashData(salted, "Server Key"u8);
        return $"SCRAM-SHA-256${ScramIterations}:{Convert.ToBase64String(salt)}${Convert.ToBase64String(storedKey)}:{Convert.ToBase64String(serverKey)}";
    }
}
