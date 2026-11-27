using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Application.Rates;

namespace Penny.Backend.Api.Controllers;

// Reference exchange rates (MAZ-151, docs/reference/exchange-rates.md). Session-protected
// by the fallback policy, though the answer is the same for everyone: public ECB data
// quoted in the asked base currency. Clients may reuse an answer for an hour.
[ApiController]
[Route("api/rates")]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(500)]
public sealed class RatesController(ExchangeRateService rates) : ControllerBase
{
    [HttpGet(Name = "getApiRates")]
    [ProducesResponseType<ExchangeRatesResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    public async Task<ActionResult<ExchangeRatesResponse>> Read(
        [FromQuery(Name = "base")] string? currency,
        [FromQuery] string? date,
        CancellationToken cancellationToken
    )
    {
        var view = await rates.GetAsync(currency, date, cancellationToken);
        Response.Headers.CacheControl = "private, max-age=3600";
        return Ok(ExchangeRatesResponse.From(view));
    }
}
