using System.Text.Json;
using Microsoft.Data.Sqlite;
using Penny.Backend.Persistence.Import;

namespace Penny.Backend.IntegrationTests.Infrastructure;

internal sealed class LegacyDatabase : IDisposable
{
    private readonly string directory = System.IO.Path.Combine(
        System.IO.Path.GetTempPath(),
        "penny-import-" + Guid.NewGuid().ToString("N")
    );
    private readonly SqliteConnection connection;
    public string Path { get; }
    public string SnapshotPath { get; private set; } = "";
    public string Sha256 { get; private set; } = "";
    public static byte[] ReceiptBytes => [0x25, 0x50, 0x44, 0x46, 0, 1, 127, 128, 255];

    public LegacyDatabase(int ledgerVersion = 4)
    {
        Directory.CreateDirectory(directory);
        Path = System.IO.Path.Combine(directory, "source.sqlite");
        connection = new SqliteConnection(
            new SqliteConnectionStringBuilder { DataSource = Path, Pooling = false }.ToString()
        );
        connection.Open();
        using var stream = typeof(LegacyDatabase).Assembly.GetManifestResourceStream(
            "Penny.Backend.IntegrationTests.Fixtures.legacy-schema-v2.sql"
        )!;
        using var reader = new StreamReader(stream);
        Execute(reader.ReadToEnd());
        Execute(
            """
            PRAGMA foreign_keys=ON;
            INSERT INTO users VALUES('legacy:user-01','Case@example.test','synthetic-password-hash','synthetic-salt');
            INSERT INTO users VALUES('oidc-user','case@example.test','','0123456789abcdef');
            INSERT INTO oidc_identities VALUES('https://issuer.example.test','subject-01','oidc-user');
            INSERT INTO sessions VALUES('synthetic-session-hash','legacy:user-01',1793577600123);
            INSERT INTO households VALUES('h','Café 東京','CAD','legacy:user-01',1700000000001,NULL);
            INSERT INTO household_trips VALUES('h','2024-02-29','2024-03-01');
            INSERT INTO household_members VALUES('h','legacy:user-01',1700000000001,NULL);
            INSERT INTO household_members VALUES('h','oidc-user',1700000000001,1700000000002);
            INSERT INTO household_member_periods VALUES('p1','h','legacy:user-01',1700000000001,NULL,NULL);
            INSERT INTO household_member_periods VALUES('p2','h','oidc-user',1700000000001,'2024-02-29',1700000000002);
            INSERT INTO household_invites VALUES('synthetic-invite-hash','h',1793577600123,NULL);
            INSERT INTO household_expenses VALUES('e','h','Historical purchase',10000,'2024-02-29','legacy:user-01','equal','{"name":"Food","icon":"cafe","color":"#ABCDEF"}','é é 👩‍👩‍👧‍👦',NULL,NULL,7,'legacy:user-01',1700000000001,'legacy:user-01',1700000000001,NULL,'deleted-recurring-rule');
            INSERT INTO household_splits VALUES('e','legacy:user-01',5000);
            INSERT INTO household_splits VALUES('e','oidc-user',5000);
            INSERT INTO household_reimbursements VALUES('payment','h','2024-02','oidc-user','legacy:user-01',5000,'legacy:user-01',1700000000001,'e');
            INSERT INTO household_audit VALUES('z-first','h','e','legacy:user-01','expense.created',NULL,'{"note":null,"amount":99999999999}',1700000000001);
            INSERT INTO household_audit VALUES('a-second','h','e','legacy:user-01','expense.updated','{"old":true}','{"new":true}',1700000000001);
            INSERT INTO household_recurring VALUES('rule','h','Rent',10000,'legacy:user-01','percent','[{"userId":"legacy:user-01","percentBasisPoints":6000},{"userId":"oidc-user","percentBasisPoints":4000}]','{"name":"Home","icon":"home","color":"#ABCDEF"}','',NULL,NULL,'monthly','2024-02-29',31,1,'legacy:user-01',12);
            INSERT INTO push_devices VALUES('synthetic-device-token','legacy:user-01','synthetic-session-hash','ios',1700000000001);
            INSERT INTO push_outbox VALUES('event','legacy:user-01','h','expense.created','e','{"expenseId":"e","optional":null}',1700000000001,NULL,2,1700000000002,NULL);
            INSERT INTO push_deliveries VALUES('event','synthetic-device-token',NULL,1,1700000000002,'ticket',NULL);
            """
        );
        using (var receipt = connection.CreateCommand())
        {
            receipt.CommandText =
                "INSERT INTO receipts VALUES('receipt','legacy:user-01','synthetic.pdf','application/pdf',@bytes)";
            receipt.Parameters.AddWithValue("bytes", ReceiptBytes);
            receipt.ExecuteNonQuery();
        }
        var ledger = JsonSerializer.Serialize(
            new
            {
                version = ledgerVersion,
                currency = "CAD",
                accounts = new[]
                {
                    new
                    {
                        id = "bank",
                        name = "Bank",
                        type = "bank",
                    },
                },
                trips = new[]
                {
                    new
                    {
                        id = "trip",
                        name = "Tokyo",
                        startDate = "2024-02-28",
                        endDate = "2024-03-02",
                        sharedHouseholdId = "h",
                    },
                },
                categories = new[]
                {
                    new
                    {
                        id = "food",
                        name = "Café",
                        icon = "cafe",
                        color = "#ABCDEF",
                        kind = "expense",
                    },
                },
                transactions = new[]
                {
                    new
                    {
                        id = "entry",
                        title = "Synthetic",
                        kind = "expense",
                        total = 99999999999L,
                        share = 99999999998L,
                        categoryId = "food",
                        accountId = "bank",
                        tripId = "trip",
                        date = "2024-02-29",
                        note = "東京 é",
                        receipt = new
                        {
                            id = "receipt",
                            name = "synthetic.pdf",
                            mime = "application/pdf",
                            uri = "/api/receipts/receipt",
                        },
                    },
                },
                recurring = new[]
                {
                    new
                    {
                        id = "rent",
                        title = "Rent",
                        kind = "expense",
                        total = 100000L,
                        share = 100000L,
                        categoryId = "food",
                        accountId = "bank",
                        date = "2024-01-01",
                        note = "",
                        frequency = "monthly",
                        nextDate = "2024-03-01",
                        anchorDay = 1,
                        active = true,
                    },
                },
            }
        );
        using var ledgers = connection.CreateCommand();
        ledgers.CommandText =
            "INSERT INTO ledgers VALUES('legacy:user-01',9007199254740990,@ledger); INSERT INTO ledgers VALUES('oidc-user',0,@empty)";
        ledgers.Parameters.AddWithValue("ledger", ledger);
        ledgers.Parameters.AddWithValue(
            "empty",
            """{"version":4,"currency":"CAD","accounts":[],"trips":[],"categories":[],"transactions":[],"recurring":[]}"""
        );
        ledgers.ExecuteNonQuery();
    }

    public void Execute(string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    public void Seal()
    {
        SnapshotPath = System.IO.Path.Combine(directory, Guid.NewGuid().ToString("N") + ".sqlite");
        Sha256 = SqliteSnapshot.Create(Path, SnapshotPath);
    }

    public void Dispose()
    {
        connection.Dispose();
        Directory.Delete(directory, recursive: true);
    }
}
