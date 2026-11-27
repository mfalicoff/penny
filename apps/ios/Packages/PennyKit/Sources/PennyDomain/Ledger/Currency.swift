// Entries in several currencies (MAZ-151, contract 2.4.0), ported from
// apps/web/src/domain/currency.ts. The ledger keeps one home currency (`Ledger.currency`) for every
// total; an entry may also carry the amount it was paid in, that currency and the rate used, while
// `total` and `share` keep holding home amounts so the merge rules, reports and older apps keep
// working. Golden cases: contracts/fixtures/currency.json (`CurrencyTests`).
//
// - Amounts are integers in a currency's minor units (ISO 4217): JPY has none, KWD has three.
// - A rate is a canonical decimal string: how many home units one unit of the entry's currency is
//   worth ("1.4612" for 1 EUR = 1.4612 CAD). Up to 9 integer and 8 fraction digits, no trailing
//   fraction zeros, greater than zero. Arithmetic is exact (128-bit integers); never floating point.
// - The home amount is rounded once, half up, to the home currency's minor units. A split share is
//   computed from that rounded home total with the existing rules.
// - Cross rates are rounded half up to 6 significant digits, at most 8 fraction digits.
// - The rate for a date is the latest published one on or before it; a date after the latest
//   publication uses the latest rate, provisionally.

/// An ISO 4217 currency an entry may be paid in.
public struct CurrencyInfo: Hashable, Sendable, Identifiable {
    public let code: String
    public let name: String
    /// Decimal places of the currency's minor unit: 0, 2 or 3.
    public let minorUnits: Int
    /// Where it's used, for the picker's search ("Search currencies or countries").
    public let countries: String

    public var id: String { code }

    init(_ code: String, _ name: String, _ minorUnits: Int, _ countries: String) {
        self.code = code
        self.name = name
        self.minorUnits = minorUnits
        self.countries = countries
    }
}

/// Where an entry's rate comes from (the wire `rateStatus`).
public enum RateStatus: String, CaseIterable, Hashable, Sendable {
    /// The source's publication for the entry's date.
    case published
    /// The latest known rate for a date after it, or one recorded offline; replaced on a later sync.
    case provisional
    /// Typed by the person; never replaced.
    case edited
}

/// A rate to put on an entry (`reconvertEntry`'s `next`).
public struct RateChoice: Hashable, Sendable {
    public var rate: String
    public var status: RateStatus
    /// The publication date; ignored for an edited rate.
    public var date: CalendarDate?

    public init(rate: String, status: RateStatus, date: CalendarDate? = nil) {
        self.rate = rate
        self.status = status
        self.date = date
    }
}

/// The stored amounts of an entry typed in some currency (`Currencies.entryAmounts`).
public struct EntryAmounts: Hashable, Sendable {
    public var originalAmount: Int64
    public var total: Int64
    public var share: Int64

    public init(originalAmount: Int64, total: Int64, share: Int64) {
        self.originalAmount = originalAmount
        self.total = total
        self.share = share
    }
}

public enum Currencies {
    /// Every circulating ISO 4217 currency, A–Z by code (funds, metals and test codes are left out).
    public static let all: [CurrencyInfo] = [
        CurrencyInfo("AED", "UAE dirham", 2, "United Arab Emirates"),
        CurrencyInfo("AFN", "Afghan afghani", 2, "Afghanistan"),
        CurrencyInfo("ALL", "Albanian lek", 2, "Albania"),
        CurrencyInfo("AMD", "Armenian dram", 2, "Armenia"),
        CurrencyInfo("AOA", "Angolan kwanza", 2, "Angola"),
        CurrencyInfo("ARS", "Argentine peso", 2, "Argentina"),
        CurrencyInfo("AUD", "Australian dollar", 2, "Australia, Kiribati, Nauru, Tuvalu"),
        CurrencyInfo("AWG", "Aruban florin", 2, "Aruba"),
        CurrencyInfo("AZN", "Azerbaijani manat", 2, "Azerbaijan"),
        CurrencyInfo("BAM", "Bosnia and Herzegovina convertible mark", 2, "Bosnia and Herzegovina"),
        CurrencyInfo("BBD", "Barbadian dollar", 2, "Barbados"),
        CurrencyInfo("BDT", "Bangladeshi taka", 2, "Bangladesh"),
        CurrencyInfo("BGN", "Bulgarian lev", 2, "Bulgaria"),
        CurrencyInfo("BHD", "Bahraini dinar", 3, "Bahrain"),
        CurrencyInfo("BIF", "Burundian franc", 0, "Burundi"),
        CurrencyInfo("BMD", "Bermudian dollar", 2, "Bermuda"),
        CurrencyInfo("BND", "Brunei dollar", 2, "Brunei"),
        CurrencyInfo("BOB", "Bolivian boliviano", 2, "Bolivia"),
        CurrencyInfo("BRL", "Brazilian real", 2, "Brazil"),
        CurrencyInfo("BSD", "Bahamian dollar", 2, "Bahamas"),
        CurrencyInfo("BTN", "Bhutanese ngultrum", 2, "Bhutan"),
        CurrencyInfo("BWP", "Botswana pula", 2, "Botswana"),
        CurrencyInfo("BYN", "Belarusian ruble", 2, "Belarus"),
        CurrencyInfo("BZD", "Belize dollar", 2, "Belize"),
        CurrencyInfo("CAD", "Canadian dollar", 2, "Canada"),
        CurrencyInfo("CDF", "Congolese franc", 2, "Democratic Republic of the Congo"),
        CurrencyInfo("CHF", "Swiss franc", 2, "Switzerland, Liechtenstein"),
        CurrencyInfo("CLP", "Chilean peso", 0, "Chile"),
        CurrencyInfo("CNY", "Chinese yuan", 2, "China"),
        CurrencyInfo("COP", "Colombian peso", 2, "Colombia"),
        CurrencyInfo("CRC", "Costa Rican colón", 2, "Costa Rica"),
        CurrencyInfo("CUP", "Cuban peso", 2, "Cuba"),
        CurrencyInfo("CVE", "Cape Verdean escudo", 2, "Cabo Verde"),
        CurrencyInfo("CZK", "Czech koruna", 2, "Czechia"),
        CurrencyInfo("DJF", "Djiboutian franc", 0, "Djibouti"),
        CurrencyInfo("DKK", "Danish krone", 2, "Denmark, Greenland, Faroe Islands"),
        CurrencyInfo("DOP", "Dominican peso", 2, "Dominican Republic"),
        CurrencyInfo("DZD", "Algerian dinar", 2, "Algeria"),
        CurrencyInfo("EGP", "Egyptian pound", 2, "Egypt"),
        CurrencyInfo("ERN", "Eritrean nakfa", 2, "Eritrea"),
        CurrencyInfo("ETB", "Ethiopian birr", 2, "Ethiopia"),
        CurrencyInfo(
            "EUR", "Euro", 2,
            "Austria, Belgium, Croatia, Cyprus, Estonia, Finland, France, Germany, Greece, Ireland, Italy, Latvia, Lithuania, Luxembourg, Malta, Netherlands, Portugal, Slovakia, Slovenia, Spain, Andorra, Monaco, San Marino, Vatican City, Montenegro, Kosovo"
        ),
        CurrencyInfo("FJD", "Fijian dollar", 2, "Fiji"),
        CurrencyInfo("FKP", "Falkland Islands pound", 2, "Falkland Islands"),
        CurrencyInfo("GBP", "Pound sterling", 2, "United Kingdom, Isle of Man, Jersey, Guernsey"),
        CurrencyInfo("GEL", "Georgian lari", 2, "Georgia"),
        CurrencyInfo("GHS", "Ghanaian cedi", 2, "Ghana"),
        CurrencyInfo("GIP", "Gibraltar pound", 2, "Gibraltar"),
        CurrencyInfo("GMD", "Gambian dalasi", 2, "Gambia"),
        CurrencyInfo("GNF", "Guinean franc", 0, "Guinea"),
        CurrencyInfo("GTQ", "Guatemalan quetzal", 2, "Guatemala"),
        CurrencyInfo("GYD", "Guyanese dollar", 2, "Guyana"),
        CurrencyInfo("HKD", "Hong Kong dollar", 2, "Hong Kong"),
        CurrencyInfo("HNL", "Honduran lempira", 2, "Honduras"),
        CurrencyInfo("HTG", "Haitian gourde", 2, "Haiti"),
        CurrencyInfo("HUF", "Hungarian forint", 2, "Hungary"),
        CurrencyInfo("IDR", "Indonesian rupiah", 2, "Indonesia"),
        CurrencyInfo("ILS", "Israeli new shekel", 2, "Israel, Palestine"),
        CurrencyInfo("INR", "Indian rupee", 2, "India"),
        CurrencyInfo("IQD", "Iraqi dinar", 3, "Iraq"),
        CurrencyInfo("IRR", "Iranian rial", 2, "Iran"),
        CurrencyInfo("ISK", "Icelandic króna", 0, "Iceland"),
        CurrencyInfo("JMD", "Jamaican dollar", 2, "Jamaica"),
        CurrencyInfo("JOD", "Jordanian dinar", 3, "Jordan"),
        CurrencyInfo("JPY", "Japanese yen", 0, "Japan"),
        CurrencyInfo("KES", "Kenyan shilling", 2, "Kenya"),
        CurrencyInfo("KGS", "Kyrgyz som", 2, "Kyrgyzstan"),
        CurrencyInfo("KHR", "Cambodian riel", 2, "Cambodia"),
        CurrencyInfo("KMF", "Comorian franc", 0, "Comoros"),
        CurrencyInfo("KPW", "North Korean won", 2, "North Korea"),
        CurrencyInfo("KRW", "South Korean won", 0, "South Korea"),
        CurrencyInfo("KWD", "Kuwaiti dinar", 3, "Kuwait"),
        CurrencyInfo("KYD", "Cayman Islands dollar", 2, "Cayman Islands"),
        CurrencyInfo("KZT", "Kazakhstani tenge", 2, "Kazakhstan"),
        CurrencyInfo("LAK", "Lao kip", 2, "Laos"),
        CurrencyInfo("LBP", "Lebanese pound", 2, "Lebanon"),
        CurrencyInfo("LKR", "Sri Lankan rupee", 2, "Sri Lanka"),
        CurrencyInfo("LRD", "Liberian dollar", 2, "Liberia"),
        CurrencyInfo("LSL", "Lesotho loti", 2, "Lesotho"),
        CurrencyInfo("LYD", "Libyan dinar", 3, "Libya"),
        CurrencyInfo("MAD", "Moroccan dirham", 2, "Morocco"),
        CurrencyInfo("MDL", "Moldovan leu", 2, "Moldova"),
        CurrencyInfo("MGA", "Malagasy ariary", 2, "Madagascar"),
        CurrencyInfo("MKD", "Macedonian denar", 2, "North Macedonia"),
        CurrencyInfo("MMK", "Myanmar kyat", 2, "Myanmar"),
        CurrencyInfo("MNT", "Mongolian tögrög", 2, "Mongolia"),
        CurrencyInfo("MOP", "Macanese pataca", 2, "Macao"),
        CurrencyInfo("MRU", "Mauritanian ouguiya", 2, "Mauritania"),
        CurrencyInfo("MUR", "Mauritian rupee", 2, "Mauritius"),
        CurrencyInfo("MVR", "Maldivian rufiyaa", 2, "Maldives"),
        CurrencyInfo("MWK", "Malawian kwacha", 2, "Malawi"),
        CurrencyInfo("MXN", "Mexican peso", 2, "Mexico"),
        CurrencyInfo("MYR", "Malaysian ringgit", 2, "Malaysia"),
        CurrencyInfo("MZN", "Mozambican metical", 2, "Mozambique"),
        CurrencyInfo("NAD", "Namibian dollar", 2, "Namibia"),
        CurrencyInfo("NGN", "Nigerian naira", 2, "Nigeria"),
        CurrencyInfo("NIO", "Nicaraguan córdoba", 2, "Nicaragua"),
        CurrencyInfo("NOK", "Norwegian krone", 2, "Norway, Svalbard"),
        CurrencyInfo("NPR", "Nepalese rupee", 2, "Nepal"),
        CurrencyInfo("NZD", "New Zealand dollar", 2, "New Zealand, Cook Islands, Niue"),
        CurrencyInfo("OMR", "Omani rial", 3, "Oman"),
        CurrencyInfo("PAB", "Panamanian balboa", 2, "Panama"),
        CurrencyInfo("PEN", "Peruvian sol", 2, "Peru"),
        CurrencyInfo("PGK", "Papua New Guinean kina", 2, "Papua New Guinea"),
        CurrencyInfo("PHP", "Philippine peso", 2, "Philippines"),
        CurrencyInfo("PKR", "Pakistani rupee", 2, "Pakistan"),
        CurrencyInfo("PLN", "Polish złoty", 2, "Poland"),
        CurrencyInfo("PYG", "Paraguayan guaraní", 0, "Paraguay"),
        CurrencyInfo("QAR", "Qatari riyal", 2, "Qatar"),
        CurrencyInfo("RON", "Romanian leu", 2, "Romania"),
        CurrencyInfo("RSD", "Serbian dinar", 2, "Serbia"),
        CurrencyInfo("RUB", "Russian ruble", 2, "Russia"),
        CurrencyInfo("RWF", "Rwandan franc", 0, "Rwanda"),
        CurrencyInfo("SAR", "Saudi riyal", 2, "Saudi Arabia"),
        CurrencyInfo("SBD", "Solomon Islands dollar", 2, "Solomon Islands"),
        CurrencyInfo("SCR", "Seychellois rupee", 2, "Seychelles"),
        CurrencyInfo("SDG", "Sudanese pound", 2, "Sudan"),
        CurrencyInfo("SEK", "Swedish krona", 2, "Sweden"),
        CurrencyInfo("SGD", "Singapore dollar", 2, "Singapore"),
        CurrencyInfo("SHP", "Saint Helena pound", 2, "Saint Helena"),
        CurrencyInfo("SLE", "Sierra Leonean leone", 2, "Sierra Leone"),
        CurrencyInfo("SOS", "Somali shilling", 2, "Somalia"),
        CurrencyInfo("SRD", "Surinamese dollar", 2, "Suriname"),
        CurrencyInfo("SSP", "South Sudanese pound", 2, "South Sudan"),
        CurrencyInfo("STN", "São Tomé and Príncipe dobra", 2, "São Tomé and Príncipe"),
        CurrencyInfo("SVC", "Salvadoran colón", 2, "El Salvador"),
        CurrencyInfo("SYP", "Syrian pound", 2, "Syria"),
        CurrencyInfo("SZL", "Swazi lilangeni", 2, "Eswatini"),
        CurrencyInfo("THB", "Thai baht", 2, "Thailand"),
        CurrencyInfo("TJS", "Tajikistani somoni", 2, "Tajikistan"),
        CurrencyInfo("TMT", "Turkmenistani manat", 2, "Turkmenistan"),
        CurrencyInfo("TND", "Tunisian dinar", 3, "Tunisia"),
        CurrencyInfo("TOP", "Tongan paʻanga", 2, "Tonga"),
        CurrencyInfo("TRY", "Turkish lira", 2, "Türkiye, Northern Cyprus"),
        CurrencyInfo("TTD", "Trinidad and Tobago dollar", 2, "Trinidad and Tobago"),
        CurrencyInfo("TWD", "New Taiwan dollar", 2, "Taiwan"),
        CurrencyInfo("TZS", "Tanzanian shilling", 2, "Tanzania"),
        CurrencyInfo("UAH", "Ukrainian hryvnia", 2, "Ukraine"),
        CurrencyInfo("UGX", "Ugandan shilling", 0, "Uganda"),
        CurrencyInfo(
            "USD", "US dollar", 2, "United States, Ecuador, El Salvador, Panama, Puerto Rico, Timor-Leste, Zimbabwe"),
        CurrencyInfo("UYU", "Uruguayan peso", 2, "Uruguay"),
        CurrencyInfo("UZS", "Uzbekistani sum", 2, "Uzbekistan"),
        CurrencyInfo("VES", "Venezuelan bolívar", 2, "Venezuela"),
        CurrencyInfo("VND", "Vietnamese đồng", 0, "Vietnam"),
        CurrencyInfo("VUV", "Vanuatu vatu", 0, "Vanuatu"),
        CurrencyInfo("WST", "Samoan tālā", 2, "Samoa"),
        CurrencyInfo(
            "XAF", "Central African CFA franc", 0,
            "Cameroon, Central African Republic, Chad, Republic of the Congo, Equatorial Guinea, Gabon"),
        CurrencyInfo(
            "XCD", "East Caribbean dollar", 2,
            "Antigua and Barbuda, Dominica, Grenada, Saint Kitts and Nevis, Saint Lucia, Saint Vincent and the Grenadines, Anguilla, Montserrat"
        ),
        CurrencyInfo("XCG", "Caribbean guilder", 2, "Curaçao, Sint Maarten"),
        CurrencyInfo(
            "XOF", "West African CFA franc", 0,
            "Benin, Burkina Faso, Côte d'Ivoire, Guinea-Bissau, Mali, Niger, Senegal, Togo"),
        CurrencyInfo("XPF", "CFP franc", 0, "French Polynesia, New Caledonia, Wallis and Futuna"),
        CurrencyInfo("YER", "Yemeni rial", 2, "Yemen"),
        CurrencyInfo("ZAR", "South African rand", 2, "South Africa"),
        CurrencyInfo("ZMW", "Zambian kwacha", 2, "Zambia"),
        CurrencyInfo("ZWG", "Zimbabwe Gold", 2, "Zimbabwe"),
    ]

    private static let byCode: [String: CurrencyInfo] = Dictionary(
        all.map { ($0.code, $0) }, uniquingKeysWith: { first, _ in first })

    /// The home currencies a ledger may use today (contract 2.4.0; every entry may use any of `all`).
    public static let homeCurrencies = ["CAD", "USD", "EUR", "GBP"]

    public static func info(_ code: String) -> CurrencyInfo? { byCode[code] }

    public static func isCurrency(_ code: String) -> Bool { byCode[code] != nil }

    public static func minorUnits(_ code: String) throws(LedgerRuleError) -> Int {
        guard let info = byCode[code] else { throw .unknownCurrency }
        return info.minorUnits
    }

    /// Parses a typed amount into the currency's minor units (`Money.cents` is this with two places):
    /// up to 11 digits in all, "." or "," before at most `minorUnits` decimals, trimmed.
    public static func parseAmount(_ value: String, currency code: String) throws(LedgerRuleError) -> Int64 {
        let units = try minorUnits(code)
        let failure: LedgerRuleError = units == 2 ? .invalidAmount : .invalidCurrencyAmount(decimals: units)
        let bytes = Array(JavaScriptText.trim(value).utf8)
        let maxWhole = 11 - units
        var index = 0
        var whole: Int64 = 0
        while index < bytes.count, isDigit(bytes[index]) {
            guard index < maxWhole else { throw failure }
            whole = whole * 10 + Int64(bytes[index] - 0x30)
            index += 1
        }
        guard index > 0 else { throw failure }
        var fraction: Int64 = 0
        var fractionDigits = 0
        if index < bytes.count {
            guard units > 0, bytes[index] == 0x2E || bytes[index] == 0x2C else { throw failure }
            index += 1
            while index < bytes.count, isDigit(bytes[index]) {
                guard fractionDigits < units else { throw failure }
                fraction = fraction * 10 + Int64(bytes[index] - 0x30)
                fractionDigits += 1
                index += 1
            }
            guard index == bytes.count else { throw failure }
        }
        return whole * power(units) + fraction * power(units - fractionDigits)
    }

    /// True for a stored rate: canonical, greater than zero, at most 9 integer and 8 fraction digits.
    public static func validRate(_ rate: String) -> Bool {
        let bytes = Array(rate.utf8)
        guard let first = bytes.first, isDigit(first) else { return false }
        var index = 0
        if first == 0x30 {
            index = 1
        } else {
            while index < bytes.count, isDigit(bytes[index]) { index += 1 }
            guard index <= 9 else { return false }
        }
        if index < bytes.count {
            guard bytes[index] == 0x2E else { return false }
            let fraction = bytes[(index + 1)...]
            guard (1...8).contains(fraction.count), fraction.allSatisfy(isDigit), fraction.last != 0x30 else {
                return false
            }
        }
        return bytes.contains { (0x31...0x39).contains($0) }
    }

    /// Turns a typed rate ("1,49", "1.4900") into its canonical form ("1.49").
    public static func normalizeRate(_ value: String) throws(LedgerRuleError) -> String {
        var bytes = Array(JavaScriptText.trim(value).utf8)
        // JavaScript's `replace(",", ".")`: the first comma only.
        if let comma = bytes.firstIndex(of: 0x2C) { bytes[comma] = 0x2E }
        let dot = bytes.firstIndex(of: 0x2E)
        let whole = bytes[..<(dot ?? bytes.count)]
        let fraction = dot.map { bytes[($0 + 1)...] } ?? []
        guard (1...9).contains(whole.count), whole.allSatisfy(isDigit), fraction.count <= 8,
            fraction.allSatisfy(isDigit)
        else { throw .invalidRateFormat }
        var mantissa: UInt128 = 0
        for digit in whole + fraction { mantissa = mantissa * 10 + UInt128(digit - 0x30) }
        let rate = canonical(mantissa, scale: fraction.count)
        guard validRate(rate) else { throw .zeroRate }
        return rate
    }

    /// The home amount of `amount` (minor units of `from`) at `rate` (home units per unit of `from`),
    /// rounded once, half up, to the home currency's minor units.
    public static func convertAmount(_ amount: Int64, from: String, rate: String, home: String)
        throws(LedgerRuleError) -> Int64
    {
        // JavaScript's safe integers, as the reference refuses anything larger.
        guard (0...9_007_199_254_740_991).contains(amount) else { throw .invalidAmount }
        guard validRate(rate) else { throw .zeroRate }
        let (mantissa, scale) = scaled(rate)
        let numerator = UInt128(amount) * mantissa * UInt128(power(try minorUnits(home)))
        let denominator = UInt128(power(scale + (try minorUnits(from))))
        let result = divideHalfUp(numerator, denominator)
        return result > UInt128(Int64.max) ? Int64.max : Int64(result)
    }

    /// The rate of one unit of `from` in `to` when both are quoted against the same base (units per
    /// base; the base itself is "1"), rounded half up to 6 significant digits and at most 8 fraction
    /// digits. Nil when the result rounds to zero.
    public static func crossRate(fromPerBase: String, toPerBase: String) throws(LedgerRuleError) -> String? {
        guard validRate(fromPerBase), validRate(toPerBase) else { throw .zeroRate }
        let from = scaled(fromPerBase)
        let to = scaled(toPerBase)
        // value = (to.m / 10^to.s) / (from.m / 10^from.s), kept exact as numerator / denominator.
        let numerator = to.mantissa * UInt128(power(from.scale))
        let denominator = from.mantissa * UInt128(power(to.scale))
        // The position of the first significant digit, as the reference counts the digits of
        // floor(value * 10^16) minus 16 (a value under 10^-16 counts as -15).
        var integerDigits: Int
        if numerator >= denominator {
            integerDigits = String(numerator / denominator).count
        } else {
            var scaledUp = numerator
            integerDigits = 1
            while scaledUp < denominator, integerDigits > -15 {
                scaledUp *= 10
                integerDigits -= 1
            }
        }
        let scale = min(8, max(0, 6 - integerDigits))
        let mantissa = divideHalfUp(numerator * UInt128(power(scale)), denominator)
        if mantissa == 0 { return nil }
        let rate = canonical(mantissa, scale: scale)
        return validRate(rate) ? rate : nil
    }

    /// Which publication applies to `date`, from the dates the source published (any order): the
    /// latest one on or before it. A date after every publication takes the latest, provisionally.
    /// Nil when nothing was published, or when the date is before the first publication.
    public static func publishedRateDate<Day: Comparable>(_ published: [Day], date: Day) -> (
        date: Day, provisional: Bool
    )? {
        guard let latest = published.max() else { return nil }
        if date > latest { return (latest, true) }
        guard let found = published.filter({ $0 <= date }).max() else { return nil }
        return (found, false)
    }

    /// The stored amounts of an entry typed in `currency`: the original amount, the home total
    /// (converted when the currency isn't the home one) and the person's share. An "amount" split is
    /// typed in the entry's currency and converted at the same rate; equal and percent splits work
    /// on the home total.
    public static func entryAmounts(
        amount: String, currency: String, home: String, rate: String?, mode: Money.SplitMode, split: String
    ) throws(LedgerRuleError) -> EntryAmounts {
        let foreign = currency != home
        if foreign, rate == nil { throw .missingRate }
        let originalAmount = try parseAmount(amount, currency: currency)
        func toHome(_ value: Int64) throws(LedgerRuleError) -> Int64 {
            guard foreign, let rate else { return value }
            return try convertAmount(value, from: currency, rate: rate, home: home)
        }
        let total = try toHome(originalAmount)
        guard total > 0 else { throw .zeroAmount }
        let share: Int64
        switch mode {
        case .full:
            share = total
        case .equal, .percent:
            // The home total is whole minor units; huge converted totals are refused by the ledger rules.
            share = try Money.personalShare(total: min(total, Money.maxCents), mode: mode, input: split)
        case .amount:
            share = try toHome(try parseAmount(split, currency: currency))
        }
        guard share <= total else { throw .shareExceedsTotal }
        return EntryAmounts(originalAmount: originalAmount, total: total, share: share)
    }

    /// The entry with a new rate (a provisional rate made final on sync, or a date or currency
    /// change): the home total is converted again and the share follows it — the whole total stays
    /// whole, an equal split is divided again, any other share keeps its proportion (half up).
    /// Entries without an original currency, and edited rates (which nothing replaces), come back
    /// unchanged.
    public static func reconvert(_ entry: LedgerEntry, home: String, next: RateChoice) -> LedgerEntry {
        guard let currency = entry.originalCurrency, let amount = entry.originalAmount, entry.rateStatus != .edited,
            let total = try? convertAmount(amount, from: currency, rate: next.rate, home: home)
        else { return entry }
        var share: Int64
        if entry.share == entry.total {
            share = total
        } else if let people = entry.participants, people > 0,
            Money.divideRoundingHalfUp(max(entry.total, 0), by: Int64(people)) == entry.share
        {
            share = Money.divideRoundingHalfUp(total, by: Int64(people))
        } else if entry.total <= 0 {
            share = 0
        } else {
            let scaledShare = divideHalfUp(
                UInt128(max(entry.share, 0)) * UInt128(total), UInt128(entry.total))
            share = scaledShare > UInt128(Int64.max) ? Int64.max : Int64(scaledShare)
        }
        var result = entry
        result.total = total
        result.share = min(share, total)
        result.rate = next.rate
        result.rateStatus = next.status
        result.rateDate = next.status == .edited ? nil : next.date
        return result
    }

    /// Why the foreign-amount fields of a stored entry are invalid, or nil when they're fine. The
    /// sentences are the reference's (`foreignAmountProblem`), the write schema's reasons.
    public static func foreignAmountProblem(_ entry: LedgerEntry, home: String) -> String? {
        let present = [
            entry.originalAmount != nil, entry.originalCurrency != nil, entry.rate != nil, entry.rateStatus != nil,
        ].filter { $0 }.count
        if present == 0 { return entry.rateDate == nil ? nil : "Invalid original amount" }
        guard present == 4, let originalAmount = entry.originalAmount, let originalCurrency = entry.originalCurrency,
            let rate = entry.rate, let rateStatus = entry.rateStatus
        else { return "Invalid original amount" }
        guard isCurrency(originalCurrency), originalCurrency != home else { return "Invalid original currency" }
        guard (1...Money.maxCents).contains(originalAmount) else { return "Invalid original amount" }
        guard validRate(rate) else { return "Invalid exchange rate" }
        guard (rateStatus == .edited) == (entry.rateDate == nil) else { return "Invalid exchange rate" }
        guard (try? convertAmount(originalAmount, from: originalCurrency, rate: rate, home: home)) == entry.total
        else { return "Invalid converted amount" }
        return nil
    }

    /// `value × part / whole`, half up, exactly (no overflow): a share's proportion carried to
    /// another amount. Zero when `whole` isn't positive.
    public static func proportion(_ part: Int64, of whole: Int64, applied value: Int64) -> Int64 {
        guard whole > 0 else { return 0 }
        let result = divideHalfUp(UInt128(max(part, 0)) * UInt128(max(value, 0)), UInt128(whole))
        return result > UInt128(Int64.max) ? Int64.max : Int64(result)
    }

    // MARK: Exact decimals

    private static func isDigit(_ byte: UInt8) -> Bool { (0x30...0x39).contains(byte) }

    private static func power(_ exponent: Int) -> Int64 {
        var value: Int64 = 1
        for _ in 0..<max(exponent, 0) { value *= 10 }
        return value
    }

    /// A canonical rate as an exact scaled integer: value = mantissa / 10^scale.
    private static func scaled(_ rate: String) -> (mantissa: UInt128, scale: Int) {
        var mantissa: UInt128 = 0
        var scale = 0
        var seenDot = false
        for byte in rate.utf8 {
            if byte == 0x2E {
                seenDot = true
                continue
            }
            mantissa = mantissa * 10 + UInt128(byte - 0x30)
            if seenDot { scale += 1 }
        }
        return (mantissa, scale)
    }

    private static func canonical(_ mantissa: UInt128, scale: Int) -> String {
        var digits = String(mantissa)
        if digits.count < scale + 1 { digits = String(repeating: "0", count: scale + 1 - digits.count) + digits }
        var whole = String(digits.dropLast(scale))
        var fraction = String(digits.suffix(scale))
        while fraction.last == "0" { fraction.removeLast() }
        while whole.count > 1, whole.first == "0" { whole.removeFirst() }
        return fraction.isEmpty ? whole : "\(whole).\(fraction)"
    }

    /// Half-up division of non-negative integers.
    private static func divideHalfUp(_ numerator: UInt128, _ denominator: UInt128) -> UInt128 {
        (numerator * 2 + denominator) / (denominator * 2)
    }
}

extension LedgerChange {
    /// Replaces an entry's provisional rate with the published one (MAZ-151), in place. Nothing
    /// changes when the entry is no longer exactly `original` (edited or deleted since): the
    /// person's version wins and a later sync looks again.
    public static func finalizeRate(_ updated: LedgerEntry, original: LedgerEntry) -> LedgerChange {
        LedgerChange { ledger in
            guard let index = ledger.transactions.firstIndex(where: { $0.id == original.id }),
                ledger.transactions[index] == original
            else { return ledger }
            var next = ledger
            next.transactions[index] = updated
            return next
        }
    }
}
