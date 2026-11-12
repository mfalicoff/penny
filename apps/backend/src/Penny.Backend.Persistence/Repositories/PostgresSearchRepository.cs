using System.Data;
using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Search;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Search;
using Penny.Backend.Persistence.Receipts;
using Penny.Backend.Persistence.Schema;
using Penny.Backend.Persistence.Schema.Entities;
using Penny.Backend.Persistence.Search;
using Pgvector;
using Pgvector.EntityFrameworkCore;

namespace Penny.Backend.Persistence.Repositories;

// Search over `search_documents` (docs/migration/search.md). Every query applies the
// viewer's authorization (own entries; shared expenses under the household-view rule:
// a current member sees every live expense, a former member those they have a share
// in) before matching, ranking, counting and paging, inside one REPEATABLE READ
// snapshot. Tiers are disjoint UNION ALL branches so each can use its index: GIN
// trigram for LIKE and `<%`, HNSW (with iterative scans) for meaning.
public sealed class PostgresSearchRepository(NpgsqlDataSource source, ReceiptFileStore files)
    : ISearchRepository
{
    public const string TimedOut = "Search took too long. Please retry.";

    // Raw SQL inventory: transaction-local settings EF cannot express. The 2-second
    // statement timeout bounds every search statement; pgvector filters inside the
    // HNSW scan (iterative scans) instead of after ranking.
    private const string Settings =
        "SELECT set_config('statement_timeout', '2000', true), "
        + "set_config('hnsw.iterative_scan', 'relaxed_order', true), "
        + "set_config('hnsw.ef_search', '200', true), "
        + "set_config('pg_trgm.word_similarity_threshold', '0.6', true)";

    private const string Personal = SearchIndexer.Personal;
    private const string Shared = SearchIndexer.Shared;
    private const long Exact = 1_000_000;

    public async Task<StoredSearchPage> SearchAsync(
        SearchCriteria criteria,
        CancellationToken cancellationToken
    )
    {
        try
        {
            await using var context = PennyDbContext.Create(source);
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.RepeatableRead,
                cancellationToken
            );
            await context.Database.ExecuteSqlRawAsync(Settings, cancellationToken);
            var matched = await MatchesAsync(context, criteria, cancellationToken);
            var total = await matched.LongCountAsync(cancellationToken);
            var rows = await Ordered(After(matched, criteria), criteria.Request.Sort)
                .Take(criteria.Limit)
                .ToListAsync(cancellationToken);
            var page = await LoadAsync(context, criteria.ViewerId, total, rows, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return page;
        }
        catch (PostgresException error)
            when (error.SqlState == PostgresErrorCodes.QueryCanceled
                && !cancellationToken.IsCancellationRequested
            )
        {
            throw new BackendFailure(FailureKind.Unavailable, TimedOut);
        }
    }

    private static async Task<IQueryable<SearchRow>> MatchesAsync(
        PennyDbContext context,
        SearchCriteria criteria,
        CancellationToken cancellationToken
    )
    {
        var request = criteria.Request;
        var viewer = criteria.ViewerId;
        var personal = Filtered(context.SearchDocuments.Where(OwnEntries(viewer)), request);
        var shared = Filtered(
            context.SearchDocuments.Where(VisibleShared(context, viewer)),
            request
        );
        var sources = request.Source switch
        {
            SearchReader.Personal => (Personal: true, Shared: false),
            SearchReader.Shared => (Personal: false, Shared: true),
            _ => (Personal: true, Shared: true),
        };
        var query = request.Query;
        var branches = new List<IQueryable<SearchRow>>();
        if (query.Length == 0)
        {
            if (sources.Personal)
                branches.Add(PersonalRows(personal, 0, _ => 0));
            if (sources.Shared)
                branches.Add(SharedRows(context, shared, viewer, 0, _ => 0));
            return Union(branches);
        }
        var pattern = SearchText.ContainsPattern(query);
        var typo = SearchText.CodePoints(query) >= SearchTuning.TypoMinimumLength;
        var nearest = criteria.QueryVector is { } vector
            ? await NearestAsync(context, criteria, new Vector(vector), cancellationToken)
            : [];
        var queryVector = new Vector(criteria.QueryVector ?? new float[SearchSchema.Dimensions]);

        if (sources.Personal)
        {
            Expression<Func<SearchDocument, bool>> text = document =>
                EF.Functions.Like(document.OwnerText, pattern, "\\");
            Expression<Func<SearchDocument, bool>> similar = document =>
                typo && EF.Functions.TrigramsAreWordSimilar(query, document.OwnerText);
            branches.Add(
                PersonalRows(
                    personal.Where(text),
                    1,
                    document => EF.Functions.Like(document.TitleText, pattern, "\\") ? 1 : 2
                )
            );
            if (typo)
                branches.Add(
                    PersonalTypoRows(personal.Where(Predicates.Not(text)).Where(similar), query)
                );
            if (nearest.Count > 0)
                branches.Add(
                    PersonalMeaningRows(
                        personal
                            .Where(Predicates.Not(text))
                            .Where(Predicates.Not(similar))
                            .Where(document => nearest.Contains(document.Id)),
                        queryVector
                    )
                );
        }
        if (sources.Shared)
        {
            // The payer's view includes their account name; other members' does not.
            Expression<Func<SearchDocument, bool>> text = document =>
                (document.PayerId == viewer && EF.Functions.Like(document.OwnerText, pattern, "\\"))
                || (
                    document.PayerId != viewer
                    && EF.Functions.Like(document.DocumentText, pattern, "\\")
                );
            Expression<Func<SearchDocument, bool>> similar = document =>
                typo
                && (
                    (
                        document.PayerId == viewer
                        && EF.Functions.TrigramsAreWordSimilar(query, document.OwnerText)
                    )
                    || (
                        document.PayerId != viewer
                        && EF.Functions.TrigramsAreWordSimilar(query, document.DocumentText)
                    )
                );
            branches.Add(
                SharedRows(
                    context,
                    shared.Where(text),
                    viewer,
                    1,
                    document => EF.Functions.Like(document.TitleText, pattern, "\\") ? 1 : 2
                )
            );
            if (typo)
                branches.Add(
                    SharedTypoRows(
                        context,
                        shared.Where(Predicates.Not(text)).Where(similar),
                        viewer,
                        query
                    )
                );
            if (nearest.Count > 0)
                branches.Add(
                    SharedMeaningRows(
                        context,
                        shared
                            .Where(Predicates.Not(text))
                            .Where(Predicates.Not(similar))
                            .Where(document => nearest.Contains(document.Id)),
                        viewer,
                        queryVector
                    )
                );
        }
        return Union(branches);
    }

    // The closest authorized, filtered documents embedded by the current model, then
    // the query's meaning threshold (`MeaningThreshold`). pgvector applies the filter
    // inside the HNSW scan.
    private static async Task<List<long>> NearestAsync(
        PennyDbContext context,
        SearchCriteria criteria,
        Vector vector,
        CancellationToken cancellationToken
    )
    {
        var viewer = criteria.ViewerId;
        var authorized = criteria.Request.Source switch
        {
            SearchReader.Personal => OwnEntries(viewer),
            SearchReader.Shared => VisibleShared(context, viewer),
            _ => Predicates.Or(OwnEntries(viewer), VisibleShared(context, viewer)),
        };
        var model = criteria.ModelId;
        var closest = await Filtered(context.SearchDocuments.Where(authorized), criteria.Request)
            .Where(document => document.Embedding != null && document.EmbeddingModel == model)
            .OrderBy(document => document.Embedding!.CosineDistance(vector))
            .Take(SearchTuning.MeaningLimit)
            .Select(document => new
            {
                document.Id,
                Distance = document.Embedding!.CosineDistance(vector),
            })
            .ToListAsync(cancellationToken);
        return
        [
            .. closest
                .Where(row => 1 - row.Distance >= criteria.MeaningSimilarity)
                .Select(row => row.Id),
        ];
    }

    private static Expression<Func<SearchDocument, bool>> OwnEntries(string viewer) =>
        document => document.Source == Personal && document.UserId == viewer;

    // The household-view rule (SharedExpenseService.CanSee): any membership period in
    // the household, and either a current period or a share of the expense. Evaluated
    // on every request, so joins, exits and removals apply from their commit.
    private static Expression<Func<SearchDocument, bool>> VisibleShared(
        PennyDbContext context,
        string viewer
    ) =>
        document =>
            document.Source == Shared
            && context.HouseholdMemberPeriods.Any(period =>
                period.HouseholdId == document.HouseholdId && period.UserId == viewer
            )
            && (
                context.HouseholdMemberPeriods.Any(period =>
                    period.HouseholdId == document.HouseholdId
                    && period.UserId == viewer
                    && period.LeftAt == null
                )
                || context.HouseholdSplits.Any(split =>
                    split.ExpenseId == document.ExpenseId && split.UserId == viewer
                )
            );

    private static IQueryable<SearchDocument> Filtered(
        IQueryable<SearchDocument> documents,
        SearchRequest request
    )
    {
        if (request.From is { } from)
            documents = documents.Where(document => document.ItemDate >= from);
        if (request.To is { } to)
            documents = documents.Where(document => document.ItemDate <= to);
        if (request.Kind is { } kind)
            documents = documents.Where(document => document.Kind == kind);
        return documents.AsNoTracking();
    }

    private static IQueryable<SearchRow> PersonalRows(
        IQueryable<SearchDocument> documents,
        long score,
        Expression<Func<SearchDocument, int>> tier
    ) => documents.Select(Row(tier, _ => score, document => document.AmountCents ?? 0));

    private static IQueryable<SearchRow> PersonalTypoRows(
        IQueryable<SearchDocument> documents,
        string query
    ) =>
        documents.Select(
            Row(
                _ => 3,
                document =>
                    (long)
                        Math.Round(
                            EF.Functions.TrigramsWordSimilarity(query, document.OwnerText) * Exact
                        ),
                document => document.AmountCents ?? 0
            )
        );

    private static IQueryable<SearchRow> PersonalMeaningRows(
        IQueryable<SearchDocument> documents,
        Vector vector
    ) =>
        documents.Select(
            Row(
                _ => 4,
                document =>
                    (long)Math.Round((1 - document.Embedding!.CosineDistance(vector)) * Exact),
                document => document.AmountCents ?? 0
            )
        );

    private static IQueryable<SearchRow> SharedRows(
        PennyDbContext context,
        IQueryable<SearchDocument> documents,
        string viewer,
        long score,
        Expression<Func<SearchDocument, int>> tier
    ) => documents.Select(Row(tier, _ => score, Share(context, viewer)));

    private static IQueryable<SearchRow> SharedTypoRows(
        PennyDbContext context,
        IQueryable<SearchDocument> documents,
        string viewer,
        string query
    ) =>
        documents.Select(
            Row(
                _ => 3,
                document =>
                    (long)
                        Math.Round(
                            (
                                document.PayerId == viewer
                                    ? EF.Functions.TrigramsWordSimilarity(query, document.OwnerText)
                                    : EF.Functions.TrigramsWordSimilarity(
                                        query,
                                        document.DocumentText
                                    )
                            ) * Exact
                        ),
                Share(context, viewer)
            )
        );

    private static IQueryable<SearchRow> SharedMeaningRows(
        PennyDbContext context,
        IQueryable<SearchDocument> documents,
        string viewer,
        Vector vector
    ) =>
        documents.Select(
            Row(
                _ => 4,
                document =>
                    (long)Math.Round((1 - document.Embedding!.CosineDistance(vector)) * Exact),
                Share(context, viewer)
            )
        );

    // The viewer's share of a shared expense; 0 for a current member without one.
    private static Expression<Func<SearchDocument, long>> Share(
        PennyDbContext context,
        string viewer
    ) =>
        document =>
            context
                .HouseholdSplits.Where(split =>
                    split.ExpenseId == document.ExpenseId && split.UserId == viewer
                )
                .Select(split => split.AmountCents)
                .FirstOrDefault();

    // Builds `document => new SearchRow { ... }` from the tier, score and amount parts.
    private static Expression<Func<SearchDocument, SearchRow>> Row(
        Expression<Func<SearchDocument, int>> tier,
        Expression<Func<SearchDocument, long>> score,
        Expression<Func<SearchDocument, long>> amount
    )
    {
        Expression<Func<SearchDocument, int, long, long, SearchRow>> shape = (
            document,
            tierValue,
            scoreValue,
            amountValue
        ) =>
            new SearchRow
            {
                Id = document.Id,
                Key = document.ResultKey,
                Source = document.Source,
                EntryId = document.EntryId,
                ExpenseId = document.ExpenseId,
                Date = document.ItemDate,
                Amount = amountValue,
                Tier = tierValue,
                Score = scoreValue,
            };
        var parameter = shape.Parameters[0];
        var body = new ParameterReplacer(
            new Dictionary<ParameterExpression, Expression>
            {
                [shape.Parameters[1]] = Predicates.Body(tier, parameter),
                [shape.Parameters[2]] = Predicates.Body(score, parameter),
                [shape.Parameters[3]] = Predicates.Body(amount, parameter),
            }
        ).Visit(shape.Body);
        return Expression.Lambda<Func<SearchDocument, SearchRow>>(body, parameter);
    }

    private static IQueryable<SearchRow> Union(List<IQueryable<SearchRow>> branches) =>
        branches.Aggregate((left, right) => left.Concat(right));

    // Keyset: rows strictly after the cursor's tuple in the request's order.
    private static IQueryable<SearchRow> After(IQueryable<SearchRow> rows, SearchCriteria criteria)
    {
        if (criteria.After is not { } last)
            return rows;
        var (tier, score, amount, date, key) = (
            last.Tier,
            last.Score,
            last.Amount,
            last.Date,
            last.Key
        );
        return criteria.Request.Sort switch
        {
            SearchReader.Relevance => rows.Where(row =>
                row.Tier > tier
                || (row.Tier == tier && row.Score < score)
                || (row.Tier == tier && row.Score == score && row.Date < date)
                || (
                    row.Tier == tier
                    && row.Score == score
                    && row.Date == date
                    && string.Compare(row.Key, key) > 0
                )
            ),
            SearchReader.DateAscending => rows.Where(row =>
                row.Date > date || (row.Date == date && string.Compare(row.Key, key) > 0)
            ),
            SearchReader.AmountDescending => rows.Where(row =>
                row.Amount < amount
                || (row.Amount == amount && row.Date < date)
                || (row.Amount == amount && row.Date == date && string.Compare(row.Key, key) > 0)
            ),
            SearchReader.AmountAscending => rows.Where(row =>
                row.Amount > amount
                || (row.Amount == amount && row.Date < date)
                || (row.Amount == amount && row.Date == date && string.Compare(row.Key, key) > 0)
            ),
            _ => rows.Where(row =>
                row.Date < date || (row.Date == date && string.Compare(row.Key, key) > 0)
            ),
        };
    }

    // Every order ends with date descending, then key ascending (bytewise, COLLATE "C").
    private static IQueryable<SearchRow> Ordered(IQueryable<SearchRow> rows, string sort) =>
        sort switch
        {
            SearchReader.Relevance => rows.OrderBy(row => row.Tier)
                .ThenByDescending(row => row.Score)
                .ThenByDescending(row => row.Date)
                .ThenBy(row => row.Key),
            SearchReader.DateAscending => rows.OrderBy(row => row.Date).ThenBy(row => row.Key),
            SearchReader.AmountDescending => rows.OrderByDescending(row => row.Amount)
                .ThenByDescending(row => row.Date)
                .ThenBy(row => row.Key),
            SearchReader.AmountAscending => rows.OrderBy(row => row.Amount)
                .ThenByDescending(row => row.Date)
                .ThenBy(row => row.Key),
            _ => rows.OrderByDescending(row => row.Date).ThenBy(row => row.Key),
        };

    // The page's entries and expenses, read in the same snapshot as the match.
    private async Task<StoredSearchPage> LoadAsync(
        PennyDbContext context,
        string viewer,
        long total,
        List<SearchRow> rows,
        CancellationToken cancellationToken
    )
    {
        var entryIds = rows.Where(row => row.EntryId != null).Select(row => row.EntryId!).ToList();
        var expenseIds = rows.Where(row => row.ExpenseId != null)
            .Select(row => row.ExpenseId!)
            .ToList();
        var entries =
            entryIds.Count == 0
                ? []
                : await context
                    .LedgerEntries.AsNoTracking()
                    .Where(entry => entry.UserId == viewer && entryIds.Contains(entry.Id))
                    .Select(entry => new StoredEntry(
                        entry.Id,
                        entry.Title,
                        entry.Kind,
                        entry.TotalCents,
                        entry.ShareCents,
                        entry.CategoryId,
                        entry.AccountId,
                        entry.TripId,
                        entry.EntryDate,
                        entry.Note,
                        entry.ReceiptId,
                        entry.RecurringId
                    ))
                    .ToDictionaryAsync(
                        entry => entry.Id,
                        StringComparer.Ordinal,
                        cancellationToken
                    );
        var receiptIds = entries
            .Values.Select(entry => entry.ReceiptId)
            .OfType<string>()
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var receipts =
            receiptIds.Count == 0
                ? new Dictionary<string, StoredReceiptInfo>(StringComparer.Ordinal)
                : (
                    await context
                        .Receipts.AsNoTracking()
                        .Where(receipt =>
                            receipt.UserId == viewer && receiptIds.Contains(receipt.Id)
                        )
                        .ToListAsync(cancellationToken)
                ).ToDictionary(
                    receipt => receipt.Id,
                    receipt => new StoredReceiptInfo(
                        receipt.Id,
                        files.ReadName(receipt),
                        receipt.Mime
                    ),
                    StringComparer.Ordinal
                );
        var expenses =
            expenseIds.Count == 0
                ? new Dictionary<string, StoredProjectedExpense>(StringComparer.Ordinal)
                : (
                    await new PostgresSharedExpenseTransaction(
                        context,
                        files,
                        cancellationToken
                    ).ProjectedAsync(expenseIds)
                ).ToDictionary(row => row.Expense.Id, StringComparer.Ordinal);
        return new(
            total,
            [
                .. rows.Select(row => new StoredSearchHit(
                    row.Key,
                    row.Tier,
                    row.Score,
                    row.Amount,
                    row.Date,
                    row.EntryId is { } entryId ? entries[entryId] : null,
                    row.ExpenseId is { } expenseId ? expenses[expenseId] : null,
                    row.Amount
                )),
            ],
            receipts
        );
    }

    public async Task<IReadOnlyList<EmbeddingWork>> ClaimEmbeddingsAsync(
        string leaseToken,
        DateTimeOffset now,
        DateTimeOffset leaseUntil,
        int limit,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        Expression<Func<SearchDocument, bool>> due = document =>
            document.EmbeddingDueAt != null
            && document.EmbeddingDueAt <= now
            && (document.LeaseExpiresAt == null || document.LeaseExpiresAt <= now);
        // Candidates first (the partial due index), then a conditional update: the row
        // lock serializes competing claims, and a loser re-checks `due` against the
        // winner's lease and skips the row.
        var candidates = await context
            .SearchDocuments.AsNoTracking()
            .Where(due)
            .OrderBy(document => document.EmbeddingDueAt)
            .ThenBy(document => document.Id)
            .Take(limit)
            .Select(document => document.Id)
            .ToListAsync(cancellationToken);
        if (candidates.Count == 0)
            return [];
        await context
            .SearchDocuments.Where(document => candidates.Contains(document.Id))
            .Where(due)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(document => document.LeaseToken, leaseToken)
                        .SetProperty(document => document.LeaseExpiresAt, leaseUntil),
                cancellationToken
            );
        return await context
            .SearchDocuments.AsNoTracking()
            .Where(document =>
                candidates.Contains(document.Id) && document.LeaseToken == leaseToken
            )
            .OrderBy(document => document.Id)
            .Select(document => new EmbeddingWork(
                document.Id,
                document.EmbeddingSource,
                document.EmbeddingAttempts,
                document.EmbeddingDueAt!.Value
            ))
            .ToListAsync(cancellationToken);
    }

    public async Task<int> CompleteEmbeddingsAsync(
        string leaseToken,
        string modelId,
        IReadOnlyList<EmbeddingResult> results,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        var stored = 0;
        foreach (var result in results)
        {
            var vector = new Vector(result.Vector);
            stored += await context
                .SearchDocuments.Where(document =>
                    document.Id == result.DocumentId
                    && document.LeaseToken == leaseToken
                    && document.EmbeddingSource == result.Passage
                )
                .ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(document => document.Embedding, vector)
                            .SetProperty(document => document.EmbeddingModel, modelId)
                            .SetProperty(document => document.EmbeddingDueAt, (DateTimeOffset?)null)
                            .SetProperty(document => document.EmbeddingAttempts, 0)
                            .SetProperty(document => document.LeaseToken, (string?)null)
                            .SetProperty(
                                document => document.LeaseExpiresAt,
                                (DateTimeOffset?)null
                            ),
                    cancellationToken
                );
        }
        return stored;
    }

    public async Task ReleaseEmbeddingsAsync(
        string leaseToken,
        DateTimeOffset retryAt,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await context
            .SearchDocuments.Where(document => document.LeaseToken == leaseToken)
            .ExecuteUpdateAsync(
                set =>
                    set.SetProperty(document => document.EmbeddingDueAt, retryAt)
                        .SetProperty(
                            document => document.EmbeddingAttempts,
                            document => document.EmbeddingAttempts + 1
                        )
                        .SetProperty(document => document.LeaseToken, (string?)null)
                        .SetProperty(document => document.LeaseExpiresAt, (DateTimeOffset?)null),
                cancellationToken
            );
    }

    public async Task<long> PendingEmbeddingsAsync(CancellationToken cancellationToken)
    {
        await using var context = PennyDbContext.Create(source);
        return await context.SearchDocuments.LongCountAsync(
            document => document.EmbeddingDueAt != null,
            cancellationToken
        );
    }

    public async Task<SearchRebuildReport> RebuildAsync(
        string? userId,
        string modelId,
        CancellationToken cancellationToken
    )
    {
        long written = 0;
        long removed = 0;
        foreach (var user in await UsersAsync(userId, cancellationToken))
        {
            await using var context = PennyDbContext.Create(source);
            await using var transaction = await context.Database.BeginTransactionAsync(
                cancellationToken
            );
            // The ledger row lock orders the rebuild with concurrent ledger saves.
            await context
                .Ledgers.Where(ledger => ledger.UserId == user)
                .ExecuteUpdateAsync(
                    set => set.SetProperty(ledger => ledger.Currency, ledger => ledger.Currency),
                    cancellationToken
                );
            var (personalWritten, personalRemoved) = await SearchIndexer.StageAsync(
                context,
                SearchIndexer.PersonalScope(context, user),
                await ExpectedPersonalAsync(context, user, cancellationToken),
                cancellationToken
            );
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            written += personalWritten;
            removed += personalRemoved;
        }
        foreach (var household in await HouseholdsAsync(userId, cancellationToken))
        {
            await using var context = PennyDbContext.Create(source);
            await using var transaction = await context.Database.BeginTransactionAsync(
                cancellationToken
            );
            // The household row lock orders the rebuild with expense writers.
            await context
                .Households.Where(row => row.Id == household)
                .ExecuteUpdateAsync(
                    set => set.SetProperty(row => row.Name, row => row.Name),
                    cancellationToken
                );
            var (sharedWritten, sharedRemoved) = await SearchIndexer.SyncExpensesAsync(
                context,
                context.HouseholdExpenses.Where(expense => expense.HouseholdId == household),
                cancellationToken
            );
            await transaction.CommitAsync(cancellationToken);
            written += sharedWritten;
            removed += sharedRemoved;
        }
        await using (var context = PennyDbContext.Create(source))
        {
            var queued = await Scope(context, userId)
                .Where(document =>
                    document.EmbeddingDueAt == null
                    && (document.Embedding == null || document.EmbeddingModel != modelId)
                )
                .ExecuteUpdateAsync(
                    set =>
                        set.SetProperty(document => document.EmbeddingDueAt, SearchIndexer.DueNow)
                            .SetProperty(document => document.EmbeddingAttempts, 0),
                    cancellationToken
                );
            return new(written, removed, queued);
        }
    }

    public async Task<SearchVerifyReport> VerifyAsync(
        string? userId,
        string modelId,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        await using var transaction = await context.Database.BeginTransactionAsync(
            IsolationLevel.RepeatableRead,
            cancellationToken
        );
        long missing = 0;
        long orphaned = 0;
        long stale = 0;
        void Compare(
            IReadOnlyList<ExpectedDocument> expected,
            Dictionary<string, (long Id, ExpectedDocument Document)> stored
        )
        {
            foreach (var document in expected)
                if (!stored.Remove(document.ResultKey, out var current))
                    missing++;
                else if (current.Document != document)
                    stale++;
            orphaned += stored.Count;
        }
        foreach (var user in await UsersAsync(userId, cancellationToken))
            Compare(
                await ExpectedPersonalAsync(context, user, cancellationToken),
                await SearchIndexer.StoredAsync(
                    SearchIndexer.PersonalScope(context, user),
                    cancellationToken
                )
            );
        var households = await HouseholdsAsync(userId, cancellationToken);
        var expenses = context.HouseholdExpenses.Where(expense =>
            households.Contains(expense.HouseholdId)
        );
        var expenseIds = expenses.Select(expense => expense.Id);
        Compare(
            await SearchIndexer.ExpectedSharedAsync(context, expenses, cancellationToken),
            await SearchIndexer.StoredAsync(
                context.SearchDocuments.Where(document =>
                    document.Source == Shared
                    && (
                        userId == null
                        || (document.ExpenseId != null && expenseIds.Contains(document.ExpenseId))
                    )
                ),
                cancellationToken
            )
        );
        var scope = Scope(context, userId);
        return new(
            await scope.LongCountAsync(cancellationToken),
            missing,
            orphaned,
            stale,
            await scope.LongCountAsync(
                document => document.EmbeddingDueAt != null,
                cancellationToken
            ),
            await scope.LongCountAsync(
                document =>
                    document.EmbeddingDueAt == null
                    && (document.Embedding == null || document.EmbeddingModel != modelId),
                cancellationToken
            )
        );
    }

    private static async Task<IReadOnlyList<ExpectedDocument>> ExpectedPersonalAsync(
        PennyDbContext context,
        string userId,
        CancellationToken cancellationToken
    )
    {
        var categories = await context
            .LedgerCategories.AsNoTracking()
            .Where(category => category.UserId == userId)
            .ToDictionaryAsync(
                category => category.Id,
                category => category.Name,
                StringComparer.Ordinal,
                cancellationToken
            );
        var accounts = await context
            .LedgerAccounts.AsNoTracking()
            .Where(account => account.UserId == userId)
            .ToDictionaryAsync(
                account => account.Id,
                account => account.Name,
                StringComparer.Ordinal,
                cancellationToken
            );
        var entries = await context
            .LedgerEntries.AsNoTracking()
            .Where(entry => entry.UserId == userId)
            .Select(entry => new StoredEntry(
                entry.Id,
                entry.Title,
                entry.Kind,
                entry.TotalCents,
                entry.ShareCents,
                entry.CategoryId,
                entry.AccountId,
                entry.TripId,
                entry.EntryDate,
                entry.Note,
                entry.ReceiptId,
                entry.RecurringId
            ))
            .ToListAsync(cancellationToken);
        return SearchIndexer.ExpectedPersonal(userId, entries, categories, accounts);
    }

    private async Task<List<string>> UsersAsync(string? userId, CancellationToken cancellationToken)
    {
        await using var context = PennyDbContext.Create(source);
        return await context
            .Ledgers.AsNoTracking()
            .Where(ledger => userId == null || ledger.UserId == userId)
            .OrderBy(ledger => ledger.UserId)
            .Select(ledger => ledger.UserId)
            .ToListAsync(cancellationToken);
    }

    // Every household, or those the user ever joined (current, former, archived).
    private async Task<List<string>> HouseholdsAsync(
        string? userId,
        CancellationToken cancellationToken
    )
    {
        await using var context = PennyDbContext.Create(source);
        return await context
            .Households.AsNoTracking()
            .Where(household =>
                userId == null
                || context.HouseholdMemberPeriods.Any(period =>
                    period.HouseholdId == household.Id && period.UserId == userId
                )
            )
            .OrderBy(household => household.Id)
            .Select(household => household.Id)
            .ToListAsync(cancellationToken);
    }

    // The documents a rebuild or verify of `userId` (or everyone) covers.
    private static IQueryable<SearchDocument> Scope(PennyDbContext context, string? userId) =>
        userId is null
            ? context.SearchDocuments
            : context.SearchDocuments.Where(document =>
                (document.Source == Personal && document.UserId == userId)
                || (
                    document.Source == Shared
                    && context.HouseholdMemberPeriods.Any(period =>
                        period.HouseholdId == document.HouseholdId && period.UserId == userId
                    )
                )
            );
}
