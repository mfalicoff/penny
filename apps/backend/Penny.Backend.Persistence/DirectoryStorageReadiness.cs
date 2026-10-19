using Penny.Backend.Application;

namespace Penny.Backend.Persistence;

public sealed class DirectoryStorageReadiness(BackendOptions options) : IStorageReadiness
{
    public Task<bool> IsReadyAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            // A temporary probe checks that the configured volume is writable.
            var probePath = Path.Combine(options.DataDirectory, $".ready-{Guid.NewGuid():N}");
            using (new FileStream(probePath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1, FileOptions.DeleteOnClose))
            {
            }
            return Task.FromResult(true);
        }
        catch (IOException)
        {
            return Task.FromResult(false);
        }
        catch (UnauthorizedAccessException)
        {
            return Task.FromResult(false);
        }
    }
}
