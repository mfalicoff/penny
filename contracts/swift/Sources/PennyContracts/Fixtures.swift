import Foundation

public enum FixtureError: Error, CustomStringConvertible {
    case notFound(String)
    case notStrict(String)

    public var description: String {
        switch self {
        case .notFound(let name): "Contract fixture \(name) not found."
        case .notStrict(let name): "\(name) has members the Swift model does not declare, or values it changes."
        }
    }
}

/// Loads contracts/fixtures (or `PENNY_CONTRACT_FIXTURES`). Decoding is strict: the
/// typed value is encoded again and must equal the file, so an unknown member, a
/// missing required member or a lossy type fails as it does in C# and TypeScript.
public enum Fixtures {
    public static var directory: URL {
        if let override = ProcessInfo.processInfo.environment["PENNY_CONTRACT_FIXTURES"] {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        // contracts/swift/Sources/PennyContracts/Fixtures.swift -> contracts/fixtures
        return URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("fixtures", isDirectory: true)
    }

    public static func data(_ name: String) throws -> Data {
        let url = directory.appendingPathComponent(name)
        guard let data = FileManager.default.contents(atPath: url.path) else { throw FixtureError.notFound(name) }
        return data
    }

    public static func decode<T: Codable>(_ type: T.Type, from name: String) throws -> T {
        let data = try data(name)
        let value = try JSONDecoder().decode(T.self, from: data)
        let original = try JSONDecoder().decode(JSONValue.self, from: data)
        let encoded = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
        // Swift optionals omit nil on encode, so an explicit null equals an absent member.
        guard original.droppingNullMembers == encoded.droppingNullMembers else {
            throw FixtureError.notStrict(name)
        }
        return value
    }

    /// SHA-256 of the fixture text with LF line endings, as published in manifest.json.
    public static func sha256(_ name: String) throws -> String {
        var text = String(decoding: try data(name), as: UTF8.self)
        text = text.replacingOccurrences(of: "\r\n", with: "\n")
        return SHA256.hex(Array(text.utf8))
    }
}
