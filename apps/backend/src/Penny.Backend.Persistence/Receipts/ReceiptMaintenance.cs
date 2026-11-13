using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Persistence.Schema;

namespace Penny.Backend.Persistence.Receipts;

// Consistency between receipt metadata (PostgreSQL) and encrypted bytes (filesystem),
// for the `receipts-verify` and `receipts-sweep` commands. Reports hold counts only:
// never ids, names, paths or contents.
public sealed class ReceiptMaintenance(NpgsqlDataSource source, ReceiptFileStore files)
{
    // Uploads write the file before committing the row; a file younger than this may
    // still be waiting for its row, so the sweep leaves it alone.
    public static readonly TimeSpan SweepGrace = TimeSpan.FromHours(1);

    // Decrypts every row's file and name and checks the stored size. Missing files
    // and authentication failures are counted, not thrown.
    public async Task<ReceiptVerifyReport> VerifyAsync(CancellationToken cancellationToken)
    {
        long receipts = 0,
            missing = 0,
            corrupt = 0,
            bytes = 0;
        var referenced = new HashSet<string>(StringComparer.Ordinal);
        await using (var context = PennyDbContext.Create(source))
        {
            await foreach (
                var row in context
                    .Receipts.AsNoTracking()
                    .OrderBy(receipt => receipt.Id)
                    .AsAsyncEnumerable()
                    .WithCancellation(cancellationToken)
            )
            {
                receipts++;
                referenced.Add(row.StoragePath);
                try
                {
                    var content = await files.ReadContentAsync(row, cancellationToken);
                    files.ReadName(row);
                    if (content.LongLength != row.SizeBytes)
                        corrupt++;
                    else
                        bytes += content.LongLength;
                }
                catch (Exception error)
                    when (error is FileNotFoundException or DirectoryNotFoundException)
                {
                    missing++;
                }
                catch (CryptographicException)
                {
                    corrupt++;
                }
            }
        }
        var unreferenced = files
            .ListFiles()
            .LongCount(file => file.Temporary || !referenced.Contains(file.StoragePath));
        return new(receipts, receipts - missing - corrupt, missing, corrupt, unreferenced, bytes);
    }

    // Deletes files no row references (and leftover temporary files) once they are
    // older than SweepGrace. A dry run only counts them.
    public async Task<ReceiptSweepReport> SweepAsync(
        DateTimeOffset now,
        bool dryRun,
        CancellationToken cancellationToken
    )
    {
        // Listing files before reading the rows means a file that gains its row in
        // between is still protected: it was written within the grace period.
        var candidates = files
            .ListFiles()
            .Where(file => file.Modified <= now - SweepGrace)
            .ToList();
        await using var context = PennyDbContext.Create(source);
        var paths = candidates
            .Where(file => !file.Temporary)
            .Select(file => file.StoragePath)
            .ToList();
        var referenced = new HashSet<string>(StringComparer.Ordinal);
        foreach (var chunk in paths.Chunk(1000))
            referenced.UnionWith(
                await context
                    .Receipts.AsNoTracking()
                    .Where(receipt => chunk.Contains(receipt.StoragePath))
                    .Select(receipt => receipt.StoragePath)
                    .ToListAsync(cancellationToken)
            );
        long removed = 0;
        foreach (var file in candidates)
        {
            if (!file.Temporary && referenced.Contains(file.StoragePath))
                continue;
            if (!dryRun)
                files.Delete(file);
            removed++;
        }
        return new(candidates.Count, removed, dryRun);
    }
}
