public import Foundation
public import Observation
public import PennyDomain

// Exchange rates for entries in several currencies (MAZ-151, contract 2.4.0). The server fetches
// the European Central Bank's daily reference rates (operators can turn that off); the app asks it
// for the rate of an entry's currency on the entry's date, keeps the last answer per home
// currency for offline entries (whose rate is provisional), and replaces provisional rates once
// the server has the day's publication (`ProvisionalRates`).

/// `GET /api/rates?base=&date=` (schema `ExchangeRates`): reference rates against `base` for
/// `date`. `rates[X]` is how many `base` units one `X` is worth, as a canonical decimal string.
public struct WireExchangeRates: Codable, Equatable, Sendable {
    /// Whether the server fetches rates. When false, `rates` is empty and the person types one.
    public var enabled: Bool
    /// Who publishes the rates ("European Central Bank"); nil when fetching is off.
    public var source: String?
    public var base: String
    /// The date asked for.
    public var date: String
    /// The publication used; nil when the server has no rates.
    public var rateDate: String?
    /// True when `date` is after the latest publication: the rates are the latest known.
    public var provisional: Bool
    /// The latest publication the server has (Settings › Currency).
    public var latestDate: String?
    public var rates: [String: String]

    public init(
        enabled: Bool, source: String?, base: String, date: String, rateDate: String?, provisional: Bool,
        latestDate: String?, rates: [String: String]
    ) {
        self.enabled = enabled
        self.source = source
        self.base = base
        self.date = date
        self.rateDate = rateDate
        self.provisional = provisional
        self.latestDate = latestDate
        self.rates = rates
    }

    /// The rate for one unit of `currency` from this answer, with its status and publication date,
    /// or nil when there is none (fetching off, an unknown currency, a value that isn't canonical).
    /// `offline` marks a cached answer: a rate used without asking the server is provisional.
    public func choice(for currency: String, offline: Bool = false) -> RateChoice? {
        guard enabled, let rate = rates[currency], Currencies.validRate(rate),
            let published = rateDate.flatMap(PennyDomain.CalendarDate.init)
        else { return nil }
        return RateChoice(rate: rate, status: provisional || offline ? .provisional : .published, date: published)
    }
}

extension APIClient {
    /// `GET /api/rates`: the reference rates against `base` (a home currency) for `date`, or the
    /// latest publication when `date` is nil. Contract 2.4.0; `400 rates.invalid_request` for an
    /// unknown base or a bad date, which are checked before sending.
    public func exchangeRates(base: String, date: PennyDomain.CalendarDate?) async throws -> WireExchangeRates {
        guard Currencies.isCurrency(base) else { throw APIError.invalidRequest(.invalidField("base")) }
        var query = [URLQueryItem(name: "base", value: base)]
        if let date {
            guard date.isWithinLedgerRange else { throw APIError.invalidRequest(.invalidField("date")) }
            query.append(URLQueryItem(name: "date", value: date.description))
        }
        let rates: WireExchangeRates = try await json(.get, "/api/rates", query: query)
        guard rates.base == base else { throw APIError.malformedResponse }
        return rates
    }
}

/// Where the entry form and Settings › Currency read rates from.
public protocol ExchangeRateService: Sendable {
    func rates(base: String, date: PennyDomain.CalendarDate?) async throws -> WireExchangeRates
}

/// The signed-in account's rates, from its server.
public struct APIExchangeRateService: ExchangeRateService {
    private let client: APIClient
    private let sessionExpired: (@MainActor @Sendable () -> Void)?

    public init(client: APIClient, sessionExpired: (@MainActor @Sendable () -> Void)? = nil) {
        self.client = client
        self.sessionExpired = sessionExpired
    }

    public func rates(base: String, date: PennyDomain.CalendarDate?) async throws -> WireExchangeRates {
        try await SessionExpiry.run(sessionExpired) { try await client.exchangeRates(base: base, date: date) }
    }
}

/// The demo's rates: a few illustrative ECB reference rates against CAD, published every weekday
/// up to `latest`. Nothing is fetched.
public struct SampleExchangeRateService: ExchangeRateService {
    /// CAD per unit.
    static let perCAD: [String: String] = [
        "EUR": "1.4612", "USD": "1.373", "GBP": "1.8215", "JPY": "0.00906283", "CHF": "1.5794", "MXN": "0.0751",
    ]
    let latest: PennyDomain.CalendarDate

    public init(latest: PennyDomain.CalendarDate) { self.latest = latest }

    public func rates(base: String, date: PennyDomain.CalendarDate?) async throws -> WireExchangeRates {
        let asked = date ?? latest
        var rates: [String: String] = [:]
        let basePerCAD = base == "CAD" ? "1" : Self.perCAD[base]
        if let basePerCAD {
            for (code, perCAD) in Self.perCAD where code != base {
                rates[code] = try Currencies.crossRate(fromPerBase: basePerCAD, toPerBase: perCAD)
            }
            if base != "CAD" { rates["CAD"] = try Currencies.crossRate(fromPerBase: basePerCAD, toPerBase: "1") }
        }
        let published = min(asked, latest)
        return WireExchangeRates(
            enabled: true, source: "European Central Bank", base: base, date: asked.description,
            rateDate: published.description, provisional: asked > latest, latestDate: latest.description,
            rates: rates.compactMapValues(\.self))
    }
}

/// What a rate lookup found for the entry form.
public enum RateLookup: Equatable, Sendable {
    /// A published or provisional rate from the server (provisional too when it came from the
    /// last answer kept for offline use). `source` names the publisher.
    case found(RateChoice, source: String?)
    /// The server doesn't fetch rates: the person types one.
    case off
    /// No rate for this currency (offline with nothing kept, a currency the source doesn't
    /// quote, or the server failed): the person types one.
    case unavailable
}

/// Rates for one signed-in account or the demo: lookups for the entry form and the latest answer
/// for Settings › Currency. The last answer per home currency is kept on this device
/// (`UserDefaults`), so an entry made offline still gets a (provisional) rate.
@MainActor
@Observable
public final class ExchangeRateModel {
    /// The last answer per home currency, newest publication last asked.
    public private(set) var latest: [String: WireExchangeRates] = [:]
    /// True once a lookup or refresh reached the server this session.
    public private(set) var reachedServer = false

    @ObservationIgnored private let service: (any ExchangeRateService)?
    @ObservationIgnored private let defaults: UserDefaults?
    static let defaultsKey = "penny.exchangeRates"

    /// `defaults` nil keeps the answers in memory only (previews, tests, the demo).
    public init(service: (any ExchangeRateService)?, defaults: UserDefaults? = nil) {
        self.service = service
        self.defaults = defaults
        if let data = defaults?.data(forKey: Self.defaultsKey),
            let stored = try? JSONDecoder().decode([String: WireExchangeRates].self, from: data)
        {
            latest = stored
        }
    }

    /// Whether there is anything to ask (false in previews).
    public var isAvailable: Bool { service != nil }

    /// The rate of `currency` in `home` for an entry dated `date`.
    public func lookup(_ currency: String, home: Currency, date: PennyDomain.CalendarDate) async -> RateLookup {
        guard currency != home.rawValue else { return .unavailable }
        if let service {
            do {
                let answer = try await service.rates(base: home.rawValue, date: date)
                remember(answer)
                guard answer.enabled else { return .off }
                guard let choice = answer.choice(for: currency) else { return .unavailable }
                return .found(choice, source: answer.source)
            } catch APIError.notFound {
                // A server from before contract 2.4.0 has no rates.
                return .off
            } catch {
                // Offline or failing: the last answer, provisionally.
            }
        }
        guard let kept = latest[home.rawValue] else { return .unavailable }
        guard kept.enabled else { return .off }
        guard let choice = kept.choice(for: currency, offline: true) else { return .unavailable }
        return .found(choice, source: kept.source)
    }

    /// The published rate for an entry's date (the Exchange rate sheet's "Published rate"), or nil.
    public func published(_ currency: String, home: Currency, date: PennyDomain.CalendarDate) async -> (
        choice: RateChoice, source: String?
    )? {
        if case .found(let choice, let source) = await lookup(currency, home: home, date: date) {
            return (choice, source)
        }
        return nil
    }

    /// Reads the latest publication for Settings › Currency.
    public func refresh(home: Currency) async {
        guard let service, let answer = try? await service.rates(base: home.rawValue, date: nil) else { return }
        remember(answer)
    }

    private func remember(_ answer: WireExchangeRates) {
        reachedServer = true
        // Keep the newest publication: an answer for an old date doesn't replace a newer one.
        if let kept = latest[answer.base], kept.enabled, answer.enabled,
            (kept.rateDate ?? "") > (answer.rateDate ?? "")
        {
            return
        }
        latest[answer.base] = answer
        if let defaults, let data = try? JSONEncoder().encode(latest) { defaults.set(data, forKey: Self.defaultsKey) }
    }
}

/// Recent currencies and last-used rates, read from the ledger's entries (so they follow the
/// account to every device): Settings › Currency's "Used N times", the picker's Recent, and the
/// rate suggested when the server doesn't fetch rates.
public struct CurrencyUsage: Equatable, Sendable {
    public struct Use: Equatable, Sendable {
        public var code: String
        public var count: Int
        /// The rate of the latest entry in this currency (by date, then list order).
        public var lastRate: String
        public var lastDate: PennyDomain.CalendarDate
    }

    /// Most recently used first.
    public var uses: [Use]

    public init(_ ledger: Ledger) {
        var found: [String: Use] = [:]
        for entry in ledger.transactions {
            guard let code = entry.originalCurrency, let rate = entry.rate else { continue }
            if var use = found[code] {
                use.count += 1
                if entry.date >= use.lastDate {
                    use.lastDate = entry.date
                    use.lastRate = rate
                }
                found[code] = use
            } else {
                found[code] = Use(code: code, count: 1, lastRate: rate, lastDate: entry.date)
            }
        }
        uses = found.values.sorted { $0.lastDate != $1.lastDate ? $0.lastDate > $1.lastDate : $0.code < $1.code }
    }

    public func lastRate(_ code: String) -> String? { uses.first { $0.code == code }?.lastRate }
}

/// Replacing provisional rates once the server has the day's publication (MAZ-151): an entry
/// recorded before its date's rate was published, or offline, carries the latest known rate as
/// provisional; after a sync, each one whose date the server now has a final rate for is converted
/// again (`Currencies.reconvert`) and saved like any edit, so it is pending and merged as usual.
/// A rate the person edited is never replaced.
public enum ProvisionalRates {
    /// The dates that have entries with a provisional rate, oldest first.
    public static func dates(in ledger: Ledger) -> [PennyDomain.CalendarDate] {
        Array(Set(ledger.transactions.filter { $0.rateStatus == .provisional }.map(\.date))).sorted()
    }

    /// The entries dated `date` whose provisional rate `answer` (the server's rates for that date)
    /// makes final, converted again at the published rate; nothing while it is still provisional.
    public static func finalized(_ ledger: Ledger, date: PennyDomain.CalendarDate, answer: WireExchangeRates)
        -> [(original: LedgerEntry, updated: LedgerEntry)]
    {
        guard answer.enabled, !answer.provisional, answer.base == ledger.currency.rawValue else { return [] }
        return ledger.transactions.compactMap { entry in
            guard entry.date == date, entry.rateStatus == .provisional, let code = entry.originalCurrency,
                let choice = answer.choice(for: code), choice.status == .published
            else { return nil }
            let updated = Currencies.reconvert(entry, home: ledger.currency.rawValue, next: choice)
            return updated == entry ? nil : (entry, updated)
        }
    }
}
