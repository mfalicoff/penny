using Penny.Backend.Application.Households;

namespace Penny.Backend.Api.Contracts;

public sealed record ProjectionResponse(
    IReadOnlyList<ProjectedExpenseResponse> Transactions,
    IReadOnlyList<ProjectedExpenseResponse> Scheduled
)
{
    public static ProjectionResponse From(ProjectionView projection) =>
        new(
            [.. projection.Transactions.Select(ProjectedExpenseResponse.From)],
            [.. projection.Scheduled.Select(ProjectedExpenseResponse.From)]
        );
}
