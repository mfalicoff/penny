using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Ledgers;
using Penny.Backend.Domain.Search;

namespace Penny.Backend.Application.Search;

// Simple keyset cursors (docs/migration/search.md, "Pagination"): base64url JSON with
// a format version, a hash of the normalized query, filters and sort, and the last
// result's sort tuple. No signature and no expiry; a cursor only positions a request
// that the server authorizes again.
public static class SearchCursor
{
    public const string Invalid = "Invalid search cursor.";
    private const int Version = 1;

    // SHA-256 (truncated to 128 bits) of everything that defines the result order.
    // The page size is not part of it, so a client may change it between pages.
    public static string Fingerprint(SearchRequest request)
    {
        var canonical = JsonSerializer.Serialize(
            new[]
            {
                request.Query,
                request.From is { } from ? LedgerDates.Write(from) : "",
                request.To is { } to ? LedgerDates.Write(to) : "",
                request.Kind ?? "",
                request.Source,
                request.Sort,
            }
        );
        return Base64Url.EncodeToString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical))[..16]);
    }

    public static string Encode(string fingerprint, string sort, SearchPosition last)
    {
        var fields = new Dictionary<string, object>(StringComparer.Ordinal)
        {
            ["v"] = Version,
            ["h"] = fingerprint,
            ["d"] = LedgerDates.Write(last.Date),
            ["k"] = last.Key,
        };
        if (sort == SearchReader.Relevance)
        {
            fields["t"] = last.Tier;
            fields["s"] = last.Score;
        }
        else if (sort is SearchReader.AmountAscending or SearchReader.AmountDescending)
            fields["a"] = last.Amount;
        return Base64Url.EncodeToString(JsonSerializer.SerializeToUtf8Bytes(fields));
    }

    // Null when the cursor is malformed or belongs to another query, filter or sort.
    public static SearchPosition? Decode(string cursor, string fingerprint, string sort)
    {
        try
        {
            using var document = JsonDocument.Parse(Base64Url.DecodeFromChars(cursor));
            var root = document.RootElement;
            if (
                root.ValueKind != JsonValueKind.Object
                || root.GetProperty("v").GetInt32() != Version
                || !string.Equals(
                    root.GetProperty("h").GetString(),
                    fingerprint,
                    StringComparison.Ordinal
                )
                || !LedgerDates.TryParse(root.GetProperty("d").GetString() ?? "", out var date)
                || root.GetProperty("k").GetString() is not { Length: > 0 } key
                || !LedgerText.IsStorable(key)
            )
                return null;
            var relevance = sort == SearchReader.Relevance;
            var amount = sort is SearchReader.AmountAscending or SearchReader.AmountDescending;
            var tier = relevance ? root.GetProperty("t").GetInt32() : 0;
            var score = relevance ? root.GetProperty("s").GetInt64() : 0;
            if (tier is < 0 or > 4 || score is < -1_000_000 or > 1_000_000)
                return null;
            return new(tier, score, amount ? root.GetProperty("a").GetInt64() : 0, date, key);
        }
        catch (Exception error)
            when (error
                    is FormatException
                        or JsonException
                        or KeyNotFoundException
                        or InvalidOperationException
                        or ArgumentException
            )
        {
            return null;
        }
    }
}
