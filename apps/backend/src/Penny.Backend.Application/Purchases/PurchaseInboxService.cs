using System.Text.Json;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Purchases;

// Captured purchases in the Inbox (MAZ-291, contract 2.5.0): a device uploads each Apple
// Pay tap once (idempotency key), and any device triages it. Triage itself saves through
// the normal ledger or shared expense save; this service only records how the item left
// To review, so every device stops offering it. Items are private to their owner; another
// user's item is "not found". Unlike emailed receipts, this needs no server setting.
public sealed class PurchaseInboxService(IPurchaseInboxRepository purchases, TimeProvider clock)
{
    public const int PageSize = 50;
    public const int MaxToReview = 1000;
    public const int MaxCards = 50;
    public const int MaxKeyLength = 64;
    public const int MaxMerchantLength = 100;
    public const int MaxCardLength = 50;
    public static readonly TimeSpan DoneListWindow = TimeSpan.FromDays(30);

    // Captures older than this or later than a day ahead are refused: a clock gone wrong.
    public static readonly DateTimeOffset EarliestCapture = new(2020, 1, 1, 0, 0, 0, TimeSpan.Zero);

    public const string Outcomes = "added, attached or discarded";
    public const string InvalidCapture = "Invalid purchase.";
    public const string InvalidFilter = "status must be to_review or done.";
    public const string InvalidResolution = "Invalid resolution.";
    public const string InvalidCards = "Invalid card list.";
    public const string NotFound = "Purchase not found.";
    public const string AlreadyDone = "This purchase was already handled on another device.";
    public const string Full = "Too many purchases are waiting in the Inbox.";

    public async Task<(StoredPurchase Item, bool Created)> CaptureAsync(
        string userId,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        var now = clock.GetUtcNow();
        var capture = ReadCapture(body, now)
            ?? throw Invalid(ErrorCodes.PurchaseInboxInvalidCapture, InvalidCapture);
        var result = await purchases.CreateAsync(
            userId,
            capture,
            now,
            now - DoneListWindow,
            MaxToReview,
            cancellationToken
        );
        return result.Item is { } item
            ? (item, result.Created)
            : throw new BackendFailure(FailureKind.Conflict, ErrorCodes.PurchaseInboxFull, Full);
    }

    public async Task<(IReadOnlyList<StoredPurchase> Items, string? Next)> ListAsync(
        string userId,
        string? status,
        string? before,
        CancellationToken cancellationToken
    )
    {
        var done = status switch
        {
            null or "" or "to_review" => false,
            "done" => true,
            _ => throw Invalid(ErrorCodes.PurchaseInboxInvalidFilter, InvalidFilter),
        };
        if (before is not null && !IsId(before))
            return ([], null);
        var items = await purchases.ListAsync(
            userId,
            done,
            clock.GetUtcNow() - DoneListWindow,
            before,
            PageSize + 1,
            cancellationToken
        );
        return items.Count > PageSize
            ? ([.. items.Take(PageSize)], items[PageSize - 1].Id)
            : (items, null);
    }

    // Idempotent: resolving a done item the same way again returns it; another way is 409.
    public async Task<StoredPurchase> ResolveAsync(
        string userId,
        string id,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        var resolution = ReadResolution(body)
            ?? throw Invalid(ErrorCodes.PurchaseInboxInvalidResolution, InvalidResolution);
        var item = (
            IsId(id)
                ? await purchases.ResolveAsync(
                    userId,
                    id,
                    resolution,
                    clock.GetUtcNow(),
                    cancellationToken
                )
                : null
        ) ?? throw MissingItem();
        if (
            item.Outcome != resolution.Outcome
            || item.EntryId != resolution.EntryId
            || item.HouseholdId != resolution.HouseholdId
        )
            throw new BackendFailure(
                FailureKind.Conflict,
                ErrorCodes.PurchaseInboxAlreadyDone,
                AlreadyDone
            );
        return item;
    }

    // Undo: back to To review. Idempotent.
    public async Task<StoredPurchase> ReopenAsync(
        string userId,
        string id,
        CancellationToken cancellationToken
    ) =>
        (IsId(id) ? await purchases.ReopenAsync(userId, id, cancellationToken) : null)
        ?? throw MissingItem();

    public Task<IReadOnlyList<StoredCardAccount>> CardsAsync(
        string userId,
        CancellationToken cancellationToken
    ) => purchases.CardsAsync(userId, cancellationToken);

    public async Task<IReadOnlyList<StoredCardAccount>> ReplaceCardsAsync(
        string userId,
        JsonElement? body,
        CancellationToken cancellationToken
    )
    {
        var cards = ReadCards(body)
            ?? throw Invalid(ErrorCodes.PurchaseInboxInvalidCards, InvalidCards);
        await purchases.ReplaceCardsAsync(userId, cards, cancellationToken);
        return await purchases.CardsAsync(userId, cancellationToken);
    }

    private static PurchaseCapture? ReadCapture(JsonElement? body, DateTimeOffset now)
    {
        if (
            body is not { ValueKind: JsonValueKind.Object } root
            || !OnlyFields(
                root,
                "idempotencyKey",
                "merchant",
                "amount",
                "currency",
                "card",
                "capturedAt"
            )
        )
            return null;
        var key = Field(root, "idempotencyKey") is { ValueKind: JsonValueKind.String } keyValue
            ? Text(keyValue)
            : null;
        if (key is null || key.Length is 0 or > MaxKeyLength || !key.All(IsKeyCharacter))
            return null;
        var merchant = Field(root, "merchant") is { ValueKind: JsonValueKind.String } merchantValue
            ? Text(merchantValue)
            : null;
        merchant = merchant is null ? null : LedgerText.TrimLikeJavaScript(merchant);
        if (merchant is null || merchant.Length is 0 or > MaxMerchantLength || HasControl(merchant))
            return null;
        if (
            Field(root, "amount") is not { ValueKind: JsonValueKind.Number } amountValue
            || !amountValue.TryGetInt64(out var amount)
            || amount is < 1 or > LedgerLimits.MaxCents
        )
            return null;
        var currency = Field(root, "currency") is { ValueKind: JsonValueKind.String } currencyValue
            ? Text(currencyValue)
            : null;
        if (currency is null || !Currencies.IsCurrency(currency))
            return null;
        string? card = null;
        switch (Field(root, "card"))
        {
            case null or { ValueKind: JsonValueKind.Null }:
                break;
            case { ValueKind: JsonValueKind.String } cardValue:
                var text = Text(cardValue);
                if (text is null)
                    return null;
                text = LedgerText.TrimLikeJavaScript(text);
                if (text.Length > MaxCardLength || HasControl(text))
                    return null;
                card = text.Length == 0 ? null : text;
                break;
            default:
                return null;
        }
        if (
            Field(root, "capturedAt") is not { ValueKind: JsonValueKind.Number } atValue
            || !atValue.TryGetInt64(out var at)
        )
            return null;
        if (
            at < EarliestCapture.ToUnixTimeMilliseconds()
            || at > (now + TimeSpan.FromDays(1)).ToUnixTimeMilliseconds()
        )
            return null;
        return new(
            key,
            merchant,
            amount,
            currency,
            card,
            DateTimeOffset.FromUnixTimeMilliseconds(at)
        );
    }

    private static PurchaseResolution? ReadResolution(JsonElement? body)
    {
        if (
            body is not { ValueKind: JsonValueKind.Object } root
            || !OnlyFields(root, "outcome", "entryId", "householdId")
        )
            return null;
        var outcome = Field(root, "outcome") is { ValueKind: JsonValueKind.String } outcomeValue
            ? outcomeValue.GetString()
            : null;
        if (
            !ReadReference(root, "entryId", out var entryId)
            || !ReadReference(root, "householdId", out var householdId)
        )
            return null;
        return outcome switch
        {
            "added" or "attached" when entryId is not null => new(outcome, entryId, householdId),
            "discarded" when entryId is null && householdId is null => new(outcome, null, null),
            _ => null,
        };
    }

    private static List<StoredCardAccount>? ReadCards(JsonElement? body)
    {
        if (body is not { ValueKind: JsonValueKind.Object } root || !OnlyFields(root, "cards"))
            return null;
        if (
            Field(root, "cards") is not { ValueKind: JsonValueKind.Array } list
            || list.GetArrayLength() > MaxCards
        )
            return null;
        var cards = new List<StoredCardAccount>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in list.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object || !OnlyFields(item, "card", "accountId"))
                return null;
            var card = Field(item, "card") is { ValueKind: JsonValueKind.String } cardValue
                ? Text(cardValue)
                : null;
            card = card is null ? null : LedgerText.TrimLikeJavaScript(card);
            if (
                card is null
                || card.Length is 0 or > MaxCardLength
                || HasControl(card)
                || !seen.Add(card)
            )
                return null;
            if (!ReadReference(item, "accountId", out var accountId) || accountId is null)
                return null;
            cards.Add(new(card, accountId));
        }
        return cards;
    }

    // An optional ledger or household id: absent or null, else 1–100 storable characters.
    private static bool ReadReference(JsonElement root, string name, out string? value)
    {
        value = null;
        switch (Field(root, name))
        {
            case null or { ValueKind: JsonValueKind.Null }:
                return true;
            case { ValueKind: JsonValueKind.String } text:
                value = Text(text);
                return value is { Length: > 0 and <= LedgerLimits.IdLength };
            default:
                return false;
        }
    }

    private static JsonElement? Field(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) ? value : null;

    private static bool OnlyFields(JsonElement root, params string[] names)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in root.EnumerateObject())
            if (!names.Contains(property.Name, StringComparer.Ordinal) || !seen.Add(property.Name))
                return false;
        return true;
    }

    private static string? Text(JsonElement value)
    {
        try
        {
            var text = value.GetString();
            return text is not null && LedgerText.IsStorable(text) ? text : null;
        }
        catch (InvalidOperationException)
        {
            // An escaped lone surrogate cannot be transcoded.
            return null;
        }
    }

    private static bool HasControl(string value) => value.Any(char.IsControl);

    private static bool IsKeyCharacter(char character) =>
        char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.' or ':';

    private static BackendFailure Invalid(string code, string message) =>
        new(FailureKind.Invalid, code, message);

    private static BackendFailure MissingItem() =>
        new(FailureKind.NotFound, ErrorCodes.PurchaseInboxNotFound, NotFound);

    private static bool IsId(string value) =>
        value.Length == 32
        && value.All(character => char.IsAsciiDigit(character) || character is >= 'a' and <= 'f');
}
