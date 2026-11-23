namespace Penny.Backend.Application.Mail;

// Counts of one delivery pass, and the exception types of messages that failed inside
// the runner (never their content). `Reasons` are the distinct reason codes of retried
// and failed messages (`smtp:auth`, `smtp:451`), for operators.
public sealed record MailRun(
    int Claimed,
    int Sent,
    int Retried,
    int Failed,
    int Dropped,
    IReadOnlyList<string> Failures,
    IReadOnlyList<string> Reasons
);
