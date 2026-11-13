namespace Penny.Backend.Application.Push;

public sealed record PushReceiptResult(
    PushReceiptClaim Claim,
    PushReceiptDecision Decision,
    DateTimeOffset? RetryAt
);
