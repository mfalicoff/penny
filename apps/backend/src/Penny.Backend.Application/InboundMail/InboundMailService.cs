using System.Security.Cryptography;
using System.Text;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Diagnostics;

namespace Penny.Backend.Application.InboundMail;

// The signed ingress (MAZ-184, docs/plans/email-receipts.md#signed-endpoint). It only
// authenticates, checks the address and limits, and stores the raw message sealed and
// pending; parsing happens later in the inbound mail worker. A request that is not
// correctly signed is always `Unauthorized`, whatever its address, so only the holder
// of the secret learns whether an address is live.
public sealed class InboundMailService(
    IReceiptMailRepository repository,
    InboundMailSettings settings,
    InboundMailReplayCache replays,
    TimeProvider clock
)
{
    public bool Enabled => settings.Enabled;
    public long MaxMessageBytes => settings.MaxMessageBytes;

    // True when the headers could belong to a signed message request, checked before
    // the body is read so unsigned requests cost nothing.
    public bool HasSignedHeaders(string? recipient, string? timestamp, string? signature) =>
        ReceiptMailAddresses.IsLocalPart(recipient)
        && InboundMailSignature.IsFresh(timestamp, clock.GetUtcNow())
        && signature is { Length: 64 };

    public async Task<InboundOutcome> ReceiveAsync(
        string? recipient,
        string? timestamp,
        string? signature,
        byte[] raw,
        CancellationToken cancellationToken
    )
    {
        var outcome = await DecideAsync(recipient, timestamp, signature, raw, cancellationToken);
        BackendTelemetry.InboundMail(Name(outcome));
        return outcome;
    }

    // `null` for a request that is not correctly signed.
    public async Task<InboundRecipients?> RecipientsAsync(
        string? timestamp,
        string? signature,
        CancellationToken cancellationToken
    )
    {
        var now = clock.GetUtcNow();
        if (
            !settings.Enabled
            || !InboundMailSignature.IsFresh(timestamp, now)
            || !InboundMailSignature.Verify(
                settings.WebhookSecret,
                InboundMailSignature.RecipientsPurpose,
                timestamp!,
                InboundMailSignature.RecipientsPath,
                [],
                signature
            )
        )
        {
            BackendTelemetry.InboundMail("recipients_unauthorized");
            return null;
        }
        var hashes = await repository.LiveHashesAsync(now, cancellationToken);
        var version = Convert.ToHexStringLower(
            SHA256.HashData(Encoding.ASCII.GetBytes(string.Join('\n', hashes)))
        )[..32];
        return new(version, now, hashes);
    }

    private async Task<InboundOutcome> DecideAsync(
        string? recipient,
        string? timestamp,
        string? signature,
        byte[] raw,
        CancellationToken cancellationToken
    )
    {
        if (
            !settings.Enabled
            || !HasSignedHeaders(recipient, timestamp, signature)
            || !InboundMailSignature.Verify(
                settings.WebhookSecret,
                InboundMailSignature.MessagePurpose,
                timestamp!,
                recipient!,
                raw,
                signature
            )
            || !replays.TryRemember(signature!)
        )
            return InboundOutcome.Unauthorized;
        if (raw.LongLength > settings.MaxMessageBytes)
            return InboundOutcome.TooLarge;
        if (raw.Length == 0)
            return InboundOutcome.Invalid;
        return await repository.AcceptAsync(
            new InboundDelivery(ReceiptMailAddresses.Hash(recipient!), raw, clock.GetUtcNow()),
            settings,
            cancellationToken
        ) switch
        {
            InboundAcceptOutcome.Accepted => InboundOutcome.Accepted,
            InboundAcceptOutcome.Duplicate => InboundOutcome.Duplicate,
            InboundAcceptOutcome.UnknownAddress => InboundOutcome.UnknownAddress,
            _ => InboundOutcome.RateLimited,
        };
    }

    private static string Name(InboundOutcome outcome) =>
        outcome switch
        {
            InboundOutcome.Accepted => "accepted",
            InboundOutcome.Duplicate => "duplicate",
            InboundOutcome.UnknownAddress => "unknown_address",
            InboundOutcome.RateLimited => "rate_limited",
            InboundOutcome.TooLarge => "too_large",
            InboundOutcome.Invalid => "invalid",
            _ => "unauthorized",
        };
}
