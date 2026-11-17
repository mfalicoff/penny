using System.Text.Json;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Errors;

namespace Penny.Backend.Application.InboundMail;

// The user's private receipt address (MAZ-184, docs/plans/email-receipts.md#5-addresses):
// create or rotate, extend, edit the allowed senders, and revoke. Every operation but
// the read answers 404 while the feature is off on this server.
public sealed class ReceiptEmailService(
    IReceiptMailRepository addresses,
    InboundMailSettings settings,
    TimeProvider clock
)
{
    public const string NotEnabled = "Receipt email is not enabled on this server.";
    public const string NoAddress = "There is no receipt address. Create one first.";
    public const string InvalidUpdate =
        "Send extend: true, allowedSenders, or both to change the receipt address.";
    public const string TooManyAddresses =
        "Too many new receipt addresses today. Try again tomorrow.";

    public bool Enabled => settings.Enabled;
    public string Domain => settings.Domain;

    public Task<StoredMailAddress?> ReadAsync(string userId, CancellationToken cancellationToken) =>
        settings.Enabled
            ? addresses.ReadCurrentAsync(userId, clock.GetUtcNow(), cancellationToken)
            : Task.FromResult<StoredMailAddress?>(null);

    // Creates the user's address, or rotates it: the old one stops working at once.
    public async Task<StoredMailAddress> CreateAsync(
        string userId,
        CancellationToken cancellationToken
    )
    {
        RequireEnabled();
        var now = clock.GetUtcNow();
        if (
            await addresses.CountCreatedSinceAsync(userId, now.AddDays(-1), cancellationToken)
            >= settings.MaxAddressesPerDay
        )
            throw new BackendFailure(FailureKind.RateLimited, TooManyAddresses);
        var local = ReceiptMailAddresses.NewLocalPart();
        return await addresses.ReplaceAsync(
            userId,
            $"{local}@{settings.Domain}",
            ReceiptMailAddresses.Hash(local),
            now,
            now + settings.AddressLifetime,
            cancellationToken
        );
    }

    // `{ "extend": true, "allowedSenders": ["…"] }`: either or both. Extending restarts
    // the lifetime from now; it never revives an address that already expired.
    public async Task<StoredMailAddress> UpdateAsync(
        string userId,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        RequireEnabled();
        if (body is not { ValueKind: JsonValueKind.Object } root)
            throw new BackendFailure(FailureKind.Invalid, InvalidUpdate);
        var extend = false;
        IReadOnlyList<string>? senders = null;
        if (root.TryGetProperty("extend", out var extendValue))
        {
            if (extendValue.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                throw new BackendFailure(FailureKind.Invalid, InvalidUpdate);
            extend = extendValue.GetBoolean();
        }
        if (root.TryGetProperty("allowedSenders", out var sendersValue))
        {
            if (sendersValue.ValueKind != JsonValueKind.Array)
                throw new BackendFailure(FailureKind.Invalid, AllowedSenders.Invalid);
            var raw = new List<string?>();
            foreach (var item in sendersValue.EnumerateArray())
                raw.Add(item.ValueKind == JsonValueKind.String ? Text(item) : null);
            senders = AllowedSenders.Normalize(raw)
                ?? throw new BackendFailure(FailureKind.Invalid, AllowedSenders.Invalid);
        }
        if (!extend && senders is null)
            throw new BackendFailure(FailureKind.Invalid, InvalidUpdate);
        var now = clock.GetUtcNow();
        return await addresses.UpdateAsync(
            userId,
            now,
            extend ? now + settings.AddressLifetime : null,
            senders,
            cancellationToken
        ) ?? throw new BackendFailure(FailureKind.NotFound, NoAddress);
    }

    // Idempotent: revoking when there is no live address succeeds.
    public Task RevokeAsync(string userId, CancellationToken cancellationToken)
    {
        RequireEnabled();
        return addresses.RevokeAsync(userId, clock.GetUtcNow(), cancellationToken);
    }

    private void RequireEnabled()
    {
        if (!settings.Enabled)
            throw new BackendFailure(FailureKind.NotFound, NotEnabled);
    }

    private static string? Text(JsonElement value)
    {
        try
        {
            return value.GetString();
        }
        catch (InvalidOperationException)
        {
            // An escaped lone surrogate cannot be transcoded.
            return null;
        }
    }
}
