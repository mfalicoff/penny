using System.Globalization;
using System.Text.Json;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Import;

// Maps a validated v1–v4 ledger document (LedgerImportValidator) to typed v4 rows,
// applying the client's upgradeLedger rules: v1 gains an investment category once.
internal static class LedgerDocumentMapper
{
    public static void Map(string userId, long revision, string data, ImportPlan plan)
    {
        using var document = JsonDocument.Parse(data);
        var ledger = document.RootElement;
        var version = ledger.GetProperty("version").GetInt32();
        plan.Ledgers.Add(
            new Ledger
            {
                UserId = userId,
                Currency = ledger.GetProperty("currency").GetString()!,
                Revision = revision,
            }
        );
        var categories = Items(ledger, "categories")
            .Select(category => new LedgerCategory
            {
                UserId = userId,
                Id = Text(category, "id"),
                Name = Text(category, "name"),
                Icon = Text(category, "icon"),
                Color = Text(category, "color"),
                Kind = Text(category, "kind"),
            })
            .ToList();
        if (
            version == 1
            && categories.Count < 300
            && !categories.Any(category => category.Kind == "investment")
        )
        {
            var id = "investments";
            for (var suffix = 1; categories.Any(category => category.Id == id); suffix++)
                id = "investments-" + suffix.ToString(CultureInfo.InvariantCulture);
            categories.Add(
                new LedgerCategory
                {
                    UserId = userId,
                    Id = id,
                    Name = "Investments",
                    Icon = "trending-up-outline",
                    Color = "#678DB1",
                    Kind = "investment",
                }
            );
        }
        plan.Categories.AddRange(categories);
        plan.Accounts.AddRange(
            Items(ledger, "accounts")
                .Select(account => new LedgerAccount
                {
                    UserId = userId,
                    Id = Text(account, "id"),
                    Name = Text(account, "name"),
                    Type = Text(account, "type"),
                })
        );
        plan.Trips.AddRange(
            Items(ledger, "trips")
                .Select(trip => new LedgerTrip
                {
                    UserId = userId,
                    Id = Text(trip, "id"),
                    Name = Text(trip, "name"),
                    StartDate = Date(trip, "startDate"),
                    EndDate = Date(trip, "endDate"),
                    SharedHouseholdId = Optional(trip, "sharedHouseholdId"),
                })
        );
        plan.LedgerRecurring.AddRange(
            Items(ledger, "recurring")
                .Select(rule => new LedgerRecurring
                {
                    UserId = userId,
                    Id = Text(rule, "id"),
                    Title = Text(rule, "title"),
                    Kind = Text(rule, "kind"),
                    TotalCents = rule.GetProperty("total").GetInt64(),
                    ShareCents = rule.GetProperty("share").GetInt64(),
                    CategoryId = Text(rule, "categoryId"),
                    AccountId = Optional(rule, "accountId"),
                    StartDate = Date(rule, "date"),
                    Note = Text(rule, "note"),
                    Frequency = Text(rule, "frequency"),
                    NextDate = Date(rule, "nextDate"),
                    AnchorDay = rule.GetProperty("anchorDay").GetInt16(),
                    Active = rule.GetProperty("active").GetBoolean(),
                })
        );
        plan.Entries.AddRange(
            Items(ledger, "transactions")
                .Select(entry => new LedgerEntry
                {
                    UserId = userId,
                    Id = Text(entry, "id"),
                    Title = Text(entry, "title"),
                    Kind = Text(entry, "kind"),
                    TotalCents = entry.GetProperty("total").GetInt64(),
                    ShareCents = entry.GetProperty("share").GetInt64(),
                    CategoryId = Text(entry, "categoryId"),
                    AccountId = Optional(entry, "accountId"),
                    TripId = Optional(entry, "tripId"),
                    EntryDate = Date(entry, "date"),
                    Note = Text(entry, "note"),
                    // Receipt name/MIME/URI are served from the receipts row, not copied.
                    ReceiptId = entry.TryGetProperty("receipt", out var receipt)
                        ? Text(receipt, "id")
                        : null,
                    RecurringId = Optional(entry, "recurringId"),
                })
        );
    }

    private static IEnumerable<JsonElement> Items(JsonElement ledger, string name) =>
        ledger.TryGetProperty(name, out var items) ? items.EnumerateArray() : [];

    private static string Text(JsonElement value, string name) =>
        value.GetProperty(name).GetString()!;

    private static string? Optional(JsonElement value, string name) =>
        value.TryGetProperty(name, out var item) ? item.GetString() : null;

    private static DateOnly Date(JsonElement value, string name) =>
        DateOnly.ParseExact(Text(value, name), "yyyy-MM-dd", CultureInfo.InvariantCulture);
}
