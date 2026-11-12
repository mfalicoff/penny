public import Foundation
public import Observation
public import PennyDomain

/// One entry form's receipt upload (MAZ-78, `receipt-upload` card): a checked file goes up
/// with progress and can be cancelled; a failure keeps the file for Try again; the uploaded
/// receipt is handed to `attach`, which links it to the draft.
///
/// The model belongs to the form, not to the More details page, so an upload keeps running
/// when the person goes back to the form, and Save can wait for it. Releasing the model (the
/// form closed) cancels an upload in flight. Nothing here touches the draft's other values: a
/// refused file, a failure, a cancel or an ended session leave them as typed.
@MainActor
@Observable
public final class ReceiptUploadModel {
    public enum Phase: Equatable, Sendable {
        case idle
        /// A picker handed over a file; it is being copied and checked.
        case reading
        /// Sending `name`; `fraction` of the request body has been sent (0 to 1).
        case uploading(name: String, fraction: Double)
        case failed(ReceiptUploadFailure)
    }

    public private(set) var phase: Phase = .idle
    /// The size of receipts uploaded by this form, by receipt id, so the attachment row can say
    /// "Photo · 1.2 MB" (a linked receipt carries no size).
    public private(set) var sizes: [String: Int] = [:]
    /// The bytes of receipts uploaded by this form, by id, so they can be previewed without a
    /// download (offline included). Only the latest is kept.
    public private(set) var uploaded: (id: String, data: Data)?

    @ObservationIgnored private let transfers: (any ReceiptTransfers)?
    @ObservationIgnored private let attach: @MainActor (ReceiptReference) -> Void
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var pending: ReceiptCandidate?
    /// Bumped by every start, cancel and dismiss, so a late answer or progress report from an
    /// earlier upload is dropped.
    @ObservationIgnored private var generation = 0

    public init(transfers: (any ReceiptTransfers)?, attach: @escaping @MainActor (ReceiptReference) -> Void) {
        self.transfers = transfers
        self.attach = attach
    }

    isolated deinit {
        task?.cancel()
    }

    /// Whether this account can attach receipts at all (false in the demo).
    public var isSupported: Bool { transfers != nil }
    /// Whether an upload can start now (online and signed in).
    public var isAvailable: Bool { transfers?.isAvailable ?? false }
    /// Reading or uploading: Save waits, and the pickers are disabled.
    public var isBusy: Bool {
        switch phase {
        case .reading, .uploading: true
        case .idle, .failed: false
        }
    }

    /// A picker handed over a file: shows it is being read until `upload(_:)` or `refuse(_:)`.
    public func beginReading() {
        cancelTask()
        pending = nil
        phase = .reading
    }

    /// Uploads `candidate`, replacing any upload in flight.
    public func upload(_ candidate: ReceiptCandidate) {
        cancelTask()
        pending = candidate
        start(candidate)
    }

    /// A file the rules refused before anything was sent. It can't be retried.
    public func refuse(_ refusal: ReceiptRefusal) {
        cancelTask()
        pending = nil
        phase = .failed(ReceiptUploadFailure(message: refusal.message, canRetry: false))
    }

    /// Sends the last file again after a failure that may pass.
    public func retry() {
        guard case .failed(let failure) = phase, failure.canRetry, let pending else { return }
        start(pending)
    }

    /// Stops the upload in flight. The draft keeps the receipt it had before.
    public func cancel() {
        cancelTask()
        pending = nil
        phase = .idle
    }

    /// Clears a failure.
    public func dismiss() {
        guard case .failed = phase else { return }
        pending = nil
        phase = .idle
    }

    private func cancelTask() {
        generation += 1
        task?.cancel()
        task = nil
    }

    private func start(_ candidate: ReceiptCandidate) {
        generation += 1
        let current = generation
        guard let transfers else {
            phase = .failed(ReceiptUploadFailure(message: ReceiptUploadFailure.demo, canRetry: false))
            return
        }
        guard transfers.isAvailable else {
            phase = .failed(ReceiptUploadFailure(message: ReceiptUploadFailure.offline, canRetry: true))
            return
        }
        phase = .uploading(name: candidate.name, fraction: 0)
        // Progress arrives on the network thread; only the newest report matters.
        let (fractions, sink) = AsyncStream.makeStream(of: Double.self, bufferingPolicy: .bufferingNewest(1))
        Task { [weak self] in
            for await fraction in fractions { self?.report(fraction, generation: current) }
        }
        task = Task { [weak self] in
            defer { sink.finish() }
            do {
                let receipt = try await transfers.upload(candidate) { sink.yield($0) }
                self?.finish(receipt, candidate: candidate, generation: current)
            } catch is CancellationError {
                return
            } catch {
                self?.fail(error, generation: current)
            }
        }
    }

    private func report(_ fraction: Double, generation: Int) {
        guard generation == self.generation, case .uploading(let name, let previous) = phase,
            fraction > previous
        else { return }
        phase = .uploading(name: name, fraction: min(fraction, 1))
    }

    private func finish(_ receipt: ReceiptReference, candidate: ReceiptCandidate, generation: Int) {
        guard generation == self.generation else { return }
        task = nil
        pending = nil
        sizes[receipt.id] = candidate.byteCount
        uploaded = (receipt.id, candidate.data)
        phase = .idle
        attach(receipt)
    }

    private func fail(_ error: any Error, generation: Int) {
        guard generation == self.generation else { return }
        task = nil
        phase = .failed(ReceiptUploadFailure(error))
    }

    /// The bytes this form uploaded for `id`, if it still has them.
    public func localData(for id: String) -> Data? {
        uploaded?.id == id ? uploaded?.data : nil
    }
}

/// A failed or refused upload, in words. The draft is kept in every case.
public struct ReceiptUploadFailure: Equatable, Sendable {
    public var message: String
    /// Whether Try again (the same file) can help: network and server failures, not a refused
    /// file or an ended session.
    public var canRetry: Bool

    public init(message: String, canRetry: Bool) {
        self.message = message
        self.canRetry = canRetry
    }

    static let offline = "Penny can't reach the server. Check your connection, then try again."
    static let failed = "The upload didn't finish. Try again."
    static let expired = "Your session ended. Sign in again to attach a receipt."
    static let requestTooLarge = "This file is too large to upload. Choose one under 10 MB."
    static let demo = "Receipts are kept on your server, so the demo can't attach one."

    /// The browser's mapping (`uploadError` in apps/web/src/api/receipts.ts).
    init(_ error: any Error) {
        guard let error = error as? APIError else {
            self.init(message: Self.failed, canRetry: true)
            return
        }
        switch error {
        case .unauthorized: self.init(message: Self.expired, canRetry: false)
        case .payloadTooLarge: self.init(message: Self.requestTooLarge, canRetry: false)
        case .badRequest(let message):
            self.init(message: message ?? ReceiptRefusal.unsupported.message, canRetry: false)
        case .invalidRequest: self.init(message: ReceiptRefusal.unsupported.message, canRetry: false)
        case .offline, .timeout, .unreachable: self.init(message: Self.offline, canRetry: true)
        default: self.init(message: Self.failed, canRetry: true)
        }
    }
}
