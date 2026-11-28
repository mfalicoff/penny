using System.Globalization;
using System.Numerics;

namespace Penny.Backend.Domain.Ledgers;

// Entries in several currencies (MAZ-151, contract 2.4.0), ported from the reference rules
// in apps/web/src/domain/currency.ts; contracts/fixtures/currency.json holds the golden
// cases (CurrencyFixtureTests). The ledger keeps one home currency for every total; an
// entry may also carry the amount it was paid in, that currency and the rate used.
// - Amounts are integers in a currency's minor units.
// - A rate is a canonical decimal string of home units per unit of the other currency: up
//   to 9 integer and 8 fraction digits, no trailing fraction zeros, greater than zero.
//   Arithmetic is exact (BigInteger); nothing uses floating point.
// - A converted amount is rounded once, half up, to the home currency's minor units.
// - Cross rates from quotes against one base (the ECB quotes per euro) are rounded half up
//   to 6 significant digits, at most 8 fraction digits.
// - The rate for a date is the latest publication on or before it; a date after the
//   latest publication takes the latest, provisionally.
public static class Currencies
{
    public const string Published = "published";
    public const string Provisional = "provisional";
    public const string Edited = "edited";

    public static readonly IReadOnlyList<string> RateStatuses = [Published, Provisional, Edited];

    // Every circulating ISO 4217 currency, A–Z by code (funds, metals and test codes are
    // left out).
    public static readonly IReadOnlyList<CurrencyInfo> All =
    [
        new("AED", "UAE dirham", 2),
        new("AFN", "Afghan afghani", 2),
        new("ALL", "Albanian lek", 2),
        new("AMD", "Armenian dram", 2),
        new("AOA", "Angolan kwanza", 2),
        new("ARS", "Argentine peso", 2),
        new("AUD", "Australian dollar", 2),
        new("AWG", "Aruban florin", 2),
        new("AZN", "Azerbaijani manat", 2),
        new("BAM", "Bosnia and Herzegovina convertible mark", 2),
        new("BBD", "Barbadian dollar", 2),
        new("BDT", "Bangladeshi taka", 2),
        new("BGN", "Bulgarian lev", 2),
        new("BHD", "Bahraini dinar", 3),
        new("BIF", "Burundian franc", 0),
        new("BMD", "Bermudian dollar", 2),
        new("BND", "Brunei dollar", 2),
        new("BOB", "Bolivian boliviano", 2),
        new("BRL", "Brazilian real", 2),
        new("BSD", "Bahamian dollar", 2),
        new("BTN", "Bhutanese ngultrum", 2),
        new("BWP", "Botswana pula", 2),
        new("BYN", "Belarusian ruble", 2),
        new("BZD", "Belize dollar", 2),
        new("CAD", "Canadian dollar", 2),
        new("CDF", "Congolese franc", 2),
        new("CHF", "Swiss franc", 2),
        new("CLP", "Chilean peso", 0),
        new("CNY", "Chinese yuan", 2),
        new("COP", "Colombian peso", 2),
        new("CRC", "Costa Rican colón", 2),
        new("CUP", "Cuban peso", 2),
        new("CVE", "Cape Verdean escudo", 2),
        new("CZK", "Czech koruna", 2),
        new("DJF", "Djiboutian franc", 0),
        new("DKK", "Danish krone", 2),
        new("DOP", "Dominican peso", 2),
        new("DZD", "Algerian dinar", 2),
        new("EGP", "Egyptian pound", 2),
        new("ERN", "Eritrean nakfa", 2),
        new("ETB", "Ethiopian birr", 2),
        new("EUR", "Euro", 2),
        new("FJD", "Fijian dollar", 2),
        new("FKP", "Falkland Islands pound", 2),
        new("GBP", "Pound sterling", 2),
        new("GEL", "Georgian lari", 2),
        new("GHS", "Ghanaian cedi", 2),
        new("GIP", "Gibraltar pound", 2),
        new("GMD", "Gambian dalasi", 2),
        new("GNF", "Guinean franc", 0),
        new("GTQ", "Guatemalan quetzal", 2),
        new("GYD", "Guyanese dollar", 2),
        new("HKD", "Hong Kong dollar", 2),
        new("HNL", "Honduran lempira", 2),
        new("HTG", "Haitian gourde", 2),
        new("HUF", "Hungarian forint", 2),
        new("IDR", "Indonesian rupiah", 2),
        new("ILS", "Israeli new shekel", 2),
        new("INR", "Indian rupee", 2),
        new("IQD", "Iraqi dinar", 3),
        new("IRR", "Iranian rial", 2),
        new("ISK", "Icelandic króna", 0),
        new("JMD", "Jamaican dollar", 2),
        new("JOD", "Jordanian dinar", 3),
        new("JPY", "Japanese yen", 0),
        new("KES", "Kenyan shilling", 2),
        new("KGS", "Kyrgyz som", 2),
        new("KHR", "Cambodian riel", 2),
        new("KMF", "Comorian franc", 0),
        new("KPW", "North Korean won", 2),
        new("KRW", "South Korean won", 0),
        new("KWD", "Kuwaiti dinar", 3),
        new("KYD", "Cayman Islands dollar", 2),
        new("KZT", "Kazakhstani tenge", 2),
        new("LAK", "Lao kip", 2),
        new("LBP", "Lebanese pound", 2),
        new("LKR", "Sri Lankan rupee", 2),
        new("LRD", "Liberian dollar", 2),
        new("LSL", "Lesotho loti", 2),
        new("LYD", "Libyan dinar", 3),
        new("MAD", "Moroccan dirham", 2),
        new("MDL", "Moldovan leu", 2),
        new("MGA", "Malagasy ariary", 2),
        new("MKD", "Macedonian denar", 2),
        new("MMK", "Myanmar kyat", 2),
        new("MNT", "Mongolian tögrög", 2),
        new("MOP", "Macanese pataca", 2),
        new("MRU", "Mauritanian ouguiya", 2),
        new("MUR", "Mauritian rupee", 2),
        new("MVR", "Maldivian rufiyaa", 2),
        new("MWK", "Malawian kwacha", 2),
        new("MXN", "Mexican peso", 2),
        new("MYR", "Malaysian ringgit", 2),
        new("MZN", "Mozambican metical", 2),
        new("NAD", "Namibian dollar", 2),
        new("NGN", "Nigerian naira", 2),
        new("NIO", "Nicaraguan córdoba", 2),
        new("NOK", "Norwegian krone", 2),
        new("NPR", "Nepalese rupee", 2),
        new("NZD", "New Zealand dollar", 2),
        new("OMR", "Omani rial", 3),
        new("PAB", "Panamanian balboa", 2),
        new("PEN", "Peruvian sol", 2),
        new("PGK", "Papua New Guinean kina", 2),
        new("PHP", "Philippine peso", 2),
        new("PKR", "Pakistani rupee", 2),
        new("PLN", "Polish złoty", 2),
        new("PYG", "Paraguayan guaraní", 0),
        new("QAR", "Qatari riyal", 2),
        new("RON", "Romanian leu", 2),
        new("RSD", "Serbian dinar", 2),
        new("RUB", "Russian ruble", 2),
        new("RWF", "Rwandan franc", 0),
        new("SAR", "Saudi riyal", 2),
        new("SBD", "Solomon Islands dollar", 2),
        new("SCR", "Seychellois rupee", 2),
        new("SDG", "Sudanese pound", 2),
        new("SEK", "Swedish krona", 2),
        new("SGD", "Singapore dollar", 2),
        new("SHP", "Saint Helena pound", 2),
        new("SLE", "Sierra Leonean leone", 2),
        new("SOS", "Somali shilling", 2),
        new("SRD", "Surinamese dollar", 2),
        new("SSP", "South Sudanese pound", 2),
        new("STN", "São Tomé and Príncipe dobra", 2),
        new("SVC", "Salvadoran colón", 2),
        new("SYP", "Syrian pound", 2),
        new("SZL", "Swazi lilangeni", 2),
        new("THB", "Thai baht", 2),
        new("TJS", "Tajikistani somoni", 2),
        new("TMT", "Turkmenistani manat", 2),
        new("TND", "Tunisian dinar", 3),
        new("TOP", "Tongan paʻanga", 2),
        new("TRY", "Turkish lira", 2),
        new("TTD", "Trinidad and Tobago dollar", 2),
        new("TWD", "New Taiwan dollar", 2),
        new("TZS", "Tanzanian shilling", 2),
        new("UAH", "Ukrainian hryvnia", 2),
        new("UGX", "Ugandan shilling", 0),
        new("USD", "US dollar", 2),
        new("UYU", "Uruguayan peso", 2),
        new("UZS", "Uzbekistani sum", 2),
        new("VES", "Venezuelan bolívar", 2),
        new("VND", "Vietnamese đồng", 0),
        new("VUV", "Vanuatu vatu", 0),
        new("WST", "Samoan tālā", 2),
        new("XAF", "Central African CFA franc", 0),
        new("XCD", "East Caribbean dollar", 2),
        new("XCG", "Caribbean guilder", 2),
        new("XOF", "West African CFA franc", 0),
        new("XPF", "CFP franc", 0),
        new("YER", "Yemeni rial", 2),
        new("ZAR", "South African rand", 2),
        new("ZMW", "Zambian kwacha", 2),
        new("ZWG", "Zimbabwe Gold", 2),
    ];

    private static readonly Dictionary<string, CurrencyInfo> ByCode = All.ToDictionary(
        currency => currency.Code,
        StringComparer.Ordinal
    );

    public static bool IsCurrency(string code) => ByCode.ContainsKey(code);

    public static int MinorUnits(string code) =>
        ByCode.TryGetValue(code, out var currency)
            ? currency.MinorUnits
            : throw new ArgumentException("Choose a currency from the list.", nameof(code));

    // True for a stored rate: canonical, greater than zero, at most 9 integer and 8
    // fraction digits. ASCII digits only.
    public static bool ValidRate(string rate)
    {
        if (rate.Length == 0)
            return false;
        var point = rate.IndexOf('.', StringComparison.Ordinal);
        var whole = point < 0 ? rate : rate[..point];
        if (whole.Length is 0 or > 9 || !Digits(whole) || (whole.Length > 1 && whole[0] == '0'))
            return false;
        if (point >= 0)
        {
            var fraction = rate[(point + 1)..];
            if (fraction.Length is 0 or > 8 || !Digits(fraction) || fraction[^1] == '0')
                return false;
        }
        return rate.AsSpan().IndexOfAnyInRange('1', '9') >= 0;
    }

    // The home amount of `amount` (minor units of `from`) at `rate` (home units per unit of
    // `from`), rounded once, half up, to the home currency's minor units.
    public static long ConvertAmount(long amount, string from, string rate, string home) =>
        (long)Converted(amount, from, rate, home);

    private static BigInteger Converted(long amount, string from, string rate, string home)
    {
        if (amount < 0 || amount > LedgerLimits.MaxSafeInteger)
            throw new ArgumentOutOfRangeException(nameof(amount), "Amounts are whole minor units.");
        if (!ValidRate(rate))
            throw new ArgumentException("Enter a rate greater than zero.", nameof(rate));
        var (mantissa, scale) = Scaled(rate);
        var numerator = amount * mantissa * BigInteger.Pow(10, MinorUnits(home));
        var denominator = BigInteger.Pow(10, scale + MinorUnits(from));
        return DivideHalfUp(numerator, denominator);
    }

    // `part` of `whole`, carried to `of` (`proportionHalfUp`): part × of / whole, rounded
    // half up, so a share keeps its proportion of a converted total and a whole share stays
    // whole (MAZ-151 phase 2, contract 2.5.0).
    public static long ProportionHalfUp(long part, long whole, long of)
    {
        foreach (var value in (ReadOnlySpan<long>)[part, whole, of])
        {
            if (value < 0 || value > LedgerLimits.MaxSafeInteger)
                throw new ArgumentOutOfRangeException(
                    nameof(part),
                    "Amounts are whole minor units."
                );
        }
        if (whole == 0 || part > whole)
            throw new ArgumentException("A share cannot exceed its total.", nameof(part));
        if (part == whole)
            return of;
        return (long)DivideHalfUp(new BigInteger(part) * of, whole);
    }

    // The rate of one unit of `from` in `to` when both are quoted against the same base
    // (units per base; the base itself is "1"), rounded half up to 6 significant digits and
    // at most 8 fraction digits. Null when the result rounds to zero (or is too large to be
    // a stored rate).
    public static string? CrossRate(string fromPerBase, string toPerBase)
    {
        if (!ValidRate(fromPerBase) || !ValidRate(toPerBase))
            throw new ArgumentException("Enter a rate greater than zero.");
        var from = Scaled(fromPerBase);
        var to = Scaled(toPerBase);
        // value = (to.m / 10^to.s) / (from.m / 10^from.s), kept exact as a fraction.
        var numerator = to.Mantissa * BigInteger.Pow(10, from.Scale);
        var denominator = from.Mantissa * BigInteger.Pow(10, to.Scale);
        // floor(value * 10^16) has (integer digits + 16) digits.
        var integerDigits =
            (numerator * BigInteger.Pow(10, 16) / denominator)
                .ToString(CultureInfo.InvariantCulture)
                .Length - 16;
        var scale = Math.Min(8, Math.Max(0, 6 - integerDigits));
        var mantissa = DivideHalfUp(numerator * BigInteger.Pow(10, scale), denominator);
        if (mantissa.IsZero)
            return null;
        var rate = Canonical(mantissa, scale);
        return ValidRate(rate) ? rate : null;
    }

    // Which publication applies to `date`, from the dates the source published (any
    // order): the latest on or before it; a date after every publication takes the latest,
    // provisionally. Null with no publications, or for a date before the first one.
    public static RatePublication? PublishedRateDate(IEnumerable<DateOnly> published, DateOnly date)
    {
        DateOnly? latest = null;
        DateOnly? found = null;
        foreach (var day in published)
        {
            if (latest is null || day > latest)
                latest = day;
            if (day <= date && (found is null || day > found))
                found = day;
        }
        if (latest is not { } last)
            return null;
        if (date > last)
            return new(last, true);
        return found is { } match ? new(match, false) : null;
    }

    // Why the foreign-amount fields of a stored transaction are invalid, or null when they
    // are fine (`foreignAmountProblem`). Absent fields are null; present ones have already
    // been read with the ledger schema's types.
    public static string? ForeignAmountProblem(
        long total,
        long? originalAmount,
        string? originalCurrency,
        string? rate,
        string? rateStatus,
        DateOnly? rateDate,
        string home
    )
    {
        var present =
            (originalAmount is null ? 0 : 1)
            + (originalCurrency is null ? 0 : 1)
            + (rate is null ? 0 : 1)
            + (rateStatus is null ? 0 : 1);
        if (present == 0)
            return rateDate is null ? null : "Invalid original amount";
        if (present != 4)
            return "Invalid original amount";
        if (!IsCurrency(originalCurrency!) || originalCurrency == home)
            return "Invalid original currency";
        if (originalAmount is <= 0 or > LedgerLimits.MaxCents)
            return "Invalid original amount";
        if (!ValidRate(rate!))
            return "Invalid exchange rate";
        if (!RateStatuses.Contains(rateStatus!, StringComparer.Ordinal))
            return "Invalid exchange rate";
        if ((rateStatus == Edited) != (rateDate is null))
            return "Invalid exchange rate";
        // Compared exactly: a huge amount at a huge rate exceeds any total.
        if (Converted(originalAmount!.Value, originalCurrency!, rate!, home) != total)
            return "Invalid converted amount";
        return null;
    }

    // A decimal string with a dot and up to 8 fraction digits (a source's quote, such as
    // the ECB's "1.0812" or "158.4500"), in canonical form; null when it isn't one or
    // isn't a valid stored rate.
    public static string? Canonicalize(string value)
    {
        var point = value.IndexOf('.', StringComparison.Ordinal);
        var whole = point < 0 ? value : value[..point];
        var fraction = point < 0 ? "" : value[(point + 1)..];
        if (whole.Length is 0 or > 9 || fraction.Length > 8 || !Digits(whole) || !Digits(fraction))
            return null;
        var rate = Canonical(
            BigInteger.Parse(whole + fraction, NumberStyles.None, CultureInfo.InvariantCulture),
            fraction.Length
        );
        return ValidRate(rate) ? rate : null;
    }

    private static bool Digits(string text) => text.AsSpan().IndexOfAnyExceptInRange('0', '9') < 0;

    // A rate as an exact scaled integer: value = mantissa / 10^scale.
    private static (BigInteger Mantissa, int Scale) Scaled(string rate)
    {
        var point = rate.IndexOf('.', StringComparison.Ordinal);
        var whole = point < 0 ? rate : rate[..point];
        var fraction = point < 0 ? "" : rate[(point + 1)..];
        return (
            BigInteger.Parse(whole + fraction, NumberStyles.None, CultureInfo.InvariantCulture),
            fraction.Length
        );
    }

    private static string Canonical(BigInteger mantissa, int scale)
    {
        var digits = mantissa.ToString(CultureInfo.InvariantCulture).PadLeft(scale + 1, '0');
        var whole = digits[..(digits.Length - scale)].TrimStart('0');
        var fraction = digits[(digits.Length - scale)..].TrimEnd('0');
        if (whole.Length == 0)
            whole = "0";
        return fraction.Length > 0 ? whole + "." + fraction : whole;
    }

    // Half-up division of nonnegative integers.
    private static BigInteger DivideHalfUp(BigInteger numerator, BigInteger denominator) =>
        (numerator * 2 + denominator) / (denominator * 2);
}
