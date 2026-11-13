using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Ledgers;

// Maps the v4 document to and from the typed ledger tables (MAZ-52). Stored rows
// keep only an entry's receipt id; name/MIME come from the receipt row.
internal static class LedgerMapper
{
    public static StoredLedger ToStored(LedgerDocument ledger, long revision) =>
        new(
            revision,
            ledger.Currency,
            [
                .. ledger.Accounts.Select(account => new StoredAccount(
                    account.Id,
                    account.Name,
                    account.Type
                )),
            ],
            [
                .. ledger.Categories.Select(category => new StoredCategory(
                    category.Id,
                    category.Name,
                    category.Icon,
                    category.Color,
                    category.Kind
                )),
            ],
            [
                .. ledger.Trips.Select(trip => new StoredTrip(
                    trip.Id,
                    trip.Name,
                    trip.StartDate,
                    trip.EndDate,
                    trip.SharedHouseholdId
                )),
            ],
            [
                .. ledger.Recurring.Select(rule => new StoredRecurring(
                    rule.Id,
                    rule.Title,
                    rule.Kind,
                    rule.Total,
                    rule.Share,
                    rule.CategoryId,
                    rule.AccountId,
                    rule.Date,
                    rule.Note,
                    rule.Frequency,
                    rule.NextDate,
                    (short)rule.AnchorDay,
                    rule.Active
                )),
            ],
            [
                .. ledger.Transactions.Select(entry => new StoredEntry(
                    entry.Id,
                    entry.Title,
                    entry.Kind,
                    entry.Total,
                    entry.Share,
                    entry.CategoryId,
                    entry.AccountId,
                    entry.TripId,
                    entry.Date,
                    entry.Note,
                    entry.Receipt?.Id,
                    entry.RecurringId
                )),
            ]
        );

    public static LedgerDocument ToDocument(
        StoredLedger ledger,
        IReadOnlyDictionary<string, StoredReceiptInfo> receipts
    ) =>
        new(
            ledger.Currency,
            [
                .. ledger.Accounts.Select(account => new PaymentAccount(
                    account.Id,
                    account.Name,
                    account.Type
                )),
            ],
            [
                .. ledger.Trips.Select(trip => new Trip(
                    trip.Id,
                    trip.Name,
                    trip.StartDate,
                    trip.EndDate,
                    trip.SharedHouseholdId
                )),
            ],
            [
                .. ledger.Categories.Select(category => new Category(
                    category.Id,
                    category.Name,
                    category.Icon,
                    category.Color,
                    category.Kind
                )),
            ],
            [.. ledger.Entries.Select(entry => ToEntry(entry, receipts))],
            [
                .. ledger.Recurring.Select(rule => new RecurringRule(
                    rule.Id,
                    rule.Title,
                    rule.Kind,
                    rule.TotalCents,
                    rule.ShareCents,
                    rule.CategoryId,
                    rule.AccountId,
                    rule.StartDate,
                    rule.Note,
                    rule.Frequency,
                    rule.NextDate,
                    rule.AnchorDay,
                    rule.Active
                )),
            ]
        );

    // A stored entry with its receipt's name and MIME (search results use it too).
    public static Entry ToEntry(
        StoredEntry entry,
        IReadOnlyDictionary<string, StoredReceiptInfo> receipts
    ) =>
        new(
            entry.Id,
            entry.Title,
            entry.Kind,
            entry.TotalCents,
            entry.ShareCents,
            entry.CategoryId,
            entry.AccountId,
            entry.TripId,
            entry.Date,
            entry.Note,
            entry.ReceiptId is null ? null : Receipt(entry.ReceiptId, receipts),
            entry.RecurringId
        );

    // Replaces client-sent receipt metadata with the stored receipt's.
    public static LedgerDocument WithReceipts(
        LedgerDocument ledger,
        IReadOnlyDictionary<string, StoredReceiptInfo> receipts
    ) =>
        ledger with
        {
            Transactions =
            [
                .. ledger.Transactions.Select(entry =>
                    entry.Receipt is null
                        ? entry
                        : entry with
                        {
                            Receipt = Receipt(entry.Receipt.Id, receipts),
                        }
                ),
            ],
        };

    public static List<string> ReceiptIds(IEnumerable<string?> ids) =>
        [.. ids.OfType<string>().Distinct(StringComparer.Ordinal)];

    private static ReceiptLink Receipt(
        string id,
        IReadOnlyDictionary<string, StoredReceiptInfo> receipts
    ) =>
        receipts.TryGetValue(id, out var receipt)
            ? new(receipt.Id, receipt.Name, receipt.Mime, ReceiptLink.UriFor(receipt.Id))
            : throw new InvalidOperationException("A ledger entry references a missing receipt.");
}
