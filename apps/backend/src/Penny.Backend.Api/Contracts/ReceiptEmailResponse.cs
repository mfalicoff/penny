using Penny.Backend.Application.Abstractions.Persistence;

namespace Penny.Backend.Api.Contracts;

// Contract schema `ReceiptEmail` (MAZ-184): whether the server accepts emailed
// receipts, its receipt domain, and the user's live address or null.
public sealed record ReceiptEmailResponse(
    bool Enabled,
    string? Domain,
    ReceiptEmailAddressResponse? Address
);

// Contract schema `ReceiptEmailAddress`. Times are Unix milliseconds.
public sealed record ReceiptEmailAddressResponse(
    string Address,
    long CreatedAt,
    long ExpiresAt,
    long? LastReceivedAt,
    IReadOnlyList<string> AllowedSenders
)
{
    public static ReceiptEmailAddressResponse From(StoredMailAddress address) =>
        new(
            address.Address,
            address.CreatedAt.ToUnixTimeMilliseconds(),
            address.ExpiresAt.ToUnixTimeMilliseconds(),
            address.LastReceivedAt?.ToUnixTimeMilliseconds(),
            address.AllowedSenders
        );
}
