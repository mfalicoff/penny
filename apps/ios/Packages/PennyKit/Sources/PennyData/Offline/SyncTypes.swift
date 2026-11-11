public import Foundation
public import PennyDomain

/// Why a sync did not finish. Pending work is always kept; branch on the case to word the
/// banner and decide whether to retry by itself.
public enum SyncIssue: Equatable, Sendable {
    /// The device has no network. Retried when the network returns.
    case offline
    /// The server did not answer (timeout, DNS, refused connection, TLS). Retried with backoff.
    case serverUnreachable
    /// The server answered but could not take the write now (5xx, 503 maintenance, 429, an
    /// answer that does not match the contract). Retried with backoff, honoring Retry-After.
    case serverUnavailable(retryAfter: TimeInterval?)
    /// The server refused the merged ledger (400, 403, 413) with this message, or the merge
    /// produced a ledger the server would refuse. Not retried automatically: the next save
    /// or a manual retry tries again. The changes stay on this device.
    case rejected(message: String?)
    /// Every attempt met a newer revision (409). Retried with backoff.
    case conflictRetriesExhausted
    /// The server's ledger is a version or value this build does not understand. Nothing is
    /// written over it; update the app.
    case incompatibleServerData
    /// The server accepted the changes but this device could not record that (disk full, I/O
    /// error). The previous copy is intact; the next sync repeats the step without duplicates.
    case storageWriteFailed

    /// Whether the engine schedules another attempt by itself.
    public var retriesAutomatically: Bool {
        switch self {
        case .offline, .serverUnreachable, .serverUnavailable, .conflictRetriesExhausted, .storageWriteFailed: true
        case .rejected, .incompatibleServerData: false
        }
    }

    static func from(_ error: APIError) -> SyncIssue {
        switch error {
        case .offline: .offline
        case .timeout, .unreachable: .serverUnreachable
        case .rateLimited(let after): .serverUnavailable(retryAfter: after)
        case .unavailable(let after, _): .serverUnavailable(retryAfter: after)
        case .server, .unexpectedStatus, .malformedResponse: .serverUnavailable(retryAfter: nil)
        case .conflict: .conflictRetriesExhausted
        case .badRequest(let message), .forbidden(let message), .payloadTooLarge(let message),
            .notFound(let message):
            .rejected(message: message)
        case .unauthorized, .invalidRequest: .rejected(message: nil)
        }
    }
}

/// How one sync ended.
public enum SyncOutcome: Equatable, Sendable {
    /// The device and the server hold the same ledger (changes made during the sync may be
    /// pending again; the engine runs another pass for them).
    case synced
    case failed(SyncIssue)
    /// 401: the session ended. Nothing local was touched; signing in again resumes.
    case sessionExpired
    /// The copy on this device cannot be read (`LedgerStoreError`), the client belongs to
    /// another account, or the account's data was removed. Nothing was sent.
    case notReady
    /// The task was cancelled (sign-out, account switch). Nothing local was touched.
    case cancelled
}

/// The state of the copy on this device.
public enum LedgerStorageCondition: Equatable, Sendable {
    /// Not read yet.
    case notLoaded
    /// Read; `snapshot` is nil until the first download.
    case ready
    case unavailable
    case unreadable
    case newerFormat(Int)
    /// The account's data was removed (sign-out); this engine does nothing more.
    case removed

    init(_ error: LedgerStoreError) {
        switch error {
        case .unavailable: self = .unavailable
        case .newerFormat(let format): self = .newerFormat(format)
        case .unreadable, .wrongAccount, .writeFailed: self = .unreadable
        }
    }
}

/// Everything an observer needs from one account's engine.
public struct LedgerEngineState: Equatable, Sendable {
    public var scope: AccountScope
    public var snapshot: LocalLedgerSnapshot?
    public var storage: LedgerStorageCondition
    public var isSyncing: Bool
    /// The last finished sync, nil before the first.
    public var lastOutcome: SyncOutcome?

    public var pending: PendingChanges { snapshot?.pending ?? .none }
}

/// A save could not be recorded. The ledger on screen and on disk are unchanged; keep the
/// person's draft and show `message`.
public enum LedgerSaveError: Error, Equatable, Sendable {
    /// A ledger rule refused the change (legacy wording in `LedgerRuleError.message`).
    case rule(LedgerRuleError)
    /// The change would make a ledger the server refuses.
    case invalid([LedgerViolation])
    /// The ledger has not been downloaded to this device yet.
    case notLoaded
    /// The copy on this device cannot be read; recover it first.
    case storageUnreadable
    /// Writing to this device failed, so nothing was saved.
    case writeFailed
    /// This account is signing out, so its entries are about to leave this device.
    case signingOut
    /// This account's entries are moving to its new email (changed on the server).
    case changingEmail
    /// The account signed out, its session ended or another account signed in.
    case unavailable

    public var message: String {
        switch self {
        case .rule(let error): error.message
        case .invalid: "This change can't be saved. Please review the entry and try again."
        case .notLoaded: "Wait for your ledger to load before saving."
        case .storageUnreadable: "Saved entries on this device can't be read. Recover them before saving."
        case .writeFailed: "This device couldn't save the change. Free some space and try again."
        case .signingOut: "You're signing out, so this change wasn't saved."
        case .changingEmail:
            "Penny is moving your entries to your account's new email. Try again in a moment."
        case .unavailable: "Your session changed. Reopen this entry before saving."
        }
    }
}

/// Conflict retries: how many times to re-read and re-apply after a 409, and how long to
/// wait between attempts. The server never merges; the client does (docs/migration/ledger.md).
public struct ConflictRetryPolicy: Sendable {
    public var maxAttempts: Int
    public var delay: @Sendable (_ attempt: Int) async -> Void

    public init(maxAttempts: Int = 5, delay: @escaping @Sendable (_ attempt: Int) async -> Void) {
        self.maxAttempts = max(1, maxAttempts)
        self.delay = delay
    }

    /// Five attempts, waiting 0.2, 0.4, 0.8, 1.6 s plus up to 50% jitter between them, so two
    /// devices racing on one ledger do not collide in lockstep.
    public static let standard = ConflictRetryPolicy { attempt in
        let base = 0.2 * Double(1 << min(attempt - 1, 6))
        try? await Task.sleep(for: .seconds(base * Double.random(in: 1...1.5)))
    }

    /// No waiting, for tests.
    public static func immediate(maxAttempts: Int = 5) -> ConflictRetryPolicy {
        ConflictRetryPolicy(maxAttempts: maxAttempts) { _ in }
    }
}
