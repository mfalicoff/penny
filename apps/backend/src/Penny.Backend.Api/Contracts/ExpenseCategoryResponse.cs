using Penny.Backend.Domain.Households;

namespace Penny.Backend.Api.Contracts;

public sealed record ExpenseCategoryResponse(string Name, string Icon, string Color)
{
    public static ExpenseCategoryResponse From(ExpenseCategory category) =>
        new(category.Name, category.Icon, category.Color);
}
