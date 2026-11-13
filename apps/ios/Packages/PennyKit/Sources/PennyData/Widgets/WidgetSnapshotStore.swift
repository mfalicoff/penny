import CryptoKit
public import Foundation
public import PennyDomain

/// What the widget extension finds in the App Group (docs/ios-widgets.md#states).
public enum WidgetSnapshotRead: Equatable, Sendable {
    /// Nobody is signed in, or the app has not written a snapshot yet.
    case signedOut
    /// The file exists but this build can't read it: written by a newer Penny (a higher
    /// `version`) or damaged. The widget asks the person to open Penny, which rewrites it.
    case unreadable
    case snapshot(WidgetSnapshot)
}

/// Reads and writes the widgets' snapshot in the App Group container (MAZ-80). The app writes;
/// the widget extension only reads. The file is `Widgets/snapshot.json`:
///
/// ```json
/// { "version": 1, "owner": "<16-byte hex>", "snapshot": { …WidgetSnapshot… } }
/// ```
///
/// `owner` is a one-way fingerprint of the account (a prefixed SHA-256 of server and email), so the app can tell another account's snapshot apart and remove it
/// before showing anything; the widgets never learn who is signed in. A change to the
/// snapshot's fields that an older extension can't decode raises `version`.
///
/// The file is written atomically with `completeUntilFirstUserAuthentication` protection: the
/// widgets can render after the first unlock following a restart, as the system requires, and
/// nothing is readable before it.
public struct WidgetSnapshotStore: Sendable {
    /// The envelope version this build writes and the newest it reads.
    public static let version = 1
    static let directoryName = "Widgets"
    static let fileName = "snapshot.json"

    struct Envelope: Codable {
        var version: Int
        var owner: String
        var snapshot: WidgetSnapshot
    }

    /// Just the version, decoded first so a newer layout is reported as such.
    private struct Header: Decodable {
        var version: Int
    }

    public enum WriteFailure: Error, Equatable, Sendable {
        case couldNotWrite(String)
    }

    public let directory: URL

    public var fileURL: URL { directory.appending(path: Self.fileName) }

    /// A store under `root` (the App Group container, or a temporary directory in tests).
    public init(root: URL) {
        directory = root.appending(path: Self.directoryName, directoryHint: .isDirectory)
    }

    /// The store in the App Group the app and the extension share.
    public init(container: SharedContainer) {
        self.init(root: container.directory)
    }

    /// The account fingerprint stored as `owner`.
    public static func owner(_ scope: AccountScope) -> String {
        // Prefixed, so the value never equals the offline ledger's file name for the account.
        let key = "widget\n\(scope.server.description)\n\(scope.email.lowercased())"
        return SHA256.hash(data: Data(key.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
    }

    public func read() -> WidgetSnapshotRead {
        guard let data = try? Data(contentsOf: fileURL) else { return .signedOut }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let header = try? decoder.decode(Header.self, from: data), header.version == Self.version,
            let envelope = try? decoder.decode(Envelope.self, from: data)
        else { return .unreadable }
        return .snapshot(envelope.snapshot)
    }

    /// The fingerprint of the account that wrote the current file, if it can be read.
    public func storedOwner() -> String? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode(Envelope.self, from: data))?.owner
    }

    /// The snapshot currently stored for `owner`, if any (nil for another account's).
    public func snapshot(for owner: String) -> WidgetSnapshot? {
        guard storedOwner() == owner, case .snapshot(let snapshot) = read() else { return nil }
        return snapshot
    }

    public func write(_ snapshot: WidgetSnapshot, owner: String) throws(WriteFailure) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        do {
            let data = try encoder.encode(Envelope(version: Self.version, owner: owner, snapshot: snapshot))
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            throw .couldNotWrite(String(describing: error))
        }
    }

    /// Removes the snapshot (sign-out, an expired session, another account). Returns whether
    /// anything was removed.
    @discardableResult
    public func clear() -> Bool {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return false }
        return (try? FileManager.default.removeItem(at: fileURL)) != nil
    }

    /// Clears the file when it belongs to another account than `owner`. Returns whether it did.
    @discardableResult
    public func clear(unlessOwnedBy owner: String) -> Bool {
        guard FileManager.default.fileExists(atPath: fileURL.path), storedOwner() != owner else { return false }
        return clear()
    }
}
