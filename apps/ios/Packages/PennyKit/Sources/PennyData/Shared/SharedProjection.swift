import Foundation
public import Observation
public import PennyDomain

/// Where Home's reports get the caller's household shares: the server's personal projection.
/// A protocol so tests and the demo can stand in for the API.
public protocol SharedProjectionService: Sendable {
    func projection(month: MonthKey) async throws -> WireHouseholdProjection
}

/// The signed-in account's projection, straight from the API. A 401 ends the session it was
/// made with (`sessionExpired`), like every other signed-in request.
public struct APISharedProjection: SharedProjectionService {
    private let client: APIClient
    private let sessionExpired: (@MainActor @Sendable () -> Void)?

    public init(client: APIClient, sessionExpired: (@MainActor @Sendable () -> Void)? = nil) {
        self.client = client
        self.sessionExpired = sessionExpired
    }

    public func projection(month: MonthKey) async throws -> WireHouseholdProjection {
        try await SessionExpiry.run(sessionExpired) { try await client.householdProjection(month: month) }
    }
}

/// The caller's household shares for the months Home has shown, kept in memory for the
/// session (MAZ-77). Shared rows are server-owned: they are read here and joined with the
/// personal ledger in `LedgerReport`, which counts each row once (a row repeated across months
/// or a preview whose occurrence is recorded) and only ever the caller's `shareCents`.
///
/// When the projection can't be read, the last answer for that month is kept and the month
/// says so (`status`), so Home can tell the person that shared expenses may be missing
/// instead of silently showing personal totals as if they were complete. A server without
/// households (404) has no shared rows: that month is simply personal.
@MainActor
@Observable
public final class SharedProjectionModel {
    public enum Status: Equatable, Sendable {
        /// Not asked yet (or no service: the demo, previews).
        case idle
        case loading
        case loaded
        /// The last attempt failed. Rows from an earlier answer, if any, are still used.
        case failed(String)
    }

    /// Answers by month, oldest month first when read.
    public private(set) var answers: [MonthKey: WireHouseholdProjection] = [:]
    public private(set) var statuses: [MonthKey: Status] = [:]
    /// Bumped whenever `answers` changes, so a report built from them can be cached.
    public private(set) var revision = 0

    @ObservationIgnored private let service: (any SharedProjectionService)?

    public init(service: (any SharedProjectionService)?) {
        self.service = service
    }

    /// Whether this account can have shared rows at all (false in the demo).
    public var isAvailable: Bool { service != nil }

    public func status(for month: MonthKey) -> Status { statuses[month] ?? .idle }

    /// Reads `month` from the server. A failure keeps the previous answer.
    public func refresh(_ month: MonthKey) async {
        guard let service else { return }
        if statuses[month] == .loading { return }
        statuses[month] = .loading
        do {
            let answer = try await service.projection(month: month)
            if answers[month] != answer {
                answers[month] = answer
                revision += 1
            }
            statuses[month] = .loaded
        } catch is CancellationError {
            statuses[month] = answers[month] == nil ? .idle : .loaded
        } catch let error as APIError {
            if case .notFound = error {
                // No households on this server: nothing shared to add.
                if answers[month] != nil {
                    answers[month] = nil
                    revision += 1
                }
                statuses[month] = .loaded
            } else {
                statuses[month] = .failed(Self.message(error))
            }
        } catch {
            statuses[month] = .failed(Self.message(.unreachable))
        }
    }

    /// Every answer's rows as domain shares, oldest month first, so `LedgerReport` keeps the
    /// newest copy of a row that appears in several answers. Rows that can't be read (a date
    /// that isn't a calendar date, an unknown currency) are left out.
    public func shares(currency: Currency) -> (recorded: [SharedExpenseShare], scheduled: [SharedExpenseShare]) {
        var recorded: [SharedExpenseShare] = []
        var scheduled: [SharedExpenseShare] = []
        for month in answers.keys.sorted() {
            guard let answer = answers[month] else { continue }
            recorded += answer.transactions.compactMap { SharedExpenseShare(wire: $0, currency: currency) }
            scheduled += answer.scheduled.compactMap {
                var share = SharedExpenseShare(wire: $0, currency: currency)
                share?.scheduled = true
                return share
            }
        }
        return (recorded, scheduled)
    }

    static func message(_ error: APIError) -> String {
        switch error {
        case .offline: "You're offline. Shared expenses update when you're back online."
        case .unauthorized: "Sign in again to include shared expenses."
        default: "Shared expenses couldn't be updated. Pull to refresh to try again."
        }
    }
}
