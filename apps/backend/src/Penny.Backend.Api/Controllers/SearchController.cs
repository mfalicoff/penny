using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Ledgers;
using Penny.Backend.Api.Search;
using Penny.Backend.Application.Search;

namespace Penny.Backend.Api.Controllers;

// Search v1 (MAZ-121, docs/migration/search.md). Session-protected by the fallback
// policy; the viewer is the session's user. The body travels in a POST so search text
// stays out of URLs and access logs; neither it nor SQL parameters are logged.
[ApiController]
[Route("api/v1/search")]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(500)]
public sealed class SearchController(SearchService search) : ControllerBase
{
    [HttpPost("transactions", Name = "searchTransactionsV1")]
    [EnableRateLimiting(SearchRateLimit.Policy)]
    [ProducesResponseType<SearchResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(413)]
    [ProducesResponseType<ApiError>(429)]
    [ProducesResponseType<ApiError>(503)]
    public async Task<ActionResult<SearchResponse>> Transactions(
        CancellationToken cancellationToken
    )
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        return Ok(
            SearchResponse.From(
                await search.SearchAsync(
                    User.Session().UserId,
                    body?.RootElement,
                    cancellationToken
                )
            )
        );
    }
}
