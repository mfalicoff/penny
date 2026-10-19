namespace Penny.Backend.Application;

public interface IStorageReadiness
{
    Task<bool> IsReadyAsync(CancellationToken cancellationToken);
}

public sealed class ReadinessService(IStorageReadiness storage)
{
    public Task<bool> IsReadyAsync(CancellationToken cancellationToken) =>
        storage.IsReadyAsync(cancellationToken);
}
