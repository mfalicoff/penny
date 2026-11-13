namespace Penny.Backend.Api.Contracts;

public sealed record ExpenseListResponse(IReadOnlyList<ExpenseResponse> Expenses);
