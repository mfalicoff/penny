using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Persistence.Receipts;

namespace Penny.Backend.Persistence.Health;

// MAZ-63: the receipt root must be writable with free space left, or uploads fail
// after the database accepted the request. It ensures the root exists, as the first
// upload would, and writes and removes one empty probe file; it never reads, moves
// or deletes receipt data.
public sealed class ReceiptStorageReadiness(ReceiptStoreSettings settings, long minimumFreeBytes)
    : IStorageReadiness
{
    public const string ProbePrefix = ".ready-";

    public Task<StorageStatus> CheckAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var probe = Path.Combine(settings.Root, ProbePrefix + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(settings.Root);
            using (
                new FileStream(
                    probe,
                    new FileStreamOptions
                    {
                        Mode = FileMode.CreateNew,
                        Access = FileAccess.Write,
                        Options = FileOptions.DeleteOnClose,
                    }
                )
            ) { }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return Task.FromResult(new StorageStatus(false, "receipt-storage"));
        }
        try
        {
            var free = new DriveInfo(settings.Root).AvailableFreeSpace;
            if (free < minimumFreeBytes)
                return Task.FromResult(new StorageStatus(false, "disk-space"));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return Task.FromResult(new StorageStatus(false, "receipt-storage"));
        }
        return Task.FromResult(new StorageStatus(true, "ready"));
    }
}
