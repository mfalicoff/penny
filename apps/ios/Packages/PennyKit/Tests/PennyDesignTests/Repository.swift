import Foundation
import Testing

/// Files from the repository checkout, for tests that guard against drift from the
/// shared contracts.
enum Repository {
    // apps/ios/Packages/PennyKit/Tests/PennyDesignTests/Repository.swift -> repository root
    static let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent()

    static func json(_ path: String) throws -> [String: Any] {
        let data = try Data(contentsOf: root.appendingPathComponent(path))
        return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}
