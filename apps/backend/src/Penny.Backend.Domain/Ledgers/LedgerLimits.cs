namespace Penny.Backend.Domain.Ledgers;

// Bounds and choices from the legacy zod schema (server/validation/ledger.ts).
public static class LedgerLimits
{
    public const int IdLength = 100;
    public const long MaxCents = 99_999_999_999;

    // Number.MAX_SAFE_INTEGER: the largest integer a JavaScript client holds exactly.
    public const long MaxSafeInteger = 9_007_199_254_740_991;
    public const int MaxAccounts = 300;
    public const int MaxTrips = 300;
    public const int MaxCategories = 300;
    public const int MaxTransactions = 100_000;
    public const int MaxRecurring = 1000;
    public static readonly IReadOnlyList<string> Currencies = ["CAD", "USD", "EUR", "GBP"];
    public static readonly IReadOnlyList<string> Kinds = ["income", "expense", "investment"];
    public static readonly IReadOnlyList<string> AccountTypes = ["bank", "credit", "cash", "other"];
    public static readonly IReadOnlyList<string> Frequencies = ["weekly", "monthly", "yearly"];
}
