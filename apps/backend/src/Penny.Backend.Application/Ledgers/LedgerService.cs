using System.Text.Json;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Ledgers;

// Port of the legacy ledger service (server/application/ledger.ts). Messages, failure
// kinds and the order of checks are part of the client contract. All checks after
// document validation run inside the saving transaction, so they see the same state
// the compare-and-increment commits against.
public sealed class LedgerService(ILedgerRepository ledgers, IReceiptRepository receipts)
{
    public const string InvalidLedger = "Invalid ledger data.";
    public const string ReloadForAccounts =
        "Update or reload the app before saving payment accounts.";
    public const string ReloadForTrips = "Update or reload the app before saving trips.";
    public const string CurrencyMismatch =
        "Your ledger currency must match your active households.";
    public const string LinkedAccount =
        "Remove household expense links before deleting this payment account.";
    public const string ForeignReceipt = "Receipt does not belong to this account.";
    public const string Conflict =
        "Your data changed on another device. Please refresh and try again.";

    public async Task<LedgerSnapshot> ReadAsync(string userId, CancellationToken cancellationToken)
    {
        // Every account is created with a ledger; a missing one is a server fault.
        var stored =
            await ledgers.ReadAsync(userId, cancellationToken)
            ?? throw new InvalidOperationException("Account ledger is missing.");
        var receiptInfo = await receipts.DescribeAsync(
            userId,
            LedgerMapper.ReceiptIds(stored.Entries.Select(entry => entry.ReceiptId)),
            cancellationToken
        );
        return new(stored.Revision, LedgerMapper.ToDocument(stored, receiptInfo));
    }

    // `body` is null when the request had no JSON body (legacy `{}`).
    public async Task<LedgerSnapshot> SaveAsync(
        string userId,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        var write =
            (body is { } value ? LedgerReader.Read(value) : null)
            ?? throw new BackendFailure(FailureKind.Invalid, InvalidLedger);
        var ledger = write.Ledger;
        if (
            !await ledgers.TrySaveAsync(
                userId,
                write.Revision,
                LedgerMapper.ToStored(ledger, write.Revision),
                state => Verify(write, state),
                cancellationToken
            )
        )
            throw new BackendFailure(FailureKind.Conflict, Conflict);
        var receiptInfo = await receipts.DescribeAsync(
            userId,
            LedgerMapper.ReceiptIds(ledger.Transactions.Select(entry => entry.Receipt?.Id)),
            cancellationToken
        );
        return new(write.Revision + 1, LedgerMapper.WithReceipts(ledger, receiptInfo));
    }

    private static void Verify(LedgerWrite write, LedgerWriteState state)
    {
        var ledger = write.Ledger;
        // Older clients drop account fields when rebuilding entries. Do not let their
        // legacy snapshots silently erase payment accounts or their links.
        if (write.SourceVersion < 3 && state.HasAccounts)
            throw new BackendFailure(FailureKind.Invalid, ReloadForAccounts);
        // The same protection for trips (v2 addition): a client that omits trips
        // would otherwise delete them and their entry links.
        if (write.OmittedTrips && state.HasTrips)
            throw new BackendFailure(FailureKind.Invalid, ReloadForTrips);
        if (state.HouseholdCurrencies.Any(currency => currency != ledger.Currency))
            throw new BackendFailure(FailureKind.Invalid, CurrencyMismatch);
        var accountIds = ledger
            .Accounts.Select(account => account.Id)
            .ToHashSet(StringComparer.Ordinal);
        if (state.LinkedAccountIds.Any(accountId => !accountIds.Contains(accountId)))
            throw new BackendFailure(FailureKind.Invalid, LinkedAccount);
        foreach (var entry in ledger.Transactions)
            if (entry.Receipt is not null && !state.OwnedReceiptIds.Contains(entry.Receipt.Id))
                throw new BackendFailure(FailureKind.Invalid, ForeignReceipt);
        // Shared trip links must name a real household (a v2 foreign key).
        foreach (var trip in ledger.Trips)
            if (
                trip.SharedHouseholdId is not null
                && !state.ExistingHouseholdIds.Contains(trip.SharedHouseholdId)
            )
                throw new BackendFailure(FailureKind.Invalid, InvalidLedger);
    }
}
