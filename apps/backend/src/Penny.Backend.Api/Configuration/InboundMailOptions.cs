using System.Text.RegularExpressions;
using Penny.Backend.Application.InboundMail;

namespace Penny.Backend.Api.Configuration;

// Emailed receipts (MAZ-184, docs/plans/email-receipts.md#configuration-and-deployment).
// `InboundMail__Enabled` (default false) turns the feature on; it then needs
// `InboundMail__Domain` (the receipts-only subdomain, for example
// receipts.example.com) and `InboundMail__WebhookSecret` (base64 of at least 32 random
// bytes, shared with the Cloudflare Email Worker). The limits are per address
// (`HourlyLimit` 20, `DailyLimit` 100), per user (`MaxPendingPerUser` 200 waiting
// messages and unhandled inbox items) and global (`MaxPendingTotal` 10000 waiting
// messages). `RecipientsRateLimitPermits` bounds recipient-list requests per minute.
public static partial class InboundMailOptions
{
    public const int MinimumSecretBytes = 32;

    public static InboundMailSettings Read(IConfiguration configuration)
    {
        var enabled = configuration["InboundMail:Enabled"] switch
        {
            null => false,
            "true" => true,
            "false" => false,
            _ => throw new InvalidOperationException("InboundMail:Enabled must be true or false."),
        };
        var maxMessageBytes = BackendOptions.ReadBounded(
            configuration,
            "InboundMail:MaxMessageBytes",
            (int)InboundMailSettings.DefaultMaxMessageBytes,
            1024 * 1024,
            50 * 1024 * 1024
        );
        var lifetime = BackendOptions.ReadBounded(
            configuration,
            "InboundMail:AddressLifetimeDays",
            90,
            1,
            3650
        );
        var retention = BackendOptions.ReadBounded(
            configuration,
            "InboundMail:InboxRetentionDays",
            30,
            1,
            365
        );
        var hourly = BackendOptions.ReadBounded(
            configuration,
            "InboundMail:HourlyLimit",
            20,
            1,
            10_000
        );
        var daily = BackendOptions.ReadBounded(
            configuration,
            "InboundMail:DailyLimit",
            100,
            1,
            100_000
        );
        var perUser = BackendOptions.ReadBounded(
            configuration,
            "InboundMail:MaxPendingPerUser",
            200,
            1,
            100_000
        );
        var total = BackendOptions.ReadBounded(
            configuration,
            "InboundMail:MaxPendingTotal",
            10_000,
            1,
            10_000_000
        );
        var perDay = BackendOptions.ReadBounded(
            configuration,
            "InboundMail:MaxAddressesPerDay",
            10,
            1,
            1000
        );
        if (!enabled)
            return InboundMailSettings.Disabled with
            {
                MaxMessageBytes = maxMessageBytes,
                AddressLifetimeDays = lifetime,
                InboxRetentionDays = retention,
            };
        var domain = (configuration["InboundMail:Domain"] ?? "").Trim().ToLowerInvariant();
        if (!Domain().IsMatch(domain))
            throw new InvalidOperationException(
                "Set InboundMail__Domain to the receipts subdomain, for example receipts.example.com."
            );
        byte[] secret;
        try
        {
            secret = Convert.FromBase64String(configuration["InboundMail:WebhookSecret"] ?? "");
        }
        catch (FormatException)
        {
            secret = [];
        }
        if (secret.Length < MinimumSecretBytes)
            throw new InvalidOperationException(
                "Set InboundMail__WebhookSecret to base64 of at least 32 random bytes."
            );
        return new InboundMailSettings(
            true,
            domain,
            secret,
            maxMessageBytes,
            lifetime,
            retention,
            hourly,
            daily,
            perUser,
            total,
            perDay
        );
    }

    public static int RecipientsRateLimitPermits(IConfiguration configuration) =>
        BackendOptions.ReadBounded(
            configuration,
            "InboundMail:RecipientsRateLimitPermits",
            120,
            1,
            100_000
        );

    [GeneratedRegex(
        "^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$",
        RegexOptions.CultureInvariant
    )]
    private static partial Regex Domain();
}
