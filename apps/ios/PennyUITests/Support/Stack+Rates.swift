import Foundation

/// Exchange rates in the test stack (MAZ-151). The server serves rates only when the stack runs
/// with `penny-env --rates` (`PENNY_STACK_RATES=1 scripts/ios.sh ui-test cards`): synthetic
/// per-euro quotes for the last 60 days, with nothing fetched.
extension Stack {
    /// Whether `GET /api/rates` answers with rates (`enabled`), asked as a throwaway account.
    func servesRates() async throws -> Bool {
        let account = try await createAccount(label: "rates")
        let answer = try await api("GET", "/api/rates?base=EUR", token: account.token)
        return answer["enabled"] as? Bool == true && !((answer["rates"] as? [String: Any]) ?? [:]).isEmpty
    }
}
