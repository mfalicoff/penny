using System.Net;
using System.Net.Http.Json;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Application.Authentication;
using Penny.Backend.IntegrationTests.Controllers;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Import;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

public sealed class ImportedOidcTests(ApiFixture fixture, FakeOidcProvider provider)
    : OidcTestBase(fixture, provider)
{
    [Fact]
    public async Task whenSqliteOidcIdentityImported_Complete_ShouldSignInToImportedAccount()
    {
        // The synthetic legacy database maps (https://issuer.example.test, subject-01)
        // to `oidc-user` with email case@example.test.
        using (var legacy = new LegacyDatabase())
        {
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
        var users = await ScalarAsync("SELECT count(*) FROM penny.users");
        await using var api = Provider.CreateApi(
            Fixture.RuntimeConnection,
            FakeOidcProvider.Settings(allowRegistration: false)
        );
        using var client = CreateClient(api);

        // Same issuer and subject, changed provider email: the imported account.
        using var signedIn = await SignInAsync(
            client,
            new FakeOidcGrant { Subject = "subject-01", Email = "changed@example.test" }
        );
        signedIn.StatusCode.ShouldBe(HttpStatusCode.OK);
        var session = (await signedIn.Content.ReadFromJsonAsync<SessionResponse>(Ct))!;
        session.Email.ShouldBe("case@example.test");
        (
            await ScalarAsync(
                $"SELECT user_id FROM penny.sessions WHERE token_hash = '{SessionTokens.Hash(session.Token)}'"
            )
        ).ShouldBe("oidc-user");

        // A new subject that reuses the imported email is never linked to it.
        await using var open = Provider.CreateApi(Fixture.RuntimeConnection);
        using var openClient = CreateClient(open);
        using var conflict = await SignInAsync(
            openClient,
            new FakeOidcGrant { Subject = "subject-02", Email = "case@example.test" }
        );
        await AuthTests.ShouldBeErrorAsync(
            conflict,
            HttpStatusCode.Conflict,
            AuthService.OidcEmailInUse
        );
        (await ScalarAsync("SELECT count(*) FROM penny.users")).ShouldBe(users);
        (await ScalarAsync("SELECT count(*) FROM penny.oidc_identities")).ShouldBe(1L);
    }
}
