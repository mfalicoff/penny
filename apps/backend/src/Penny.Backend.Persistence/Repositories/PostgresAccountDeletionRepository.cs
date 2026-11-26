using System.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.InboundMail;
using Penny.Backend.Persistence.Receipts;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Search;

namespace Penny.Backend.Persistence.Repositories;

// Account deletion (MAZ-152). One READ COMMITTED transaction with the household lock order
// (households, then the ledger row, then the user row), so it serializes with membership
// changes, ledger saves and profile edits. Rows are deleted children first; the foreign
// keys to `users` don't cascade, so a missed table fails the delete instead of losing
// shared data.
public sealed class PostgresAccountDeletionRepository(
    NpgsqlDataSource source,
    ReceiptFileStore receiptFiles,
    ReceiptStoreSettings receiptSettings
) : IAccountDeletionRepository
{
    private readonly InboundMailSealer mailFiles = new(receiptSettings);

    public async Task<bool> DeleteAsync(
        string userId,
        string tombstoneEmail,
        DateTimeOffset deletedAt,
        Func<IHouseholdTransaction, Task> leaveHouseholds,
        CancellationToken cancellationToken
    )
    {
        List<string> receiptPaths;
        List<string> mailPaths;
        await using (var context = PennyDbContext.Create(source))
        {
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.ReadCommitted,
                cancellationToken
            );
            if (
                !await context
                    .Users.AsNoTracking()
                    .AnyAsync(
                        user => user.Id == userId && user.DeletedAt == null,
                        cancellationToken
                    )
            )
                return false;
            await leaveHouseholds(new PostgresHouseholdTransaction(context, cancellationToken));

            // The ledger row, as every personal save locks it first.
            await context
                .Ledgers.Where(ledger => ledger.UserId == userId)
                .ExecuteUpdateAsync(
                    set => set.SetProperty(ledger => ledger.Revision, ledger => ledger.Revision),
                    cancellationToken
                );
            // The user row: a concurrent deletion waits here and then finds it deleted.
            if (
                await context
                    .Users.Where(user => user.Id == userId && user.DeletedAt == null)
                    .ExecuteUpdateAsync(
                        set => set.SetProperty(user => user.DeletedAt, deletedAt),
                        cancellationToken
                    ) != 1
            )
                return false;

            var receipts = context.Receipts.Where(receipt => receipt.UserId == userId);
            var receiptIds = receipts.Select(receipt => receipt.Id);
            receiptPaths = await receipts
                .Select(receipt => receipt.StoragePath)
                .ToListAsync(cancellationToken);

            // Shared expenses and rules stay. The person's receipts and account names go
            // from them; a changed expense gets a new revision, so clients refetch it.
            var touched = context.HouseholdExpenses.Where(expense =>
                (expense.PayerId == userId && expense.AccountId != null)
                || (expense.ReceiptId != null && receiptIds.Contains(expense.ReceiptId))
            );
            var touchedIds = await touched
                .Select(expense => expense.Id)
                .ToListAsync(cancellationToken);
            await context
                .HouseholdExpenses.Where(expense => touchedIds.Contains(expense.Id))
                .ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(
                                expense => expense.AccountId,
                                expense => expense.PayerId == userId ? null : expense.AccountId
                            )
                            .SetProperty(
                                expense => expense.ReceiptId,
                                expense =>
                                    expense.ReceiptId != null
                                    && receiptIds.Contains(expense.ReceiptId)
                                        ? null
                                        : expense.ReceiptId
                            )
                            .SetProperty(
                                expense => expense.Revision,
                                expense => expense.Revision + 1
                            ),
                    cancellationToken
                );
            await context
                .HouseholdRecurring.Where(rule =>
                    (rule.PayerId == userId && rule.AccountId != null)
                    || (rule.ReceiptId != null && receiptIds.Contains(rule.ReceiptId))
                )
                .ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(
                                rule => rule.AccountId,
                                rule => rule.PayerId == userId ? null : rule.AccountId
                            )
                            .SetProperty(
                                rule => rule.ReceiptId,
                                rule =>
                                    rule.ReceiptId != null && receiptIds.Contains(rule.ReceiptId)
                                        ? null
                                        : rule.ReceiptId
                            )
                            .SetProperty(rule => rule.Revision, rule => rule.Revision + 1),
                    cancellationToken
                );
            // Search (MAZ-121): the person's own documents go; the shared documents of the
            // changed expenses are rewritten without the account name and receipt.
            await SearchIndexer
                .PersonalScope(context, userId)
                .ExecuteDeleteAsync(cancellationToken);
            await SearchIndexer.SyncExpensesAsync(
                context,
                context.HouseholdExpenses.Where(expense => touchedIds.Contains(expense.Id)),
                cancellationToken
            );
            await context
                .SearchDocuments.Where(document =>
                    document.ReceiptId != null && receiptIds.Contains(document.ReceiptId)
                )
                .ExecuteDeleteAsync(cancellationToken);

            // The personal ledger.
            await context
                .LedgerDismissedSuggestions.Where(suggestion => suggestion.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);
            await context
                .LedgerEntries.Where(entry => entry.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);
            await context
                .LedgerRecurring.Where(rule => rule.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);
            await context
                .LedgerTrips.Where(trip => trip.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);
            await context
                .LedgerAccounts.Where(account => account.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);
            await context
                .LedgerCategories.Where(category => category.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);
            await context
                .Ledgers.Where(ledger => ledger.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // Emailed receipts (MAZ-184): inbox items (their receipt links cascade), the
            // raw messages and the receipt address.
            await context
                .ReceiptInboxItems.Where(item => item.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);
            var messages = context.InboundMessages.Where(message => message.UserId == userId);
            mailPaths =
            [
                .. (
                    await messages
                        .Select(message => message.StoragePath)
                        .ToListAsync(cancellationToken)
                ).OfType<string>(),
            ];
            await messages.ExecuteDeleteAsync(cancellationToken);
            await context
                .ReceiptMailAddresses.Where(address => address.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // Receipts: text first (its chunks cascade), then the rows.
            await context
                .ReceiptTexts.Where(text => receiptIds.Contains(text.ReceiptId))
                .ExecuteDeleteAsync(cancellationToken);
            await receipts.ExecuteDeleteAsync(cancellationToken);

            // Sign-ins, devices and messages waiting to be sent.
            var pushOutbox = context.PushOutbox.Where(message => message.UserId == userId);
            await context
                .PushDeliveries.Where(delivery =>
                    pushOutbox.Any(message => message.Id == delivery.OutboxId)
                )
                .ExecuteDeleteAsync(cancellationToken);
            await pushOutbox.ExecuteDeleteAsync(cancellationToken);
            await context
                .PushDevices.Where(device => device.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);
            await context
                .Sessions.Where(session => session.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);
            await context
                .MailOutbox.Where(message =>
                    message.UserId == userId || message.AccountId == userId
                )
                .ExecuteDeleteAsync(cancellationToken);
            await context
                .OidcIdentities.Where(identity => identity.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);
            await context
                .EmailVerifications.Where(verification => verification.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);
            await context
                .PasswordResets.Where(reset => reset.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);
            await context
                .UserAvatars.Where(avatar => avatar.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // The tombstone: no email, password or profile.
            await context
                .Users.Where(user => user.Id == userId)
                .ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(user => user.Email, tombstoneEmail)
                            .SetProperty(user => user.Password, "")
                            .SetProperty(user => user.DisplayName, (string?)null)
                            .SetProperty(user => user.NameFromProvider, false)
                            .SetProperty(user => user.AvatarFromProvider, false)
                            .SetProperty(user => user.NamePromptDismissed, false)
                            .SetProperty(user => user.AvatarVersion, (string?)null)
                            .SetProperty(user => user.AvatarSourceHash, (byte[]?)null)
                            .SetProperty(user => user.PasswordChangedAt, (DateTimeOffset?)null)
                            .SetProperty(user => user.EmailVerifiedAt, (DateTimeOffset?)null),
                    cancellationToken
                );
            // Not cancellable: once the rows are gone, the outcome must be known.
            await transaction.CommitAsync(CancellationToken.None);
        }
        foreach (var path in receiptPaths)
            TryDelete(() => receiptFiles.Delete(path));
        foreach (var path in mailPaths)
            TryDelete(() => mailFiles.Delete(path));
        return true;
    }

    // The rows are gone; `receipts-sweep` removes an unreferenced file later.
    private static void TryDelete(Action delete)
    {
        try
        {
            delete();
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
