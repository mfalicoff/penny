using Npgsql;

namespace Penny.Backend.Persistence.Migrations;

// Brings a database last migrated before the EF migrations were squashed into
// `20261113183852_InitialSchema` onto the squashed history, so `migrate` upgrades it with
// no manual step. Such a database lists exactly the seven old migrations below; any other
// history is left to the normal checks. The upgrade runs in one transaction while
// `migrate` holds the migration advisory lock: it removes the retired push provider's
// devices, deliveries and columns, the one-time import's checkpoint table and the unused
// `users.salt` column, then replaces the history with the squashed migration. The result
// matches a database created by the squashed `InitialSchema` (MigrationTests).
public static class PreSquashUpgrade
{
    public const string SquashedMigration = "20261113183852_InitialSchema";

    internal static readonly string[] History =
    [
        "20261108152101_InitialSchema",
        "20261108163050_AddOidcAttempts",
        "20261108200954_AddPasswordResets",
        "20261109015841_AddSearchDocuments",
        "20261109222927_AddApnsPushDelivery",
        "20261111135519_AddReceiptEncryptionVersion",
        "20261112020756_AddReceiptTexts",
    ];

    internal static bool Applies(IEnumerable<string> applied) =>
        applied.Order(StringComparer.Ordinal).SequenceEqual(History, StringComparer.Ordinal);

    // The caller holds the migration advisory lock. The history is checked again inside the
    // transaction, so a concurrent change rolls everything back.
    internal static async Task ApplyAsync(NpgsqlConnection connection, CancellationToken ct)
    {
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await using (var check = new NpgsqlCommand(CheckHistory, connection, transaction))
        {
            check.Parameters.Add(new NpgsqlParameter<string[]> { TypedValue = History });
            if (await check.ExecuteScalarAsync(ct) is not true)
                throw new InvalidOperationException(
                    "Migration history changed during the upgrade. No migration was applied."
                );
        }
        await using (var upgrade = new NpgsqlCommand(Upgrade, connection, transaction))
        {
            upgrade.CommandTimeout = 300;
            await upgrade.ExecuteNonQueryAsync(ct);
        }
        await transaction.CommitAsync(ct);
    }

    private const string CheckHistory = """
        SELECT ARRAY(
            SELECT "MigrationId"::text FROM penny."__EFMigrationsHistory" ORDER BY 1
        ) = $1
        """;

    private const string Upgrade = """
        -- Retired push provider: its deliveries, deliveries to its devices, then the devices.
        DELETE FROM penny.push_deliveries
         WHERE provider = 'expo'
            OR token IN (SELECT token FROM penny.push_devices WHERE provider = 'expo');
        DELETE FROM penny.push_devices WHERE provider = 'expo';

        -- push_deliveries: drop that provider's receipt columns, their lease, index and checks.
        DROP INDEX penny.ix_push_deliveries_receipts;
        ALTER TABLE penny.push_deliveries
          DROP CONSTRAINT ck_push_deliveries_lease,
          DROP CONSTRAINT ck_push_deliveries_provider,
          DROP COLUMN receipt_checked_at,
          DROP COLUMN lease_owner,
          DROP COLUMN lease_token,
          DROP COLUMN lease_expires_at,
          DROP COLUMN provider;

        -- push_devices: APNs on iOS only, no default provider, environment required.
        ALTER TABLE penny.push_devices
          DROP CONSTRAINT ck_push_devices_platform,
          DROP CONSTRAINT ck_push_devices_provider,
          ALTER COLUMN provider DROP DEFAULT,
          ALTER COLUMN environment SET NOT NULL,
          ADD CONSTRAINT ck_push_devices_platform CHECK (platform = 'ios'),
          ADD CONSTRAINT ck_push_devices_provider
            CHECK (provider = 'apns' AND environment IN ('sandbox','production'));

        -- The one-time import's checkpoint table.
        DROP TABLE penny.sqlite_import;

        -- users: the unused salt column.
        ALTER TABLE penny.users DROP COLUMN salt;

        -- One squashed migration replaces the seven.
        DELETE FROM penny."__EFMigrationsHistory";
        INSERT INTO penny."__EFMigrationsHistory" ("MigrationId", "ProductVersion")
        VALUES ('20261113183852_InitialSchema', '10.0.14');
        """;
}
