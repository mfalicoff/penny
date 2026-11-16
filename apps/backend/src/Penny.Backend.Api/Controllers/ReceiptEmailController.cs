using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Ledgers;
using Penny.Backend.Application.InboundMail;

namespace Penny.Backend.Api.Controllers;

// The user's private receipt address (MAZ-184, docs/plans/email-receipts.md#5-addresses).
// Session-protected by the fallback policy. GET always answers, with `enabled: false`
// when the server does not accept emailed receipts; the other operations then 404.
[ApiController]
[Route("api/receipt-email")]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(500)]
public sealed class ReceiptEmailController(ReceiptEmailService addresses) : ControllerBase
{
    [HttpGet(Name = "getApiReceiptEmail")]
    [ProducesResponseType<ReceiptEmailResponse>(200)]
    public async Task<ActionResult<ReceiptEmailResponse>> Read(CancellationToken cancellationToken)
    {
        var address = await addresses.ReadAsync(User.Session().UserId, cancellationToken);
        return Ok(Envelope(address is null ? null : ReceiptEmailAddressResponse.From(address)));
    }

    // Creates the address, or rotates it (the old one stops working at once).
    [HttpPost(Name = "postApiReceiptEmail")]
    [ProducesResponseType<ReceiptEmailResponse>(201)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(429)]
    public async Task<IActionResult> Create(CancellationToken cancellationToken)
    {
        var address = await addresses.CreateAsync(User.Session().UserId, cancellationToken);
        return StatusCode(201, Envelope(ReceiptEmailAddressResponse.From(address)));
    }

    [HttpPatch(Name = "patchApiReceiptEmail")]
    [ProducesResponseType<ReceiptEmailResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<ActionResult<ReceiptEmailResponse>> Update(
        CancellationToken cancellationToken
    )
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        var address = await addresses.UpdateAsync(
            User.Session().UserId,
            body?.RootElement,
            cancellationToken
        );
        return Ok(Envelope(ReceiptEmailAddressResponse.From(address)));
    }

    // Turns the feature off for this user. Idempotent.
    [HttpDelete(Name = "deleteApiReceiptEmail")]
    [ProducesResponseType<OkResponse>(200)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<OkResponse>> Revoke(CancellationToken cancellationToken)
    {
        await addresses.RevokeAsync(User.Session().UserId, cancellationToken);
        return Ok(new OkResponse(true));
    }

    private ReceiptEmailResponse Envelope(ReceiptEmailAddressResponse? address) =>
        new(addresses.Enabled, addresses.Enabled ? addresses.Domain : null, address);
}
