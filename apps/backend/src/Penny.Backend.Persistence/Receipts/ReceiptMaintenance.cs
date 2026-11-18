using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Penny.Backend.Persistence.InboundMail;
using Penny.Backend.Persistence.Schema;

namespace Penny.Backend.Persistence.Receipts;

// Consistency between receipt metadata (PostgreSQL) and encrypted bytes (filesystem),
// for the `receipts-verify` and `receipts-sweep` commands. Reports hold counts only:
// never ids, names, paths or contents.
public sealed class ReceiptMaintenance(
    NpgsqlDataSource source,
    ReceiptFileStore files,
    InboundMailSealer? inbound = null
)
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

    // Deletes receipts nothing links to once they are older than `unlinkedRetention`
    // (rows and files, MAZ-165), then files no row references (and leftover temporary
    // files) once they are older than SweepGrace. A dry run only counts them.
    public async Task<ReceiptSweepReport> SweepAsync(
        DateTimeOffset now,
        TimeSpan unlinkedRetention,
        bool dryRun,
        CancellationToken cancellationToken
    )
    {
        var unlinked = await UnlinkedReceipts.RemoveAsync(
            source,
            files,
            now - unlinkedRetention,
            dryRun,
            cancellationToken
        );
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
        var (inboundExamined, inboundRemoved) = await SweepInboundAsync(
            context,
            now,
            dryRun,
            cancellationToken
        );
        return new(candidates.Count + inboundExamined, removed + inboundRemoved, dryRun, unlinked);
    }

    // Raw emailed receipts (MAZ-184) under `inbound/`: files no inbound message
    // references (a write whose row was never committed) and temporary files, once
    // past the same grace period. Rows drop their path when the file is deleted.
    private async Task<(long Examined, long Removed)> SweepInboundAsync(
        PennyDbContext context,
        DateTimeOffset now,
        bool dryRun,
        CancellationToken cancellationToken
    )
    {
        if (inbound is null)
            return (0, 0);
        var candidates = inbound
            .ListFiles()
            .Where(file => file.Modified <= now - SweepGrace)
            .ToList();
        var referenced = new HashSet<string>(StringComparer.Ordinal);
        var paths = candidates
            .Where(file => !file.Temporary)
            .Select(file => file.StoragePath)
            .ToList();
        foreach (var chunk in paths.Chunk(1000))
            referenced.UnionWith(
                await context
                    .InboundMessages.AsNoTracking()
                    .Where(message =>
                        message.StoragePath != null && chunk.Contains(message.StoragePath)
                    )
                    .Select(message => message.StoragePath!)
                    .ToListAsync(cancellationToken)
            );
        long removed = 0;
        foreach (var file in candidates)
        {
            if (!file.Temporary && referenced.Contains(file.StoragePath))
                continue;
            if (!dryRun)
                inbound.Delete(file);
            removed++;
        }
        return (candidates.Count, removed);
    }
}
