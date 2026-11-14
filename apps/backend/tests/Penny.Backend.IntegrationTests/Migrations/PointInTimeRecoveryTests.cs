using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

// MAZ-64 recovery rehearsal. Recovery is forward-only: a PostgreSQL base backup plus archived WAL, replayed to a point
// in time, together with the receipt root (docs/reference/postgresql.md#forward-only-recovery).
// The rehearsal takes a base backup, accepts more writes through the API (the
// writes a dump alone would lose), marks a restore point, then makes
// "incident" writes. A second PostgreSQL instance in the same container recovers to
// the restore point, and a new API host over it must keep every accepted write,
// none of the incident writes, working sessions and decryptable receipts.
public sealed class PointInTimeRecoveryTests(ApiFixture fixture) : SharedExpenseTestBase(fixture)
{
    private const string Base = "/var/lib/postgresql/drill-base";
    private const string Recovered = "/var/lib/postgresql/drill-recovered";
    private const string PgCtl = "/usr/lib/postgresql/18/bin/pg_ctl";
    private const string RestorePoint = "penny-drill";

    [Fact]
    public async Task whenWritesFollowBaseBackup_PointInTimeRecovery_ShouldRestoreAcceptedWritesOnly()
    {
        try
        {
            await RehearseAsync();
        }
        finally
        {
            await CleanUpAsync();
        }
    }

    private async Task RehearseAsync()
    {
        At(Noon);
        var alex = await AccountAsync("alex.recovery@example.test");
        var sam = await AccountAsync("sam.recovery@example.test");
        await SaveEntryAsync(alex.Token, "before-backup");
        var home = Id(await CreateHouseholdAsync(alex.Token, "Recovery home"));
        await AdmitAsync(home, alex.Token, sam.Token);
        var kept = await CreateExpenseAsync(home, alex.Token, Expense(3000, alex.UserId));

        // Base backup with archiving on: the starting point of recovery.
        await Shell(
            $"mkdir -p {ApiFixture.WalArchive} && chown postgres:postgres {ApiFixture.WalArchive}"
        );
        await Shell(
            $"gosu postgres pg_basebackup --username=foundation_admin --pgdata={Base} --wal-method=stream --checkpoint=fast"
        );

        // Writes accepted after the backup must survive.
        await SaveEntryAsync(alex.Token, "after-backup");
        var accepted = await CreateExpenseAsync(
            home,
            sam.Token,
            Expense(5000, sam.UserId, extra: new { title = "Accepted after backup" })
        );
        var receipt = Id(
            await ExpectAsync(
                HttpMethod.Post,
                "/api/receipts",
                alex.Token,
                HttpStatusCode.Created,
                new
                {
                    name = "Recovery.pdf",
                    mime = "application/pdf",
                    base64 = Convert.ToBase64String("%PDF-1.7\nrecovery"u8.ToArray()),
                }
            )
        );
        var restoreLsn = (string)
            (await ScalarAsync($"SELECT pg_create_restore_point('{RestorePoint}')::text"))!;

        // The incident: writes after the restore point that recovery must discard.
        await SaveEntryAsync(alex.Token, "after-incident");
        await ExpectAsync(
            HttpMethod.Delete,
            ExpensePath(home, Id(kept)),
            alex.Token,
            HttpStatusCode.OK,
            new { revision = kept.GetProperty("revision").GetInt64() }
        );

        // Close the segment holding the restore point and wait until it is archived.
        await ScalarAsync("SELECT pg_switch_wal()::text");
        var needed = (string)(await ScalarAsync($"SELECT pg_walfile_name('{restoreLsn}')"))!;
        await WaitForArchiveAsync(needed);

        // Recover a copy of the base backup to the restore point on the recovery port.
        await Shell(
            string.Join(
                " && ",
                $"gosu postgres cp -a {Base} {Recovered}",
                $"rm -f {Recovered}/postmaster.pid",
                $"printf \"%s\\n\" \"port = {ApiFixture.RecoveryPort}\" \"archive_mode = off\" \"restore_command = 'cp {ApiFixture.WalArchive}/%f %p'\" \"recovery_target_name = '{RestorePoint}'\" \"recovery_target_action = 'promote'\" | gosu postgres tee -a {Recovered}/postgresql.auto.conf > /dev/null",
                $"gosu postgres touch {Recovered}/recovery.signal",
                $"gosu postgres {PgCtl} --pgdata={Recovered} --log={Recovered}/recovery.log --wait --timeout=120 start"
            )
        );
        await WaitForPromotionAsync();

        await using var recovered = new TestApiFactory(
            Fixture.RecoveredConnection(Fixture.RuntimeConnection),
            new Dictionary<string, string>
            {
                ["Receipts:Root"] = Fixture.ReceiptRoot,
                ["Receipts:MasterKey"] = Fixture.ReceiptKey,
            }
        );
        recovered.Clock.Set(Noon.AddHours(1));
        using var client = CreateClient(recovered);

        await ReadAsync(client, "/api/ready", null);
        (await ReadAsync(client, "/api/auth/me", sam.Token))
            .GetProperty("email")
            .GetString()
            .ShouldBe("sam.recovery@example.test", "sessions are recovered with the data");
        (await ReadAsync(client, "/api/ledger", alex.Token))
            .GetProperty("ledger")
            .GetProperty("transactions")
            .EnumerateArray()
            .Select(entry => entry.GetProperty("id").GetString())
            .Order(StringComparer.Ordinal)
            .ShouldBe(["after-backup", "before-backup"]);
        var expenses = (await ReadAsync(client, ExpensesPath(home) + "?month=2026-09", alex.Token))
            .GetProperty("expenses")
            .EnumerateArray()
            .Select(Id)
            .Order(StringComparer.Ordinal)
            .ToList();
        expenses.ShouldBe(
            new[] { Id(kept), Id(accepted) }.Order(StringComparer.Ordinal).ToList(),
            "the accepted expense is back and the incident deletion is undone"
        );
        using var download = await client.SendAsync(
            Authorized(HttpMethod.Get, "/api/receipts/" + receipt, bearer: alex.Token),
            Ct
        );
        download.StatusCode.ShouldBe(HttpStatusCode.OK, "the receipt root backup matches");
    }

    private async Task WaitForArchiveAsync(string segment)
    {
        for (var attempt = 0; attempt < 100; attempt++)
        {
            var archived =
                await ScalarAsync("SELECT coalesce(last_archived_wal, '') FROM pg_stat_archiver")
                as string;
            if (string.CompareOrdinal(archived, segment) >= 0)
                return;
            await Task.Delay(100, Ct);
        }
        throw new ShouldAssertException($"WAL segment {segment} was not archived.");
    }

    private async Task WaitForPromotionAsync()
    {
        var connection = Fixture.RecoveredConnection(Fixture.AdminConnection);
        for (var attempt = 0; attempt < 100; attempt++)
        {
            try
            {
                await using var source = Npgsql.NpgsqlDataSource.Create(connection);
                await using var command = source.CreateCommand("SELECT pg_is_in_recovery()");
                if (await command.ExecuteScalarAsync(Ct) is false)
                    return;
            }
            catch (Npgsql.NpgsqlException)
            {
                // Still starting.
            }
            await Task.Delay(200, Ct);
        }
        throw new ShouldAssertException(
            "The recovery instance did not promote: " + await RecoveryLogAsync()
        );
    }

    private async Task<string> RecoveryLogAsync()
    {
        try
        {
            return await Fixture.ExecAsync(
                ["sh", "-c", $"tail -n 20 {Recovered}/recovery.log"],
                Ct
            );
        }
        catch (InvalidOperationException error)
        {
            return error.Message;
        }
    }

    private async Task CleanUpAsync()
    {
        await Fixture.ExecAsync(
            [
                "sh",
                "-c",
                $"if [ -f {Recovered}/postmaster.pid ]; then gosu postgres {PgCtl} --pgdata={Recovered} --mode=immediate stop; fi; rm -rf {Base} {Recovered} {ApiFixture.WalArchive}",
            ],
            CancellationToken.None
        );
    }

    private Task<string> Shell(string script) => Fixture.ExecAsync(["sh", "-c", script], Ct);

    private async Task SaveEntryAsync(string token, string id)
    {
        var snapshot = await GetLedgerAsync(token);
        snapshot["ledger"]!["transactions"]!
            .AsArray()
            .Add(
                new JsonObject
                {
                    ["id"] = id,
                    ["title"] = "Synthetic " + id,
                    ["kind"] = "expense",
                    ["total"] = 1000,
                    ["share"] = 1000,
                    ["categoryId"] = "food",
                    ["date"] = "2026-09-28",
                    ["note"] = "",
                }
            );
        using var saved = await PutLedgerAsync(token, snapshot);
        saved.StatusCode.ShouldBe(HttpStatusCode.OK, await saved.Content.ReadAsStringAsync(Ct));
    }

    private static async Task<JsonElement> ReadAsync(HttpClient client, string path, string? token)
    {
        using var response = await client.SendAsync(
            Authorized(HttpMethod.Get, path, bearer: token),
            Ct
        );
        var text = await response.Content.ReadAsStringAsync(Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK, text);
        return JsonDocument.Parse(text).RootElement.Clone();
    }
}
