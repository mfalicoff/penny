using System.Globalization;
using System.Net;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Households;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Import;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

// Imported SQLite households (LegacyDatabase: trip household `h` created by
// `legacy:user-01`, former member `oidc-user`, a settled historical month and a
// pending invite) served through HTTP with imported sessions. All data is synthetic.
public sealed class ImportedHouseholdTests(ApiFixture fixture) : HouseholdTestBase(fixture)
{
    private const string Creator = "legacy:user-01";
    private const string Former = "oidc-user";
    private const string Newcomer = "imported-newcomer";
    private const string ImportedCode = "C0FFEE1234";
    private const long SessionExpiry = 1893456000000; // 2030-01-01T00:00:00Z
    private static readonly string CreatorToken = Token('a');
    private static readonly string FormerToken = Token('b');
    private static readonly string NewcomerToken = Token('c');

    [Fact]
    public async Task whenSqliteHouseholdImported_MembershipFlow_ShouldReadJoinAndLeaveThroughHttp()
    {
        await ImportAsync();
        At(new DateTimeOffset(2026, 11, 8, 12, 0, 0, TimeSpan.Zero));

        // The imported trip household, its creator and dates.
        var listed = (
            await ExpectAsync(HttpMethod.Get, "/api/households", CreatorToken, HttpStatusCode.OK)
        )
            .GetProperty("households")
            .EnumerateArray()
            .Single();
        listed.GetProperty("id").GetString().ShouldBe("h");
        listed.GetProperty("name").GetString().ShouldBe("Café 東京");
        listed.GetProperty("creatorId").GetString().ShouldBe(Creator);
        listed.GetProperty("createdAt").GetInt64().ShouldBe(1700000000001);
        listed.GetProperty("memberCount").GetInt32().ShouldBe(1);
        listed.GetProperty("trip").GetProperty("startDate").GetString().ShouldBe("2024-02-29");
        listed.GetProperty("trip").GetProperty("endDate").GetString().ShouldBe("2024-03-01");

        // The former OIDC member keeps reading its history, with imported dates.
        (await ListIdsAsync(FormerToken)).ShouldBe(["h"]);
        var former = await MemberAsync("h", FormerToken, Former);
        former.GetProperty("joinedAt").GetInt64().ShouldBe(1700000000001);
        former.GetProperty("joinedOn").GetString().ShouldBe("2024-02-29");
        former.GetProperty("leftAt").GetInt64().ShouldBe(1700000000002);
        var creator = await MemberAsync("h", FormerToken, Creator);
        creator.TryGetProperty("joinedOn", out _).ShouldBeFalse();
        await ExpectErrorAsync(
            HttpMethod.Post,
            "/api/households/h/leave",
            FormerToken,
            HttpStatusCode.NotFound,
            HouseholdService.NotFound
        );

        // The imported invite still admits one account by its legacy hash.
        var joined = (
            await ExpectAsync(
                HttpMethod.Post,
                "/api/households/join",
                NewcomerToken,
                HttpStatusCode.OK,
                new { code = ImportedCode.ToLowerInvariant(), timezoneOffsetMinutes = 300 }
            )
        ).GetProperty("household");
        joined.GetProperty("memberCount").GetInt32().ShouldBe(2);
        await ExpectErrorAsync(
            HttpMethod.Post,
            "/api/households/join",
            FormerToken,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidInvite,
            new { code = ImportedCode }
        );

        // The former member rejoins with a new invite; the imported period is kept.
        var code = await InviteAsync("h", CreatorToken);
        await ExpectAsync(
            HttpMethod.Post,
            "/api/households/join",
            FormerToken,
            HttpStatusCode.OK,
            new { code }
        );
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_member_periods WHERE household_id = 'h' AND user_id = '{Former}'"
            )
        ).ShouldBe(2L);
        (
            await CountAsync(
                "SELECT count(*) FROM penny.household_member_periods WHERE id = 'p2' AND left_at IS NOT NULL"
            )
        ).ShouldBe(1L);

        // The imported February month is settled (an expense payment), so members
        // may leave; the creator cannot while others remain.
        await ExpectErrorAsync(
            HttpMethod.Post,
            "/api/households/h/leave",
            CreatorToken,
            HttpStatusCode.Conflict,
            HouseholdService.CreatorCannotLeave
        );
        await ExpectAsync(
            HttpMethod.Post,
            "/api/households/h/leave",
            FormerToken,
            HttpStatusCode.OK
        );
        await ExpectAsync(
            HttpMethod.Delete,
            $"/api/households/h/members/{Newcomer}",
            CreatorToken,
            HttpStatusCode.OK
        );

        // An unsettled imported month blocks archiving until it is settled.
        await AddExpenseAsync("h", Creator, 300, "2024-03-01", (Creator, 100), (Former, 200));
        await ExpectErrorAsync(
            HttpMethod.Post,
            "/api/households/h/archive",
            CreatorToken,
            HttpStatusCode.Conflict,
            HouseholdService.UnsettledArchive
        );
        await AddReimbursementAsync("h", "2024-03", Former, Creator, 200);
        await ExpectAsync(
            HttpMethod.Post,
            "/api/households/h/archive",
            CreatorToken,
            HttpStatusCode.OK
        );

        // The creator's personal trip link to the shared trip is private and survives.
        var ledger = await GetLedgerAsync(CreatorToken);
        ledger["ledger"]!["trips"]![0]!["sharedHouseholdId"]!.GetValue<string>().ShouldBe("h");
        (await DetailAsync("h", NewcomerToken)).GetProperty("members").GetArrayLength().ShouldBe(3);
    }

    private async Task ImportAsync()
    {
        using var legacy = new LegacyDatabase();
        legacy.Execute(
            string.Create(
                CultureInfo.InvariantCulture,
                $$"""
                INSERT INTO users VALUES('{{Newcomer}}','newcomer@example.test','','');
                INSERT INTO ledgers VALUES('{{Newcomer}}',0,'{"version":4,"currency":"CAD","accounts":[],"trips":[],"categories":[],"transactions":[],"recurring":[]}');
                INSERT INTO sessions VALUES('{{SessionTokens.Hash(
                    CreatorToken
                )}}','{{Creator}}',{{SessionExpiry}});
                INSERT INTO sessions VALUES('{{SessionTokens.Hash(
                    FormerToken
                )}}','{{Former}}',{{SessionExpiry}});
                INSERT INTO sessions VALUES('{{SessionTokens.Hash(
                    NewcomerToken
                )}}','{{Newcomer}}',{{SessionExpiry}});
                INSERT INTO household_invites VALUES('{{InviteCodes.Hash(
                    ImportedCode
                )}}','h',{{SessionExpiry}},NULL);
                """
            )
        );
        legacy.Seal();
        await SqliteImporter.RunAsync(
            Fixture.Admin,
            Fixture.Receipts,
            legacy.SnapshotPath,
            legacy.Sha256,
            ImportMode.Import,
            null,
            Ct
        );
    }

    private static string Token(char digit) => new(digit, 64);
}
