using System.Text.Json;
using Penny.Backend.Domain.Errors;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Domain.Search;

// Reads the search request (docs/reference/search.md, "Request") with the JSON rules
// of LedgerReader: numbers are safe integers, optional fields may be absent but never
// null, the last duplicate key wins and lengths are UTF-16 code units. Unlike the
// other request readers, unknown fields are rejected. Every problem is one 400.
public static class SearchReader
{
    public const string Invalid = "Invalid search request.";
    public const int QueryLength = 200;
    public const int CursorLength = 2048;
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 100;

    public const string Relevance = "relevance";
    public const string DateDescending = "date-desc";
    public const string DateAscending = "date-asc";
    public const string AmountDescending = "amount-desc";
    public const string AmountAscending = "amount-asc";

    public const string AllSources = "all";
    public const string Personal = "personal";
    public const string Shared = "shared";

    public static readonly IReadOnlyList<string> Sorts =
    [
        Relevance,
        DateDescending,
        DateAscending,
        AmountDescending,
        AmountAscending,
    ];

    public static readonly IReadOnlyList<string> Sources = [Personal, Shared, AllSources];
    public static readonly IReadOnlyList<string> Kinds = ["expense", "income", "investment"];

    private static readonly HashSet<string> Known = new(StringComparer.Ordinal)
    {
        "query",
        "from",
        "to",
        "kind",
        "source",
        "sort",
        "pageSize",
        "cursor",
    };

    public static SearchRequest Read(JsonElement? body)
    {
        try
        {
            return Parse(body ?? throw new FormatException());
        }
        catch (FormatException)
        {
            throw new BackendFailure(FailureKind.Invalid, Invalid);
        }
    }

    private static SearchRequest Parse(JsonElement body)
    {
        var fields = LedgerReader.Fields(body);
        LedgerReader.Require(fields.Keys.All(Known.Contains));
        var raw = fields.TryGetValue("query", out var query)
            ? LedgerText.TrimLikeJavaScript(LedgerReader.Text(query, 0, int.MaxValue))
            : "";
        LedgerReader.Require(raw.Length <= QueryLength);
        DateOnly? from = fields.TryGetValue("from", out var first)
            ? LedgerReader.Date(first)
            : null;
        DateOnly? to = fields.TryGetValue("to", out var last) ? LedgerReader.Date(last) : null;
        LedgerReader.Require(from is null || to is null || from <= to);
        var normalized = SearchText.Normalize(raw);
        var sort = fields.TryGetValue("sort", out var order)
            ? LedgerReader.Choice(order, Sorts)
            : Relevance;
        // Relevance needs a query; without one it is date-desc, as is the default.
        if (sort == Relevance && normalized.Length == 0)
            sort = DateDescending;
        return new(
            normalized,
            from,
            to,
            fields.TryGetValue("kind", out var kind) ? LedgerReader.Choice(kind, Kinds) : null,
            fields.TryGetValue("source", out var source)
                ? LedgerReader.Choice(source, Sources)
                : AllSources,
            sort,
            fields.TryGetValue("pageSize", out var size)
                ? (int)LedgerReader.Integer(size, 1, MaxPageSize)
                : DefaultPageSize,
            fields.TryGetValue("cursor", out var cursor)
                ? LedgerReader.Text(cursor, 1, CursorLength)
                : null
        );
    }
}
