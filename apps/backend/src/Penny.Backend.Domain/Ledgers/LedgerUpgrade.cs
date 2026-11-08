using System.Globalization;

namespace Penny.Backend.Domain.Ledgers;

// The client's `upgradeLedger`: upgrade once, without reclassifying historical
// expenses or restoring deleted categories. v1 gains an investment category (id
// `investments`, suffixed on collision) unless it has one or already has 300
// categories; v2/v3 only gain empty accounts/trips; v4 is unchanged.
public static class LedgerUpgrade
{
    public static readonly Category Investments = new(
        "investments",
        "Investments",
        "trending-up-outline",
        "#678DB1",
        "investment"
    );

    public static IReadOnlyList<Category> Categories(
        int sourceVersion,
        IReadOnlyList<Category> categories
    )
    {
        if (
            sourceVersion != 1
            || categories.Count >= LedgerLimits.MaxCategories
            || categories.Any(category => category.Kind == "investment")
        )
            return categories;
        var id = Investments.Id;
        for (var suffix = 1; categories.Any(category => category.Id == id); suffix++)
            id = Investments.Id + "-" + suffix.ToString(CultureInfo.InvariantCulture);
        return [.. categories, Investments with { Id = id }];
    }
}
