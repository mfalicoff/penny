using Penny.Backend.Domain.Households;

namespace Penny.Backend.Application.Households;

// GET /api/households/{id}/months/{month} (legacy `month()`): the month's visible
// expenses and reimbursements, every member's balance, the full transfers that
// settle it, whether it is overdue, and every overdue month the viewer can see.
public sealed record MonthRecapView(
    string Month,
    IReadOnlyList<ExpenseView> Expenses,
    IReadOnlyList<ReimbursementView> Reimbursements,
    IReadOnlyList<MemberBalance> Balances,
    IReadOnlyList<SuggestedReimbursement> Suggestions,
    bool Overdue,
    IReadOnlyList<string> OverdueMonths
);
