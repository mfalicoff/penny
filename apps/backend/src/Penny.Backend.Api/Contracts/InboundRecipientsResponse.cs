namespace Penny.Backend.Api.Contracts;

// Contract schema `InboundRecipients` (MAZ-184): the Worker's recipient list.
// `generatedAt` is Unix milliseconds.
public sealed record InboundRecipientsResponse(
    string Version,
    long GeneratedAt,
    IReadOnlyList<string> Hashes
);
