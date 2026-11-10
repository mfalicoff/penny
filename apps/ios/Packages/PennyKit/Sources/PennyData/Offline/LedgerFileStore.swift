import CryptoKit
import Darwin
public import Foundation
public import PennyDomain

/// One account's durable ledger: the last snapshot the server acknowledged (`base`) and the
/// ledger this device shows (`local` = `base` plus unsynced changes). Pending work is the
/// difference between the two, so it survives exactly as long as this record does.
public struct LocalLedgerSnapshot: Equatable, Sendable {
    public var base: Ledger
    public var local: Ledger
    /// The server revision `base` was read or written at.
    public var baseRevision: Int
    /// When the server last acknowledged this device's ledger (a fetch or a write).
    public var lastSyncedAt: Date?

    public init(base: Ledger, local: Ledger, baseRevision: Int, lastSyncedAt: Date?) {
        self.base = base
        self.local = local
        self.baseRevision = baseRevision
        self.lastSyncedAt = lastSyncedAt
    }

    public var pending: PendingChanges { PendingChanges(base: base, local: local) }
    public var hasPendingChanges: Bool { base != local }
}

/// Why the durable ledger could not be read or written. Branch on the case.
public enum LedgerStoreError: Error, Equatable, Sendable {
    /// The file exists but cannot be opened now (for example data protection before the
    /// first unlock). Nothing is wrong with it; try again later. Never treated as corrupt.
    case unavailable
    /// The file exists but is not a ledger this build can read: damaged, truncated or
    /// tampered with. It is kept (moved aside on recovery), never overwritten silently.
    case unreadable
    /// Written by a newer build (a higher `format`). Kept as is; update the app.
    case newerFormat(Int)
    /// The record belongs to another server or email than the one asked for.
    case wrongAccount
    /// Writing failed (disk full, I/O error). The previous record is unchanged.
    case writeFailed
}

/// The file operations the store needs, so tests can fail a write or a read on purpose.
public protocol LedgerFileSystem: Sendable {
    /// The file's bytes, or nil when it does not exist.
    func read(_ url: URL) throws -> Data?
    /// Replaces the file atomically and durably: after it returns, a crash or power loss
    /// leaves either the old file or the new one, never a mix.
    func write(_ data: Data, to url: URL) throws
    /// Removes the file; no error when it is already gone.
    func remove(_ url: URL) throws
    func move(_ source: URL, to destination: URL) throws
    /// The files in a directory; empty when it does not exist.
    func files(in directory: URL) throws -> [URL]
    /// When the file was last written, or nil when that cannot be read.
    func modificationDate(of url: URL) -> Date?
}

extension LedgerFileSystem {
    public func modificationDate(of url: URL) -> Date? {
        (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date
    }
}

/// Files under Application Support, written through a temporary file that is flushed to
/// stable storage (`F_FULLFSYNC`) and renamed over the old one, then the directory is
/// flushed. Files are protected until first unlock (so a background sync after a restart
/// can still run once the device was unlocked) and excluded from backups (the server is the
/// copy that is backed up; restoring stale pending work onto a new device would undo newer
/// edits).
public struct DurableFileSystem: LedgerFileSystem {
    public init() {}

    public func read(_ url: URL) throws -> Data? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try Data(contentsOf: url)
    }

    public func write(_ data: Data, to url: URL) throws {
        let directory = url.deletingLastPathComponent()
        try prepare(directory)
        let temporary = directory.appendingPathComponent(".\(url.lastPathComponent).\(UUID().uuidString).tmp")
        defer { try? FileManager.default.removeItem(at: temporary) }
        let descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL, 0o600)
        guard descriptor >= 0 else { throw POSIXError(.init(rawValue: errno) ?? .EIO) }
        do {
            try data.withUnsafeBytes { buffer in
                var offset = 0
                while offset < buffer.count {
                    let written = Darwin.write(
                        descriptor, buffer.baseAddress?.advanced(by: offset), buffer.count - offset)
                    if written < 0 {
                        if errno == EINTR { continue }
                        throw POSIXError(.init(rawValue: errno) ?? .EIO)
                    }
                    offset += written
                }
            }
            // F_FULLFSYNC asks the drive to flush its cache too; fall back to fsync where
            // the file system does not support it.
            if fcntl(descriptor, F_FULLFSYNC) != 0, fsync(descriptor) != 0 {
                throw POSIXError(.init(rawValue: errno) ?? .EIO)
            }
        } catch {
            close(descriptor)
            throw error
        }
        close(descriptor)
        #if os(iOS)
            try FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: temporary.path)
        #endif
        guard rename(temporary.path, url.path) == 0 else { throw POSIXError(.init(rawValue: errno) ?? .EIO) }
        let directoryDescriptor = open(directory.path, O_RDONLY)
        if directoryDescriptor >= 0 {
            _ = fsync(directoryDescriptor)
            close(directoryDescriptor)
        }
    }

    public func remove(_ url: URL) throws {
        do {
            try FileManager.default.removeItem(at: url)
        } catch let error as CocoaError where error.code == .fileNoSuchFile {
            return
        }
    }

    public func move(_ source: URL, to destination: URL) throws {
        try FileManager.default.moveItem(at: source, to: destination)
    }

    public func files(in directory: URL) throws -> [URL] {
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
    }

    private func prepare(_ directory: URL) throws {
        guard !FileManager.default.fileExists(atPath: directory.path) else { return }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var excluded = directory
        try excluded.setResourceValues(values)
    }
}

/// Reads and writes each account's `LocalLedgerSnapshot` as one JSON file. Accounts never
/// share a file: the name is a hash of the server and the lowercased email, and the record
/// repeats both so a misplaced file is refused (`wrongAccount`).
///
/// Format 1 (see docs/ios-offline-sync.md for the schema and the migration rules):
///
/// ```json
/// {"format":1,"server":"https://…","email":"…","baseRevision":12,
///  "base":{ledger v4},"local":{ledger v4},"lastSyncedAt":"…","savedAt":"…"}
/// ```
public struct LedgerFileStore: Sendable {
    public static let format = 1

    public let directory: URL
    let fileSystem: any LedgerFileSystem
    let now: @Sendable () -> Date

    public init(
        directory: URL, fileSystem: any LedgerFileSystem = DurableFileSystem(),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.directory = directory
        self.fileSystem = fileSystem
        self.now = now
    }

    /// `Application Support/Penny/Ledgers` in the app's own container (not the App Group:
    /// widgets get their own reduced snapshots, MAZ-80).
    public static var defaultDirectory: URL {
        URL.applicationSupportDirectory.appending(path: "Penny/Ledgers", directoryHint: .isDirectory)
    }

    struct Record: Codable {
        var format: Int
        var server: String
        var email: String
        var baseRevision: Int
        var base: WireLedger
        var local: WireLedger
        var lastSyncedAt: Date?
        var savedAt: Date
    }

    /// Only the header, to list accounts and to detect a newer format before decoding the rest.
    struct Header: Decodable {
        var format: Int
        var server: String?
        var email: String?
    }

    static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    func fileName(for scope: AccountScope) -> String {
        let key = "\(scope.server.description)\n\(scope.email.lowercased())"
        let digest = SHA256.hash(data: Data(key.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
        return "ledger-\(digest)"
    }

    public func url(for scope: AccountScope) -> URL {
        directory.appendingPathComponent("\(fileName(for: scope)).json")
    }

    /// The account's snapshot, or nil when this device has none yet.
    public func load(_ scope: AccountScope) throws(LedgerStoreError) -> LocalLedgerSnapshot? {
        let data: Data?
        do {
            data = try fileSystem.read(url(for: scope))
        } catch {
            throw .unavailable
        }
        guard let data else { return nil }
        let decoder = Self.decoder()
        guard let header = try? decoder.decode(Header.self, from: data) else { throw .unreadable }
        guard header.format <= Self.format else { throw .newerFormat(header.format) }
        guard let record = try? decoder.decode(Record.self, from: data), record.format == Self.format else {
            throw .unreadable
        }
        guard record.server == scope.server.description, record.email.lowercased() == scope.email.lowercased() else {
            throw .wrongAccount
        }
        do {
            return LocalLedgerSnapshot(
                base: try Ledger(wire: record.base), local: try Ledger(wire: record.local),
                baseRevision: record.baseRevision, lastSyncedAt: record.lastSyncedAt)
        } catch {
            throw .unreadable
        }
    }

    /// Writes the snapshot durably. When it throws, the previous file is unchanged.
    public func save(_ snapshot: LocalLedgerSnapshot, for scope: AccountScope) throws(LedgerStoreError) {
        let record = Record(
            format: Self.format, server: scope.server.description, email: scope.email.lowercased(),
            baseRevision: snapshot.baseRevision, base: WireLedger(snapshot.base), local: WireLedger(snapshot.local),
            lastSyncedAt: snapshot.lastSyncedAt, savedAt: now())
        do {
            try fileSystem.write(try Self.encoder().encode(record), to: url(for: scope))
        } catch {
            throw .writeFailed
        }
    }

    /// Whether `file` is a durable write's temporary file (`.ledger-<hash>.json.<uuid>.tmp`),
    /// for the account named `name` when given.
    static func isTemporary(_ file: String, for name: String? = nil) -> Bool {
        guard file.hasPrefix(".ledger-"), file.hasSuffix(".tmp") else { return false }
        return name.map { file.hasPrefix(".\($0).") } ?? true
    }

    /// Removes the account's ledger, any copies set aside by `setAside`, and temporary files
    /// an interrupted write left for it (they hold the account's ledger too).
    public func remove(_ scope: AccountScope) throws(LedgerStoreError) {
        let name = fileName(for: scope)
        do {
            for file in try fileSystem.files(in: directory)
            where file.lastPathComponent.hasPrefix(name) || Self.isTemporary(file.lastPathComponent, for: name) {
                try fileSystem.remove(file)
            }
        } catch {
            throw .writeFailed
        }
    }

    /// Removes temporary files that writes interrupted by a crash or power loss left behind
    /// (a write that returns removes its own). Only files older than `age`, so a write still
    /// in progress is never touched. Best effort: a stray file is never read.
    public func removeStaleTemporaryFiles(olderThan age: TimeInterval = 60) {
        let cutoff = Date().addingTimeInterval(-age)
        for file in (try? fileSystem.files(in: directory)) ?? [] where Self.isTemporary(file.lastPathComponent) {
            guard let written = fileSystem.modificationDate(of: file), written < cutoff else { continue }
            try? fileSystem.remove(file)
        }
    }

    /// Moves an unreadable file aside (kept for support and manual recovery, removed with the
    /// account) so the account can start again from the server. Returns the new location.
    @discardableResult
    public func setAside(_ scope: AccountScope) throws(LedgerStoreError) -> URL {
        let stamp = Int(now().timeIntervalSince1970)
        let destination = directory.appendingPathComponent("\(fileName(for: scope)).unreadable-\(stamp).json")
        do {
            try fileSystem.move(url(for: scope), to: destination)
        } catch {
            throw .writeFailed
        }
        return destination
    }

    /// Every account with a readable header in the store, for example to offer removing
    /// entries a sign-out could not remove after a relaunch.
    public func storedScopes() -> [AccountScope] {
        let decoder = Self.decoder()
        let files = (try? fileSystem.files(in: directory)) ?? []
        return files.filter { $0.pathExtension == "json" && !$0.lastPathComponent.contains(".unreadable-") }
            .compactMap { file in
                guard let data = try? fileSystem.read(file), let header = try? decoder.decode(Header.self, from: data),
                    let server = header.server.flatMap({ try? ServerURL($0) }), let email = header.email
                else { return nil }
                return AccountScope(server: server, email: email)
            }
    }
}
