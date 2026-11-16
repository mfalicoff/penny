using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Application.InboundMail;

namespace Penny.Backend.Api.Controllers;

// The receipt inbox (MAZ-184, docs/plans/email-receipts.md#4-the-receipt-inbox).
// Session-protected by the fallback policy; items are private to their owner. Files are
// downloaded with GET /api/receipts/{id} and attached with the normal entry and shared
// expense saves. 404 while emailed receipts are off on this server.
[ApiController]
[Route("api/receipt-inbox")]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(404)]
[ProducesResponseType<ApiError>(500)]
public sealed class ReceiptInboxController(ReceiptInboxService inbox) : ControllerBase
{
    [HttpGet(Name = "getApiReceiptInbox")]
    [ProducesResponseType<ReceiptInboxPageResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    public async Task<ActionResult<ReceiptInboxPageResponse>> List(
        [FromQuery] string? status,
        [FromQuery] string? before,
        CancellationToken cancellationToken
    )
    {
        var (items, next) = await inbox.ListAsync(
            User.Session().UserId,
            status,
            before,
            cancellationToken
        );
        return Ok(
            new ReceiptInboxPageResponse([.. items.Select(ReceiptInboxItemResponse.Of)], next)
        );
    }

    // Deletes the item and its files that no entry links.
    [HttpDelete("{id}", Name = "deleteApiReceiptInboxId")]
    [ProducesResponseType<ReceiptInboxCleanupResponse>(200)]
    [ProducesResponseType<ApiError>(403)]
    public async Task<ActionResult<ReceiptInboxCleanupResponse>> Discard(
        string id,
        CancellationToken cancellationToken
    )
    {
        var result = await inbox.DiscardAsync(User.Session().UserId, id, cancellationToken);
        return Ok(new ReceiptInboxCleanupResponse(result.Deleted, result.Kept));
    }

    // Marks a partly attached item Attached and deletes its files that no entry links.
    [HttpPost("{id}/done", Name = "postApiReceiptInboxIdDone")]
    [ProducesResponseType<ReceiptInboxCleanupResponse>(200)]
    [ProducesResponseType<ApiError>(403)]
    public async Task<ActionResult<ReceiptInboxCleanupResponse>> Done(
        string id,
        CancellationToken cancellationToken
    )
    {
        var result = await inbox.DoneAsync(User.Session().UserId, id, cancellationToken);
        return Ok(new ReceiptInboxCleanupResponse(result.Deleted, result.Kept));
    }
}
