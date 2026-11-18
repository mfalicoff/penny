using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Penny.Backend.Application.InboundMail;
using Penny.Backend.Application.Receipts;
using Penny.Backend.IntegrationTests.Infrastructure;
using Shouldly;
using Xunit;

namespace Penny.Backend.IntegrationTests.Controllers;

// The receipt inbox (MAZ-184, doc task 8) on real PostgreSQL: owner-only items, states
// that follow real ledger saves (attach, partly attached, unlink, entry deleted),
// discard and Done that delete only unlinked files, and expiry.
public sealed class ReceiptInboxTests(ApiFixture fixture) : InboundMailTestBase(fixture)
{
    private const string InboxPath = "/api/receipt-inbox";
    private readonly FakeRenderer renderer = new();

    private sealed record Item(string Id, string Status, JsonElement Json)
    {
        public string Email => File("email");
        public string Attachment => File("attachment");

        private string File(string kind) =>
            Json.GetProperty("files")
                .EnumerateArray()
                .Single(file => file.GetProperty("kind").GetString() == kind)
                .GetProperty("receiptId")
                .GetString()!;
    }

    // An account with an address and `count` processed emails (each: email PDF + invoice).
    private async Task<(string Token, string UserId)> InboxAsync(string email, int count = 1)
    {
        At(Noon);
        var (token, userId) = await AccountAsync(email);
        var local = await CreateAddressAsync(token);
        await using var host = InboundMailHost.With(Fixture, renderer);
        using var client = CreateClient(host);
        for (var index = 0; index < count; index++)
        {
            At(Noon.AddMinutes(index));
            (
                await DeliverAsync(
                    local,
                    InboundMailHost.MailWithInvoice(TestPdf.Create(index + 1), $"Order {index}"),
                    client
                )
            ).ShouldBe(HttpStatusCode.Accepted);
        }
        (await InboundMailHost.ProcessAsync(host, Ct)).ShouldBe(count);
        return (token, userId);
    }

    private async Task<List<Item>> ListAsync(string token, string query = "")
    {
        var page = await ExpectAsync(HttpMethod.Get, InboxPath + query, token, HttpStatusCode.OK);
        return
        [
            .. page.GetProperty("items")
                .EnumerateArray()
                .Select(item => new Item(
                    item.GetProperty("id").GetString()!,
                    item.GetProperty("status").GetString()!,
                    item
                )),
        ];
    }

    private async Task<Item> OnlyItemAsync(string token, string query = "") =>
        (await ListAsync(token, query)).Single();

    // Unlinked receipt cleanup (MAZ-165) leaves inbox files to the inbox's own expiry.
    [Fact]
    public async Task whenInboxFilesAreNotAttached_ReceiptCleanup_ShouldLeaveThem()
    {
        await InboxAsync("inbox@example.test");
        var receipts = await CountAsync("SELECT count(*) FROM penny.receipts");
        receipts.ShouldBe(2);

        At(Noon.AddDays(400));
        (
            await Fixture
                .Factory.Services.GetRequiredService<ReceiptCleanupService>()
                .RunOnceAsync(Ct)
        ).ShouldBe(0);

        (await CountAsync("SELECT count(*) FROM penny.receipts")).ShouldBe(receipts);
    }

    [Fact]
    public async Task whenMailProcessed_List_ShouldShowTheOwnersItemsNewestFirst()
    {
        var (token, _) = await InboxAsync("list@example.test", count: 2);
        var (other, _) = await AccountAsync("nosy@example.test");

        var items = await ListAsync(token);

        items
            .Select(item => item.Json.GetProperty("subject").GetString())
            .ShouldBe(["Order 1", "Order 0"]);
        var first = items[0].Json;
        first.GetProperty("status").GetString().ShouldBe("to_attach");
        first.GetProperty("from").GetString().ShouldBe("Acme Store");
        first.GetProperty("senderVerified").GetBoolean().ShouldBeFalse();
        first.GetProperty("expiresAt").GetInt64().ShouldBe(Millis(Noon.AddMinutes(1).AddDays(30)));
        var files = first.GetProperty("files").EnumerateArray().ToList();
        files
            .Select(file => file.GetProperty("kind").GetString())
            .ShouldBe(["email", "attachment"]);
        files
            .Select(file => file.GetProperty("name").GetString())
            .ShouldBe(["Order 1.pdf", "invoice-0412.pdf"]);
        files.ShouldAllBe(file => !file.GetProperty("linked").GetBoolean());
        files[1]
            .GetProperty("uri")
            .GetString()
            .ShouldBe("/api/receipts/" + files[1].GetProperty("receiptId").GetString());

        (await ListAsync(other)).ShouldBeEmpty();
        (await ListAsync(token, "?before=" + items[0].Id))
            .Select(item => item.Id)
            .ShouldBe([items[1].Id]);
        await ExpectErrorAsync(
            HttpMethod.Get,
            InboxPath + "?status=everything",
            token,
            HttpStatusCode.BadRequest,
            ReceiptInboxService.InvalidFilter
        );
    }

    [Fact]
    public async Task whenFilesAttachedAndUnlinked_LedgerSaves_ShouldMoveTheItemThroughItsStates()
    {
        var (token, _) = await InboxAsync("states@example.test");
        var item = await OnlyItemAsync(token);

        await SaveEntryAsync(token, "entry-invoice", "Coffee at Mill St.", item.Attachment);
        var partly = await OnlyItemAsync(token);
        partly.Status.ShouldBe("partly_attached");
        partly.Json.GetProperty("files")[1].GetProperty("linked").GetBoolean().ShouldBeTrue();

        await SaveEntryAsync(token, "entry-email", "Coffee email", item.Email);
        (await ListAsync(token)).ShouldBeEmpty();
        var attached = await OnlyItemAsync(token, "?status=attached");
        attached.Status.ShouldBe("attached");
        attached.Json.GetProperty("expiresAt").ValueKind.ShouldBe(JsonValueKind.Null);

        // Replacing the receipt on an entry releases it; deleting the entry releases the other.
        await SaveEntryAsync(token, "entry-email", "Coffee email", null);
        (await OnlyItemAsync(token)).Status.ShouldBe("partly_attached");
        await RemoveEntryAsync(token, "entry-invoice");
        var back = await OnlyItemAsync(token);
        back.Status.ShouldBe("to_attach");
        (
            await ScalarAsync("SELECT returned_at IS NOT NULL FROM penny.receipt_inbox_items")
        ).ShouldBe(true);
    }

    [Fact]
    public async Task whenDiscarded_Discard_ShouldDeleteOnlyUnlinkedFiles()
    {
        var (token, _) = await InboxAsync("discard@example.test");
        var (other, _) = await AccountAsync("other-discard@example.test");
        var item = await OnlyItemAsync(token);
        await SaveEntryAsync(token, "entry-invoice", "Groceries", item.Attachment);

        await ExpectErrorAsync(
            HttpMethod.Delete,
            $"{InboxPath}/{item.Id}",
            other,
            HttpStatusCode.NotFound,
            ReceiptInboxService.NotFound
        );
        var result = await ExpectAsync(
            HttpMethod.Delete,
            $"{InboxPath}/{item.Id}",
            token,
            HttpStatusCode.OK
        );

        result.GetProperty("deleted").GetInt32().ShouldBe(1);
        result.GetProperty("kept").GetInt32().ShouldBe(1);
        (await ListAsync(token)).ShouldBeEmpty();
        (await ListAsync(token, "?status=attached")).ShouldBeEmpty();
        (await CountAsync("SELECT count(*) FROM penny.receipt_inbox_items")).ShouldBe(0);
        using (var gone = await SendAsync(HttpMethod.Get, "/api/receipts/" + item.Email, token))
            gone.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        using (
            var kept = await SendAsync(HttpMethod.Get, "/api/receipts/" + item.Attachment, token)
        )
            kept.StatusCode.ShouldBe(HttpStatusCode.OK);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.receipt_texts WHERE receipt_id = '{item.Email}'"
            )
        ).ShouldBe(0);
        await ExpectErrorAsync(
            HttpMethod.Delete,
            $"{InboxPath}/{item.Id}",
            token,
            HttpStatusCode.NotFound,
            ReceiptInboxService.NotFound
        );
    }

    [Fact]
    public async Task whenPartlyAttachedItemIsDone_Done_ShouldDropTheEmailAndMarkItAttached()
    {
        var (token, _) = await InboxAsync("done@example.test");
        var item = await OnlyItemAsync(token);
        await SaveEntryAsync(token, "entry-invoice", "Groceries", item.Attachment);

        var result = await ExpectAsync(
            HttpMethod.Post,
            $"{InboxPath}/{item.Id}/done",
            token,
            HttpStatusCode.OK
        );

        (result.GetProperty("deleted").GetInt32(), result.GetProperty("kept").GetInt32()).ShouldBe(
            (1, 1)
        );
        var attached = await OnlyItemAsync(token, "?status=attached");
        attached.Json.GetProperty("files").GetArrayLength().ShouldBe(1);
        attached.Json.GetProperty("attachedAt").GetInt64().ShouldBe(Millis(Noon));
        await ExpectErrorAsync(
            HttpMethod.Post,
            $"{InboxPath}/{item.Id}/done",
            token,
            HttpStatusCode.NotFound,
            ReceiptInboxService.NotFound
        );
    }

    [Fact]
    public async Task whenDeadlinePasses_Process_ShouldDiscardUnhandledItems()
    {
        var (token, _) = await InboxAsync("expire@example.test", count: 2);
        var items = await ListAsync(token);
        await SaveEntryAsync(token, "entry", "Kept", items[1].Attachment);
        await using var host = InboundMailHost.With(Fixture, renderer);

        At(Noon.AddDays(30).AddMinutes(-1));
        token = await SignInAsync("expire@example.test");
        await InboundMailHost.ProcessAsync(host, Ct);
        (await ListAsync(token)).Count.ShouldBe(2);

        At(Noon.AddDays(30).AddMinutes(2));
        await InboundMailHost.ProcessAsync(host, Ct);
        (await ListAsync(token)).ShouldBeEmpty();
        (await CountAsync("SELECT count(*) FROM penny.receipts")).ShouldBe(1);
        using var kept = await SendAsync(
            HttpMethod.Get,
            "/api/receipts/" + items[1].Attachment,
            token
        );
        kept.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    // Review findings (MAZ-184): files kept only by a shared expense, live or deleted, are
    // never deleted, and another user can't finish someone else's item.
    [Fact]
    public async Task whenOnlyASharedExpenseLinksAFile_Discard_ShouldKeepIt()
    {
        var (token, userId) = await InboxAsync("shared-keep@example.test", count: 2);
        var items = await ListAsync(token);
        var home = Id(await CreateHouseholdAsync(token));
        var live = await CreateExpenseAsync(
            home,
            token,
            Expense(1250, userId, extra: new { receiptId = items[0].Attachment })
        );
        var deleted = await CreateExpenseAsync(
            home,
            token,
            Expense(900, userId, extra: new { receiptId = items[1].Attachment })
        );
        (await ListAsync(token))
            .Select(item => item.Status)
            .ShouldBe(["partly_attached", "partly_attached"]);
        await ExpectAsync(
            HttpMethod.Delete,
            ExpensePath(home, Id(deleted)),
            token,
            HttpStatusCode.OK,
            new { revision = deleted.GetProperty("revision").GetInt64() }
        );
        // The deleted expense no longer counts as a link, but its row still references the file.
        (await ListAsync(token))
            .Single(item => item.Id == items[1].Id)
            .Status.ShouldBe("to_attach");

        foreach (var item in items)
        {
            var result = await ExpectAsync(
                HttpMethod.Delete,
                $"{InboxPath}/{item.Id}",
                token,
                HttpStatusCode.OK
            );
            (
                result.GetProperty("deleted").GetInt32(),
                result.GetProperty("kept").GetInt32()
            ).ShouldBe((1, 1));
        }
        using (
            var kept = await SendAsync(
                HttpMethod.Get,
                "/api/receipts/" + items[0].Attachment,
                token
            )
        )
            kept.StatusCode.ShouldBe(HttpStatusCode.OK);
        (
            await CountAsync(
                $"SELECT count(*) FROM penny.receipts WHERE id = '{items[1].Attachment}'"
            )
        ).ShouldBe(1);
        Id(live).ShouldNotBeNullOrEmpty();
    }

    [Fact]
    public async Task whenAnotherUserFinishesAnItem_Done_ShouldReturnNotFound()
    {
        var (token, _) = await InboxAsync("done-owner@example.test");
        var (other, _) = await AccountAsync("done-other@example.test");
        var item = await OnlyItemAsync(token);
        await ExpectErrorAsync(
            HttpMethod.Post,
            $"{InboxPath}/{item.Id}/done",
            other,
            HttpStatusCode.NotFound,
            ReceiptInboxService.NotFound
        );
        (await OnlyItemAsync(token)).Status.ShouldBe("to_attach");
    }

    // Discard and an attach of the same file at once: either may win, neither fails with a
    // 500, and a file the saved ledger links always still exists.
    [Fact]
    public async Task whenDiscardRacesAnAttach_Inbox_ShouldNeverLoseALinkedFile()
    {
        var (token, _) = await InboxAsync("race-inbox@example.test", count: 5);
        var items = await ListAsync(token);
        var round = 0;
        foreach (var item in items)
        {
            var snapshot = await GetLedgerAsync(token);
            var ledger = snapshot["ledger"]!;
            ledger["transactions"]!
                .AsArray()
                .Add(
                    new System.Text.Json.Nodes.JsonObject
                    {
                        ["id"] = $"race-{round++}",
                        ["title"] = "Race",
                        ["kind"] = "expense",
                        ["total"] = 1000,
                        ["share"] = 1000,
                        ["categoryId"] = ledger["categories"]![0]!["id"]!.GetValue<string>(),
                        ["date"] = "2026-09-28",
                        ["note"] = "",
                        ["receipt"] = Link(item.Attachment),
                    }
                );
            var save = PutLedgerAsync(token, snapshot);
            var discard = SendAsync(HttpMethod.Delete, $"{InboxPath}/{item.Id}", token);
            using var saved = await save;
            using var discarded = await discard;
            ((int)saved.StatusCode).ShouldBeLessThan(
                500,
                await saved.Content.ReadAsStringAsync(Ct)
            );
            discarded.StatusCode.ShouldBe(
                HttpStatusCode.OK,
                await discarded.Content.ReadAsStringAsync(Ct)
            );
            if (saved.StatusCode == HttpStatusCode.OK)
                (
                    await CountAsync(
                        $"SELECT count(*) FROM penny.receipts WHERE id = '{item.Attachment}'"
                    )
                ).ShouldBe(1);
        }
    }

    [Fact]
    public async Task whenFeatureDisabled_Inbox_ShouldReturnNotFound()
    {
        await using var disabled = Fixture.Factory.WithWebHostBuilder(builder =>
            builder.UseSetting("InboundMail:Enabled", "false")
        );
        using var client = CreateClient(disabled);
        var token = await RegisterAsync("off@example.test", client);
        using var request = Authorized(HttpMethod.Get, InboxPath, bearer: token);
        using var response = await client.SendAsync(request, Ct);
        await ShouldBeErrorAsync(response, HttpStatusCode.NotFound, ReceiptEmailService.NotEnabled);
    }
}
