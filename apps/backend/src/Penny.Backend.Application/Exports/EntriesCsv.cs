using System.Globalization;
using System.Text;
using Penny.Backend.Application.Households;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Exports;

// The entries CSV (MAZ-152): one file for the Settings export, the Activity export and the
// full export's `entries.csv`. Personal entries and the person's share of recorded shared
// expenses, oldest first, in a form spreadsheets open as is: RFC 4180 quoting, CRLF line
// ends and a UTF-8 byte order mark. Amounts are positive decimals in the ledger's
// currency (the type says which way the money went). Text a spreadsheet would read as a
// formula starts with an apostrophe, so a title such as "=1+1" stays text.
public static class EntriesCsv
{
    public static readonly string[] Header =
    [
        "Date",
        "Type",
        "Title",
        "Category",
        "Account",
        "Amount",
        "Your share",
        "Currency",
        "Household",
        "Trip",
        "Note",
    ];

    private static readonly Dictionary<string, string> Kinds = new(StringComparer.Ordinal)
    {
        ["expense"] = "Expense",
        ["income"] = "Income",
        ["investment"] = "Investment",
    };

    // `period` is a month (YYYY-MM), a year (YYYY) or null for everything; `shared` holds
    // the projection's recorded rows for the same period.
    public static string Build(
        LedgerDocument ledger,
        IReadOnlyList<ProjectedExpenseView> shared,
        string? period
    )
    {
        var categories = ledger.Categories.ToDictionary(
            category => category.Id,
            category => category.Name,
            StringComparer.Ordinal
        );
        var accounts = ledger.Accounts.ToDictionary(
            account => account.Id,
            account => account.Name,
            StringComparer.Ordinal
        );
        var trips = ledger.Trips.ToDictionary(
            trip => trip.Id,
            trip => trip.Name,
            StringComparer.Ordinal
        );
        var rows = new List<(string Date, string Title, string[] Cells)>();
        foreach (var entry in ledger.Transactions)
        {
            var date = LedgerDates.Write(entry.Date);
            if (period is not null && !date.StartsWith(period, StringComparison.Ordinal))
                continue;
            rows.Add(
                (
                    date,
                    entry.Title,
                    [
                        date,
                        Kinds.GetValueOrDefault(entry.Kind, entry.Kind),
                        entry.Title,
                        categories.GetValueOrDefault(entry.CategoryId, ""),
                        entry.AccountId is { } account
                            ? accounts.GetValueOrDefault(account, "")
                            : "",
                        Money(entry.Total),
                        Money(entry.Share),
                        ledger.Currency,
                        "",
                        entry.TripId is { } trip ? trips.GetValueOrDefault(trip, "") : "",
                        entry.Note,
                    ]
                )
            );
        }
        foreach (var expense in shared)
        {
            if (expense.Scheduled == true)
                continue;
            rows.Add(
                (
                    expense.Date,
                    expense.Title,
                    [
                        expense.Date,
                        "Expense",
                        expense.Title,
                        expense.Category.Name,
                        expense.AccountId is { } account
                            ? accounts.GetValueOrDefault(account, "")
                            : "",
                        Money(expense.TotalCents),
                        Money(expense.ShareCents),
                        expense.HouseholdCurrency,
                        expense.HouseholdName,
                        "",
                        expense.Note,
                    ]
                )
            );
        }
        var csv = new StringBuilder("﻿");
        Append(csv, Header);
        foreach (
            var row in rows.OrderBy(row => row.Date, StringComparer.Ordinal)
                .ThenBy(row => row.Title, StringComparer.Ordinal)
        )
            Append(csv, row.Cells);
        return csv.ToString();
    }

    // "48.90" from 4890 cents.
    public static string Money(long cents) =>
        (cents / 100m).ToString("0.00", CultureInfo.InvariantCulture);

    public static string Cell(string value)
    {
        var text =
            value.Length > 0 && value[0] is '=' or '+' or '-' or '@' or '\t' or '\r'
                ? "'" + value
                : value;
        return text.IndexOfAny([',', '"', '\r', '\n']) >= 0
            ? "\"" + text.Replace("\"", "\"\"", StringComparison.Ordinal) + "\""
            : text;
    }

    private static void Append(StringBuilder csv, IEnumerable<string> cells)
    {
        csv.AppendJoin(',', cells.Select(Cell));
        csv.Append("\r\n");
    }
}
