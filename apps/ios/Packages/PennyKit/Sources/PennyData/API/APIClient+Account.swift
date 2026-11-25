public import Foundation

// MAZ-152: deleting the account and the full export. See contracts/openapi.json
// (`postApiAccountDelete`, `AccountDeletion`, `getApiExport`).

/// `POST /api/account/delete`'s body: the password for a password account, nothing for one that
/// signs in with a provider.
struct WireAccountDeletion: Encodable, Equatable, Sendable {
    var password: String?

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(password, forKey: .password)
    }

    private enum CodingKeys: String, CodingKey { case password }
}

/// The ZIP `GET /api/export` returned.
public struct AccountExport: Equatable, Sendable {
    public let data: Data
    /// `penny-export-YYYY-MM-DD.zip`, from `Content-Disposition`.
    public let filename: String

    public init(data: Data, filename: String) {
        self.data = data
        self.filename = filename
    }
}

extension APIClient {
    /// `POST /api/account/delete`. 400 for a wrong or missing password and 409 when a household
    /// rule blocks leaving; nothing is deleted then and the session stays. On success the server
    /// has ended every session, this one included.
    public func deleteAccount(password: String?) async throws {
        if let password, password.utf16.count > 256 {
            throw APIError.badRequest(message: AccountDeletionFailure.wrongPasswordMessage)
        }
        let ok: WireOk = try await json(.post, "/api/account/delete", body: WireAccountDeletion(password: password))
        guard ok.ok else { throw APIError.malformedResponse }
    }

    /// `GET /api/export`: one ZIP with everything on the server that belongs to the person.
    public func exportAll() async throws -> AccountExport {
        let result = try await perform(
            .get, "/api/export", headers: ["Accept": "application/zip"], timeout: configuration.transferTimeout)
        let contentType = (result.headers["content-type"] ?? "").lowercased()
        guard !result.body.isEmpty, !contentType.hasPrefix("application/json") else {
            throw APIError.malformedResponse
        }
        return AccountExport(
            data: result.body,
            filename: AccountExportFile.safeName(Self.filename(result.headers["content-disposition"])))
    }
}

/// The export on this device: a temporary file the share sheet hands over, removed when the page
/// closes and at the next launch or account change. It is written with complete file protection
/// under `tmp/PennyExport`, which is never backed up.
public struct AccountExportFile: Equatable, Sendable {
    public let url: URL
    public let filename: String
    public let byteCount: Int

    /// `tmp/PennyExport` in the app's container.
    public static let root = FileManager.default.temporaryDirectory.appending(
        path: "PennyExport", directoryHint: .isDirectory)

    /// The fallback when the server sends no usable name.
    public static func defaultName(on date: Date = Date(), calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "penny-export-%04d-%02d-%02d.zip", parts.year ?? 2000, parts.month ?? 1, parts.day ?? 1)
    }

    /// The server's name kept to a plain `.zip` file name: no folders, control characters or
    /// leading dots.
    static func safeName(_ name: String?) -> String {
        let unsafe = CharacterSet(charactersIn: "/\\:").union(.controlCharacters)
        var stem = String(String.UnicodeScalarView((name ?? "").unicodeScalars.filter { !unsafe.contains($0) }))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        while stem.hasPrefix(".") { stem.removeFirst() }
        if stem.lowercased().hasSuffix(".zip") { stem = String(stem.dropLast(4)) }
        if stem.isEmpty { return defaultName() }
        return "\(stem.prefix(120)).zip"
    }

    /// Writes `export` in a new folder under `root` and returns the file.
    public static func write(_ export: AccountExport, root: URL = root) throws -> AccountExportFile {
        let folder = root.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appending(path: safeName(export.filename), directoryHint: .notDirectory)
        do {
            #if os(iOS)
                try export.data.write(to: url, options: [.atomic, .completeFileProtection])
            #else
                try export.data.write(to: url, options: .atomic)
            #endif
        } catch {
            try? FileManager.default.removeItem(at: folder)
            throw error
        }
        return AccountExportFile(url: url, filename: url.lastPathComponent, byteCount: export.data.count)
    }

    /// Removes this file and its folder.
    public func remove() {
        try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }

    /// Removes every export left on this device.
    public static func purge(root: URL = root) {
        try? FileManager.default.removeItem(at: root)
    }
}
