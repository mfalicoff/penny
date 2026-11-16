namespace Penny.Backend.Application.InboundMail;

// The inbound mail worker (MAZ-184): one message per pass by default, a lease long
// enough for the 60-second message deadline, four attempts with backoff when the
// renderer is unavailable, and 7 days of raw retention for rejected or failed mail.
public sealed record InboundMailProcessingSettings(
    int Concurrency,
    TimeSpan Lease,
    int MaxAttempts,
    TimeSpan MessageTimeout,
    TimeSpan RawRetention
)
{
    public static InboundMailProcessingSettings Default { get; } =
        new(1, TimeSpan.FromMinutes(3), 4, TimeSpan.FromSeconds(60), TimeSpan.FromDays(7));

    public TimeSpan Backoff(int attempts) =>
        TimeSpan.FromSeconds(Math.Min(3600, 30 * Math.Pow(4, Math.Max(0, attempts - 1))));
}
