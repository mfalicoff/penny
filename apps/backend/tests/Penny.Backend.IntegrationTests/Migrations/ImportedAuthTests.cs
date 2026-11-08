using System.Net;
using System.Net.Http.Json;
using Penny.Backend.Api.Contracts;
using Penny.Backend.IntegrationTests.Controllers;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Import;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

public sealed class ImportedAuthTests(ApiFixture fixture) : IntegrationTestBase(fixture)
{
    // Synthetic credentials hashed by the legacy Node server (security.ts), not real data.
    private const string Password = "imported account password";
    private const string Salt = "5f1c0e7a9b3d2468ace0f1357924680b";
    private const string Hash =
        "6d4347584d1b837f80c695dc3f951ee36ebae6ff975402cba940f8a1c9b2574b5ba24380bd1a1de4d757032e9d6ed1f00131af295fd99083028916b841e48058";
    private const string ActiveToken =
        "3c5a0b9e7d1f2468ace013579bdf02468ace13579bdf02468ace13579bdf0246";
    private const string ActiveHash =
        "e66d4c72859c5f6e7a06e34d93dd9126a892f57ef90d2c456375f0d728d0495a";
    private const string ExpiredToken =
        "9e7d1f2468ace013579bdf02468ace13579bdf02468ace13579bdf02463c5a0b";
    private const string ExpiredHash =
        "ad6f1d64b02ac4eca3b3db5c5bef6450e28eca127c4aceabcf4c15b4cefdc4c4";
    private const long ActiveExpires = 1893456000000; // 2030-01-01T00:00:00Z
    private const long ExpiredExpires = 1793577600123; // also the base fixture session

    [Fact]
    public async Task whenSqliteAccountImported_AuthFlow_ShouldKeepPasswordsSessionsAndCaseRules()
    {
        await ImportAsync();
        Fixture.Factory.Clock.Set(DateTimeOffset.FromUnixTimeMilliseconds(ExpiredExpires + 1));

        // Imported sessions keep working (bearer and cookie) until their legacy expiry.
        (await MeAsync(bearer: ActiveToken)).ShouldBe("imported@example.test");
        (await MeAsync(cookie: $"penny_session={ActiveToken}")).ShouldBe("imported@example.test");
        using (
            var expired = await Client.SendAsync(
                Authorized(HttpMethod.Get, "/api/auth/me", bearer: ExpiredToken),
                Ct
            )
        )
            expired.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        // The stored scrypt hash verifies without rehashing; login trims and lowercases.
        using var login = await Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email = " Imported@Example.TEST", password = Password },
            Ct
        );
        login.StatusCode.ShouldBe(HttpStatusCode.OK);
        var session = (await login.Content.ReadFromJsonAsync<SessionResponse>(Ct))!;
        session.Email.ShouldBe("imported@example.test");
        (await ScalarAsync("SELECT password FROM penny.users WHERE id = 'imported-user'")).ShouldBe(
            Hash
        );

        // Issuing a session purges expired rows; their push devices cascade as in SQLite.
        (
            await ScalarAsync(
                $"SELECT count(*) FROM penny.sessions WHERE token_hash IN ('{ExpiredHash}', 'synthetic-session-hash')"
            )
        ).ShouldBe(0L);
        (await ScalarAsync("SELECT count(*) FROM penny.push_devices")).ShouldBe(0L);
        (
            await ScalarAsync(
                $"SELECT count(*) FROM penny.sessions WHERE token_hash = '{ActiveHash}'"
            )
        ).ShouldBe(1L);

        // Emails stay bytewise: legacy mixed-case rows are unreachable by password login,
        // exactly as before, and the empty OIDC-only password never verifies.
        using var mixed = await Client.PostAsJsonAsync(
            "/api/auth/login",
            new { email = "Case@example.test", password = "synthetic password" },
            Ct
        );
        await AuthTests.ShouldBeErrorAsync(
            mixed,
            HttpStatusCode.Unauthorized,
            "Email or password is incorrect."
        );
        using var duplicate = await Client.PostAsJsonAsync(
            "/api/auth/register",
            new { email = "IMPORTED@example.test", password = TestPassword },
            Ct
        );
        duplicate.StatusCode.ShouldBe(HttpStatusCode.Conflict);

        // Revoking the imported session leaves the new one valid.
        using (
            var logout = await Client.SendAsync(
                Authorized(HttpMethod.Post, "/api/auth/logout", bearer: ActiveToken),
                Ct
            )
        )
            logout.StatusCode.ShouldBe(HttpStatusCode.OK);
        using (
            var revoked = await Client.SendAsync(
                Authorized(HttpMethod.Get, "/api/auth/me", bearer: ActiveToken),
                Ct
            )
        )
            revoked.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await MeAsync(bearer: session.Token)).ShouldBe("imported@example.test");
    }

    private async Task ImportAsync()
    {
        using var legacy = new LegacyDatabase();
        legacy.Execute(
            $$"""
            INSERT INTO users VALUES('imported-user','imported@example.test','{{Hash}}','{{Salt}}');
            INSERT INTO ledgers VALUES('imported-user',3,'{"version":4,"currency":"CAD","accounts":[],"trips":[],"categories":[],"transactions":[],"recurring":[]}');
            INSERT INTO sessions VALUES('{{ActiveHash}}','imported-user',{{ActiveExpires}});
            INSERT INTO sessions VALUES('{{ExpiredHash}}','imported-user',{{ExpiredExpires}});
            """
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

    private async Task<string?> MeAsync(string? bearer = null, string? cookie = null)
    {
        using var response = await Client.SendAsync(
            Authorized(HttpMethod.Get, "/api/auth/me", bearer, cookie),
            Ct
        );
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<MeResponse>(Ct))!.Email;
    }

    private async Task<object?> ScalarAsync(string sql)
    {
        await using var command = Fixture.Admin.CreateCommand(sql);
        return await command.ExecuteScalarAsync(Ct);
    }
}
