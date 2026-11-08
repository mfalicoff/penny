using Penny.Backend.Application.Abstractions.Persistence;

namespace Penny.Backend.Application.Ledgers;

// The legacy `emptyLedger()` created with every new account: revision 0, CAD and
// the default categories.
public static class InitialLedger
{
    public const string Currency = "CAD";

    public static IReadOnlyList<StoredCategory> Categories { get; } =
    [
        new("groceries", "Groceries", "basket-outline", "#6C9C79", "expense"),
        new("food", "Food & drinks", "cafe-outline", "#E47850", "expense"),
        new("home", "Home", "home-outline", "#C6953A", "expense"),
        new("transport", "Transport", "bus-outline", "#678DB1", "expense"),
        new("shopping", "Shopping", "bag-handle-outline", "#C8798D", "expense"),
        new("fun", "Entertainment", "musical-notes-outline", "#9D83BA", "expense"),
        new("health", "Health", "heart-outline", "#6C9C79", "expense"),
        new("other", "Other", "ellipsis-horizontal", "#89918C", "expense"),
        new("salary", "Salary", "briefcase-outline", "#6C9C79", "income"),
        new("freelance", "Freelance", "laptop-outline", "#678DB1", "income"),
        new("gift", "Gifts", "gift-outline", "#C6953A", "income"),
        new("investments", "Investments", "trending-up-outline", "#678DB1", "investment"),
    ];

    public static StoredLedger Create() => new(0, Currency, [], Categories, [], [], []);
}
