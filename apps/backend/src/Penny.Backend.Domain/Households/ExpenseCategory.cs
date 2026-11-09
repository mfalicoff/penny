namespace Penny.Backend.Domain.Households;

// The category embedded in a shared expense or rule (`{name, icon, color}`).
public sealed record ExpenseCategory(string Name, string Icon, string Color);
