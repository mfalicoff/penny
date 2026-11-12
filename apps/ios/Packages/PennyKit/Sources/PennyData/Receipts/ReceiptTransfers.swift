import Foundation
public import PennyDomain

/// Uploads and downloads receipts for the signed-in account (MAZ-78). Receipts are
/// online-only: they go straight through the account's `APIClient` and are never queued in the
/// offline ledger (docs/ios-offline-sync.md). A protocol so tests and previews can stand in.
///
/// Both calls throw `APIError` or `CancellationError`. A 401 has already ended the session
/// when it is thrown (`AuthController.sessionDidExpire(for:)`).
@MainActor
public protocol ReceiptTransfers: AnyObject {
    /// Whether an upload or download can start now: online, signed in, session not expired.
    var isAvailable: Bool { get }
    /// Uploads a checked file. `progress` receives the fraction of the body sent, on any thread.
    func upload(_ candidate: ReceiptCandidate, progress: @escaping @Sendable (Double) -> Void) async throws
        -> ReceiptReference
    /// The receipt's bytes, with the session. A receipt this account can't read is
    /// `APIError.notFound`, the same as a missing one.
    func download(id: String) async throws -> ReceiptFile
}

/// The signed-in account's receipts, over `AuthController.client`, so a request always
/// carries the current session's token to its own server.
@MainActor
public final class AccountReceipts: ReceiptTransfers {
    private let auth: AuthController
    private let account: SignedInAccount
    private let sync: LedgerSyncModel?

    /// - Parameter sync: the offline model, for `canUseOnlineOnlyActions`; nil to rely on the
    ///   session alone.
    public init(auth: AuthController, account: SignedInAccount, sync: LedgerSyncModel?) {
        self.auth = auth
        self.account = account
        self.sync = sync
    }

    public var isAvailable: Bool {
        guard auth.state.account?.scope == account.scope else { return false }
        return sync?.canUseOnlineOnlyActions ?? true
    }

    public func upload(_ candidate: ReceiptCandidate, progress: @escaping @Sendable (Double) -> Void) async throws
        -> ReceiptReference
    {
        let client = try currentClient()
        let wire = try await expiring {
            try await client.uploadReceipt(
                name: candidate.name, mime: candidate.mime, data: candidate.data, progress: progress)
        }
        return ReceiptReference(id: wire.id, name: wire.name, uri: wire.uri, mime: wire.mime)
    }

    public func download(id: String) async throws -> ReceiptFile {
        let client = try currentClient()
        return try await expiring { try await client.receipt(id: id) }
    }

    /// The account's client, or `unauthorized` once it signed out or another account took over.
    private func currentClient() throws -> APIClient {
        guard let client = auth.client, client.scope == account.scope else {
            throw APIError.unauthorized(message: nil)
        }
        return client
    }

    /// Runs `request`; a 401 ends the session it was made with, unless another has started since.
    private func expiring<Value>(_ request: () async throws -> Value) async throws -> Value {
        let session = auth.state.account
        do {
            return try await request()
        } catch let error as APIError where error.requiresSignIn {
            if let session { auth.sessionDidExpire(for: session) }
            throw error
        }
    }
}
