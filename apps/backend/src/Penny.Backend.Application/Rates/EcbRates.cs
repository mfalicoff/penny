using System.IO.Compression;
using System.Xml;
using Penny.Backend.Application.Abstractions.Persistence;
using Penny.Backend.Domain.Ledgers;

namespace Penny.Backend.Application.Rates;

// Reads the European Central Bank's reference rate files (MAZ-151): units of each
// currency per euro, by publication date. Only currencies an entry may use are kept (the
// history also quotes retired ones, such as CYP or TRL), only dates a ledger may hold
// (2000-01-01 onward) and only values that are valid canonical rates; "N/A" and blanks
// are skipped. Quotes such as "158.4500" are stored canonically ("158.45").
public static class EcbRates
{
    // The zipped history is about 600 KB, its CSV a few MB; anything far larger is refused.
    public const long MaxDownloadBytes = 16 * 1024 * 1024;
    public const long MaxCsvBytes = 64 * 1024 * 1024;

    // eurofxref-hist.zip: one CSV, `Date,USD,JPY,...` then one line per publication
    // (`2026-11-03,1.0812,161.23,...`), newest first, trailing commas allowed.
    public static IReadOnlyList<StoredRate> ReadHistoryZip(Stream zip)
    {
        using var archive = new ZipArchive(zip, ZipArchiveMode.Read);
        var entry = archive.Entries.SingleOrDefault(item =>
            item.FullName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase)
        ) ?? throw new InvalidDataException("The rate history has no CSV file.");
        if (entry.Length > MaxCsvBytes)
            throw new InvalidDataException("The rate history is too large.");
        using var reader = new StreamReader(entry.Open());
        return ReadHistoryCsv(reader);
    }

    public static IReadOnlyList<StoredRate> ReadHistoryCsv(TextReader reader)
    {
        var header = reader.ReadLine()?.Split(',')
            ?? throw new InvalidDataException("The rate history is empty.");
        if (header.Length == 0 || header[0].Trim() != "Date")
            throw new InvalidDataException("The rate history has no Date column.");
        var codes = header.Select(cell => cell.Trim()).ToArray();
        var rates = new List<StoredRate>();
        while (reader.ReadLine() is { } line)
        {
            var cells = line.Split(',');
            if (!LedgerDates.TryParse(cells[0].Trim(), out var date))
                continue;
            for (var index = 1; index < cells.Length && index < codes.Length; index++)
                Add(rates, date, codes[index], cells[index].Trim());
        }
        return rates;
    }

    // eurofxref-hist-90d.xml (and eurofxref-daily.xml): `<Cube time="2026-11-03">` holding
    // `<Cube currency="USD" rate="1.0812"/>` for each currency. No DTDs or external
    // entities are resolved.
    public static IReadOnlyList<StoredRate> ReadDaily(Stream xml)
    {
        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            IgnoreComments = true,
            IgnoreWhitespace = true,
        };
        using var reader = XmlReader.Create(xml, settings);
        var rates = new List<StoredRate>();
        DateOnly? date = null;
        while (reader.Read())
        {
            if (reader.NodeType != XmlNodeType.Element || reader.LocalName != "Cube")
                continue;
            if (reader.GetAttribute("time") is { } time)
                date = LedgerDates.TryParse(time, out var day) ? day : null;
            else if (
                date is { } current
                && reader.GetAttribute("currency") is { } code
                && reader.GetAttribute("rate") is { } value
            )
                Add(rates, current, code, value);
        }
        return rates;
    }

    private static void Add(List<StoredRate> rates, DateOnly date, string code, string value)
    {
        if (code == "EUR" || !Currencies.IsCurrency(code))
            return;
        if (Currencies.Canonicalize(value) is { } rate)
            rates.Add(new(date, code, rate));
    }
}
