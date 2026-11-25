public import Foundation
public import Observation

/// Settings › Profile › Export all your data (MAZ-152, card `iphone-export-all`): the server
/// prepares one ZIP, the app keeps it in a temporary file for the share sheet, and removes it when
/// the page closes. Nil service (the demo) prepares nothing.
@MainActor
@Observable
public final class AccountExportModel {
    public enum State: Equatable, Sendable {
        case idle
        case preparing
        case ready(AccountExportFile)
        case failed(String)
    }

    public private(set) var state: State = .idle

    @ObservationIgnored private let service: (any ProfileService)?
    @ObservationIgnored private let root: URL
    @ObservationIgnored private var attempt = 0

    public init(service: (any ProfileService)?, root: URL = AccountExportFile.root) {
        self.service = service
        self.root = root
    }

    public nonisolated static let failedMessage = "The file wasn't prepared. Try again."

    /// Asks the server for the export, unless it is already prepared or being prepared.
    public func prepare() async {
        switch state {
        case .preparing, .ready: return
        case .idle, .failed: break
        }
        guard let service else {
            state = .failed("The demo has no data on a server to export.")
            return
        }
        attempt += 1
        let current = attempt
        state = .preparing
        do {
            let export = try await service.exportAll()
            let file = try AccountExportFile.write(export, root: root)
            guard current == attempt else {
                file.remove()
                return
            }
            state = .ready(file)
        } catch is CancellationError {
            if current == attempt { state = .idle }
        } catch {
            guard current == attempt else { return }
            state = .failed(Self.message(error))
        }
    }

    /// The page closed: the file goes, and a late answer is dropped.
    public func close() {
        attempt += 1
        if case .ready(let file) = state { file.remove() }
        state = .idle
    }

    static func message(_ error: any Error) -> String {
        guard let error = error as? APIError else { return failedMessage }
        switch error {
        case .offline, .timeout, .unreachable: return AccountDeletionFailure.offlineMessage
        case .unauthorized: return "Your session ended. Sign in again."
        default: return failedMessage
        }
    }
}

/// "14.2 MB", "820 KB", "512 bytes", as on the web.
public enum FileSizeText {
    public static func text(_ bytes: Int) -> String {
        if bytes < 1000 { return "\(bytes) bytes" }
        if bytes < 1_000_000 { return "\(Int((Double(bytes) / 1000).rounded())) KB" }
        return String(format: "%.1f MB", Double(bytes) / 1_000_000)
    }
}
