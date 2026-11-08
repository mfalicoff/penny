namespace Penny.Backend.Application.Abstractions.Persistence;

public interface IStorageReadiness
{
    Task<StorageStatus> CheckAsync(CancellationToken cancellationToken);
}
