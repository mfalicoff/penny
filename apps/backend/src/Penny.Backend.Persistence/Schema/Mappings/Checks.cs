namespace Penny.Backend.Persistence.Schema.Mappings;

// Check-constraint expressions shared by mappings. They are part of the EF model,
// so migrations and the model snapshot track them like any other schema change.
internal static class Checks
{
    public const long MaxCents = 99_999_999_999;
    public const long MaxRevision = 9_007_199_254_740_991;
    public const string Currencies = "('CAD','USD','EUR','GBP')";
    public const string Kinds = "('income','expense','investment')";
    public const string SplitModes = "('equal','exact','percent')";
    public const string Frequencies = "('weekly','monthly','yearly')";
    public const string RateStatuses = "('published','provisional','edited')";

    public static string Cents(string column, long min = 0) =>
        $"{column} BETWEEN {min} AND {MaxCents}";

    public static string Revision(string column) => $"{column} BETWEEN 0 AND {MaxRevision}";

    public static string Length(string column, int min, int max) =>
        $"length({column}) BETWEEN {min} AND {max}";

    public static string In(string column, string values) => $"{column} IN {values}";

    public static string Color(string column) => $"{column} ~ '^#[0-9A-Fa-f]{{6}}$'";

    public static string AnchorDay(string column) => $"{column} BETWEEN 1 AND 31";

    // How many people split a personal expense (contract 2.2.0); only expenses carry it.
    public static string Participants(string column) =>
        $"{column} IS NULL OR {column} BETWEEN 2 AND 100";

    public static string ParticipantsExpenseOnly(string column) =>
        $"{column} IS NULL OR kind = 'expense'";

    // A canonical exchange rate (contract 2.4.0): up to 9 integer and 8 fraction digits, no
    // trailing fraction zeros, greater than zero.
    public static string Rate(string column) =>
        $"{column} ~ '^(0|[1-9][0-9]{{0,8}})([.][0-9]{{0,7}}[1-9])?$' AND {column} ~ '[1-9]'";

    public const string Lease =
        "(lease_owner IS NULL) = (lease_token IS NULL) AND (lease_token IS NULL) = (lease_expires_at IS NULL)";
}
