import Foundation

/// Client telemetry in the test stack (MAZ-129). The server offers the iOS app crash and
/// performance reports only when the stack runs with `penny-env --telemetry`
/// (`PENNY_STACK_TELEMETRY=1 scripts/ios.sh ui-test …`).
extension Stack {
    /// Whether `/api/info` says the server takes the iOS app's reports (`telemetry.native`).
    func takesNativeTelemetry() async throws -> Bool {
        let info = try await send("GET", configuration.apiURL.appending(path: "api/info"))
        return (info["telemetry"] as? [String: Any])?["native"] as? Bool == true
    }
}
