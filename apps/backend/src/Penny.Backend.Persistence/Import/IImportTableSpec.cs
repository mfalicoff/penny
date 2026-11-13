using Penny.Backend.Persistence.Schema;

namespace Penny.Backend.Persistence.Import;

internal interface IImportTableSpec
{
    string Table(PennyDbContext context);
    void Add(PennyDbContext context, ImportPlan plan);
    Task<bool> AnyAsync(PennyDbContext context, CancellationToken ct);
    Task<ImportTableReport> ExpectedAsync(PennyDbContext context, ImportPlan plan);
    Task<ImportTableReport> ActualAsync(PennyDbContext context, CancellationToken ct);
}
