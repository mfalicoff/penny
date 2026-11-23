import Foundation
import XCTest

/// Outgoing email in the test stack (MAZ-124). The stack sends email only when it runs with an
/// SMTP sink (`penny-env --smtp`, `PENNY_STACK_SMTP=1 scripts/ios.sh ui-test …`).
extension Stack {
    /// Whether `/api/info` says the server sends email.
    func sendsEmail() async throws -> Bool {
        let info = try await send("GET", configuration.apiURL.appending(path: "api/info"))
        return info["emailEnabled"] as? Bool == true
    }

    /// Invites `email` to a household by email and waits until the mail worker sent it.
    @discardableResult
    func emailInvite(token: String, household: String, email: String) async throws -> String {
        let invite = try await api(
            "POST", "/api/households/\(household)/email-invites", body: ["email": email], token: token)
        guard let id = invite["id"] as? String else { throw StackError.malformed("POST email-invites") }
        for _ in 0..<60 {
            let list = try await api("GET", "/api/households/\(household)/email-invites", token: token)
            let row = (list["items"] as? [[String: Any]])?.first { $0["id"] as? String == id }
            if let status = row?["status"] as? String, status != "sending" { return status }
            try await Task.sleep(for: .milliseconds(500))
        }
        throw UIExpectationFailed(description: "The invitation to \(email) was never sent")
    }
}
