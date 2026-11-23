namespace Penny.Backend.Application.Mail;

// What the runner records for one claimed message. `RetryAt` is set for `Retry`.
public sealed record MailResult(MailOutcomeKind Kind, string? Reason, DateTimeOffset? RetryAt);
