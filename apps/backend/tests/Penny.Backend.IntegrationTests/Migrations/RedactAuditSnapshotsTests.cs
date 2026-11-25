using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Migrations;
using Penny.Backend.Persistence.Schema;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

// Migration RedactAuditSnapshots (MAZ-189) on real rows: audit snapshots imported from
// the old SQLite database may still carry the payer's `accountId` or the receipt's
// `receipt.name`. The database is taken back to the migration before it (a fixture
// device, see PopulatedUpgradeTests), given such rows, and upgraded the way a release
// does it. All data is synthetic.
public sealed class RedactAuditSnapshotsTests(ApiFixture fixture) : SettlementTestBase(fixture)
{
    [Fact]
    public async Task whenStoredSnapshotsHavePrivateData_Migrate_ShouldRemoveOnlyThoseFields()
    {
        var (alex, alexId, bea, _, _, _, home) = await HomeAsync();
        await using (var context = PennyDbContext.Create(Fixture.Admin))
        {
            var migrations = context.Database.GetMigrations().ToList();
            // Later migrations are rolled back too and reapplied by the upgrade below.
            var redact = migrations.FindIndex(migration =>
                migration.EndsWith("_RedactAuditSnapshots", StringComparison.Ordinal)
            );
            redact.ShouldBeGreaterThan(0);
            await context.GetService<IMigrator>().MigrateAsync(migrations[redact - 1], Ct);
        }
        await Fixture.SqlAsync(
            $$$"""
            INSERT INTO penny.household_audit (id, household_id, expense_id, actor_id, action, before_json, after_json, created_at)
            VALUES
              ('legacy-1', '{{{home}}}', 'legacy-expense', '{{{alexId}}}', 'expense.updated',
               '{"title":"Old","accountId":"acct-secret","receiptId":"r9","receipt":{"id":"r9","name":"Secret.pdf","mime":"application/pdf"}}',
               '{"title":"New","accountId":"acct-secret","receipt":{"id":"r9","name":"Secret.pdf"}}',
               TIMESTAMPTZ '2026-09-28 12:30:00+00'),
              ('legacy-2', '{{{home}}}', 'legacy-expense', '{{{alexId}}}', 'expense.deleted',
               '{"title":"New","receipt":null,"note":"accountId"}', NULL,
               TIMESTAMPTZ '2026-09-28 12:31:00+00'),
              ('legacy-3', '{{{home}}}', 'legacy-expense', '{{{alexId}}}', 'expense.updated',
               '["accountId"]', 'null', TIMESTAMPTZ '2026-09-28 12:32:00+00');
            """,
            Ct
        );

        await DatabaseMigrator.ApplyAsync(Fixture.App, Ct);

        (await StoredAsync("legacy-1", "before_json")).ShouldBe(
            """{"title": "Old", "receipt": {"id": "r9", "mime": "application/pdf"}, "receiptId": "r9"}"""
        );
        (await StoredAsync("legacy-1", "after_json")).ShouldBe(
            """{"title": "New", "receipt": {"id": "r9"}}"""
        );
        // Nothing else changes: a null receipt, a value that only spells a field name,
        // and snapshots that aren't objects.
        (await StoredAsync("legacy-2", "before_json")).ShouldBe(
            """{"note": "accountId", "title": "New", "receipt": null}"""
        );
        (await StoredAsync("legacy-2", "after_json")).ShouldBeNull();
        (await StoredAsync("legacy-3", "before_json")).ShouldBe("""["accountId"]""");
        (await StoredAsync("legacy-3", "after_json")).ShouldBe("null");

        // The history reads the stored snapshots as they are, for every member.
        foreach (var token in new[] { alex, bea })
        {
            var events = await AuditAsync(home, token, "?expenseId=legacy-expense");
            events.Count.ShouldBe(3);
            var text = JsonSerializer.Serialize(events);
            text.ShouldNotContain("acct-secret");
            text.ShouldNotContain("Secret.pdf");
            events[^1].GetProperty("before").GetProperty("receiptId").GetString().ShouldBe("r9");
        }
    }

    private async Task<string?> StoredAsync(string id, string column) =>
        await ScalarAsync($"SELECT {column}::text FROM penny.household_audit WHERE id = '{id}'")
        as string;
}
