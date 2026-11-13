namespace Penny.Backend.IntegrationTests.Infrastructure.Probes;

public sealed class ProbeSignals
{
    public TaskCompletionSource Started { get; private set; } = Create();
    public TaskCompletionSource Canceled { get; private set; } = Create();
    public TaskCompletionSource Release { get; private set; } = Create();

    private static TaskCompletionSource Create() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    public void Reset()
    {
        Started = Create();
        Canceled = Create();
        Release = Create();
    }
}
