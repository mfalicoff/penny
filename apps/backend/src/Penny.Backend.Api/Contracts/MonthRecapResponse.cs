using Penny.Backend.Application.Households;

namespace Penny.Backend.Api.Contracts;

// Contract schema `MonthRecap` (legacy `month()`, returned without an envelope).
public sealed record MonthRecapResponse(
    string Month,
    IReadOnlyList<ExpenseResponse> Expenses,
    IReadOnlyList<ReimbursementResponse> Reimbursements,
    IReadOnlyList<BalanceResponse> Balances,
    IReadOnlyList<SuggestionResponse> Suggestions,
    bool Overdue,
    IReadOnlyList<string> OverdueMonths
)
{
    public static MonthRecapResponse From(MonthRecapView recap) =>
        new(
            recap.Month,
            [.. recap.Expenses.Select(ExpenseResponse.From)],
            [.. recap.Reimbursements.Select(ReimbursementResponse.From)],
            [
                .. recap.Balances.Select(balance => new BalanceResponse(
                    balance.UserId,
                    balance.BalanceCents
                )),
            ],
            [
                .. recap.Suggestions.Select(suggestion => new SuggestionResponse(
                    suggestion.FromUserId,
                    suggestion.ToUserId,
                    suggestion.AmountCents
                )),
            ],
            recap.Overdue,
            recap.OverdueMonths
        );
}
