namespace Penny.Backend.Application;

public sealed record StorageStatus(bool Ready, string Code);

public interface IStorageReadiness
{
    Task<StorageStatus> CheckAsync(CancellationToken cancellationToken);
}
