import Foundation
import XCTest

/// The household API as a second person's device uses it (MAZ-75): the other member creates,
/// invites, joins, edits and records payments through the real API while the app is open.
extension Stack {
    private func api(_ path: String) -> URL { configuration.apiURL.appending(path: "api/households\(path)") }

    /// Creates a household in the account's ledger currency (CAD for new accounts).
    func createHousehold(token: String, name: String) async throws -> String {
        let body = try await send("POST", api(""), body: ["name": name, "currency": "CAD"], token: token)
        guard let id = (body["household"] as? [String: Any])?["id"] as? String else {
            throw StackError.malformed("POST /api/households")
        }
        return id
    }

    func households(token: String) async throws -> [[String: Any]] {
        try await send("GET", api(""), token: token)["households"] as? [[String: Any]] ?? []
    }

    /// A new invite code for 10 minutes (creator only).
    func invite(token: String, household: String) async throws -> String {
        guard
            let code = try await send("POST", api("/\(household)/invites"), body: [:], token: token)["code"] as? String
        else { throw StackError.malformed("POST /api/households/{id}/invites") }
        return code
    }

    func join(token: String, code: String) async throws {
        _ = try await send("POST", api("/join"), body: ["code": code], token: token)
    }

    /// Adds an equal-split expense paid by `payer` (MAZ-79's notification journeys).
    func createExpense(
        token: String, household: String, payer: String, title: String, cents: Int, date: String
    ) async throws -> String {
        let body: [String: Any] = [
            "title": title, "totalCents": cents, "date": date, "payerUserId": payer, "splitMode": "equal",
            "category": ["name": "Food", "icon": "cafe-outline", "color": "#E47850"], "note": "",
        ]
        guard
            let id =
                (try await send("POST", api("/\(household)/expenses"), body: body, token: token)["expense"]
                as? [String: Any])?["id"] as? String
        else { throw StackError.malformed("POST /api/households/{id}/expenses") }
        return id
    }

    func expenses(token: String, household: String) async throws -> [[String: Any]] {
        try await send("GET", api("/\(household)/expenses"), token: token)["expenses"] as? [[String: Any]] ?? []
    }

    /// Records `fromUserId`'s share of an expense as paid, as that person would.
    func recordSharePayment(token: String, household: String, expense: [String: Any], from userID: String)
        async throws
    {
        guard let id = expense["id"] as? String, let revision = expense["revision"] as? Int else {
            throw StackError.malformed("expense")
        }
        _ = try await send(
            "POST", api("/\(household)/expenses/\(id)/payments"), body: ["fromUserId": userID, "revision": revision],
            token: token)
    }

    /// Renames an expense from the other device (a metadata edit; paid expenses allow it).
    func renameExpense(token: String, household: String, expense: [String: Any], title: String) async throws {
        guard let id = expense["id"] as? String else { throw StackError.malformed("expense") }
        var body: [String: Any] = [:]
        for key in ["totalCents", "date", "payerUserId", "splitMode", "category", "note", "revision"] {
            body[key] = expense[key]
        }
        body["title"] = title
        if (expense["splitMode"] as? String) != "equal" {
            body["allocations"] = (expense["splits"] as? [[String: Any]]) ?? []
        }
        _ = try await send("PUT", api("/\(household)/expenses/\(id)"), body: body, token: token)
    }

    /// Polls until the account's view of the household's expenses satisfies `condition`.
    @discardableResult
    func waitForExpenses(
        token: String, household: String, timeout: TimeInterval = 20, _ condition: ([[String: Any]]) -> Bool
    ) async throws -> [[String: Any]] {
        let deadline = Date().addingTimeInterval(timeout)
        while true {
            let expenses = try await expenses(token: token, household: household)
            if condition(expenses) { return expenses }
            guard Date() < deadline else {
                throw UIExpectationFailed(description: "The household's expenses did not reach the expected state")
            }
            try await Task.sleep(for: .milliseconds(500))
        }
    }
}
