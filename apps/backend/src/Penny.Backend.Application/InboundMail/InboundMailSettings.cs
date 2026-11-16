namespace Penny.Backend.Application.InboundMail;

// Emailed receipts (MAZ-184, docs/plans/email-receipts.md#configuration-and-deployment).
// Off by default: then the receipt email routes answer 404 (GET reports `enabled:
// false`) and the ingress refuses everything. `WebhookSecret` is the HMAC key shared
// with the Cloudflare Email Worker (or `penny-mail`).
public sealed record InboundMailSettings(
    bool Enabled,
    string Domain,
    byte[] WebhookSecret,
    long MaxMessageBytes,
    int AddressLifetimeDays,
    int InboxRetentionDays,
    int HourlyLimit,
    int DailyLimit,
    int MaxPendingPerUser,
    int MaxPendingTotal,
    int MaxAddressesPerDay
)
{
    public const long DefaultMaxMessageBytes = 25L * 1024 * 1024;

    // Signed requests whose timestamp is further off than this are refused.
    public static readonly TimeSpan SignatureWindow = TimeSpan.FromMinutes(5);

    public static InboundMailSettings Disabled { get; } =
        new(false, "", [], DefaultMaxMessageBytes, 90, 30, 20, 100, 200, 10_000, 10);

    public TimeSpan AddressLifetime => TimeSpan.FromDays(AddressLifetimeDays);

    public override string ToString() => "Inbound mail settings (secret redacted)";
}
