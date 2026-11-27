using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Penny.Backend.Application.Accounts;
using Penny.Backend.Application.Authentication;
using Penny.Backend.Application.Households;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// Account deletion and the full export (MAZ-152). Deleting follows the household rules
// for leaving (settled, a creator alone), removes every personal row and file, and keeps
// shared expenses, splits and payments, so the other members' balances don't move and
// they see a former member. The export holds everything that belongs to the person. All
// data is synthetic.
public sealed class AccountTests(ApiFixture fixture) : ReceiptTestBase(fixture)
{
    private const string DeletePath = "/api/account/delete";

    private async Task<string> AddPersonalEntryAsync(string token, string? receiptId = null)
    {
        var snapshot = await GetLedgerAsync(token);
        var entry = new JsonObject
        {
            ["id"] = "lunch",
            ["title"] = "Synthetic lunch",
            ["kind"] = "expense",
            ["total"] = 1250,
            ["share"] = 1250,
            ["categoryId"] = snapshot["ledger"]!["categories"]![0]!["id"]!.GetValue<string>(),
            ["date"] = "2026-09-28",
            ["note"] = "=1+1, \"quoted\"",
        };
        if (receiptId is not null)
            entry["receipt"] = new JsonObject
            {
                ["id"] = receiptId,
                ["name"] = "lunch.pdf",
                ["mime"] = "application/pdf",
                ["uri"] = "/api/receipts/" + receiptId,
            };
        snapshot["ledger"]!["transactions"]!.AsArray().Add(entry);
        // Ledger data outside the lists goes with the account too (contract 2.3.0).
        snapshot["ledger"]!["dismissedSuggestions"] = new JsonArray("expense|lunch|monthly|1250");
        using var saved = await PutLedgerAsync(token, snapshot);
        saved.StatusCode.ShouldBe(HttpStatusCode.OK);
        return snapshot["ledger"]!["categories"]![0]!["name"]!.GetValue<string>();
    }

    private Task<long> RowsAsync(string table, string userId) =>
        CountAsync($"SELECT count(*) FROM penny.{table} WHERE user_id = '{userId}'");

    private async Task<HttpStatusCode> LoginStatusAsync(string email)
    {
        using var response = await SendAsync(
            HttpMethod.Post,
            "/api/auth/login",
            null,
            new { email, password = TestPassword }
        );
        return response.StatusCode;
    }

    [Fact]
    public async Task whenPasswordWrongOrMissing_DeleteAccount_ShouldKeepTheAccount()
    {
        var (bea, beaId) = await AccountAsync("bea@example.test");

        await ExpectErrorAsync(
            HttpMethod.Post,
            DeletePath,
            bea,
            HttpStatusCode.BadRequest,
            AccountDeletionService.WrongPassword,
            new { password = "not the password" }
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            DeletePath,
            bea,
            HttpStatusCode.BadRequest,
            AccountDeletionService.WrongPassword,
            new { }
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            DeletePath,
            null,
            HttpStatusCode.Unauthorized,
            AuthService.SignInRequired,
            new { password = TestPassword }
        );

        (
            await CountAsync(
                $"SELECT count(*) FROM penny.users WHERE id = '{beaId}' AND deleted_at IS NULL"
            )
        ).ShouldBe(1);
        (await LoginStatusAsync("bea@example.test")).ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenMemberSettled_DeleteAccount_ShouldRemovePersonalDataAndKeepSharedExpenses()
    {
        At(Noon);
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        var home = Id(await CreateHouseholdAsync(alex));
        await AdmitAsync(home, alex, bea);
        // Bea paid, with her own account and receipt, and Alex settled his half.
        await AddAccountAsync(bea, "visa");
        var sharedReceipt = Id(await UploadedAsync(bea, "slip.pdf", "application/pdf", Pdf()));
        var expense = await CreateExpenseAsync(
            home,
            bea,
            Expense(10000, beaId, extra: new { accountId = "visa", receiptId = sharedReceipt })
        );
        await AddReimbursementAsync(home, "2026-09", alexId, beaId, 5000);
        var personalReceipt = Id(await UploadedAsync(bea, "lunch.pdf", "application/pdf", Pdf()));
        await AddPersonalEntryAsync(bea, personalReceipt);
        await Fixture.SqlAsync(
            $"UPDATE penny.users SET display_name = 'Bea Synthetic' WHERE id = '{beaId}'",
            Ct
        );
        var beaFiles = new[]
        {
            await StoragePathAsync(sharedReceipt),
            await StoragePathAsync(personalReceipt),
        };
        var monthBefore = await ExpectAsync(
            HttpMethod.Get,
            $"/api/households/{home}/months/2026-09",
            alex,
            HttpStatusCode.OK
        );

        var deleted = await ExpectAsync(
            HttpMethod.Post,
            DeletePath,
            bea,
            HttpStatusCode.OK,
            new { password = TestPassword }
        );

        deleted.GetProperty("ok").GetBoolean().ShouldBeTrue();
        // Signed out everywhere and can't sign in again.
        using (var me = await SendAsync(HttpMethod.Get, "/api/auth/me", bea))
            me.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await LoginStatusAsync("bea@example.test")).ShouldBe(HttpStatusCode.Unauthorized);
        // Every personal row is gone; the user row is a tombstone.
        foreach (
            var table in new[]
            {
                "ledgers",
                "ledger_entries",
                "ledger_accounts",
                "ledger_categories",
                "ledger_dismissed_suggestions",
                "receipts",
                "sessions",
                "search_documents",
            }
        )
            (await RowsAsync(table, beaId)).ShouldBe(0, table);
        (
            await ScalarAsync(
                $"SELECT email || '|' || password || '|' || coalesce(display_name, '-') || '|' || (deleted_at IS NOT NULL) FROM penny.users WHERE id = '{beaId}'"
            )
        ).ShouldBe(AccountDeletionService.TombstoneEmail(beaId) + "||-|true");
        var files = StoredFiles();
        foreach (var path in beaFiles)
            files.ShouldNotContain(path);

        // The shared expense and its splits stay for Alex, without Bea's receipt or account.
        var kept = await GetExpenseAsync(home, Id(expense), alex);
        kept.GetProperty("totalCents").GetInt64().ShouldBe(10000);
        kept.GetProperty("payerUserId").GetString().ShouldBe(beaId);
        SplitUsers(kept)
            .ShouldBe(
                new[] { alexId, beaId }.Order(StringComparer.Ordinal).ToList(),
                ignoreOrder: true
            );
        kept.TryGetProperty("receipt", out _).ShouldBeFalse();
        var monthAfter = await ExpectAsync(
            HttpMethod.Get,
            $"/api/households/{home}/months/2026-09",
            alex,
            HttpStatusCode.OK
        );
        monthAfter
            .GetProperty("balances")
            .ToString()
            .ShouldBe(monthBefore.GetProperty("balances").ToString());
        // Alex sees a former member with no email, name or picture of Bea.
        var member = await MemberAsync(home, alex, beaId);
        member.GetProperty("deleted").GetBoolean().ShouldBeTrue();
        member.TryGetProperty("leftAt", out _).ShouldBeTrue();
        member.TryGetProperty("displayName", out _).ShouldBeFalse();
        member
            .GetProperty("email")
            .GetString()
            .ShouldBe(AccountDeletionService.TombstoneEmail(beaId));
        (await MemberAsync(home, alex, alexId)).TryGetProperty("deleted", out _).ShouldBeFalse();
        // Alex's Activity row says a former member paid, without Bea's name.
        var payer = (await ProjectionAsync(alex, "?month=2026-09"))
            .GetProperty("transactions")[0]
            .GetProperty("payer");
        payer.GetProperty("deleted").GetBoolean().ShouldBeTrue();
        payer.TryGetProperty("displayName", out _).ShouldBeFalse();
        (await AuditCountAsync(home, "member.left")).ShouldBe(1);

        // Bea's email is free again.
        await RegisterAsync("bea@example.test");
    }

    [Fact]
    public async Task whenUnsettledOrCreatorWithMembers_DeleteAccount_ShouldRefuseAndChangeNothing()
    {
        At(Noon);
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        var home = Id(await CreateHouseholdAsync(alex, "Apartment"));
        await AdmitAsync(home, alex, bea);
        await CreateExpenseAsync(home, alex, Expense(10000, alexId));

        await ExpectErrorAsync(
            HttpMethod.Post,
            DeletePath,
            bea,
            HttpStatusCode.Conflict,
            AccountDeletionService.Unsettled("Apartment"),
            new { password = TestPassword }
        );
        await ExpectErrorAsync(
            HttpMethod.Post,
            DeletePath,
            alex,
            HttpStatusCode.Conflict,
            AccountDeletionService.CreatorWithMembers("Apartment"),
            new { password = TestPassword }
        );

        (
            await CountAsync("SELECT count(*) FROM penny.users WHERE deleted_at IS NOT NULL")
        ).ShouldBe(0);
        (await MemberAsync(home, alex, beaId)).TryGetProperty("leftAt", out _).ShouldBeFalse();
        (await RowsAsync("ledgers", beaId)).ShouldBe(1);
        (await LoginStatusAsync("bea@example.test")).ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task whenCreatorAlone_DeleteAccount_ShouldLeaveTheHousehold()
    {
        At(Noon);
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var home = Id(await CreateHouseholdAsync(alex));

        await ExpectAsync(
            HttpMethod.Post,
            DeletePath,
            alex,
            HttpStatusCode.OK,
            new { password = TestPassword }
        );

        (
            await CountAsync(
                $"SELECT count(*) FROM penny.household_member_periods WHERE household_id = '{home}' AND user_id = '{alexId}' AND left_at IS NOT NULL"
            )
        ).ShouldBe(1);
        // A second request has no session any more.
        await ExpectErrorAsync(
            HttpMethod.Post,
            DeletePath,
            alex,
            HttpStatusCode.Unauthorized,
            AuthService.SignInRequired,
            new { password = TestPassword }
        );
    }

    [Fact]
    public async Task whenExported_Export_ShouldZipEverythingThatBelongsToThePerson()
    {
        At(Noon);
        var (alex, alexId) = await AccountAsync("alex@example.test");
        var (bea, beaId) = await AccountAsync("bea@example.test");
        var home = Id(await CreateHouseholdAsync(alex, "Apartment"));
        await AdmitAsync(home, alex, bea);
        await CreateExpenseAsync(home, alex, Expense(9000, alexId));
        var content = Pdf(2048);
        var receipt = Id(await UploadedAsync(bea, "Lunch slip.pdf", "application/pdf", content));
        var category = await AddPersonalEntryAsync(bea, receipt);
        await Fixture.SqlAsync(
            $"UPDATE penny.users SET display_name = 'Bea Synthetic' WHERE id = '{beaId}'",
            Ct
        );

        using var response = await SendAsync(HttpMethod.Get, "/api/export", bea);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/zip");
        response.Content.Headers.ContentDisposition!.FileNameStar.ShouldBe(
            "penny-export-2026-09-28.zip"
        );
        response.Headers.CacheControl!.NoStore.ShouldBeTrue();
        await using var stream = await response.Content.ReadAsStreamAsync(Ct);
        using var zip = new ZipArchive(stream, ZipArchiveMode.Read);
        var names = zip.Entries.Select(entry => entry.FullName).ToList();
        names.ShouldBe([
            "README.txt",
            "profile.json",
            "ledger.json",
            "entries.csv",
            "households/01-Apartment.json",
            $"receipts/{receipt}-Lunch-slip.pdf",
        ]);

        var profile = Read(zip, "profile.json");
        profile
            .GetProperty("profile")
            .GetProperty("email")
            .GetString()
            .ShouldBe("bea@example.test");
        profile
            .GetProperty("profile")
            .GetProperty("displayName")
            .GetString()
            .ShouldBe("Bea Synthetic");
        profile.GetProperty("name").GetProperty("managedBy").GetString().ShouldBe("you");
        profile.GetProperty("picture").GetProperty("managedBy").GetString().ShouldBe("you");
        profile.GetProperty("picture").TryGetProperty("file", out _).ShouldBeFalse();
        Read(zip, "ledger.json")
            .GetProperty("ledger")
            .GetProperty("transactions")[0]
            .GetProperty("id")
            .GetString()
            .ShouldBe("lunch");
        var household = Read(zip, "households/01-Apartment.json");
        household.GetProperty("household").GetProperty("id").GetString().ShouldBe(home);
        household.GetProperty("members").GetArrayLength().ShouldBe(2);
        var shared = household.GetProperty("expenses").EnumerateArray().Single();
        shared.GetProperty("splits").GetArrayLength().ShouldBe(2);
        household.GetProperty("history").GetArrayLength().ShouldBeGreaterThan(0);
        await using (
            var file = await zip.GetEntry($"receipts/{receipt}-Lunch-slip.pdf")!.OpenAsync(Ct)
        )
        {
            using var copy = new MemoryStream();
            await file.CopyToAsync(copy, Ct);
            copy.ToArray().ShouldBe(content);
        }
        var csv = Text(zip, "entries.csv");
        csv.ShouldStartWith(
            "﻿Date,Type,Title,Category,Account,Amount,Your share,Currency,Household,Trip,Note,Original amount,Original currency,Exchange rate\r\n"
        );
        csv.ShouldContain(
            $"2026-09-28,Expense,Groceries,Groceries,,90.00,45.00,CAD,Apartment,,,,,\r\n"
        );
        csv.ShouldContain(
            $"2026-09-28,Expense,Synthetic lunch,{category},,12.50,12.50,CAD,,,\"'=1+1, \"\"quoted\"\"\",,,\r\n"
        );

        // Nothing of the export stays on the server.
        Directory.EnumerateFiles(Path.GetTempPath(), "penny-export-*.zip").ShouldBeEmpty();
    }

    [Fact]
    public async Task whenPeriodGiven_ExportEntries_ShouldReturnThatPeriodsCsv()
    {
        At(Noon);
        var (alex, _) = await AccountAsync("alex@example.test");
        await AddPersonalEntryAsync(alex);

        using (
            var september = await SendAsync(
                HttpMethod.Get,
                "/api/export/entries?month=2026-09",
                alex
            )
        )
        {
            september.StatusCode.ShouldBe(HttpStatusCode.OK);
            september.Content.Headers.ContentType!.ToString().ShouldBe("text/csv; charset=utf-8");
            september.Content.Headers.ContentDisposition!.FileNameStar.ShouldBe(
                "penny-entries-2026-09.csv"
            );
            var text = Encoding.UTF8.GetString(await september.Content.ReadAsByteArrayAsync(Ct));
            text.Split("\r\n", StringSplitOptions.RemoveEmptyEntries).Length.ShouldBe(2);
        }
        using (
            var october = await SendAsync(HttpMethod.Get, "/api/export/entries?month=2026-10", alex)
        )
        {
            var text = Encoding.UTF8.GetString(await october.Content.ReadAsByteArrayAsync(Ct));
            text.Split("\r\n", StringSplitOptions.RemoveEmptyEntries).Length.ShouldBe(1);
        }
        using (var year = await SendAsync(HttpMethod.Get, "/api/export/entries?year=2026", alex))
            year.Content.Headers.ContentDisposition!.FileNameStar.ShouldBe(
                "penny-entries-2026.csv"
            );
        using (var everything = await SendAsync(HttpMethod.Get, "/api/export/entries", alex))
            everything.Content.Headers.ContentDisposition!.FileNameStar.ShouldBe(
                "penny-entries-2026-09-28.csv"
            );
        await ExpectErrorAsync(
            HttpMethod.Get,
            "/api/export/entries?month=2026-13",
            alex,
            HttpStatusCode.BadRequest,
            HouseholdService.InvalidData
        );
        await ExpectErrorAsync(
            HttpMethod.Get,
            "/api/export",
            null,
            HttpStatusCode.Unauthorized,
            AuthService.SignInRequired
        );
    }

    [Fact]
    public async Task whenEntriesPaidInOtherCurrencies_ExportEntries_ShouldListTheirOriginalAmounts()
    {
        At(Noon);
        var (alex, _) = await AccountAsync("alex@example.test");
        var snapshot = await GetLedgerAsync(alex);
        var category = snapshot["ledger"]!["categories"]![0]!;
        JsonObject Entry(string id, long total, long amount, string currency, string rate) =>
            new()
            {
                ["id"] = id,
                ["title"] = "Synthetic " + id,
                ["kind"] = "expense",
                ["total"] = total,
                ["share"] = total,
                ["categoryId"] = category["id"]!.GetValue<string>(),
                ["date"] = "2026-09-28",
                ["note"] = "",
                ["originalAmount"] = amount,
                ["originalCurrency"] = currency,
                ["rate"] = rate,
                ["rateStatus"] = "edited",
            };
        var transactions = snapshot["ledger"]!["transactions"]!.AsArray();
        transactions.Add(Entry("class", 12420, 8500, "EUR", "1.4612"));
        transactions.Add(Entry("noodles", 1088, 1200, "JPY", "0.00906283"));
        using (var saved = await PutLedgerAsync(alex, snapshot))
            saved.StatusCode.ShouldBe(HttpStatusCode.OK);

        using var response = await SendAsync(HttpMethod.Get, "/api/export/entries", alex);
        var text = Encoding.UTF8.GetString(await response.Content.ReadAsByteArrayAsync(Ct));
        var name = category["name"]!.GetValue<string>();
        text.ShouldContain(
            $"2026-09-28,Expense,Synthetic class,{name},,124.20,124.20,CAD,,,,85.00,EUR,1.4612\r\n"
        );
        text.ShouldContain(
            $"2026-09-28,Expense,Synthetic noodles,{name},,10.88,10.88,CAD,,,,1200,JPY,0.00906283\r\n"
        );
    }

    private static JsonElement Read(ZipArchive zip, string name) =>
        JsonDocument.Parse(Text(zip, name).TrimStart('\uFEFF')).RootElement.Clone();

    private static string Text(ZipArchive zip, string name)
    {
        // Raw bytes, so the CSV's byte order mark stays visible.
        using var stream = zip.GetEntry(name)!.Open();
        using var copy = new MemoryStream();
        stream.CopyTo(copy);
        return Encoding.UTF8.GetString(copy.ToArray());
    }
}
