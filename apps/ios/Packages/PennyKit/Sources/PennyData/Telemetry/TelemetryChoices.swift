import Foundation
import Synchronization

/// What this install agreed to send (MAZ-129, cards `iphone-monitoring-prompt` and
/// `iphone-privacy`). Everything is off until the person chooses: the prompt's Share reports turns
/// both kinds on, and Settings › Privacy switches each on or off. Choices belong to the install,
/// not the account, like Appearance; signing out keeps them.
public struct TelemetryChoices: Codable, Equatable, Sendable {
    /// Crashes, hangs and errors (log records).
    public var crashes: Bool
    /// API call and launch timings (spans), and `traceparent` on API calls.
    public var performance: Bool
    /// Whether the person answered the prompt (either way), so it never asks twice.
    public var decided: Bool

    public static let none = TelemetryChoices(crashes: false, performance: false, decided: false)

    public init(crashes: Bool, performance: Bool, decided: Bool) {
        self.crashes = crashes
        self.performance = performance
        self.decided = decided
    }

    private enum CodingKeys: String, CodingKey { case crashes, performance, decided }

    /// Anything missing or malformed reads as off.
    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        crashes = (try? container.decodeIfPresent(Bool.self, forKey: .crashes)) == true
        performance = (try? container.decodeIfPresent(Bool.self, forKey: .performance)) == true
        decided = (try? container.decodeIfPresent(Bool.self, forKey: .decided)) == true
    }
}

/// Where the choices are kept. Not secret, so in the app's preferences.
public protocol TelemetryChoiceStore: Sendable {
    func load() -> TelemetryChoices
    func save(_ choices: TelemetryChoices)
}

/// `TelemetryChoiceStore` in `UserDefaults.standard` (or a named suite in tests).
public struct UserDefaultsTelemetryChoiceStore: TelemetryChoiceStore {
    static let key = "penny.telemetry"

    private let suiteName: String?

    public init(suiteName: String? = nil) {
        self.suiteName = suiteName
    }

    private var defaults: UserDefaults {
        suiteName.flatMap(UserDefaults.init(suiteName:)) ?? .standard
    }

    public func load() -> TelemetryChoices {
        defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode(TelemetryChoices.self, from: $0) }
            ?? .none
    }

    public func save(_ choices: TelemetryChoices) {
        if let data = try? JSONEncoder().encode(choices) { defaults.set(data, forKey: Self.key) }
    }
}

/// Choices in memory, for previews and tests.
public final class EphemeralTelemetryChoiceStore: TelemetryChoiceStore {
    private let choices: Mutex<TelemetryChoices>

    public init(_ choices: TelemetryChoices = .none) {
        self.choices = Mutex(choices)
    }

    public func load() -> TelemetryChoices { choices.withLock { $0 } }
    public func save(_ choices: TelemetryChoices) { self.choices.withLock { $0 = choices } }
}
