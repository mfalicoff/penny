using Microsoft.EntityFrameworkCore;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Search;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;

namespace Penny.Backend.Persistence.Search;

// Keeps `search_documents` equal to what the source rows imply (MAZ-121). Writers call
// it inside their own transaction, before commit; `search-rebuild` and `search-verify`
// use the same computation. Only changed columns are written. A changed embedding
// source clears the embedding and queues the row in the embedding outbox, so a stale
// vector never matches; until the worker catches up, the row matches by text only.
internal static class SearchIndexer
{
    public const string Personal = "personal";
    public const string Shared = "shared";

    // New and changed rows are due at once; retries use real instants.
    public static readonly DateTimeOffset DueNow = DateTimeOffset.UnixEpoch;

    public static IReadOnlyList<ExpectedDocument> ExpectedPersonal(
        string userId,
        IEnumerable<StoredEntry> entries,
        IReadOnlyDictionary<string, string> categories,
        IReadOnlyDictionary<string, string> accounts
    ) =>
        [
            .. entries.Select(entry => new ExpectedDocument(
                Personal,
                Personal + ":" + entry.Id,
                userId,
                entry.Id,
                null,
                null,
                null,
                entry.Kind,
                entry.Date,
                entry.ShareCents,
                SearchDocumentText.Build(
                    entry.Title,
                    entry.Note,
                    categories.GetValueOrDefault(entry.CategoryId, ""),
                    entry.AccountId is { } account ? accounts.GetValueOrDefault(account) : null
                )
            )),
        ];

    // The documents of the live expenses in `scope`, with the payer's account name as
    // stored now (call after the payer's ledger changes are saved).
    public static async Task<IReadOnlyList<ExpectedDocument>> ExpectedSharedAsync(
        PennyDbContext context,
        IQueryable<HouseholdExpense> scope,
        CancellationToken cancellationToken
    )
    {
        var rows = await scope
            .AsNoTracking()
            .Where(expense => expense.DeletedAt == null)
            .Select(expense => new
            {
                expense.Id,
                expense.HouseholdId,
                expense.PayerId,
                expense.Title,
                expense.Note,
                expense.CategoryName,
                expense.ExpenseDate,
                Account = expense.AccountId == null
                    ? null
                    : context
                        .LedgerAccounts.Where(account =>
                            account.UserId == expense.PayerId && account.Id == expense.AccountId
                        )
                        .Select(account => account.Name)
                        .FirstOrDefault(),
            })
            .ToListAsync(cancellationToken);
        return
        [
            .. rows.Select(row => new ExpectedDocument(
                Shared,
                Shared + ":" + row.Id,
                null,
                null,
                row.Id,
                row.HouseholdId,
                row.PayerId,
                "expense",
                row.ExpenseDate,
                null,
                SearchDocumentText.Build(row.Title, row.Note, row.CategoryName, row.Account)
            )),
        ];
    }

    // The stored documents of a scope, without their vectors.
    public static async Task<Dictionary<string, (long Id, ExpectedDocument Document)>> StoredAsync(
        IQueryable<SearchDocument> scope,
        CancellationToken cancellationToken
    ) =>
        (
            await scope
                .AsNoTracking()
                .Select(row => new
                {
                    row.Id,
                    row.Source,
                    row.ResultKey,
                    row.UserId,
                    row.EntryId,
                    row.ExpenseId,
                    row.HouseholdId,
                    row.PayerId,
                    row.Kind,
                    row.ItemDate,
                    row.AmountCents,
                    row.TitleText,
                    row.DocumentText,
                    row.OwnerText,
                    row.EmbeddingSource,
                })
                .ToListAsync(cancellationToken)
        ).ToDictionary(
            row => row.ResultKey,
            row =>
                (
                    row.Id,
                    new ExpectedDocument(
                        row.Source,
                        row.ResultKey,
                        row.UserId,
                        row.EntryId,
                        row.ExpenseId,
                        row.HouseholdId,
                        row.PayerId,
                        row.Kind,
                        row.ItemDate,
                        row.AmountCents,
                        new SearchDocumentText(
                            row.TitleText,
                            row.DocumentText,
                            row.OwnerText,
                            row.EmbeddingSource
                        )
                    )
                ),
            StringComparer.Ordinal
        );

    // Stages inserts, updates and deletes that make `scope` equal `expected`; the
    // caller saves. Result keys are unique within a scope (one user's entries, or a
    // set of expenses).
    public static async Task<(int Written, int Removed)> StageAsync(
        PennyDbContext context,
        IQueryable<SearchDocument> scope,
        IReadOnlyList<ExpectedDocument> expected,
        CancellationToken cancellationToken
    )
    {
        var stored = await StoredAsync(scope, cancellationToken);
        var written = 0;
        foreach (var document in expected)
        {
            if (!stored.Remove(document.ResultKey, out var current))
            {
                context.SearchDocuments.Add(New(document));
                written++;
                continue;
            }
            if (current.Document == document)
                continue;
            var row = Stub(current.Id, current.Document);
            context.SearchDocuments.Attach(row);
            var entry = context.Entry(row);
            entry.Property(item => item.HouseholdId).CurrentValue = document.HouseholdId;
            entry.Property(item => item.PayerId).CurrentValue = document.PayerId;
            entry.Property(item => item.Kind).CurrentValue = document.Kind;
            entry.Property(item => item.ItemDate).CurrentValue = document.ItemDate;
            entry.Property(item => item.AmountCents).CurrentValue = document.AmountCents;
            entry.Property(item => item.TitleText).CurrentValue = document.Text.Title;
            entry.Property(item => item.DocumentText).CurrentValue = document.Text.Document;
            entry.Property(item => item.OwnerText).CurrentValue = document.Text.OwnerDocument;
            if (
                !string.Equals(
                    current.Document.Text.EmbeddingSource,
                    document.Text.EmbeddingSource,
                    StringComparison.Ordinal
                )
            )
            {
                entry.Property(item => item.EmbeddingSource).CurrentValue = document
                    .Text
                    .EmbeddingSource;
                Queue(entry);
            }
            written++;
        }
        foreach (var (id, document) in stored.Values)
            context.SearchDocuments.Remove(Stub(id, document));
        return (written, stored.Count);
    }

    // Personal documents of a ledger save, staged before the save so EF orders them
    // around the entry inserts and deletes they reference.
    public static Task<(int Written, int Removed)> StageLedgerAsync(
        PennyDbContext context,
        string userId,
        StoredLedger ledger,
        CancellationToken cancellationToken
    ) =>
        StageAsync(
            context,
            PersonalScope(context, userId),
            ExpectedPersonal(
                userId,
                ledger.Entries,
                ledger.Categories.ToDictionary(
                    category => category.Id,
                    category => category.Name,
                    StringComparer.Ordinal
                ),
                ledger.Accounts.ToDictionary(
                    account => account.Id,
                    account => account.Name,
                    StringComparer.Ordinal
                )
            ),
            cancellationToken
        );

    // Shared documents in `expenses` (live or deleted), staged and saved. Deleted
    // expenses lose their document.
    public static async Task<(int Written, int Removed)> SyncExpensesAsync(
        PennyDbContext context,
        IQueryable<HouseholdExpense> expenses,
        CancellationToken cancellationToken
    )
    {
        var ids = expenses.Select(expense => expense.Id);
        var changes = await StageAsync(
            context,
            context.SearchDocuments.Where(document =>
                document.ExpenseId != null && ids.Contains(document.ExpenseId)
            ),
            await ExpectedSharedAsync(context, expenses, cancellationToken),
            cancellationToken
        );
        await context.SaveChangesAsync(cancellationToken);
        return changes;
    }

    // After a ledger save: the payer's account names appear in the payer's view of
    // their shared expenses, so an account rename rewrites those documents too.
    public static Task<(int Written, int Removed)> SyncPaidExpensesAsync(
        PennyDbContext context,
        string userId,
        CancellationToken cancellationToken
    ) =>
        SyncExpensesAsync(
            context,
            context.HouseholdExpenses.Where(expense =>
                expense.PayerId == userId && expense.AccountId != null && expense.DeletedAt == null
            ),
            cancellationToken
        );

    public static IQueryable<SearchDocument> PersonalScope(PennyDbContext context, string userId) =>
        context.SearchDocuments.Where(document =>
            document.Source == Personal && document.UserId == userId
        );

    private static void Queue(
        Microsoft.EntityFrameworkCore.ChangeTracking.EntityEntry<SearchDocument> entry
    )
    {
        entry.Property(item => item.Embedding).CurrentValue = null;
        entry.Property(item => item.Embedding).IsModified = true;
        entry.Property(item => item.EmbeddingModel).CurrentValue = null;
        entry.Property(item => item.EmbeddingModel).IsModified = true;
        entry.Property(item => item.EmbeddingDueAt).CurrentValue = DueNow;
        entry.Property(item => item.EmbeddingDueAt).IsModified = true;
        entry.Property(item => item.EmbeddingAttempts).CurrentValue = 0;
        entry.Property(item => item.EmbeddingAttempts).IsModified = true;
        entry.Property(item => item.LeaseToken).CurrentValue = null;
        entry.Property(item => item.LeaseToken).IsModified = true;
        entry.Property(item => item.LeaseExpiresAt).CurrentValue = null;
        entry.Property(item => item.LeaseExpiresAt).IsModified = true;
    }

    private static SearchDocument New(ExpectedDocument document) =>
        new()
        {
            Source = document.Source,
            ResultKey = document.ResultKey,
            UserId = document.UserId,
            EntryId = document.EntryId,
            ExpenseId = document.ExpenseId,
            HouseholdId = document.HouseholdId,
            PayerId = document.PayerId,
            Kind = document.Kind,
            ItemDate = document.ItemDate,
            AmountCents = document.AmountCents,
            TitleText = document.Text.Title,
            DocumentText = document.Text.Document,
            OwnerText = document.Text.OwnerDocument,
            EmbeddingSource = document.Text.EmbeddingSource,
            EmbeddingDueAt = DueNow,
        };

    // An attached stand-in carrying the stored values (key and foreign keys included),
    // so EF writes only what changes and orders deletes before the rows they reference.
    private static SearchDocument Stub(long id, ExpectedDocument document)
    {
        var row = New(document);
        row.Id = id;
        row.EmbeddingDueAt = null;
        return row;
    }
}
