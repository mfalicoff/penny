namespace Penny.Backend.Api.Configuration;

// Unlinked receipt cleanup (MAZ-165, docs/reference/receipts.md#unlinked-receipts). A
// receipt nothing links to (no personal entry, shared expense, shared rule or inbox
// email) is deleted once it is `Receipts__UnlinkedRetentionDays` old (default 30), so
// a draft or offline save that links it later has that long to sync.
// `Receipts__CleanupWorker=false` stops this process from cleaning up (another process
// may; any number may run). `receipts-sweep` applies the same retention.
public sealed record ReceiptCleanupOptions(bool Worker, TimeSpan Retention)
{
    public static ReceiptCleanupOptions Read(IConfiguration configuration)
    {
        var worker = configuration["Receipts:CleanupWorker"] switch
        {
            null => true,
            "true" => true,
            "false" => false,
            _ => throw new InvalidOperationException(
                "Receipts:CleanupWorker must be true or false."
            ),
        };
        return new(
            worker,
            TimeSpan.FromDays(
                BackendOptions.ReadBounded(
                    configuration,
                    "Receipts:UnlinkedRetentionDays",
                    30,
                    1,
                    3650
                )
            )
        );
    }
}
