public import Observation
public import PennyDomain

/// The caller's shares of shared expenses for the Activity periods browsed this session
/// (MAZ-185), listed next to personal entries and counted in the period's totals, as on Home
/// and the web Activity.
///
/// Shared data is online-only: answers are kept in memory for the session, never on the
/// device. When a period can't be read, the last answer for it (if any) is still listed and
/// the period says so (`status`), so Activity can say shared expenses are missing or may be
/// out of date instead of silently showing personal entries as if they were everything.
@MainActor
@Observable
public final class ActivitySharedModel {
    public enum Status: Equatable, Sendable {
        /// Not asked yet (or no service: the demo, previews).
        case idle
        case loading
        case loaded
        /// The last attempt failed. Rows from an earlier answer, if any, are still listed.
        case failed(String)
    }

    public private(set) var answers: [ActivityFilters.Period: WireHouseholdProjection] = [:]
    public private(set) var statuses: [ActivityFilters.Period: Status] = [:]

    @ObservationIgnored private let service: (any SharedProjectionService)?

    public init(service: (any SharedProjectionService)?) {
        self.service = service
    }

    /// Whether this account can have shared rows at all (false in the demo).
    public var isAvailable: Bool { service != nil }

    public func status(for period: ActivityFilters.Period) -> Status { statuses[period] ?? .idle }

    /// Whether `period` has an answer to list (possibly an older one, when `status` failed).
    public func hasAnswer(for period: ActivityFilters.Period) -> Bool { answers[period] != nil }

    /// Reads `period` from the server. A failure keeps the previous answer; a server without
    /// households (404) has nothing shared to list.
    public func refresh(_ period: ActivityFilters.Period) async {
        guard let service else { return }
        if statuses[period] == .loading { return }
        statuses[period] = .loading
        do {
            let answer = try await service.projection(period: period)
            if answers[period] != answer { answers[period] = answer }
            statuses[period] = .loaded
        } catch is CancellationError {
            statuses[period] = answers[period] == nil ? .idle : .loaded
        } catch let error as APIError {
            if case .notFound = error {
                answers[period] = WireHouseholdProjection(transactions: [], scheduled: [])
                statuses[period] = .loaded
            } else {
                statuses[period] = .failed(Self.message(error))
            }
        } catch {
            statuses[period] = .failed(Self.message(.unreachable))
        }
    }

    /// Refreshes every period read this session (after a shared write).
    public func refreshLoaded() async {
        for period in Array(statuses.keys) { await refresh(period) }
    }

    /// The period's recorded shares as domain shares (previews are left out: Activity lists
    /// recorded rows only). Rows that can't be read are left out; `LedgerReport` also leaves
    /// out rows in another currency than the ledger.
    public func shares(for period: ActivityFilters.Period, currency: Currency) -> [SharedExpenseShare] {
        guard let answer = answers[period] else { return [] }
        return answer.transactions.compactMap { wire in
            guard let share = SharedExpenseShare(wire: wire, currency: currency), !share.scheduled,
                period.contains(share.date)
            else { return nil }
            return share
        }
    }

    static func message(_ error: APIError) -> String {
        switch error {
        case .offline: "You're offline. Shared expenses need a connection."
        case .unauthorized: "Sign in again to list shared expenses."
        default: "Shared expenses couldn't load. Pull to refresh to try again."
        }
    }
}
