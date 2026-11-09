using Microsoft.AspNetCore.Mvc;
using Penny.Backend.Api.Authentication;
using Penny.Backend.Api.Contracts;
using Penny.Backend.Api.Ledgers;
using Penny.Backend.Application.Households;

namespace Penny.Backend.Api.Controllers;

// Shared expenses, individual share payments and the personal projection (legacy
// server/http/households.ts, MAZ-57). Session-protected by the fallback policy. Month
// recaps, monthly reimbursements and audit history (MAZ-58) and shared recurrence
// (MAZ-59) are not served yet; see docs/migration/shared-expenses.md.
[ApiController]
[Route("api/households")]
[ProducesResponseType<ApiError>(401)]
[ProducesResponseType<ApiError>(500)]
public sealed class HouseholdExpensesController(SharedExpenseService expenses) : ControllerBase
{
    // The literal segment wins over GET /api/households/{id}.
    [HttpGet("projection", Name = "getApiHouseholdsProjection")]
    [ProducesResponseType<ProjectionResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    public async Task<ActionResult<ProjectionResponse>> Projection(
        CancellationToken cancellationToken
    ) =>
        Ok(
            ProjectionResponse.From(
                await expenses.ProjectionAsync(
                    User.Session().UserId,
                    Query("month"),
                    Query("year"),
                    cancellationToken
                )
            )
        );

    [HttpGet("{id}/expenses", Name = "getApiHouseholdsIdExpenses")]
    [ProducesResponseType<ExpenseListResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<ExpenseListResponse>> List(
        string id,
        CancellationToken cancellationToken
    ) =>
        Ok(
            new ExpenseListResponse([
                .. (
                    await expenses.ListAsync(
                        id,
                        User.Session().UserId,
                        Query("month"),
                        cancellationToken
                    )
                ).Select(ExpenseResponse.From),
            ])
        );

    [HttpPost("{id}/expenses", Name = "postApiHouseholdsIdExpenses")]
    [ProducesResponseType<ExpenseEnvelopeResponse>(201)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<IActionResult> Create(string id, CancellationToken cancellationToken)
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        var created = await expenses.CreateAsync(
            id,
            User.Session().UserId,
            body?.RootElement,
            cancellationToken
        );
        return StatusCode(201, new ExpenseEnvelopeResponse(ExpenseResponse.From(created)));
    }

    [HttpGet("{id}/expenses/{expenseId}", Name = "getApiHouseholdsIdExpensesExpenseid")]
    [ProducesResponseType<ExpenseEnvelopeResponse>(200)]
    [ProducesResponseType<ApiError>(404)]
    public async Task<ActionResult<ExpenseEnvelopeResponse>> Get(
        string id,
        string expenseId,
        CancellationToken cancellationToken
    ) =>
        Ok(
            new ExpenseEnvelopeResponse(
                ExpenseResponse.From(
                    await expenses.GetAsync(id, User.Session().UserId, expenseId, cancellationToken)
                )
            )
        );

    [HttpPut("{id}/expenses/{expenseId}", Name = "putApiHouseholdsIdExpensesExpenseid")]
    [ProducesResponseType<ExpenseEnvelopeResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(409)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<ActionResult<ExpenseEnvelopeResponse>> Update(
        string id,
        string expenseId,
        CancellationToken cancellationToken
    )
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        return Ok(
            new ExpenseEnvelopeResponse(
                ExpenseResponse.From(
                    await expenses.UpdateAsync(
                        id,
                        User.Session().UserId,
                        expenseId,
                        body?.RootElement,
                        cancellationToken
                    )
                )
            )
        );
    }

    // The revision travels in the DELETE body, as in the legacy client.
    [HttpDelete("{id}/expenses/{expenseId}", Name = "deleteApiHouseholdsIdExpensesExpenseid")]
    [ProducesResponseType<OkResponse>(200)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(409)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<ActionResult<OkResponse>> Delete(
        string id,
        string expenseId,
        CancellationToken cancellationToken
    )
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        await expenses.DeleteAsync(
            id,
            User.Session().UserId,
            expenseId,
            body?.RootElement,
            cancellationToken
        );
        return Ok(new OkResponse(true));
    }

    [HttpPost("{id}/expenses/{expenseId}/payments", Name = "postApiHouseholdExpensePayment")]
    [ProducesResponseType<ExpenseEnvelopeResponse>(201)]
    [ProducesResponseType<ApiError>(400)]
    [ProducesResponseType<ApiError>(403)]
    [ProducesResponseType<ApiError>(404)]
    [ProducesResponseType<ApiError>(409)]
    [ProducesResponseType<ApiError>(413)]
    public async Task<IActionResult> Pay(
        string id,
        string expenseId,
        CancellationToken cancellationToken
    )
    {
        using var body = await LedgerBody.ReadAsync(Request, cancellationToken);
        var paid = await expenses.PayAsync(
            id,
            User.Session().UserId,
            expenseId,
            body?.RootElement,
            cancellationToken
        );
        return StatusCode(201, new ExpenseEnvelopeResponse(ExpenseResponse.From(paid)));
    }

    // Express `typeof req.query.x === "string"`: one non-empty value, else absent
    // (a repeated parameter is an array and is ignored, as is an empty value).
    private string? Query(string name) =>
        Request.Query.TryGetValue(name, out var values)
        && values.Count == 1
        && !string.IsNullOrEmpty(values[0])
            ? values[0]
            : null;
}
