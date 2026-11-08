using Microsoft.EntityFrameworkCore;
using Penny.Backend.Persistence.Schema;

namespace Penny.Backend.Persistence.Import;

internal sealed class ImportTableSpec<T>(Func<ImportPlan, List<T>> rows) : IImportTableSpec
    where T : class
{
    public string Table(PennyDbContext context) =>
        context.Model.FindEntityType(typeof(T))!.GetTableName()!;

    public void Add(PennyDbContext context, ImportPlan plan) =>
        context.Set<T>().AddRange(rows(plan));

    public Task<bool> AnyAsync(PennyDbContext context, CancellationToken ct) =>
        context.Set<T>().AnyAsync(ct);

    public Task<ImportTableReport> ExpectedAsync(PennyDbContext context, ImportPlan plan) =>
        Task.FromResult(ImportDigest.Compute(context.Model.FindEntityType(typeof(T))!, rows(plan)));

    public async Task<ImportTableReport> ActualAsync(
        PennyDbContext context,
        CancellationToken ct
    ) =>
        ImportDigest.Compute(
            context.Model.FindEntityType(typeof(T))!,
            await context.Set<T>().AsNoTracking().ToListAsync(ct)
        );
}
