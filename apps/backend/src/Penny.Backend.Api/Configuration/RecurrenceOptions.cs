namespace Penny.Backend.Api.Configuration;

// Shared recurrence worker settings (MAZ-59). `Recurrence__Worker=false` stops this
// process from recording occurrences (another process may; any number may run).
// `Recurrence__PollSeconds` is the idle delay between passes (default one minute).
public sealed record RecurrenceOptions(bool Worker, int PollSeconds)
{
    public static RecurrenceOptions Read(IConfiguration configuration)
    {
        var worker = configuration["Recurrence:Worker"] switch
        {
            null => true,
            "true" => true,
            "false" => false,
            _ => throw new InvalidOperationException("Recurrence:Worker must be true or false."),
        };
        return new(
            worker,
            BackendOptions.ReadBounded(configuration, "Recurrence:PollSeconds", 60, 1, 3600)
        );
    }
}
