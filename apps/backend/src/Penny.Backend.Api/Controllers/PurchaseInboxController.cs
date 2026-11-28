using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Ledgers;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Application.Purchases;

namespace Penny.Backend.Api.Controllers;

// Captured purchases in the Inbox (MAZ-291, contract 2.5.0), beside emailed receipts.
// Session-protected by the fallback policy; items are private to their owner. A device
// uploads each Apple Pay tap with its own idempotency key; triage saves the entry with the
// normal ledger or shared expense save, then records the outcome here.
[ApiController]
[Route("api/purchase-inbox")]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(500)]
public sealed class PurchaseInboxController(PurchaseInboxService purchases) : ControllerBase
{
    [HttpGet(Name = "getApiPurchaseInbox")]
    [ProducesResponseType<PurchaseInboxPageResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    public async Task<ActionResult<PurchaseInboxPageResponse>> List(
        [FromQuery] string? status,
        [FromQuery] string? before,
        CancellationToken cancellationToken
    )
    {
        var (items, next) = await purchases.ListAsync(
            User.Session().UserId,
            status,
            before,
            cancellationToken
        );
        return Ok(
            new PurchaseInboxPageResponse([.. items.Select(PurchaseInboxItemResponse.Of)], next)
        );
    }

    // 201 with the new item; 200 with the existing one when the key was already used.
    [HttpPost(Name = "postApiPurchaseInbox")]
    [ProducesResponseType<PurchaseInboxItemResponse>(200)]
    [ProducesResponseType<PurchaseInboxItemResponse>(201)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(409)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<ActionResult<PurchaseInboxItemResponse>> Capture(
        CancellationToken cancellationToken
    )
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        var (item, created) = await purchases.CaptureAsync(
            User.Session().UserId,
            body?.RootElement,
            cancellationToken
        );
        var response = PurchaseInboxItemResponse.Of(item);
        return created ? StatusCode(201, response) : Ok(response);
    }

    // Records how the purchase left To review: added, attached or discarded.
    [HttpPost("{id}/resolve", Name = "postApiPurchaseInboxIdResolve")]
    [ProducesResponseType<PurchaseInboxItemResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(409)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<ActionResult<PurchaseInboxItemResponse>> Resolve(
        string id,
        CancellationToken cancellationToken
    )
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        var item = await purchases.ResolveAsync(
            User.Session().UserId,
            id,
            body?.RootElement,
            cancellationToken
        );
        return Ok(PurchaseInboxItemResponse.Of(item));
    }

    // Undo: moves a done purchase back to To review.
    [HttpPost("{id}/reopen", Name = "postApiPurchaseInboxIdReopen")]
    [ProducesResponseType<PurchaseInboxItemResponse>(200)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<PurchaseInboxItemResponse>> Reopen(
        string id,
        CancellationToken cancellationToken
    )
    {
        var item = await purchases.ReopenAsync(User.Session().UserId, id, cancellationToken);
        return Ok(PurchaseInboxItemResponse.Of(item));
    }

    [HttpGet("cards", Name = "getApiPurchaseInboxCards")]
    [ProducesResponseType<CardAccountsResponse>(200)]
    public async Task<ActionResult<CardAccountsResponse>> Cards(
        CancellationToken cancellationToken
    ) => Ok(Envelope(await purchases.CardsAsync(User.Session().UserId, cancellationToken)));

    // Replaces the whole card mapping (edited in iOS Settings › Shortcuts).
    [HttpPut("cards", Name = "putApiPurchaseInboxCards")]
    [ProducesResponseType<CardAccountsResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<ActionResult<CardAccountsResponse>> ReplaceCards(
        CancellationToken cancellationToken
    )
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        var cards = await purchases.ReplaceCardsAsync(
            User.Session().UserId,
            body?.RootElement,
            cancellationToken
        );
        return Ok(Envelope(cards));
    }

    private static CardAccountsResponse Envelope(IReadOnlyList<StoredCardAccount> cards) =>
        new([.. cards.Select(card => new CardAccountResponse(card.Card, card.AccountId))]);
}
