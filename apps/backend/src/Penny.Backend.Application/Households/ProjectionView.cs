namespace Penny.Backend.Application.Households;

// GET /api/households/projection: recorded shares and (month only) scheduled previews.
public sealed record ProjectionView(
    IReadOnlyList<ProjectedExpenseView> Transactions,
    IReadOnlyList<ProjectedExpenseView> Scheduled
);
