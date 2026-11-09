using System.Globalization;
using System.Net;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Receipts;
using Penny.Backend.IntegrationTests.Infrastructure;
using Penny.Backend.Persistence.Import;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Migrations;

// An imported SQLite receipt (LegacyDatabase: `receipt`, owned by `legacy:user-01`,
// here also linked to expense `e`, which former member `oidc-user` shares) served
// through HTTP with imported sessions: same id, URL and plaintext bytes. All data is
// synthetic.
public sealed class ImportedReceiptTests(ApiFixture fixture) : ReceiptTestBase(fixture)
{
    private const long SessionExpiry = 1893456000000; // 2030-01-01T00:00:00Z
    private static readonly string OwnerToken = new('a', 64);
    private static readonly string FormerToken = new('b', 64);

    [Fact]
    public async Task whenSqliteReceiptImported_Download_ShouldServeOriginalBytesAtTheLegacyUrl()
    {
        using (var legacy = new LegacyDatabase())
        {
            legacy.Execute(
                string.Create(
                    CultureInfo.InvariantCulture,
                    $"""
                    UPDATE household_expenses SET receipt_id = 'receipt' WHERE id = 'e';
                    INSERT INTO sessions VALUES('{SessionTokens.Hash(
                        OwnerToken
                    )}','legacy:user-01',{SessionExpiry});
                    INSERT INTO sessions VALUES('{SessionTokens.Hash(
                        FormerToken
                    )}','oidc-user',{SessionExpiry});
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

        // The ledger entry's URI is the download URL, unchanged.
        var uri = (await GetLedgerAsync(OwnerToken))["ledger"]!["transactions"]![0]!["receipt"]![
            "uri"
        ]!.GetValue<string>();
        uri.ShouldBe("/api/receipts/receipt");
        using (
            var response = await Client.SendAsync(Authorized(HttpMethod.Get, uri, OwnerToken), Ct)
        )
        {
            response.StatusCode.ShouldBe(HttpStatusCode.OK);
            (await response.Content.ReadAsByteArrayAsync(Ct)).ShouldBe(LegacyDatabase.ReceiptBytes);
            response.Content.Headers.ContentType!.ToString().ShouldBe("application/pdf");
            response
                .Content.Headers.GetValues("Content-Disposition")
                .Single()
                .ShouldBe("inline; filename*=UTF-8''synthetic.pdf");
        }

        // The former member shares the linked expense, so the receipt stays readable.
        (await DownloadedAsync(FormerToken, "receipt")).ShouldBe(LegacyDatabase.ReceiptBytes);
        var outsider = await RegisterAsync("outsider@example.test");
        await ShouldFailAsync(
            DownloadAsync(outsider, "receipt"),
            HttpStatusCode.NotFound,
            ReceiptService.NotFound
        );
    }
}
