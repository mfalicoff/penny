public import Foundation
public import Observation
public import PennyDomain

/// Temporary files for receipt previews and picked files (MAZ-78). Each file sits in its own
/// folder under `root` (inside the app's temporary directory, never backed up), written with
/// complete file protection so it can't be read while the device is locked. A preview removes
/// its file when it closes; `purge()` removes everything left over (launch, account change).
public struct ReceiptFileCache: Sendable {
    public let root: URL

    public init(root: URL) {
        self.root = root
    }

    /// `tmp/PennyReceipts` in the app's container.
    public static let standard = ReceiptFileCache(
        root: FileManager.default.temporaryDirectory.appending(path: "PennyReceipts", directoryHint: .isDirectory))

    /// Writes `data` as `name` (made safe for a file name, with `mime`'s extension) in a new
    /// folder, and returns the file's URL.
    public func write(_ data: Data, name: String, mime: String) throws -> URL {
        let folder = try makeFolder()
        let url = folder.appending(path: Self.fileName(name, mime: mime), directoryHint: .notDirectory)
        do {
            #if os(iOS)
                try data.write(to: url, options: [.atomic, .completeFileProtection])
            #else
                try data.write(to: url, options: .atomic)
            #endif
        } catch {
            try? FileManager.default.removeItem(at: folder)
            throw error
        }
        return url
    }

    /// Copies a file a picker handed over (it may delete its own copy as soon as it returns).
    public func copy(_ source: URL) throws -> URL {
        let folder = try makeFolder()
        let name = source.lastPathComponent.isEmpty ? "receipt" : source.lastPathComponent
        let url = folder.appending(path: name, directoryHint: .notDirectory)
        do {
            try FileManager.default.copyItem(at: source, to: url)
        } catch {
            try? FileManager.default.removeItem(at: folder)
            throw error
        }
        return url
    }

    /// Removes a file written here, with its folder. Anything outside `root` is left alone.
    public func remove(_ url: URL) {
        let folder = url.deletingLastPathComponent()
        guard Self.path(folder.deletingLastPathComponent()) == Self.path(root) else { return }
        try? FileManager.default.removeItem(at: folder)
    }

    /// Removes every file written here.
    public func purge() {
        try? FileManager.default.removeItem(at: root)
    }

    /// The files currently kept (tests and diagnostics).
    public func files() -> [URL] {
        let folders = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        return folders.flatMap {
            (try? FileManager.default.contentsOfDirectory(at: $0, includingPropertiesForKeys: nil)) ?? []
        }
    }

    private static func path(_ url: URL) -> String {
        var path = url.standardizedFileURL.path(percentEncoded: false)
        while path.count > 1, path.hasSuffix("/") { path.removeLast() }
        return path
    }

    private func makeFolder() throws -> URL {
        let folder = root.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    /// A file name the preview and share sheet can use: no path separators or control
    /// characters, not hidden, at most 120 characters, ending in the type's extension.
    static func fileName(_ name: String, mime: String) -> String {
        let pathExtension = ReceiptRules.fileExtension(for: mime)
        var stem = (name as NSString).deletingPathExtension
        if ReceiptRules.mime(forExtension: (name as NSString).pathExtension) != mime { stem = name }
        let unsafe = CharacterSet(charactersIn: "/\\:").union(.controlCharacters)
        stem = String(String.UnicodeScalarView(stem.unicodeScalars.map { unsafe.contains($0) ? "-" : $0 }))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        while stem.hasPrefix(".") { stem.removeFirst() }
        if stem.isEmpty { stem = "receipt" }
        if stem.count > 120 { stem = String(stem.prefix(120)) }
        return "\(stem).\(pathExtension)"
    }
}

/// A receipt written to a temporary file for preview and sharing.
public struct ReceiptPreviewFile: Equatable, Sendable {
    public let url: URL
    public let mime: String
    public let byteCount: Int
}

/// Why a receipt can't be shown, in words, with whether Try again can help.
public enum ReceiptPreviewFailure: Equatable, Sendable {
    /// 404: missing, or this account may not read it (the API doesn't tell them apart).
    case notAvailable
    /// A link the server doesn't serve (a receipt attached by the legacy native app).
    case notServed
    case sessionEnded
    case offline
    case failed

    public var message: String {
        switch self {
        case .notAvailable:
            "This receipt isn't available. It may have been removed, or you no longer have access to it."
        case .notServed: "This receipt was attached by an earlier version of Penny and can only be shown by name."
        case .sessionEnded: "Your session ended. Sign in again to see this receipt."
        case .offline: "Penny can't reach the server, so the receipt can't be shown. Try again when you're online."
        case .failed: "Penny couldn't load this receipt. Try again."
        }
    }

    public var canRetry: Bool { self == .offline || self == .failed }

    init(_ error: any Error) {
        switch error as? APIError {
        case .notFound: self = .notAvailable
        case .unauthorized: self = .sessionEnded
        case .offline, .timeout, .unreachable: self = .offline
        default: self = .failed
        }
    }
}

/// The receipt viewer's state (MAZ-78, `receipt` card): an authenticated download into a
/// temporary file, then the file for the image or PDF view and the share sheet. Closing it
/// cancels a download in flight and removes the file.
@MainActor
@Observable
public final class ReceiptPreviewModel {
    public enum State: Equatable, Sendable {
        case loading
        case ready(ReceiptPreviewFile)
        case failed(ReceiptPreviewFailure)
    }

    public let receipt: ReceiptReference
    public private(set) var state: State = .loading

    @ObservationIgnored private let transfers: (any ReceiptTransfers)?
    @ObservationIgnored private let cache: ReceiptFileCache
    @ObservationIgnored private let localData: Data?
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var closed = false

    /// - Parameter localData: the receipt's bytes when this device still has them (just
    ///   uploaded from the form), so they are shown without a download.
    public init(
        receipt: ReceiptReference, transfers: (any ReceiptTransfers)?, cache: ReceiptFileCache = .standard,
        localData: Data? = nil
    ) {
        self.receipt = receipt
        self.transfers = transfers
        self.cache = cache
        self.localData = localData
    }

    isolated deinit {
        task?.cancel()
        if case .ready(let file) = state { cache.remove(file.url) }
    }

    /// Starts (or restarts, after a failure) loading the receipt.
    public func load() {
        guard !closed else { return }
        if case .ready = state { return }
        task?.cancel()
        state = .loading
        let receipt = receipt
        if let localData {
            show(localData, mime: receipt.mime)
            return
        }
        guard let id = ReceiptRules.servedID(receipt) else {
            state = .failed(.notServed)
            return
        }
        guard let transfers else {
            state = .failed(.notAvailable)
            return
        }
        guard transfers.isAvailable else {
            state = .failed(.offline)
            return
        }
        task = Task { [weak self] in
            do {
                let file = try await transfers.download(id: id)
                guard !Task.isCancelled else { return }
                // The stored type wins over the link's when they differ (they shouldn't).
                self?.show(file.data, mime: ReceiptRules.mimes.contains(file.mime) ? file.mime : receipt.mime)
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                self?.state = .failed(ReceiptPreviewFailure(error))
            }
        }
    }

    /// Cancels a download in flight and removes the temporary file. Call when the viewer
    /// closes; the model shows nothing afterwards.
    public func close() {
        closed = true
        task?.cancel()
        task = nil
        if case .ready(let file) = state { cache.remove(file.url) }
        state = .loading
    }

    private func show(_ data: Data, mime: String) {
        guard !closed else { return }
        do {
            let url = try cache.write(data, name: receipt.name, mime: mime)
            state = .ready(ReceiptPreviewFile(url: url, mime: mime, byteCount: data.count))
        } catch {
            state = .failed(.failed)
        }
    }
}
