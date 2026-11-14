using Microsoft.AspNetCore.Http.Timeouts;
using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Ledgers;
using Penny.Backend.Application.Receipts;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Api.Controllers;

// Receipt upload and download (MAZ-60). Session-
// protected by the fallback policy. Large bodies on slow links legitimately outlast
// the default request timeout, so these two operations opt out of it; Kestrel's
// minimum data rates still end stalled transfers. See docs/reference/receipts.md.
[ApiController]
[Route("api/receipts")]
[DisableRequestTimeout]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(500)]
public sealed class ReceiptsController(ReceiptService receipts) : ControllerBase
{
    [HttpPost(Name = "postApiReceipts")]
    [ProducesResponseType<ReceiptResponse>(201)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<IActionResult> Upload(CancellationToken cancellationToken)
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        var uploaded = await receipts.UploadAsync(
            User.Session().UserId,
            body?.RootElement,
            cancellationToken
        );
        return StatusCode(
            201,
            new ReceiptResponse(
                uploaded.Id,
                uploaded.Name,
                uploaded.Mime,
                ReceiptLink.UriFor(uploaded.Id)
            )
        );
    }

    [HttpGet("{id}", Name = "getApiReceiptsId")]
    [ProducesResponseType(200)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<IActionResult> Download(string id, CancellationToken cancellationToken)
    {
        var receipt = await receipts.ReadAsync(User.Session().UserId, id, cancellationToken);
        Response.Headers.ContentDisposition = ReceiptDisposition.Inline(receipt.Name);
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        return File(receipt.Data, receipt.Mime);
    }
}
